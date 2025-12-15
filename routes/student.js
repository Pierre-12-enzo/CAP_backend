// routes/student.js - UPDATED WITH CLOUDINARY
const express = require('express');
const router = express.Router();
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const path = require('path');
const Student = require('../models/Student');

// Configure Cloudinary (should be configured already from templates.js)
// Make sure CLOUDINARY env variables are set

// Cloudinary storage for student photos
const studentPhotoStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    const studentId = req.body.student_id || 'unknown';
    return {
      folder: `student-cards/photos/${studentId}`,
      allowed_formats: ['jpg', 'jpeg', 'png'],
      public_id: () => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        return `student-photo-${uniqueSuffix}`;
      },
      transformation: [
        { width: 400, height: 400, crop: "thumb", gravity: "face" }, // Optimize for faces
        { quality: "auto:good" },
        { fetch_format: "auto" }
      ],
      tags: [`student-${studentId}`] // Tag for easier management
    };
  }
});

const upload = multer({
  storage: studentPhotoStorage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB for photos
    files: 1
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files (jpeg, jpg, png) are allowed for photos!'));
    }
  }
});

// --------------------------------------------------
// 1. GET all students (with Cloudinary URLs)
// --------------------------------------------------
router.get('/', async (req, res) => {
  try {
    const students = await Student.find().sort({ student_id: 1 });
    
    // Add Cloudinary URLs to each student
    const studentsWithUrls = students.map(student => ({
      ...student.toObject(),
      photo_url: student.photo_public_id ? 
        cloudinary.url(student.photo_public_id, {
          width: 200,
          height: 200,
          crop: 'fill',
          gravity: 'face',
          quality: 'auto',
          fetch_format: 'auto'
        }) : null
    }));
    
    res.json(studentsWithUrls);
  } catch (e) { 
    console.error('❌ Error fetching students:', e);
    res.status(500).json({ error: e.message }); 
  }
});

// --------------------------------------------------
// 2. CREATE a new student (with Cloudinary photo)
// --------------------------------------------------
router.post('/', upload.single('photo'), async (req, res) => {
  try {
    const data = req.body;
    
    // If photo was uploaded via Cloudinary
    let photoData = null;
    if (req.file) {
      photoData = {
        url: req.file.path,
        secure_url: req.file.path,
        public_id: req.file.filename,
        originalname: req.file.originalname,
        width: req.file.width,
        height: req.file.height,
        bytes: req.file.size,
        format: req.file.format
      };
    }

    const student = new Student({
      student_id: data.student_id,
      name: data.name,
      class: data.class || 'N/A',
      level: data.level || 'N/A',
      residence: data.residence || 'N/A',
      gender: data.gender || 'N/A',
      academic_year: data.academic_year || 'N/A',
      parent_phone: data.parent_phone || '',
      // Store Cloudinary data
      photo_url: photoData ? photoData.secure_url : null,
      photo_public_id: photoData ? photoData.public_id : null,
      photo_metadata: photoData ? {
        width: photoData.width,
        height: photoData.height,
        format: photoData.format,
        bytes: photoData.bytes
      } : null,
      has_photo: !!photoData
    });

    await student.save();
    res.status(201).json(student);
  } catch (e) { 
    console.error('❌ Error creating student:', e);
    res.status(400).json({ error: e.message }); 
  }
});

// --------------------------------------------------
// 3. UPDATE a student (Cloudinary photo replace)
// --------------------------------------------------
router.put('/:id', upload.single('photo'), async (req, res) => {
  try {
    const id = req.params.id;
    const data = req.body;
    
    const student = await Student.findById(id);
    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const update = {
      name: data.name,
      class: data.class || 'N/A',
      level: data.level || 'N/A',
      residence: data.residence || 'N/A',
      gender: data.gender || 'N/A',
      academic_year: data.academic_year || 'N/A',
      parent_phone: data.parent_phone || ''
    };

    // Replace photo if a new one is uploaded
    if (req.file) {
      // Delete old photo from Cloudinary if exists
      if (student.photo_public_id) {
        try {
          await cloudinary.uploader.destroy(student.photo_public_id);
          console.log(`🗑️ Deleted old photo from Cloudinary: ${student.photo_public_id}`);
        } catch (deleteError) {
          console.warn('⚠️ Could not delete old photo:', deleteError.message);
        }
      }

      // Store new Cloudinary data
      update.photo_url = req.file.path;
      update.photo_public_id = req.file.filename;
      update.photo_metadata = {
        width: req.file.width,
        height: req.file.height,
        format: req.file.format,
        bytes: req.file.size
      };
      update.has_photo = true;
      update.photo_updated_at = new Date();
    }

    const updatedStudent = await Student.findByIdAndUpdate(id, update, { new: true });
    res.json(updatedStudent);
  } catch (e) { 
    console.error('❌ Error updating student:', e);
    res.status(400).json({ error: e.message }); 
  }
});

