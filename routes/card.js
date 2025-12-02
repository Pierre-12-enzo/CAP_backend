// routes/card.js - ENHANCED VERSION
const express = require('express');
const router = express.Router();
const multer = require('multer');
const unzipper = require('unzipper');
const Jimp = require('jimp');
const { createCanvas, loadImage, registerFont } = require('canvas');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const archiver = require('archiver');
const Student = require('../models/Student');
const Template = require('../models/Template');

// Multer configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (file.fieldname === 'photo') {
      cb(null, 'uploads/photos/');
    } else if (file.fieldname === 'csv') {
      cb(null, 'uploads/csv/');
    } else if (file.fieldname === 'photoZip') {
      cb(null, 'uploads/zips/');
    } else {
      cb(null, 'uploads/');
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

//Register fonts--- 
try {
  // You can download these fonts from Google Fonts
  registerFont(path.join(__dirname, '../fonts/Roboto-Bold.ttf'), { family: 'Roboto', weight: 'bold' });
  registerFont(path.join(__dirname, '../fonts/Roboto-Regular.ttf'), { family: 'Roboto' });
  registerFont(path.join(__dirname, '../fonts/OpenSans-Regular.ttf'), { family: 'Open Sans' });
  console.log('✅ Fonts registered successfully');
} catch (error) {
  console.log('⚠️ Using system fonts (custom fonts not found)');
}

// ✅ BATCH PROCESSING - STREAM DIRECTLY TO USER (NO SERVER SAVING)
router.post('/process-csv-generate', upload.fields([
  { name: 'csv', maxCount: 1 },
  { name: 'photoZip', maxCount: 1 }
]), async (req, res) => {
  try {
    console.log('🚀 Starting batch card generation...');

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

    // Get template
    const template = await Template.findById(req.body.templateId);
    if (!template) {
      return res.status(404).json({
        success: false,
        error: 'Template not found'
      });
    }

    // Step 1: Parse CSV
    const students = await parseCSV(req.files.csv[0].path);
    console.log(`📊 Parsed ${students.length} students from CSV`);

    // Step 2: Process photos if provided
    let photoMap = {};
    if (req.files.photoZip) {
      photoMap = await extractPhotos(req.files.photoZip[0].path);
      console.log(`🖼️ Extracted ${Object.keys(photoMap).length} photos`);
    }

    // Step 3: Save students to database
    const savedStudents = [];
    for (const studentData of students) {
      try {
        const student = await Student.findOneAndUpdate(
          { student_id: studentData.student_id },
          {
            ...studentData,
            has_photo: !!photoMap[studentData.student_id],
            photo_path: photoMap[studentData.student_id] || null,
            photo_uploaded_at: photoMap[studentData.student_id] ? new Date() : null
          },
          { upsert: true, new: true }
        );
        savedStudents.push(student);
      } catch (error) {
        console.error(`❌ Failed to save student ${studentData.student_id}:`, error);
        console.log('gunnable, Failed');
      }
    }

    console.log(`✅ Saved ${savedStudents.length} students to database`);

    // ✅ STREAM CARDS DIRECTLY TO ZIP RESPONSE (NO SERVER SAVING)
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="batch-id-cards-${Date.now()}.zip"`
    });

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.pipe(res);

    const coordinates = JSON.parse(req.body.coordinates || '{}');
    let generatedCount = 0;

    console.log('🎨 Generating cards and streaming to ZIP...');

    // Generate and stream each card directly to ZIP
    for (const student of savedStudents) {
      try {
        const studentPhotoPath = photoMap[student.student_id] || student.photo_path;
        const { frontBuffer, backBuffer } = await generateCardsInMemory(student, template, coordinates, studentPhotoPath);

        // Add to ZIP stream
        archive.append(frontBuffer, { name: `${student.student_id}/front-side.png` });
        archive.append(backBuffer, { name: `${student.student_id}/back-side.png` });

        // Update tracking
        student.card_generated = true;
        student.card_generation_count = (student.card_generation_count || 0) + 1;
        student.last_card_generated = new Date();
        await student.save();

        generatedCount++;
        console.log(`✅ Generated card ${generatedCount}/${savedStudents.length}: ${student.name}`);

      } catch (error) {
        console.error(`❌ Card generation failed for ${student.name}:`, error);
      }
    }

    // Finalize ZIP and send to user
    archive.finalize();
    console.log(`📥 Streaming ${generatedCount} cards to user's download`);

    // Cleanup temporary upload files
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

// ✅ SINGLE CARD GENERATION - DIRECT DOWNLOAD (NO SERVER SAVING)
router.post('/generate-single-card', upload.single('photo'), async (req, res) => {
  try {
    const { studentId, coordinates, templateId } = req.body;

    console.log('🎯 Starting single card generation with Canvas...');

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

    // Determine photo source
    let photoSource = null;
    if (req.file) {
      photoSource = req.file;
    } else if (student.has_photo && student.photo_path) {
      photoSource = student.photo_path;
    }

    // ✅ USE CANVAS GENERATION
    const { frontBuffer, backBuffer } = await generateCardsInMemory(
      student,
      template,
      parsedCoordinates,
      photoSource
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

    // Clean up temporary file
    if (req.file && req.file.path) {
      fs.unlinkSync(req.file.path);
    }

    // Send response
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${student.student_id}-id-card.zip"`,
      'Content-Length': zipBuffer.length
    });

    res.send(zipBuffer);
    console.log(`📥 Canvas-generated card sent for ${student.name}`);

  } catch (error) {
    console.error('❌ Single card generation error:', error);

    // Clean up on error
    if (req.file && req.file.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    res.status(500).json({ success: false, error: error.message });
  }
});

//CARD HISTORY
// ✅ SIMPLE CARD HISTORY ROUTE
// In your card.js routes - Add this simple route first
router.get('/history', async (req, res) => {
    try {
        console.log('📊 Getting card history...');
        
        // Get total statistics
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

        // Format the response
        const response = {
            success: true,
            statistics: {
                totalCards: result.totalCardsGenerated,
                totalStudents: result.totalStudentsWithCards,
                averageCardsPerStudent: Math.round(result.averageCardsPerStudent * 100) / 100,
                maxCardsByStudent: result.maxCardsGenerated,
                status: 'fulfilled'
            },
            summary: `Total ${result.totalCardsGenerated} cards generated by ${result.totalStudentsWithCards} students`
        };

        console.log('📊 Card statistics:', response.statistics);
        res.json(response);

    } catch (error) {
        console.error('❌ Card history error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});


// ✅ GET STUDENT CARD HISTORY (individual student)
router.get('/history/student/:studentId', async (req, res) => {
    try {
        const { studentId } = req.params;

        const student = await Student.findById(studentId)
            .select('student_id name class level card_generation_count last_card_generated first_card_generated createdAt');

        if (!student) {
            return res.status(404).json({
                success: false,
                error: 'Student not found'
            });
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
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ✅ GET TOP CARD GENERATORS
router.get('/history/top-generators', async (req, res) => {
    try {
        const { limit = 10 } = req.query;

        const topGenerators = await Student.find({
            card_generated: true,
            card_generation_count: { $gt: 0 }
        })
        .select('student_id name class level card_generation_count last_card_generated')
        .sort({ card_generation_count: -1 })
        .limit(parseInt(limit));

        res.json({
            success: true,
            topGenerators
        });

    } catch (error) {
        console.error('❌ Top generators error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ✅ GET RECENT CARD GENERATIONS
router.get('/history/recent', async (req, res) => {
    try {
        const { limit = 10 } = req.query;

        const recent = await Student.find({
            card_generated: true,
            last_card_generated: { $exists: true, $ne: null }
        })
        .select('student_id name class card_generation_count last_card_generated')
        .sort({ last_card_generated: -1 })
        .limit(parseInt(limit));

        res.json({
            success: true,
            recent
        });

    } catch (error) {
        console.error('❌ Recent generations error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
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
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});


// ✅ STUDENT PHOTO UPLOAD ONLY (No card generation)
router.post('/upload-student-photo', upload.single('photo'), async (req, res) => {
  try {
    console.log('📸 Starting student photo upload...');

    const { studentId } = req.body;

    if (!studentId) {
      return res.status(400).json({
        success: false,
        error: 'Student ID is required'
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'Photo file is required'
      });
    }

    // Get student
    const student = await Student.findById(studentId);
    if (!student) {
      // Clean up uploaded file if student not found
      if (req.file && req.file.path) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(404).json({
        success: false,
        error: 'Student not found'
      });
    }

    console.log(`🖼️ Uploading photo for student: ${student.name} (${student.student_id})`);

    // Process and optimize the photo
    const optimizedPhotoPath = await optimizeStudentPhoto(req.file.path, student.student_id);

    // Delete the original uploaded file
    if (fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    // Update student record
    student.has_photo = true;
    student.photo_path = optimizedPhotoPath;
    student.photo_uploaded_at = new Date();
    await student.save();

    console.log(`✅ Photo uploaded successfully for ${student.name}`);
    console.log(`📁 Photo saved at: ${optimizedPhotoPath}`);

    res.json({
      success: true,
      message: 'Photo uploaded successfully',
      photo_path: optimizedPhotoPath,
      student: {
        id: student._id,
        name: student.name,
        student_id: student.student_id,
        has_photo: true
      }
    });

  } catch (error) {
    console.error('❌ Student photo upload error:', error);

    // Clean up uploaded file on error
    if (req.file && req.file.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});


//Route to get previews for student photo
router.get('/student-photo/:studentId', async (req, res) => {
  try {
    const { studentId } = req.params;
    const student = await Student.findById(studentId);


    if (!student || !student.has_photo || !student.photo_path) {
      return res.status(404).json({ error: 'Student photo not found' });
    }

    if (!fs.existsSync(student.photo_path)) {
      return res.status(404).json({ error: 'Photo file not found' });
    }

    res.sendFile(path.resolve(student.photo_path));
    console.log(student.photo_path);
  } catch (error) {
    console.error('❌ Student photo retrieval error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ✅ UPDATED: Get Template Dimensions using Canvas
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

    // ✅ USE CANVAS to get dimensions (faster and more reliable)
    const templateImage = await loadImage(template.frontSide.filepath);
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
        name: template.name
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

// ========== HELPER FUNCTIONS ==========

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
    const studentId = path.parse(file).name; // Remove extension
    photoMap[studentId] = path.join(extractPath, file);
  }

  return photoMap;
}

async function optimizeStudentPhoto(photoPath, studentId) {
  try {
    // Read the uploaded photo
    const image = await Jimp.read(photoPath);

    // Optimize for ID card (standard size: 250x250px)
    image.resize(250, 250) // Resize to standard ID card photo size
      .quality(85);     // Good quality with compression

    // Create optimized photos directory if it doesn't exist
    const optimizedDir = 'uploads/student-photos/optimized';
    if (!fs.existsSync(optimizedDir)) {
      fs.mkdirSync(optimizedDir, { recursive: true });
    }

    // Generate filename: studentId-timestamp.jpg
    const timestamp = Date.now();
    const optimizedFilename = `student-${studentId}-${timestamp}.jpg`;
    const optimizedPath = path.join(optimizedDir, optimizedFilename);

    // Save optimized photo
    await image.writeAsync(optimizedPath);

    return optimizedPath;

  } catch (error) {
    throw new Error(`Photo optimization failed: ${error.message}`);
  }
}


// ✅ GENERATE CARDS IN MEMORY (NO FILE SAVING)

async function generateCardsInMemory(student, template, coordinates, photoFileOrPath) {
  try {
    console.log('🎨 Generating card with Canvas...');

    // Load template image
    const templateImage = await loadImage(template.frontSide.filepath);
    const templateWidth = templateImage.width;
    const templateHeight = templateImage.height;

    // Create canvas with exact template dimensions
    const canvas = createCanvas(templateWidth, templateHeight);
    const ctx = canvas.getContext('2d');

    // Draw template background
    ctx.drawImage(templateImage, 0, 0, templateWidth, templateHeight);

    // Handle student photo
    let photoPath = null;
    if (photoFileOrPath) {
      photoPath = typeof photoFileOrPath === 'object' ? photoFileOrPath.path : photoFileOrPath;
    }

    // ✅ ADD STUDENT PHOTO WITH WHITE BORDER AND ROUNDED CORNERS (matches frontend)
    if (photoPath && fs.existsSync(photoPath) && coordinates.photo) {
      try {
        const studentPhoto = await loadImage(photoPath);
        const { x, y, width, height } = coordinates.photo;
        const borderRadius = 8; // matches frontend rounded-lg (8px)

        // Draw white border (matches frontend border-2 border-white)
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(x - 2, y - 2, width + 4, height + 4, borderRadius + 4);
        ctx.fillStyle = '#005800ff'; // border
        ctx.fill();
        ctx.restore();

        // Draw rounded photo (matches frontend rounded-lg and overflow-hidden)
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(x, y, width, height, borderRadius);
        ctx.clip();
        ctx.drawImage(studentPhoto, x, y, width, height);
        ctx.restore();

        console.log('✅ Student photo with white border and rounded corners added');
      } catch (photoError) {
        console.warn('⚠️ Could not add student photo:', photoError.message);

        // Fallback: Draw placeholder (matches frontend bg-emerald-400)
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(coordinates.photo.x, coordinates.photo.y, coordinates.photo.width, coordinates.photo.height, 8);
        ctx.fillStyle = 'rgba(16, 185, 129, 0.5)'; // emerald-400 with opacity
        ctx.fill();
        ctx.restore();
      }
    } else if (coordinates.photo) {
      // No photo available - draw placeholder (matches frontend)
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(coordinates.photo.x, coordinates.photo.y, coordinates.photo.width, coordinates.photo.height, 8);
      ctx.fillStyle = 'rgba(16, 185, 129, 0.5)'; // emerald-400 with opacity
      ctx.fill();
      ctx.restore();
    }

    // ✅ IMPROVED TEXT RENDERING with better font scaling
    const getFontStyle = (field, templateWidth) => {
      // Base sizes for different template widths
      let baseSize;
      if (templateWidth >= 1000) {
        baseSize = 28; // Large templates (1080px+)
      } else if (templateWidth >= 800) {
        baseSize = 20; // Medium templates
      } else {
        baseSize = 16; // Small templates
      }

      // Field-specific adjustments
      const sizes = {
        name: baseSize + 4,      // Name is larger
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

      // Try custom fonts first, fallback to system fonts
      const fontFamilies = ['"Roboto"', '"Open Sans"', 'Arial', 'sans-serif'];

      return `${weight} ${size}px ${fontFamilies[0]}`;
    };

    // Set text style
    ctx.fillStyle = '#000000'; // Black text
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    // ✅ ADD ALL TEXT FIELDS with proper styling
    const addText = (text, coord, field) => {
      if (!text || text === 'N/A' || !coord || coord.x === undefined || coord.y === undefined) {
        return;
      }

      const textToPrint = text.toString().trim();
      if (textToPrint) {
        try {
          ctx.font = getFontStyle(field, templateWidth);

          // Handle text overflow (matches frontend maxWidth)
          let displayText = textToPrint;
          if (coord.maxWidth) {
            const metrics = ctx.measureText(textToPrint);
            if (metrics.width > coord.maxWidth) {
              // Simple truncation with ellipsis
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

    // Handle back side (simple copy for now)
    let backBuffer;
    try {
      const backTemplate = await loadImage(template.backSide.filepath);
      const backCanvas = createCanvas(backTemplate.width, backTemplate.height);
      const backCtx = backCanvas.getContext('2d');
      backCtx.drawImage(backTemplate, 0, 0);
      backBuffer = backCanvas.toBuffer('image/png');
    } catch (backError) {
      console.warn('⚠️ Could not generate back side:', backError.message);
      // Create empty back buffer
      const backCanvas = createCanvas(templateWidth, templateHeight);
      backBuffer = backCanvas.toBuffer('image/png');
    }

    console.log('✅ Canvas generation completed successfully');
    return { frontBuffer, backBuffer };

  } catch (error) {
    console.error('❌ Canvas generation failed:', error);
    throw new Error(`Card generation failed: ${error.message}`);
  }
}

// ✅ CREATE ZIP IN MEMORY
async function createZipInMemory(files) {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 9 } });
    const chunks = [];

    archive.on('data', (chunk) => chunks.push(chunk));
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', reject);

    // Add files to archive
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

// ✅ GET CARD STATISTICS
async function getCardStatistics() {
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
                maxCardsGenerated: { $max: '$card_generation_count' },
                mostRecentGeneration: { $max: '$last_card_generated' }
            }
        },
        {
            $project: {
                _id: 0,
                totalStudentsWithCards: 1,
                totalCardsGenerated: 1,
                averageCardsPerStudent: { $round: ['$averageCardsPerStudent', 2] },
                maxCardsGenerated: 1,
                mostRecentGeneration: 1
            }
        }
    ]);

    return stats[0] || {
        totalStudentsWithCards: 0,
        totalCardsGenerated: 0,
        averageCardsPerStudent: 0,
        maxCardsGenerated: 0,
        mostRecentGeneration: null
    };
}

module.exports = router;

