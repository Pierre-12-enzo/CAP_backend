// routes/templates.js - UPDATED WITH CLOUDINARY
const express = require('express');
const path = require('path');
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

// ✅ GET all templates - SIMPLE WORKING VERSION
router.get('/', async (req, res) => {
  try {
    console.log('🔍 Fetching templates...');
    const templates = await Template.find().sort({ isDefault: -1, createdAt: -1 });
    
    // Generate Cloudinary preview URLs
    const templatesWithUrls = templates.map(template => {
      const templateObj = template.toObject();
      
      // Generate preview URLs
      let frontSideUrl = null;
      let backSideUrl = null;
      
      if (templateObj.frontSide?.public_id) {
        frontSideUrl = cloudinary.url(templateObj.frontSide.public_id, {
          width: 400,
          height: 300,
          crop: 'fill',
          quality: 'auto'
        });
      }
      
      if (templateObj.backSide?.public_id) {
        backSideUrl = cloudinary.url(templateObj.backSide.public_id, {
          width: 400,
          height: 300,
          crop: 'fill',
          quality: 'auto'
        });
      }
      
      return {
        ...templateObj,
        frontSideUrl,
        backSideUrl
      };
    });
    
    console.log(`📊 Found ${templates.length} templates`);
    res.json({ success: true, templates: templatesWithUrls });
    
  } catch (error) {
    console.error('❌ Error fetching templates:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ✅ UPLOAD new template with Cloudinary - SIMPLE WORKING VERSION
router.post('/upload', upload.fields([
  { name: 'frontSide', maxCount: 1 },
  { name: 'backSide', maxCount: 1 }
]), async (req, res) => {
  try {
    const { name, description, setAsDefault } = req.body;
    
    console.log('📦 Uploading template:', name);
    
    if (!req.files || !req.files.frontSide || !req.files.backSide) {
      return res.status(400).json({ 
        success: false, 
        error: 'Both front and back sides are required' 
      });
    }

    const frontFile = req.files.frontSide[0];
    const backFile = req.files.backSide[0];

    // Create SIMPLE template - only what we need
    const template = new Template({
      name,
      description,
      frontSide: {
        filename: frontFile.originalname, // '2.png'
        filepath: frontFile.path, // Cloudinary URL
        url: frontFile.path,
        secure_url: frontFile.path,
        public_id: frontFile.filename // 'student-cards/templates/template-...'
      },
      backSide: {
        filename: backFile.originalname, // '1.png'
        filepath: backFile.path, // Cloudinary URL
        url: backFile.path,
        secure_url: backFile.path,
        public_id: backFile.filename
      },
      isDefault: setAsDefault === 'true'
    });

    console.log('💾 Saving template to DB...');

    // If set as default, unset other defaults
    if (template.isDefault) {
      await Template.updateMany({}, { $set: { isDefault: false } });
    }

    await template.save();
    
    console.log('✅ Template saved successfully!');
    console.log('   ID:', template._id);
    console.log('   Front public_id:', template.frontSide.public_id);
    console.log('   Back public_id:', template.backSide.public_id);
    
    res.json({ 
      success: true, 
      message: 'Template uploaded successfully!', 
      template 
    });

  } catch (error) {
    console.error('❌ Upload error:', error.message);
    
    // Try to delete from Cloudinary if DB save failed
    if (req.files?.frontSide?.[0]?.filename) {
      try {
        await cloudinary.uploader.destroy(req.files.frontSide[0].filename);
        await cloudinary.uploader.destroy(req.files.backSide[0].filename);
      } catch (e) {}
    }
    
    res.status(500).json({ 
      success: false, 
      error: 'Upload failed: ' + error.message 
    });
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

// ✅ PREVIEW template image - SIMPLE WORKING VERSION
router.get('/preview/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    console.log('🖼️ Preview requested for:', id);
    
    // Method 1: Try to find by filename (like '2.png')
    let template = await Template.findOne({
      $or: [
        { 'frontSide.filename': id },
        { 'backSide.filename': id }
      ]
    });
    
    let cloudinaryPublicId = null;
    
    if (template) {
      console.log(`✅ Found template by filename: ${template.name}`);
      if (template.frontSide.filename === id) {
        cloudinaryPublicId = template.frontSide.public_id;
      } else if (template.backSide.filename === id) {
        cloudinaryPublicId = template.backSide.public_id;
      }
    } 
    // Method 2: Try to find by template ID
    else {
      try {
        template = await Template.findById(id);
        if (template) {
          console.log(`✅ Found template by ID: ${template.name}`);
          cloudinaryPublicId = template.frontSide.public_id;
        }
      } catch (err) {}
    }
    
    if (!cloudinaryPublicId) {
      console.log('❌ No template found, using id as public_id');
      cloudinaryPublicId = id;
    }
    
    // Generate Cloudinary URL
    const url = cloudinary.url(cloudinaryPublicId, {
      fetch_format: 'auto',
      quality: 'auto',
      width: 800,
      height: 600,
      crop: 'limit'
    });
    
    console.log(`🔗 Redirecting to: ${url}`);
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