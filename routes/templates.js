// routes/templates.js - UPDATED WITH CLOUDINARY
const express = require('express');
const router = express.Router();
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const Template = require('../models/Template');

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true // Force HTTPS
});

// Cloudinary storage for templates
const templateStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'student-cards/templates',
    allowed_formats: ['jpg', 'jpeg', 'png', 'pdf', 'svg'],
    public_id: (req, file) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      return `template-${uniqueSuffix}`;
    },
    transformation: [
      { width: 1200, height: 800, crop: "limit" }, // Optimize for ID cards
      { quality: "auto:good" } // Auto optimize quality
    ]
  }
});

const upload = multer({
  storage: templateStorage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
    files: 2 // Max 2 files (front & back)
  },
  fileFilter: (req, file, cb) => {
    // Accept only image files
    const allowedTypes = /jpeg|jpg|png|pdf|svg/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files (jpeg, jpg, png, pdf, svg) are allowed!'));
    }
  }
});

// ✅ GET all templates
router.get('/', async (req, res) => {
  try {
    console.log('🔍 Fetching templates from database...');
    const templates = await Template.find().sort({ isDefault: -1, createdAt: -1 });
    
    // Generate signed URLs for templates that expire after 1 hour
    const templatesWithUrls = templates.map(template => ({
      ...template.toObject(),
      frontSideUrl: generateSignedUrl(template.frontSide.public_id),
      backSideUrl: template.backSide ? generateSignedUrl(template.backSide.public_id) : null
    }));
    
    console.log(`📊 Found ${templates.length} templates`);
    res.json({ success: true, templates: templatesWithUrls });
  } catch (error) {
    console.error('❌ Error fetching templates:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ✅ UPLOAD new template with Cloudinary
router.post('/upload', upload.fields([
  { name: 'frontSide', maxCount: 1 },
  { name: 'backSide', maxCount: 1 }
]), async (req, res) => {
  try {
    const { name, description, setAsDefault } = req.body;
    
    console.log('📦 Upload request received');
    
    if (!req.files.frontSide || !req.files.backSide) {
      return res.status(400).json({ 
        success: false, 
        error: 'Both front and back sides are required' 
      });
    }

    // Cloudinary returns file info in req.files
    const frontFile = req.files.frontSide[0];
    const backFile = req.files.backSide[0];

    // Create template with Cloudinary URLs and public_ids
    const template = new Template({
      name,
      description,
      frontSide: {
        url: frontFile.path, // Cloudinary URL
        secure_url: frontFile.path, // HTTPS URL
        public_id: frontFile.filename, // Cloudinary public_id
        originalname: frontFile.originalname,
        format: frontFile.format,
        width: frontFile.width,
        height: frontFile.height,
        bytes: frontFile.size,
        resource_type: frontFile.resource_type
      },
      backSide: {
        url: backFile.path,
        secure_url: backFile.path,
        public_id: backFile.filename,
        originalname: backFile.originalname,
        format: backFile.format,
        width: backFile.width,
        height: backFile.height,
        bytes: backFile.size,
        resource_type: backFile.resource_type
      },
      isDefault: setAsDefault === 'true'
    });

    // If set as default, unset other defaults
    if (template.isDefault) {
      await Template.updateMany(
        { _id: { $ne: template._id } },
        { $set: { isDefault: false } }
      );
    }

    await template.save();
    console.log('✅ Template saved to Cloudinary');
    console.log('   Front URL:', template.frontSide.secure_url);
    console.log('   Back URL:', template.backSide.secure_url);
    
    res.json({ 
      success: true, 
      message: 'Template uploaded to cloud successfully', 
      template 
    });

  } catch (error) {
    console.error('❌ Upload error:', error);
    
    // If files were uploaded but DB save failed, delete from Cloudinary
    if (req.files && req.files.frontSide) {
      try {
        await cloudinary.uploader.destroy(req.files.frontSide[0].filename);
        await cloudinary.uploader.destroy(req.files.backSide[0].filename);
      } catch (cleanupError) {
        console.warn('⚠️ Could not delete uploaded files:', cleanupError.message);
      }
    }
    
    res.status(500).json({ success: false, error: error.message });
  }
});

// ✅ SET default template
router.patch('/:id/set-default', async (req, res) => {
  try {
    // Unset all defaults
    await Template.updateMany({ isDefault: true }, { $set: { isDefault: false } });
    
    // Set new default
    const template = await Template.findByIdAndUpdate(
      req.params.id,
      { isDefault: true },
      { new: true }
    );

    res.json({ success: true, message: 'Default template updated', template });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ✅ DELETE Template with Cloudinary cleanup
router.delete('/:id', async (req, res) => {
  try {
    const template = await Template.findById(req.params.id);
    if (!template) {
      return res.status(404).json({ success: false, error: 'Template not found' });
    }

    console.log('🗑️ Deleting template:', template.name);

    // Delete files from Cloudinary
    let deletedFiles = 0;
    const deletePromises = [];

    // Delete front side
    if (template.frontSide && template.frontSide.public_id) {
      deletePromises.push(
        cloudinary.uploader.destroy(template.frontSide.public_id)
          .then(result => {
            if (result.result === 'ok') deletedFiles++;
            console.log('✅ Deleted from Cloudinary:', template.frontSide.public_id);
          })
          .catch(err => console.warn('⚠️ Could not delete from Cloudinary:', err.message))
      );
    }

    // Delete back side
    if (template.backSide && template.backSide.public_id) {
      deletePromises.push(
        cloudinary.uploader.destroy(template.backSide.public_id)
          .then(result => {
            if (result.result === 'ok') deletedFiles++;
            console.log('✅ Deleted from Cloudinary:', template.backSide.public_id);
          })
          .catch(err => console.warn('⚠️ Could not delete from Cloudinary:', err.message))
      );
    }

    // Wait for all deletions
    await Promise.allSettled(deletePromises);

    // Delete from database
    await Template.findByIdAndDelete(req.params.id);

    res.json({ 
      success: true, 
      message: `Template deleted successfully from cloud and database`,
      deletedFiles: deletedFiles
    });

  } catch (error) {
    console.error('❌ Template deletion error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ✅ PREVIEW template image (redirects to Cloudinary URL)
router.get('/preview/:publicId', async (req, res) => {
  try {
    const { publicId } = req.params;
    
    // Generate optimized URL with transformations
    const url = cloudinary.url(publicId, {
      fetch_format: 'auto',
      quality: 'auto',
      width: 800,
      height: 600,
      crop: 'limit'
    });
    
    // Redirect to Cloudinary URL
    res.redirect(url);
    
  } catch (error) {
    console.error('❌ Preview error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ✅ GET direct template URL with optimizations
router.get('/url/:templateId/:side', async (req, res) => {
  try {
    const { templateId, side } = req.params;
    const template = await Template.findById(templateId);
    
    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    const sideData = side === 'front' ? template.frontSide : template.backSide;
    if (!sideData || !sideData.public_id) {
      return res.status(404).json({ error: 'Template side not found' });
    }

    // Generate optimized URL with transformations
    const url = cloudinary.url(sideData.public_id, {
      fetch_format: 'auto',
      quality: 'auto',
      width: 1200,
      crop: 'limit',
      secure: true
    });

    res.json({ 
      success: true, 
      url: url,
      public_id: sideData.public_id 
    });

  } catch (error) {
    console.error('❌ URL generation error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Helper function to generate signed URLs
function generateSignedUrl(public_id, expiresIn = 3600) {
  if (!public_id) return null;
  
  return cloudinary.url(public_id, {
    sign_url: true,
    expires_at: Math.floor(Date.now() / 1000) + expiresIn
  });
}

module.exports = router;