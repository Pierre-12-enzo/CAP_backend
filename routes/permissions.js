const express = require('express');
const router = express.Router();
const Permission = require('../models/Permission');
const Student = require('../models/Student');
const authMiddleware = require('../middleware/authMiddleware');
const textbeeService = require('../services/textbeeService');

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
router.post('/create', authMiddleware, async (req, res) => {
  try {

    console.log('📝 =========== /permissions/create CALLED ===========');
    console.log('Headers:', req.headers);
    console.log('Request body type:', typeof req.body);
    console.log('Is array?', Array.isArray(req.body));
    console.log('Full request body:', JSON.stringify(req.body, null, 2));

    const data = req.body;
    let permissionsData = [];
    let isBulk = false;

    // Determine if it's single or bulk
    if (Array.isArray(data)) {
      // Bulk creation
      permissionsData = data;
      isBulk = true;
      console.log(`📦 Bulk request: ${permissionsData.length} permission(s)`);
    } else if (data && typeof data === 'object') {
      // Single permission creation
      permissionsData = [data];
      isBulk = false;
      console.log('📄 Single permission request');
    } else {
      return res.status(400).json({
        success: false,
        error: 'Invalid request format. Send an object for single permission or array for bulk.'
      });
    }

    // Validate permissions data
    if (permissionsData.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No permission data provided'
      });
    }

    // Validate each permission
    const validationErrors = [];
    permissionsData.forEach((perm, index) => {
      if (!perm.student) {
        validationErrors.push(`Item ${index + 1}: Student is required`);
      }
      if (!perm.reason || !perm.reason.trim()) {
        validationErrors.push(`Item ${index + 1}: Reason is required`);
      }
      if (!perm.destination || !perm.destination.trim()) {
        validationErrors.push(`Item ${index + 1}: Destination is required`);
      }
      if (!perm.guardian?.name || !perm.guardian.name.trim()) {
        validationErrors.push(`Item ${index + 1}: Guardian name is required`);
      }
      if (!perm.returnDate) {
        validationErrors.push(`Item ${index + 1}: Return date is required`);
      }
    });

    if (validationErrors.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: validationErrors
      });
    }

    // Prepare data for database
    const permissionsToInsert = permissionsData.map(perm => {
      // Add default values and ensure proper structure
      return {
        student: perm.student,
        reason: perm.reason.trim(),
        destination: perm.destination.trim(),
        guardian: {
          name: perm.guardian.name.trim(),
          relationship: perm.guardian.relationship?.trim() || 'Parent',
          phone: perm.guardian.phone?.trim() || ''
        },
        departure: perm.departure || new Date(),
        returnDate: perm.returnDate,
        status: 'approved', // Default status
        createdBy: perm.createdBy || req.user?._id,
        // Initialize empty SMS tracking
        smsNotifications: {
          permissionCreated: {
            sent: false,
            sentAt: null,
            messageId: null,
            error: null
          }
        },
        smsProvider: 'none'
      };
    });

    // Create permissions using insertMany (works for both single and multiple)
    const createdPermissions = await Permission.insertMany(permissionsToInsert);

    console.log(`✅ Successfully created ${createdPermissions.length} permission(s)`);

    // Send SMS notifications for each permission
    const smsResults = [];

    for (const permission of createdPermissions) {
      try {
        // Fetch student data for SMS
        // You need to implement getStudentData based on your Student model
        const studentData = await getStudentData(permission.student);

        if (studentData && studentData.parent_phone) {
          try {
            const smsResult = await textbeeService.sendPermissionCreated(
              studentData,
              permission,
              studentData.parent_phone
            );

            // Store detailed SMS status
            permission.smsNotifications = {
              permissionCreated: {
                sent: smsResult.success,
                sentAt: new Date(),
                messageId: smsResult.batchId || smsResult.messageId,
                provider: 'textbee',
                phone: studentData.parent_phone,
                attempts: smsResult.attempts || 1,
                status: smsResult.success ? 'queued' : 'failed',
                error: smsResult.error
              }
            };

            await permission.save();

            console.log(`📱 SMS ${smsResult.success ? 'queued' : 'failed'} for ${studentData.name}`);
            console.log(`   Batch ID: ${smsResult.batchId}`);

          } catch (error) {
            console.error(`❌ SMS error for ${studentData.name}:`, error.message);

            permission.smsNotifications = {
              permissionCreated: {
                sent: false,
                sentAt: new Date(),
                error: error.message,
                status: 'failed'
              }
            };

            await permission.save();

          }
        }
      } catch (smsError) {
        console.error(`❌ SMS error for permission ${permission._id}:`, smsError);
        // Continue with other permissions
      }
    }

    // Populate student data in response
    const populatedPermissions = await Permission.find({
      _id: { $in: createdPermissions.map(p => p._id) }
    })
      .populate('student', 'name student_id class parent_phone')
      .populate('approvedBy', 'firstName lastName');

    // Prepare response based on single/bulk
    const response = {
      success: true,
      message: isBulk
        ? `Created ${createdPermissions.length} permissions successfully`
        : 'Permission created successfully',
      count: createdPermissions.length,
      isBulk: isBulk,
      permissions: isBulk ? populatedPermissions : populatedPermissions[0],
      smsSummary: {
        totalAttempted: smsResults.length,
        successful: smsResults.filter(r => r.success).length,
        demoMode: smsResults.some(r => r.demo),
        details: smsResults
      }
    };

    res.status(201).json(response);

  } catch (error) {
    console.error('❌ Error creating permissions:', error);

    // Handle specific errors
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: error.errors
      });
    }

    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        error: 'Duplicate permission detected',
        details: 'Permission number must be unique'
      });
    }

    res.status(500).json({
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
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
router.patch('/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    const updateData = { status };
    
    // CRITICAL: Set returnedAt when status is 'returned'
    if (status === 'returned') {
      updateData.returnedAt = new Date();
    }
    
    const permission = await Permission.findByIdAndUpdate(
      id,
      updateData,
      { new: true }
    ).populate('student');
    
    if (!permission) {
      return res.status(404).json({ error: 'Permission not found' });
    }
    
    res.json({ 
      success: true, 
      permission,
      message: `Permission status updated to ${status}` 
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete all permissions (DANGEROUS - Admin only)
router.delete('/delete-all', authMiddleware, async (req, res) => {
  try {
    console.log('⚠️ WARNING: Attempting to delete ALL permissions');
    
    const totalPermissions = await Permission.countDocuments();
    
    if (totalPermissions === 0) {
      return res.json({
        success: true,
        message: 'No permissions to delete',
        deletedCount: 0
      });
    }
    
    // Delete all permissions
    const result = await Permission.deleteMany({});
    
    console.log(`🗑️ Deleted ALL permissions: ${result.deletedCount} records`);
    
    res.json({
      success: true,
      message: `Deleted all ${result.deletedCount} permission records`,
      deletedCount: result.deletedCount,
      totalBefore: totalPermissions
    });
    
  } catch (error) {
    console.error('❌ Error deleting all permissions:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to delete all permissions'
    });
  }
});

// Get permission statistics
router.get('/stats', authMiddleware, async (req, res) => {
  try {
    const totalPermissions = await Permission.countDocuments();
    
    res.json({
      success: true,
      stats: {
        totalPermissions
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});



//Helper function
async function getStudentData(studentId) {
  try {
    const student = await Student.findById(studentId).select('name student_id class parent_phone');
    return student;
  } catch (error) {
    console.error('Error fetching student data:', error);
    return null;
  }
}

module.exports = router;