const express = require('express');
const router = express.Router();
const Permission = require('../models/Permission');
const Student = require('../models/Student');
const authMiddleware = require('../middleware/authMiddleware');

// Get all permissions with student data
router.get('/', authMiddleware, async (req, res) => {
  try {
    const permissions = await Permission.find()
      .populate('student', 'name student_id class level')
      .populate('approvedBy', 'firstName lastName')
      .sort({ createdAt: -1 });
    
    res.json({ success: true, permissions });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Create multiple permissions
router.post('/bulk', authMiddleware, async (req, res) => {
  try {
    const { permissions } = req.body;
    
    const createdPermissions = await Permission.insertMany(
      permissions.map(perm => ({
        ...perm,
        approvedBy: req.user.id
      }))
    );

    // Populate student data for response
    const populatedPermissions = await Permission.find({
      _id: { $in: createdPermissions.map(p => p._id) }
    }).populate('student', 'name student_id class level');

    res.status(201).json({ 
      success: true, 
      permissions: populatedPermissions 
    });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Get permissions by student
router.get('/student/:studentId', authMiddleware, async (req, res) => {
  try {
    const permissions = await Permission.find({ 
      student: req.params.studentId 
    })
    .populate('approvedBy', 'firstName lastName')
    .sort({ departure: -1 });
    
    res.json({ success: true, permissions });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get single permission
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const permission = await Permission.findById(req.params.id)
      .populate('student', 'name student_id class level gender photo')
      .populate('approvedBy', 'firstName lastName');
    
    if (!permission) {
      return res.status(404).json({ success: false, error: 'Permission not found' });
    }
    
    res.json({ success: true, permission });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Updating Permission Status
router.patch('/:id/status', authMiddleware, async (req, res) => {
  try {
    const { status, returnNotes } = req.body;
    
    // Validate status
    if (!['returned', 'approved'].includes(status)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Status must be either "returned" or "approved"' 
      });
    }

    const updateData = { status, returnNotes };
    
    // If marking as returned, add returnedAt timestamp
    if (status === 'returned') {
      updateData.returnedAt = new Date();
    }
    
    const permission = await Permission.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true } // Add runValidators
    )
      .populate('student', 'name student_id class level residence parent_phone')
      .populate('approvedBy', 'firstName lastName');
    
    if (!permission) {
      return res.status(404).json({ 
        success: false, 
        error: 'Permission not found' 
      });
    }
    
    res.json({ 
      success: true, 
      permission,
      message: `Permission marked as ${status} successfully`
    });
    
  } catch (error) {
    console.error('Error updating permission status:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message
    });
  }
});

module.exports = router;