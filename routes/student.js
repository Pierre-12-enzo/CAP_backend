// routes/student.js
const express   = require('express');
const router    = express.Router();
const multer    = require('multer');
const path      = require('path');
const Student   = require('../models/Student');
const fs        = require('fs');

// Multer – store a single photo per student
const upload = multer({ dest: 'uploads/photos/' });

// --------------------------------------------------
// 1. GET all students (for list & edit)
// --------------------------------------------------
router.get('/', async (req, res) => {
  try {
    const students = await Student.find().sort({ student_id: 1 });
    res.json(students);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --------------------------------------------------
// 2. CREATE a new student (with optional photo)
// --------------------------------------------------
router.post('/', upload.single('photo'), async (req, res) => {
  try {
    const data = req.body;
    const photoPath = req.file ? `uploads/photos/${req.file.filename}` : null;

    const student = new Student({
      student_id:    data.student_id,
      name:          data.name,
      class:         data.class        || 'N/A',
      level:   data.level   || 'N/A',
      residence:     data.residence     || 'N/A',
      gender:        data.gender        || 'N/A',
      academic_year: data.academic_year || 'N/A',
      parent_phone:  data.parent_phone  || '',
      photo_path:    photoPath
    });

    await student.save();
    res.status(201).json(student);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// --------------------------------------------------
// 3. UPDATE a student (photo replace optional)
// --------------------------------------------------
router.put('/:id', upload.single('photo'), async (req, res) => {
  try {
    const id   = req.params.id;
    const data = req.body;

    const update = {
      name:          data.name,
      class:         data.class        || 'N/A',
      level:   data.level   || 'N/A',
      residence:     data.residence     || 'N/A',
      gender:        data.gender        || 'N/A',
      academic_year: data.academic_year || 'N/A',
      parent_phone:  data.parent_phone  || ''
    };

    // Replace photo if a new one is uploaded
    if (req.file) {
      // delete old photo if exists
      const old = await Student.findById(id);
      if (old?.photo_path) await fs.promises.unlink(old.photo_path).catch(() => {});
      update.photo_path = `uploads/photos/${req.file.filename}`;
    }

    const student = await Student.findByIdAndUpdate(id, update, { new: true });
    if (!student) return res.status(404).json({ error: 'Student not found' });
    res.json(student);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// --------------------------------------------------
// 4. DELETE a student (also remove photo file)
// --------------------------------------------------
router.delete('/:id', async (req, res) => {
    try {
        const student = await Student.findById(req.params.id);
        if (!student) {
            return res.status(404).json({ success: false, error: 'Student not found' });
        }

        console.log('🗑️ Deleting student:', student.name);

        // ✅ DELETE STUDENT PHOTO FILE
        let deletedPhoto = false;
        if (student.photo_path && fs.existsSync(student.photo_path)) {
            try {
                fs.unlinkSync(student.photo_path);
                deletedPhoto = true;
                console.log('✅ Deleted student photo:', student.photo_path);
                
                // Also delete from optimized folder if exists
                const optimizedDir = path.dirname(student.photo_path);
                if (optimizedDir.includes('optimized')) {
                    const originalDir = path.join(path.dirname(optimizedDir), 'original');
                    const originalPhotoPath = path.join(originalDir, path.basename(student.photo_path));
                    
                    if (fs.existsSync(originalPhotoPath)) {
                        fs.unlinkSync(originalPhotoPath);
                        console.log('✅ Deleted original student photo:', originalPhotoPath);
                    }
                }
            } catch (photoError) {
                console.warn('⚠️ Could not delete student photo:', student.photo_path, photoError.message);
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
// 5. Cleanup student (also remove photo file)
// --------------------------------------------------
router.post('/cleanup-orphaned-files', async (req, res) => {
    try {
        console.log('🧹 Cleaning up orphaned student files...');
        
        const students = await Student.find();
        
        // Get all valid photo paths from database
        const validStudentPhotos = [];
        
        students.forEach(student => {
            if (student.photo_path) validStudentPhotos.push(student.photo_path);
        });
        
        // Scan student photos directories
        const photoDirs = [
            'uploads/student-photos',
            'uploads/student-photos/original',
            'uploads/student-photos/optimized'
        ];
        
        let orphanedFiles = 0;
        
        for (const dir of photoDirs) {
            if (!fs.existsSync(dir)) continue;
            
            const files = fs.readdirSync(dir, { withFileTypes: true })
                .filter(dirent => dirent.isFile())
                .map(dirent => path.join(dir, dirent.name));
            
            for (const filePath of files) {
                if (!validStudentPhotos.includes(filePath)) {
                    try {
                        fs.unlinkSync(filePath);
                        orphanedFiles++;
                        console.log('🗑️ Deleted orphaned student file:', filePath);
                    } catch (error) {
                        console.warn('⚠️ Could not delete orphaned file:', filePath);
                    }
                }
            }
        }
        
        res.json({
            success: true,
            message: `Student photos cleanup completed`,
            orphanedFilesDeleted: orphanedFiles
        });
        
    } catch (error) {
        console.error('❌ Student cleanup error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;