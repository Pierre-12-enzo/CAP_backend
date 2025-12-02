// routes/templates.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const Template = require('../models/Template');
const fs = require('fs');
const path = require('path');

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = 'uploads/templates/';
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        // Keep original filename but make it unique
        const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9) + '-' + file.originalname;
        cb(null, uniqueName);
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }
});

// ✅ GET all templates
router.get('/', async (req, res) => {
    try {
        console.log('🔍 Fetching templates from database...');
        const templates = await Template.find().sort({ isDefault: -1, createdAt: -1 });
        
        console.log(`📊 Found ${templates.length} templates:`);
        templates.forEach(template => {
            console.log(`   - ${template.name} (ID: ${template._id})`);
        });
        
        res.json({ success: true, templates });
    } catch (error) {
        console.error('❌ Error fetching templates:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ✅ UPLOAD new template
// routes/templates.js - FIX UPLOAD ROUTE
router.post('/upload', upload.fields([
    { name: 'frontSide', maxCount: 1 },
    { name: 'backSide', maxCount: 1 }
]), async (req, res) => {
    try {
        const { name, description, setAsDefault } = req.body;
        
        console.log('📦 Upload request received');
        console.log('🖼️ Front side file:', req.files.frontSide[0]);
        console.log('🖼️ Back side file:', req.files.backSide[0]);

        if (!req.files.frontSide || !req.files.backSide) {
            return res.status(400).json({ 
                success: false, 
                error: 'Both front and back sides are required' 
            });
        }

        // ✅ FIXED: Use the actual saved filename (multer's filename), not originalname
        const template = new Template({
            name,
            description,
            frontSide: {
                filename: req.files.frontSide[0].filename, // This is the actual saved filename
                filepath: req.files.frontSide[0].path,
                originalname: req.files.frontSide[0].originalname // Keep for reference
            },
            backSide: {
                filename: req.files.backSide[0].filename, // This is the actual saved filename
                filepath: req.files.backSide[0].path,
                originalname: req.files.backSide[0].originalname // Keep for reference
            },
            isDefault: setAsDefault === 'true'
        });

        await template.save();
        console.log('✅ Template saved with correct filenames');
        console.log('   Front filename:', template.frontSide.filename);
        console.log('   Back filename:', template.backSide.filename);
        
        res.json({ 
            success: true, 
            message: 'Template with both sides uploaded successfully', 
            template 
        });

    } catch (error) {
        console.error('❌ Upload error:', error);
        if (req.files) {
            Object.values(req.files).forEach(files => {
                files.forEach(file => {
                    if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
                });
            });
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


// ✅ UPDATED: Delete Template with file cleanup
router.delete('/:id', async (req, res) => {
    try {
        const template = await Template.findById(req.params.id);
        if (!template) {
            return res.status(404).json({ success: false, error: 'Template not found' });
        }

        console.log('🗑️ Deleting template:', template.name);

        // ✅ DELETE ALL ASSOCIATED FILES
        const filesToDelete = [];

        // Front side file
        if (template.frontSide && template.frontSide.filepath) {
            filesToDelete.push(template.frontSide.filepath);
        }

        // Back side file  
        if (template.backSide && template.backSide.filepath) {
            filesToDelete.push(template.backSide.filepath);
        }

        // Original uploaded file (if exists in your schema)
        if (template.filepath) {
            filesToDelete.push(template.filepath);
        }

        // Delete all files
        let deletedFiles = 0;
        for (const filePath of filesToDelete) {
            try {
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                    deletedFiles++;
                    console.log('✅ Deleted file:', filePath);
                }
            } catch (fileError) {
                console.warn('⚠️ Could not delete file:', filePath, fileError.message);
            }
        }

        // Delete from database
        await Template.findByIdAndDelete(req.params.id);

        res.json({ 
            success: true, 
            message: `Template deleted successfully`,
            deletedFiles: deletedFiles
        });

    } catch (error) {
        console.error('❌ Template deletion error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// In your template routes file (e.g., templates.js)
router.post('/cleanup-orphaned-files', async (req, res) => {
    try {
        console.log('🧹 Cleaning up orphaned template files...');
        
        const templates = await Template.find();
        
        // Get all valid file paths from database
        const validTemplateFiles = [];
        
        templates.forEach(template => {
            if (template.frontSide?.filepath) validTemplateFiles.push(template.frontSide.filepath);
            if (template.backSide?.filepath) validTemplateFiles.push(template.backSide.filepath);
            if (template.filepath) validTemplateFiles.push(template.filepath);
        });
        
        // Scan template upload directory
        const templateDir = 'uploads/templates';
        let orphanedFiles = 0;
        
        if (fs.existsSync(templateDir)) {
            const files = fs.readdirSync(templateDir, { withFileTypes: true })
                .filter(dirent => dirent.isFile())
                .map(dirent => path.join(templateDir, dirent.name));
            
            for (const filePath of files) {
                if (!validTemplateFiles.includes(filePath)) {
                    try {
                        fs.unlinkSync(filePath);
                        orphanedFiles++;
                        console.log('🗑️ Deleted orphaned template file:', filePath);
                    } catch (error) {
                        console.warn('⚠️ Could not delete orphaned file:', filePath);
                    }
                }
            }
        }
        
        res.json({
            success: true,
            message: `Template cleanup completed`,
            orphanedFilesDeleted: orphanedFiles
        });
        
    } catch (error) {
        console.error('❌ Template cleanup error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});


// Add this route to serve template preview images
router.get('/preview/:filename', (req, res) => {
    try {
        const filename = req.params.filename;
        const uploadsDir = path.join(__dirname, '../uploads/templates');
        const filePath = path.join(uploadsDir, filename);
        
        console.log('🔍 Looking for file:', filePath);
        
        if (!fs.existsSync(filePath)) {
            console.log('❌ Files not found:', filePath);
            return res.status(404).json({ error: 'File not found' });
        }

        // Set appropriate content type
        const ext = path.extname(filename).toLowerCase();
        const contentTypes = {
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg'
        };
        
        res.setHeader('Content-Type', contentTypes[ext] || 'image/png');
        res.sendFile(path.resolve(filePath));
        
    } catch (error) {
        console.error('❌ Preview error:', error);
        res.status(500).json({ error: error.message });
    }
});


// routes/templates.js - ADD DEBUG ROUTE
router.get('/debug-files', (req, res) => {
    try {
        const uploadsDir = path.join(__dirname, '../uploads/templates');
        console.log('📁 Checking uploads directory:', uploadsDir);
        
        if (!fs.existsSync(uploadsDir)) {
            return res.json({ error: 'Uploads directory does not exist', path: uploadsDir });
        }
        
        const files = fs.readdirSync(uploadsDir);
        console.log('📄 Files found:', files);
        
        res.json({
            uploadsDir,
            fileCount: files.length,
            files: files
        });
    } catch (error) {
        res.json({ error: error.message });
    }
});

module.exports = router;