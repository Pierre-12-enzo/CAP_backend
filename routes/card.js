// routes/card.js - COMPLETE APPROACH A (All-in-one with Cloudinary)
const express = require('express');
const router = express.Router();
const multer = require('multer');
const { createCanvas, loadImage, registerFont } = require('canvas');
const fs = require('fs');
const path = require('path');
const JSZip = require('jszip'); // For ZIP extraction
const archiver = require('archiver');
const stream = require('stream');
const cloudinary = require('cloudinary').v2;
const Student = require('../models/Student');
const Template = require('../models/Template');

// Configure Cloudinary (use same config as templates.js)
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

// Multer memory storage (NO DISK STORAGE)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { 
    fileSize: 100 * 1024 * 1024 // 100MB for large ZIP files
  }
});

// Register fonts
try {
  registerFont(path.join(__dirname, '../fonts/Roboto-Bold.ttf'), { family: 'Roboto', weight: 'bold' });
  registerFont(path.join(__dirname, '../fonts/Roboto-Regular.ttf'), { family: 'Roboto' });
  console.log('✅ Fonts registered');
} catch (error) {
  console.log('⚠️ Using system fonts');
}


// ✅ 1. SINGLE CARD GENERATION
router.post('/generate-single-card', async (req, res) => {
  try {
    const { studentId, coordinates, templateId } = req.body;

    console.log('🎯 Starting single card generation...');

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

    // Use student's Cloudinary photo
    const studentPhotoUrl = student.photo_url;

    // Generate card
    const { frontBuffer, backBuffer } = await generateCardsWithCloudinary(
      student,
      template,
      parsedCoordinates,
      studentPhotoUrl
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

// ✅ 2. BATCH PROCESSING - COMPLETE APPROACH A
router.post('/process-csv-generate', upload.fields([
  { name: 'csv', maxCount: 1 },
  { name: 'photoZip', maxCount: 1 }
]), async (req, res) => {
  try {
    console.log('🚀 Starting Approach A - All-in-one batch processing with Cloudinary...');

    // ==================== VALIDATION ====================
    if (!req.files || !req.files.csv) {
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

    console.log('📁 Files received:', {
      csvSize: `${(req.files.csv[0].size / 1024).toFixed(2)} KB`,
      hasPhotoZip: !!req.files.photoZip,
      templateId: req.body.templateId
    });

    // ==================== PARSE CSV ====================
    console.log('📊 Parsing CSV from buffer...');
    const students = await parseCSVFromBuffer(req.files.csv[0].buffer);
    console.log(`✅ Parsed ${students.length} students from CSV`);

    // ==================== EXTRACT & UPLOAD PHOTOS TO CLOUDINARY ====================
    let photoCloudinaryMap = {}; // student_id -> { url, public_id, metadata }
    
    if (req.files.photoZip && req.files.photoZip[0]) {
      console.log('📦 Extracting photos from ZIP and uploading to Cloudinary...');
      photoCloudinaryMap = await extractAndUploadPhotosToCloudinary(req.files.photoZip[0].buffer);
      console.log(`✅ Uploaded ${Object.keys(photoCloudinaryMap).length} photos to Cloudinary`);
    }

    // ==================== SAVE STUDENTS WITH CLOUDINARY DATA ====================
    console.log('💾 Saving/updating students in database...');
    const savedStudents = [];
    
    for (const studentData of students) {
      try {
        const existingStudent = await Student.findOne({ student_id: studentData.student_id });
        const cloudinaryPhoto = photoCloudinaryMap[studentData.student_id];
        
        if (existingStudent) {
          // Update existing student
          Object.assign(existingStudent, studentData);
          
          // Update Cloudinary photo if available
          if (cloudinaryPhoto) {
            existingStudent.photo_url = cloudinaryPhoto.secure_url;
            existingStudent.photo_public_id = cloudinaryPhoto.public_id;
            existingStudent.photo_metadata = {
              width: cloudinaryPhoto.width,
              height: cloudinaryPhoto.height,
              format: cloudinaryPhoto.format,
              bytes: cloudinaryPhoto.bytes
            };
            existingStudent.has_photo = true;
            existingStudent.photo_uploaded_at = new Date();
          }
          
          await existingStudent.save();
          savedStudents.push(existingStudent);
          
          console.log(`✅ Updated student: ${studentData.name} ${cloudinaryPhoto ? '(+photo)' : ''}`);
        } else {
          // Create new student with Cloudinary data
          const student = new Student({
            ...studentData,
            photo_url: cloudinaryPhoto ? cloudinaryPhoto.secure_url : null,
            photo_public_id: cloudinaryPhoto ? cloudinaryPhoto.public_id : null,
            photo_metadata: cloudinaryPhoto ? {
              width: cloudinaryPhoto.width,
              height: cloudinaryPhoto.height,
              format: cloudinaryPhoto.format,
              bytes: cloudinaryPhoto.bytes
            } : null,
            has_photo: !!cloudinaryPhoto,
            photo_uploaded_at: cloudinaryPhoto ? new Date() : null
          });
          
          await student.save();
          savedStudents.push(student);
          
          console.log(`✅ Created student: ${studentData.name} ${cloudinaryPhoto ? '(+photo)' : ''}`);
        }
      } catch (error) {
        console.error(`❌ Failed to save student ${studentData.student_id}:`, error.message);
      }
    }

    console.log(`✅ Total students saved: ${savedStudents.length}`);

    // ==================== GET TEMPLATE ====================
    const template = await Template.findById(req.body.templateId);
    if (!template) {
      return res.status(404).json({
        success: false,
        error: 'Template not found'
      });
    }

    console.log(`🎨 Using template: ${template.name}`);

    // ==================== PARSE COORDINATES ====================
    const coordinates = req.body.coordinates ? JSON.parse(req.body.coordinates) : {};

    // ==================== GENERATE CARDS ====================
    console.log('🎨 Generating ID cards...');
    
    // Set response headers for ZIP stream
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="batch-id-cards-${Date.now()}.zip"`
    });

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.pipe(res);

    let generatedCount = 0;
    const totalStudents = savedStudents.length;

    // Generate and stream each card
    for (const student of savedStudents) {
      try {
        console.log(`🔄 Generating card ${generatedCount + 1}/${totalStudents}: ${student.name}`);
        
        // Use student's Cloudinary photo URL
        const studentPhotoUrl = student.photo_url;
        
        const { frontBuffer, backBuffer } = await generateCardsWithCloudinary(
          student, 
          template, 
          coordinates, 
          studentPhotoUrl // Pass Cloudinary URL
        );

        // Add to ZIP stream
        archive.append(frontBuffer, { name: `${student.student_id}/front-side.png` });
        archive.append(backBuffer, { name: `${student.student_id}/back-side.png` });

        // Update student card generation stats
        student.card_generated = true;
        student.card_generation_count = (student.card_generation_count || 0) + 1;
        student.last_card_generated = new Date();
        if (!student.first_card_generated) {
          student.first_card_generated = new Date();
        }
        
        await student.save();

        generatedCount++;
        console.log(`✅ Generated card for ${student.name}`);

      } catch (error) {
        console.error(`❌ Card generation failed for ${student.name}:`, error.message);
      }
    }

    // Finalize ZIP
    archive.finalize();
    console.log(`📥 Streaming ${generatedCount} cards to download`);
    console.log('✅ Approach A - Batch processing completed successfully!');

  } catch (error) {
    console.error('❌ Batch processing error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// ✅ 3. CARD HISTORY
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

// ✅ 4. GET STUDENT CARD HISTORY
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

// ✅ 6. GET ALL STUDENTS FOR DROPDOWN
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

// ✅ 7. GET STUDENT PHOTO FROM CLOUDINARY
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

// ✅ 8. GET TEMPLATE DIMENSIONS FROM CLOUDINARY
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
    const templateImage = await loadImage(template.frontSide.secure_url || template.frontSide.url);
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
        frontSideUrl: template.frontSide.secure_url || template.frontSide.url
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

// ✅ 9. STUDENT PHOTO UPLOAD (Individual photo upload)
router.post('/upload-student-photo', upload.single('photo'), async (req, res) => {
  try {
    const { studentId } = req.body;
    
    if (!studentId || !req.file) {
      return res.status(400).json({
        success: false,
        error: 'Student ID and photo are required'
      });
    }

    const student = await Student.findById(studentId);
    if (!student) {
      return res.status(404).json({
        success: false,
        error: 'Student not found'
      });
    }

    console.log(`📸 Uploading photo for ${student.name}...`);

    // Upload to Cloudinary
    const uploadResult = await cloudinary.uploader.upload(
      `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`,
      {
        folder: 'student-cards/student-photos',
        public_id: `student-${student.student_id}-${Date.now()}`,
        overwrite: true,
        transformation: [
          { width: 500, height: 500, crop: "fill" },
          { quality: "auto:good" }
        ]
      }
    );

    // Update student record
    student.photo_url = uploadResult.secure_url;
    student.photo_public_id = uploadResult.public_id;
    student.photo_metadata = {
      width: uploadResult.width,
      height: uploadResult.height,
      format: uploadResult.format,
      bytes: uploadResult.bytes
    };
    student.has_photo = true;
    student.photo_uploaded_at = new Date();
    
    await student.save();

    console.log(`✅ Photo uploaded for ${student.name}`);

    res.json({
      success: true,
      message: 'Photo uploaded successfully',
      photo_url: uploadResult.secure_url,
      student: {
        id: student._id,
        name: student.name,
        has_photo: true
      }
    });

  } catch (error) {
    console.error('❌ Photo upload error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});






// ==================== HELPER FUNCTIONS ====================

// ✅ PARSE CSV FROM BUFFER
async function parseCSVFromBuffer(csvBuffer) {
  return new Promise((resolve, reject) => {
    try {
      const students = [];
      const csvString = csvBuffer.toString('utf-8');
      const lines = csvString.split('\n').filter(line => line.trim());
      
      if (lines.length === 0) {
        return resolve([]);
      }

      // Auto-detect headers (support with/without headers)
      const firstLine = lines[0].toLowerCase();
      let startIndex = 0;
      
      if (firstLine.includes('student_id') || firstLine.includes('name')) {
        // Has headers, skip first line
        startIndex = 1;
      }

      for (let i = startIndex; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        // Simple CSV parsing (supports quoted fields)
        const values = parseCSVLine(line);
        
        // Map values to student object
        const student = {
          student_id: values[0] || `STU${i.toString().padStart(3, '0')}`,
          name: values[1] || 'Unknown Student',
          class: values[2] || 'N/A',
          level: values[3] || 'N/A',
          residence: values[4] || 'N/A',
          gender: values[5] || 'N/A',
          academic_year: values[6] || '2024',
          parent_phone: values[7] || ''
        };

        students.push(student);
      }

      resolve(students);
    } catch (error) {
      reject(new Error(`CSV parsing failed: ${error.message}`));
    }
  });
}

// ✅ SIMPLE CSV LINE PARSER
function parseCSVLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"' && inQuotes && nextChar === '"') {
      // Escaped quote
      current += '"';
      i++; // Skip next char
    } else if (char === '"') {
      // Quote
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      // Comma outside quotes = field delimiter
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  // Add last field
  values.push(current.trim());
  return values;
}

// ✅ EXTRACT AND UPLOAD PHOTOS TO CLOUDINARY
async function extractAndUploadPhotosToCloudinary(zipBuffer) {
  const photoCloudinaryMap = {};
  
  try {
    const zip = new JSZip();
    const zipData = await zip.loadAsync(zipBuffer);
    
    const filePromises = [];
    
    // Process each file in ZIP
    for (const [fileName, file] of Object.entries(zipData.files)) {
      if (!file.dir && fileName.match(/\.(jpg|jpeg|png|gif|bmp)$/i)) {
        filePromises.push(processPhotoFile(fileName, file, photoCloudinaryMap));
      }
    }
    
    // Wait for all photos to be processed
    await Promise.all(filePromises);
    
    return photoCloudinaryMap;
    
  } catch (error) {
    console.error('❌ ZIP processing error:', error);
    return {};
  }
}

// ✅ PROCESS INDIVIDUAL PHOTO FILE
async function processPhotoFile(fileName, file, photoCloudinaryMap) {
  try {
    // Extract student ID from filename (e.g., "STU001.jpg" → "STU001")
    const studentId = path.parse(fileName).name;
    
    // Skip if not a valid student ID format
    if (!studentId || studentId.length < 2) {
      console.warn(`⚠️ Skipping invalid filename: ${fileName}`);
      return;
    }

    // Read file as buffer
    const fileBuffer = await file.async('nodebuffer');
    
    if (fileBuffer.length === 0) {
      console.warn(`⚠️ Empty photo file: ${fileName}`);
      return;
    }

    console.log(`📸 Processing photo for ${studentId}: ${fileName} (${(fileBuffer.length / 1024).toFixed(2)} KB)`);

    // Upload to Cloudinary
    const uploadResult = await cloudinary.uploader.upload(
      `data:image/jpeg;base64,${fileBuffer.toString('base64')}`,
      {
        folder: 'student-cards/student-photos',
        public_id: `student-${studentId}-${Date.now()}`,
        overwrite: true,
        transformation: [
          { width: 500, height: 500, crop: "fill" }, // Resize for ID cards
          { quality: "auto:good" }
        ]
      }
    );

    // Store Cloudinary data
    photoCloudinaryMap[studentId] = {
      secure_url: uploadResult.secure_url,
      public_id: uploadResult.public_id,
      width: uploadResult.width,
      height: uploadResult.height,
      format: uploadResult.format,
      bytes: uploadResult.bytes
    };

    console.log(`✅ Uploaded to Cloudinary: ${studentId} → ${uploadResult.public_id}`);
    
  } catch (error) {
    console.error(`❌ Failed to process photo ${fileName}:`, error.message);
  }
}

// ✅ GENERATE CARDS WITH CLOUDINARY (updated to use URLs)
async function generateCardsWithCloudinary(student, template, coordinates, studentPhotoUrl) {
  try {
    console.log(`🎨 Generating card for ${student.name} ${studentPhotoUrl ? '(with photo)' : '(no photo)'}`);

    // Load template from Cloudinary
    const templateImage = await loadImage(template.frontSide.secure_url);
    const templateWidth = templateImage.width;
    const templateHeight = templateImage.height;

    // Create canvas
    const canvas = createCanvas(templateWidth, templateHeight);
    const ctx = canvas.getContext('2d');

    // Draw template
    ctx.drawImage(templateImage, 0, 0, templateWidth, templateHeight);

    // ✅ ADD STUDENT PHOTO FROM CLOUDINARY URL
    if (studentPhotoUrl && coordinates.photo) {
      try {
        const studentPhoto = await loadImage(studentPhotoUrl);
        const { x, y, width, height } = coordinates.photo;
        const borderRadius = 8;

        // Draw border
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

        console.log(`✅ Added Cloudinary photo for ${student.name}`);
      } catch (photoError) {
        console.warn(`⚠️ Could not load Cloudinary photo for ${student.name}:`, photoError.message);
        drawPhotoPlaceholder(ctx, coordinates.photo);
      }
    } else if (coordinates.photo) {
      drawPhotoPlaceholder(ctx, coordinates.photo);
    }

    // ✅ ADD TEXT FIELDS
    ctx.fillStyle = '#000000';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    // Add text helper
    const addText = (text, coord, fontSize = 20, isBold = false) => {
      if (!text || !coord) return;
      
      ctx.font = `${isBold ? 'bold' : 'normal'} ${fontSize}px "Roboto", Arial, sans-serif`;
      
      // Truncate if too long
      let displayText = text.toString();
      if (coord.maxWidth) {
        while (ctx.measureText(displayText).width > coord.maxWidth && displayText.length > 3) {
          displayText = displayText.slice(0, -1);
        }
        if (displayText !== text) displayText += '...';
      }
      
      ctx.fillText(displayText, coord.x, coord.y);
    };

    // Add all student data
    addText(student.name, coordinates.name, 28, true);
    addText(student.class, coordinates.class, 20);
    addText(student.level, coordinates.level, 20);
    addText(student.gender, coordinates.gender, 18);
    addText(student.residence, coordinates.residence, 18);
    addText(student.academic_year, coordinates.academic_year, 18);

    // Generate front buffer
    const frontBuffer = canvas.toBuffer('image/png');

    // Generate back buffer
    let backBuffer;
    try {
      if (template.backSide && template.backSide.secure_url) {
        const backTemplate = await loadImage(template.backSide.secure_url);
        const backCanvas = createCanvas(backTemplate.width, backTemplate.height);
        const backCtx = backCanvas.getContext('2d');
        backCtx.drawImage(backTemplate, 0, 0);
        backBuffer = backCanvas.toBuffer('image/png');
      } else {
        const backCanvas = createCanvas(templateWidth, templateHeight);
        const backCtx = backCanvas.getContext('2d');
        backCtx.fillStyle = '#FFFFFF';
        backCtx.fillRect(0, 0, templateWidth, templateHeight);
        backBuffer = backCanvas.toBuffer('image/png');
      }
    } catch (backError) {
      const backCanvas = createCanvas(templateWidth, templateHeight);
      backBuffer = backCanvas.toBuffer('image/png');
    }

    console.log(`✅ Card generation completed for ${student.name}`);
    return { frontBuffer, backBuffer };

  } catch (error) {
    console.error(`❌ Card generation failed for ${student.name}:`, error);
    throw error;
  }
}

// ✅ PHOTO PLACEHOLDER
function drawPhotoPlaceholder(ctx, photoCoords) {
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(photoCoords.x, photoCoords.y, 
               photoCoords.width, photoCoords.height, 8);
  ctx.fillStyle = 'rgba(16, 185, 129, 0.3)';
  ctx.fill();
  
  // Draw camera icon
  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 24px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('📷', 
    photoCoords.x + photoCoords.width / 2, 
    photoCoords.y + photoCoords.height / 2);
  ctx.restore();
}

// Make sure to include createZipInMemory:
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

// Make sure to include loadImageFromUrl for error handling:
async function loadImageFromUrl(url) {
  try {
    return await loadImage(url);
  } catch (error) {
    console.warn(`⚠️ Failed to load image, retrying: ${url}`);
    
    // For Cloudinary URLs, try adding optimization parameters
    if (url.includes('cloudinary.com')) {
      const optimizedUrl = url.replace(/\/upload\//, '/upload/q_auto,f_auto/');
      return await loadImage(optimizedUrl);
    }
    
    throw error;
  }
}


module.exports = router;