// --------------------------------------------------
// 4. DELETE a student (with Cloudinary cleanup)
// --------------------------------------------------
router.delete('/:id', async (req, res) => {
  try {
    const student = await Student.findById(req.params.id);
    if (!student) {
      return res.status(404).json({ success: false, error: 'Student not found' });
    }

    console.log('🗑️ Deleting student:', student.name);

    // Delete photo from Cloudinary if exists
    let deletedPhoto = false;
    if (student.photo_public_id) {
      try {
        await cloudinary.uploader.destroy(student.photo_public_id);
        deletedPhoto = true;
        console.log('✅ Deleted student photo from Cloudinary:', student.photo_public_id);
      } catch (photoError) {
        console.warn('⚠️ Could not delete student photo from Cloudinary:', photoError.message);
      }
    }

    // Delete from database
    await Student.findByIdAndDelete(req.params.id);

    res.json({ 
      success: true, 
      message: `Student deleted successfully`,
      deletedPhoto: deletedPhoto,
      studentName: student.name
    });

  } catch (error) {
    console.error('❌ Student deletion error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// --------------------------------------------------
// 5. GET student photo URL (optimized)
// --------------------------------------------------
router.get('/photo/:studentId', async (req, res) => {
  try {
    const { studentId } = req.params;
    const { size = 'medium' } = req.query;
    
    const student = await Student.findById(studentId);
    
    if (!student || !student.photo_public_id) {
      return res.status(404).json({ error: 'Student photo not found' });
    }

    // Define size presets
    const sizePresets = {
      thumbnail: { width: 100, height: 100, crop: 'fill' },
      small: { width: 200, height: 200, crop: 'fill' },
      medium: { width: 400, height: 400, crop: 'fill' },
      large: { width: 800, height: 800, crop: 'limit' }
    };

    const preset = sizePresets[size] || sizePresets.medium;
    
    // Generate Cloudinary URL with optimizations
    const url = cloudinary.url(student.photo_public_id, {
      ...preset,
      gravity: 'face', // Focus on face for thumbnails
      quality: 'auto',
      fetch_format: 'auto',
      secure: true
    });

    // Redirect to Cloudinary URL
    res.redirect(url);
    
  } catch (error) {
    console.error('❌ Student photo retrieval error:', error);
    res.status(500).json({ error: error.message });
  }
});

// --------------------------------------------------
// 6. BULK DELETE student photos (admin cleanup)
// --------------------------------------------------
router.post('/cleanup-photos', async (req, res) => {
  try {
    console.log('🧹 Cleaning up unused student photos...');
    
    // Get all students with photos
    const students = await Student.find({ photo_public_id: { $exists: true, $ne: null } });
    const activePublicIds = students.map(s => s.photo_public_id);
    
    // List all resources in the student-cards/photos folder
    const result = await cloudinary.api.resources({
      type: 'upload',
      prefix: 'student-cards/photos/',
      max_results: 500
    });
    
    const cloudinaryResources = result.resources || [];
    let deletedCount = 0;
    
    // Delete orphaned photos
    for (const resource of cloudinaryResources) {
      if (!activePublicIds.includes(resource.public_id)) {
        try {
          await cloudinary.uploader.destroy(resource.public_id);
          deletedCount++;
          console.log('🗑️ Deleted orphaned photo:', resource.public_id);
        } catch (deleteError) {
          console.warn('⚠️ Could not delete:', resource.public_id, deleteError.message);
        }
      }
    }
    
    res.json({
      success: true,
      message: `Cloudinary photo cleanup completed`,
      deletedCount: deletedCount,
      totalResources: cloudinaryResources.length
    });
    
  } catch (error) {
    console.error('❌ Photo cleanup error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// --------------------------------------------------
// 7. DELETE ALL STUDENTS (DANGEROUS - Admin only)
// --------------------------------------------------
router.delete('/delete-all', async (req, res) => {
  try {
    console.log('⚠️ WARNING: Attempting to delete ALL students');
    
    // Get total count before deletion
    const totalStudents = await Student.countDocuments();
    
    if (totalStudents === 0) {
      return res.json({
        success: true,
        message: 'No students to delete',
        deletedCount: 0
      });
    }
    
    // Fetch all students to get their photo public_ids
    const allStudents = await Student.find({});
    
    // Delete all photos from Cloudinary first
    let deletedPhotos = 0;
    const deletePhotoPromises = allStudents.map(async (student) => {
      if (student.photo_public_id) {
        try {
          await cloudinary.uploader.destroy(student.photo_public_id);
          deletedPhotos++;
        } catch (photoError) {
          console.warn(`⚠️ Could not delete photo ${student.photo_public_id}:`, photoError.message);
        }
      }
    });
    
    await Promise.allSettled(deletePhotoPromises);
    
    // Delete all students from database
    const result = await Student.deleteMany({});
    
    console.log(`🗑️ Deleted ALL students: ${result.deletedCount} records`);
    console.log(`🗑️ Deleted ${deletedPhotos} photos from Cloudinary`);
    
    res.json({
      success: true,
      message: `Deleted all ${result.deletedCount} students and ${deletedPhotos} photos`,
      deletedCount: result.deletedCount,
      deletedPhotos: deletedPhotos,
      totalBefore: totalStudents
    });
    
  } catch (error) {
    console.error('❌ Error deleting all students:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to delete all students'
    });
  }
});

// --------------------------------------------------
// 8. GET STUDENT STATISTICS
// --------------------------------------------------
router.get('/stats', async (req, res) => {
  try {
    const totalStudents = await Student.countDocuments();
    const studentsWithPhotos = await Student.countDocuments({ has_photo: true });
    
    res.json({
      success: true,
      stats: {
        totalStudents,
        studentsWithPhotos,
        studentsWithoutPhotos: totalStudents - studentsWithPhotos
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});


module.exports = router;