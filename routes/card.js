// routes/card.js - UPDATED FOR CLOUDINARY
const express = require('express');
const router = express.Router();
const multer = require('multer');
const { createCanvas, loadImage, registerFont } = require('canvas');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const archiver = require('archiver');
const stream = require('stream');
const axios = require('axios'); // Add this for fetching Cloudinary images
const Student = require('../models/Student');
const Template = require('../models/Template');

// Multer configuration for CSV/ZIP only (photos go to Cloudinary via student.js)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (file.fieldname === 'csv') {
      cb(null, 'uploads/csv/');
    } else if (file.fieldname === 'photoZip') {
      cb(null, 'uploads/zips/');
    } else {
      cb(null, 'uploads/temp/');
    }
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Register fonts
try {
  registerFont(path.join(__dirname, '../fonts/Roboto-Bold.ttf'), { family: 'Roboto', weight: 'bold' });
  registerFont(path.join(__dirname, '../fonts/Roboto-Regular.ttf'), { family: 'Roboto' });
  registerFont(path.join(__dirname, '../fonts/OpenSans-Regular.ttf'), { family: 'Open Sans' });
  console.log('✅ Fonts registered successfully');
} catch (error) {
  console.log('⚠️ Using system fonts (custom fonts not found)');
}

// ✅ BATCH PROCESSING - WITH CLOUDINARY TEMPLATES
router.post('/process-csv-generate', upload.fields([
  { name: 'csv', maxCount: 1 },
  { name: 'photoZip', maxCount: 1 }
]), async (req, res) => {
  try {
    console.log('🚀 Starting batch card generation with Cloudinary...');

    if (!req.files.csv) {
      return res.status(400).json({
        success: false,
        error: 'CSV file is required'
      });
    }

    if (!req.body.templateId) {
      return res.status(400).json({
        success: false,
        error: 'Template ID is required'
      });
    }

    // Get template from database (now contains Cloudinary URLs)
    const template = await Template.findById(req.body.templateId);
    if (!template) {
      return res.status(404).json({
        success: false,
        error: 'Template not found'
      });
    }

    console.log(`📊 Using template: ${template.name} from Cloudinary`);

    // Step 1: Parse CSV
    const students = await parseCSV(req.files.csv[0].path);
    console.log(`📊 Parsed ${students.length} students from CSV`);

    // Step 2: Process photos if provided (temporary local processing)
    let photoMap = {};
    if (req.files.photoZip) {
      photoMap = await extractPhotos(req.files.photoZip[0].path);
      console.log(`🖼️ Extracted ${Object.keys(photoMap).length} photos`);
    }

    // Step 3: Save/update students in database
    const savedStudents = [];
    for (const studentData of students) {
      try {
        const existingStudent = await Student.findOne({ student_id: studentData.student_id });
        
        if (existingStudent) {
          // Update existing student
          Object.assign(existingStudent, studentData);
          
          // Update photo if provided in ZIP
          if (photoMap[studentData.student_id]) {
            existingStudent.temp_photo_path = photoMap[studentData.student_id]; // Temporary path
          }
          
          await existingStudent.save();
          savedStudents.push(existingStudent);
        } else {
          // Create new student (photos will be uploaded to Cloudinary via separate route)
          const student = new Student({
            ...studentData,
            temp_photo_path: photoMap[studentData.student_id] || null
          });
          await student.save();
          savedStudents.push(student);
        }
      } catch (error) {
        console.error(`❌ Failed to save student ${studentData.student_id}:`, error);
      }
    }

    console.log(`✅ Processed ${savedStudents.length} students`);

    // ✅ STREAM CARDS DIRECTLY TO ZIP RESPONSE
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="batch-id-cards-${Date.now()}.zip"`
    });

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.pipe(res);

    const coordinates = JSON.parse(req.body.coordinates || '{}');
    let generatedCount = 0;

    console.log('🎨 Generating cards from Cloudinary templates...');

    // Generate and stream each card
    for (const student of savedStudents) {
      try {
        // Use temporary photo path or existing Cloudinary photo
        const studentPhotoPath = student.temp_photo_path || 
                               (student.photo_url ? student.photo_url : null);
        
        const { frontBuffer, backBuffer } = await generateCardsWithCloudinary(
          student, 
          template, 
          coordinates, 
          studentPhotoPath
        );

        // Add to ZIP stream
        archive.append(frontBuffer, { name: `${student.student_id}/front-side.png` });
        archive.append(backBuffer, { name: `${student.student_id}/back-side.png` });

        // Update tracking
        student.card_generated = true;
        student.card_generation_count = (student.card_generation_count || 0) + 1;
        student.last_card_generated = new Date();
        if (!student.first_card_generated) {
          student.first_card_generated = new Date();
        }
        
        // Clean temp photo path
        if (student.temp_photo_path) {
          delete student.temp_photo_path;
        }
        
        await student.save();

        generatedCount++;
        console.log(`✅ Generated card ${generatedCount}/${savedStudents.length}: ${student.name}`);

      } catch (error) {
        console.error(`❌ Card generation failed for ${student.name}:`, error);
      }
    }

    // Finalize ZIP
    archive.finalize();
    console.log(`📥 Streaming ${generatedCount} cards to user's download`);

    // Cleanup temporary files
    cleanupFiles([req.files.csv[0].path]);
    if (req.files.photoZip) {
      cleanupFiles([req.files.photoZip[0].path]);
    }

  } catch (error) {
    console.error('❌ Batch processing error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ✅ SINGLE CARD GENERATION - WITH CLOUDINARY
router.post('/generate-single-card', async (req, res) => {
  try {
    const { studentId, coordinates, templateId } = req.body;

    console.log('🎯 Starting single card generation with Cloudinary...');

    // Input validation
    if (!studentId || !templateId) {
      return res.status(400).json({
        success: false,
        error: 'Student ID and Template ID are required'
      });
    }

    // Parse coordinates
    let parsedCoordinates = {};
    try {
      parsedCoordinates = coordinates ? JSON.parse(coordinates) : {};
    } catch (parseError) {
      console.warn('⚠️ Could not parse coordinates:', parseError.message);
    }

    // Get template and student
    const template = await Template.findById(templateId);
    const student = await Student.findById(studentId);

    if (!template) throw new Error('Template not found');
    if (!student) throw new Error('Student not found');

    console.log(`🖼️ Generating card for: ${student.name}`);

    // Use student's Cloudinary photo or no photo
    const studentPhotoPath = student.photo_url;

    // ✅ GENERATE WITH CLOUDINARY TEMPLATES
    const { frontBuffer, backBuffer } = await generateCardsWithCloudinary(
      student,
      template,
      parsedCoordinates,
      studentPhotoPath
    );

    // Create ZIP
    const zipBuffer = await createZipInMemory([
      { name: `${student.student_id}/front-side.png`, buffer: frontBuffer },
      { name: `${student.student_id}/back-side.png`, buffer: backBuffer }
    ]);

    // Update student tracking
    student.card_generated = true;
    student.card_generation_count = (student.card_generation_count || 0) + 1;
    student.last_card_generated = new Date();
    if (!student.first_card_generated) {
      student.first_card_generated = new Date();
    }
    await student.save();

    // Send response
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${student.student_id}-id-card.zip"`,
      'Content-Length': zipBuffer.length
    });

    res.send(zipBuffer);
    console.log(`📥 Card sent for ${student.name}`);

  } catch (error) {
    console.error('❌ Single card generation error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ✅ CARD HISTORY (unchanged)
router.get('/history', async (req, res) => {
  try {
    console.log('📊 Getting card history...');
    
    const stats = await Student.aggregate([
      {
        $match: {
          card_generated: true,
          card_generation_count: { $gt: 0 }
        }
      },
      {
        $group: {
          _id: null,
          totalStudentsWithCards: { $sum: 1 },
          totalCardsGenerated: { $sum: '$card_generation_count' },
          averageCardsPerStudent: { $avg: '$card_generation_count' },
          maxCardsGenerated: { $max: '$card_generation_count' }
        }
      }
    ]);

    const result = stats[0] || {
      totalStudentsWithCards: 0,
      totalCardsGenerated: 0,
      averageCardsPerStudent: 0,
      maxCardsGenerated: 0
    };

    res.json({
      success: true,
      statistics: {
        totalCards: result.totalCardsGenerated,
        totalStudents: result.totalStudentsWithCards,
        averageCardsPerStudent: Math.round(result.averageCardsPerStudent * 100) / 100,
        maxCardsByStudent: result.maxCardsGenerated,
        status: 'fulfilled'
      },
      summary: `Total ${result.totalCardsGenerated} cards generated by ${result.totalStudentsWithCards} students`
    });

  } catch (error) {
    console.error('❌ Card history error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ✅ GET STUDENT CARD HISTORY (unchanged)
router.get('/history/student/:studentId', async (req, res) => {
  try {
    const { studentId } = req.params;

    const student = await Student.findById(studentId)
      .select('student_id name class level card_generation_count last_card_generated first_card_generated createdAt');

    if (!student) {
      return res.status(404).json({ success: false, error: 'Student not found' });
    }

    res.json({
      success: true,
      student: {
        _id: student._id,
        student_id: student.student_id,
        name: student.name,
        class: student.class,
        level: student.level,
        card_generation_count: student.card_generation_count,
        last_card_generated: student.last_card_generated,
        first_card_generated: student.first_card_generated,
        student_since: student.createdAt
      },
      statistics: {
        hasGeneratedCards: student.card_generated,
        totalCards: student.card_generation_count,
        lastGeneration: student.last_card_generated,
        firstGeneration: student.first_card_generated
      }
    });

  } catch (error) {
    console.error('❌ Student card history error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ✅ GET ALL STUDENTS FOR DROPDOWN
router.get('/students', async (req, res) => {
  try {
    const students = await Student.find().sort({ name: 1 });

    res.json({
      success: true,
      students: students
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ✅ STUDENT PHOTO UPLOAD (Now handled by student.js with Cloudinary)
// Remove this route since it's handled by student.js

// ✅ GET STUDENT PHOTO FROM CLOUDINARY
router.get('/student-photo/:studentId', async (req, res) => {
  try {
    const { studentId } = req.params;
    const student = await Student.findById(studentId);

    if (!student || !student.photo_url) {
      return res.status(404).json({ error: 'Student photo not found' });
    }

    // Redirect to Cloudinary URL
    res.redirect(student.photo_url);
    
  } catch (error) {
    console.error('❌ Student photo retrieval error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ✅ GET TEMPLATE DIMENSIONS FROM CLOUDINARY
router.get('/template-dimensions/:templateId', async (req, res) => {
  try {
    const { templateId } = req.params;

    const template = await Template.findById(templateId);
    if (!template) {
      return res.status(404).json({
        success: false,
        error: 'Template not found'
      });
    }

    // Load image from Cloudinary URL to get dimensions
    const templateImage = await loadImage(template.frontSide.secure_url);
    const dimensions = {
      width: templateImage.width,
      height: templateImage.height
    };

    console.log('📏 Template dimensions:', dimensions);

    res.json({
      success: true,
      dimensions,
      template: {
        id: template._id,
        name: template.name,
        frontSideUrl: template.frontSide.secure_url
      }
    });

  } catch (error) {
    console.error('❌ Error getting template dimensions:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ========== UPDATED HELPER FUNCTIONS FOR CLOUDINARY ==========

// ✅ GENERATE CARDS WITH CLOUDINARY TEMPLATES
async function generateCardsWithCloudinary(student, template, coordinates, photoFileOrPath) {
  try {
    console.log('🎨 Generating card with Cloudinary templates...');

    // Load template image from Cloudinary URL
    const templateImage = await loadImage(template.frontSide.secure_url);
    const templateWidth = templateImage.width;
    const templateHeight = templateImage.height;

    // Create canvas with exact template dimensions
    const canvas = createCanvas(templateWidth, templateHeight);
    const ctx = canvas.getContext('2d');

    // Draw template background
    ctx.drawImage(templateImage, 0, 0, templateWidth, templateHeight);

    // Handle student photo (could be Cloudinary URL, local path, or file object)
    let photoPath = null;
    if (photoFileOrPath) {
      if (typeof photoFileOrPath === 'object' && photoFileOrPath.path) {
        // Local file object (from temporary ZIP extraction)
        photoPath = photoFileOrPath.path;
      } else if (typeof photoFileOrPath === 'string') {
        // Could be Cloudinary URL or local path
        photoPath = photoFileOrPath;
      }
    }

    // ✅ ADD STUDENT PHOTO
    if (photoPath && coordinates.photo) {
      try {
        const studentPhoto = await loadImage(photoPath);
        const { x, y, width, height } = coordinates.photo;
        const borderRadius = 8;

        // Draw white border
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(x - 2, y - 2, width + 4, height + 4, borderRadius + 4);
        ctx.fillStyle = '#005800ff';
        ctx.fill();
        ctx.restore();

        // Draw rounded photo
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(x, y, width, height, borderRadius);
        ctx.clip();
        ctx.drawImage(studentPhoto, x, y, width, height);
        ctx.restore();

        console.log('✅ Student photo added');
      } catch (photoError) {
        console.warn('⚠️ Could not add student photo:', photoError.message);
        // Draw placeholder
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(coordinates.photo.x, coordinates.photo.y, 
                     coordinates.photo.width, coordinates.photo.height, 8);
        ctx.fillStyle = 'rgba(16, 185, 129, 0.5)';
        ctx.fill();
        ctx.restore();
      }
    } else if (coordinates.photo) {
      // No photo available - draw placeholder
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(coordinates.photo.x, coordinates.photo.y, 
                   coordinates.photo.width, coordinates.photo.height, 8);
      ctx.fillStyle = 'rgba(16, 185, 129, 0.5)';
      ctx.fill();
      ctx.restore();
    }

    // ✅ IMPROVED TEXT RENDERING
    const getFontStyle = (field, templateWidth) => {
      let baseSize;
      if (templateWidth >= 1000) {
        baseSize = 28;
      } else if (templateWidth >= 800) {
        baseSize = 20;
      } else {
        baseSize = 16;
      }

      const sizes = {
        name: baseSize + 4,
        class: baseSize,
        level: baseSize,
        residence: baseSize,
        gender: baseSize,
        academic_year: baseSize
      };

      const weights = {
        name: 'bold',
        class: 'normal',
        level: 'normal',
        residence: 'normal',
        gender: 'normal',
        academic_year: 'normal'
      };

      const size = sizes[field] || baseSize;
      const weight = weights[field] || 'normal';

      return `${weight} ${size}px "Roboto", "Open Sans", Arial, sans-serif`;
    };

    // Set text style
    ctx.fillStyle = '#000000';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    // ✅ ADD ALL TEXT FIELDS
    const addText = (text, coord, field) => {
      if (!text || text === 'N/A' || !coord || coord.x === undefined || coord.y === undefined) {
        return;
      }

      const textToPrint = text.toString().trim();
      if (textToPrint) {
        try {
          ctx.font = getFontStyle(field, templateWidth);

          // Handle text overflow
          let displayText = textToPrint;
          if (coord.maxWidth) {
            const metrics = ctx.measureText(textToPrint);
            if (metrics.width > coord.maxWidth) {
              let truncated = textToPrint;
              while (ctx.measureText(truncated + '...').width > coord.maxWidth && truncated.length > 1) {
                truncated = truncated.slice(0, -1);
              }
              displayText = truncated + '...';
            }
          }

          ctx.fillText(displayText, coord.x, coord.y);
          console.log(`✅ Added ${field}: "${displayText}" at (${coord.x}, ${coord.y})`);
        } catch (textError) {
          console.warn(`⚠️ Could not add text for ${field}:`, textError.message);
        }
      }
    };

    // Add all student data
    addText(student.name, coordinates.name, 'name');
    addText(student.class, coordinates.class, 'class');
    addText(student.level, coordinates.level, 'level');
    addText(student.residence, coordinates.residence, 'residence');
    addText(student.gender, coordinates.gender, 'gender');
    addText(student.academic_year, coordinates.academic_year, 'academic_year');

    // Generate front buffer
    const frontBuffer = canvas.toBuffer('image/png');

    // Handle back side (load from Cloudinary)
    let backBuffer;
    try {
      if (template.backSide && template.backSide.secure_url) {
        const backTemplate = await loadImage(template.backSide.secure_url);
        const backCanvas = createCanvas(backTemplate.width, backTemplate.height);
        const backCtx = backCanvas.getContext('2d');
        backCtx.drawImage(backTemplate, 0, 0);
        backBuffer = backCanvas.toBuffer('image/png');
      } else {
        // No back side - create empty
        const backCanvas = createCanvas(templateWidth, templateHeight);
        const backCtx = backCanvas.getContext('2d');
        backCtx.fillStyle = '#FFFFFF';
        backCtx.fillRect(0, 0, templateWidth, templateHeight);
        backBuffer = backCanvas.toBuffer('image/png');
      }
    } catch (backError) {
      console.warn('⚠️ Could not generate back side:', backError.message);
      // Create empty back buffer
      const backCanvas = createCanvas(templateWidth, templateHeight);
      backBuffer = backCanvas.toBuffer('image/png');
    }

    console.log('✅ Canvas generation completed with Cloudinary');
    return { frontBuffer, backBuffer };

  } catch (error) {
    console.error('❌ Canvas generation failed:', error);
    throw new Error(`Card generation failed: ${error.message}`);
  }
}

// ✅ Helper function to load image from URL (with retry)
async function loadImageFromUrl(url) {
  try {
    return await loadImage(url);
  } catch (error) {
    console.warn(`⚠️ Failed to load image from URL, retrying...: ${url}`);
    
    // For Cloudinary URLs, try adding optimization parameters
    if (url.includes('cloudinary.com')) {
      const optimizedUrl = url.replace(/\/upload\//, '/upload/q_auto,f_auto/');
      return await loadImage(optimizedUrl);
    }
    
    throw error;
  }
}

// ========== EXISTING HELPER FUNCTIONS (unchanged) ==========

async function parseCSV(csvPath) {
  return new Promise((resolve, reject) => {
    const students = [];
    fs.createReadStream(csvPath)
      .pipe(csv())
      .on('data', (row) => {
        students.push({
          student_id: row.student_id,
          name: row.name,
          class: row.class || 'N/A',
          level: row.level || 'N/A',
          residence: row.residence || 'N/A',
          gender: row.gender || 'N/A',
          academic_year: row.academic_year || 'N/A',
          parent_phone: row.parent_phone || ''
        });
      })
      .on('end', () => resolve(students))
      .on('error', reject);
  });
}

async function extractPhotos(zipPath) {
  const photoMap = {};
  const extractPath = 'uploads/photos/extracted/' + Date.now();

  await fs.promises.mkdir(extractPath, { recursive: true });

  await new Promise((resolve, reject) => {
    fs.createReadStream(zipPath)
      .pipe(unzipper.Extract({ path: extractPath }))
      .on('close', resolve)
      .on('error', reject);
  });

  const files = await fs.promises.readdir(extractPath);
  for (const file of files) {
    const studentId = path.parse(file).name;
    photoMap[studentId] = path.join(extractPath, file);
  }

  return photoMap;
}

async function createZipInMemory(files) {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 9 } });
    const chunks = [];

    archive.on('data', (chunk) => chunks.push(chunk));
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', reject);

    files.forEach(file => {
      archive.append(file.buffer, { name: file.name });
    });

    archive.finalize();
  });
}

function cleanupFiles(filePaths) {
  filePaths.forEach(filePath => {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  });
}

module.exports = router;