// routes/analytics.js
const express = require('express');
const router = express.Router();
const Permission = require('../models/Permission');
const Student = require('../models/Student');
const authMiddleware = require('../middleware/authMiddleware');

// Analytics helper functions
const getAnalyticsSummary = async () => {
  const today = new Date();
  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  
  const [
    totalPermissions,
    activePermissions,
    returnedThisMonth,
    overduePermissions,
    totalStudents,
    monthlyData
  ] = await Promise.all([
    Permission.countDocuments(),
    Permission.countDocuments({ status: 'approved' }),
    Permission.countDocuments({ 
      status: 'returned',
      returnedAt: { $gte: startOfMonth, $lte: endOfMonth }
    }),
    Permission.countDocuments({
      status: 'approved',
      returnDate: { $lt: today }
    }),
    Student.countDocuments(),
    Permission.aggregate([
      {
        $match: {
          createdAt: { $gte: startOfMonth, $lte: endOfMonth }
        }
      },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          byClass: { $push: '$student' },
          byStatus: { $push: '$status' },
          byReason: { $push: '$reason' }
        }
      }
    ])
  ]);
  
  // Process class distribution
  const classDistribution = {};
  if (monthlyData[0]?.byClass) {
    monthlyData[0].byClass.forEach(studentId => {
      // This would need population in a real implementation
      classDistribution['Unknown'] = (classDistribution['Unknown'] || 0) + 1;
    });
  }
  
  // Process status distribution
  const statusDistribution = {};
  if (monthlyData[0]?.byStatus) {
    monthlyData[0].byStatus.forEach(status => {
      statusDistribution[status] = (statusDistribution[status] || 0) + 1;
    });
  }
  
  // Process reason distribution
  const reasonDistribution = {};
  if (monthlyData[0]?.byReason) {
    monthlyData[0].byReason.forEach(reason => {
      reasonDistribution[reason] = (reasonDistribution[reason] || 0) + 1;
    });
  }
  
  return {
    totalPermissions,
    activePermissions,
    returnedThisMonth,
    overduePermissions,
    totalStudents,
    monthlyData: {
      count: monthlyData[0]?.count || 0,
      classDistribution,
      statusDistribution,
      reasonDistribution
    }
  };
};

const getReturnPunctuality = async (startDate, endDate) => {
  const matchStage = { status: 'returned' };
  
  if (startDate && endDate) {
    matchStage.returnedAt = { 
      $gte: new Date(startDate), 
      $lte: new Date(endDate) 
    };
  }
  
  const returnedPermissions = await Permission.find(matchStage)
    .populate('student', 'name class');
  
  let onTime = 0;
  let late = 0;
  let early = 0;
  let totalDelayHours = 0;
  const classStats = {};
  const studentStats = {};
  
  returnedPermissions.forEach(permission => {
    if (!permission.returnDate || !permission.returnedAt) return;
    
    const expectedReturn = new Date(permission.returnDate);
    const actualReturn = new Date(permission.returnedAt);
    const delayHours = (actualReturn - expectedReturn) / (1000 * 60 * 60);
    
    if (delayHours <= 0) {
      onTime++;
    } else if (delayHours <= 24) {
      late++;
    } else {
      early++;
    }
    
    totalDelayHours += Math.max(0, delayHours);
    
    // Class stats
    const studentClass = permission.student?.class || 'Unknown';
    classStats[studentClass] = (classStats[studentClass] || 0) + 1;
    
    // Student stats
    const studentName = permission.student?.name || 'Unknown';
    studentStats[studentName] = (studentStats[studentName] || 0) + 1;
  });
  
  const totalReturned = returnedPermissions.length;
  
  return {
    totalReturned,
    onTime,
    late,
    early,
    averageDelayHours: totalReturned > 0 ? (totalDelayHours / totalReturned).toFixed(2) : 0,
    onTimePercentage: totalReturned > 0 ? ((onTime / totalReturned) * 100).toFixed(1) : 0,
    classStats,
    studentStats: Object.entries(studentStats)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, count]) => ({ name, count }))
  };
};

const getTrends = async (timeRange = 'monthly') => {
  const now = new Date();
  let startDate;
  
  switch(timeRange) {
    case 'weekly':
      startDate = new Date(now.setDate(now.getDate() - 7));
      break;
    case 'monthly':
      startDate = new Date(now.setMonth(now.getMonth() - 1));
      break;
    case 'quarterly':
      startDate = new Date(now.setMonth(now.getMonth() - 3));
      break;
    case 'yearly':
      startDate = new Date(now.setFullYear(now.getFullYear() - 1));
      break;
    default:
      startDate = new Date(now.setMonth(now.getMonth() - 1));
  }
  
  const permissions = await Permission.find({
    createdAt: { $gte: startDate }
  });
  
  // Group by date for trends
  const trends = {};
  permissions.forEach(permission => {
    const date = permission.createdAt.toISOString().split('T')[0];
    trends[date] = (trends[date] || 0) + 1;
  });
  
  return {
    timeRange,
    total: permissions.length,
    trends,
    summary: {
      dailyAverage: (permissions.length / Object.keys(trends).length).toFixed(1),
      peakDay: Object.keys(trends).reduce((a, b) => trends[a] > trends[b] ? a : b, ''),
      peakCount: Math.max(...Object.values(trends))
    }
  };
};

// Dashboard summary
router.get('/dashboard-summary', authMiddleware, async (req, res) => {
  try {
    const summary = await getAnalyticsSummary();
    const punctuality = await getReturnPunctuality();
    const trends = await getTrends('monthly');
    
    res.json({
      success: true,
      summary,
      punctuality,
      trends
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Monthly report
router.get('/monthly-report/:year/:month', authMiddleware, async (req, res) => {
  try {
    const { year, month } = req.params;
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0);
    
    const permissions = await Permission.find({
      createdAt: { $gte: startDate, $lte: endDate }
    }).populate('student', 'name class');
    
    const report = {
      period: `${year}-${String(month).padStart(2, '0')}`,
      totalPermissions: permissions.length,
      byStatus: {},
      byClass: {},
      byReason: {},
      dailyCount: {}
    };
    
    // Calculate daily counts
    const daysInMonth = endDate.getDate();
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      report.dailyCount[dateStr] = 0;
    }
    
    // Process permissions
    permissions.forEach(permission => {
      // Status
      report.byStatus[permission.status] = (report.byStatus[permission.status] || 0) + 1;
      
      // Class
      const studentClass = permission.student?.class || 'Unknown';
      report.byClass[studentClass] = (report.byClass[studentClass] || 0) + 1;
      
      // Reason
      report.byReason[permission.reason] = (report.byReason[permission.reason] || 0) + 1;
      
      // Daily count
      const dateStr = permission.createdAt.toISOString().split('T')[0];
      if (report.dailyCount[dateStr] !== undefined) {
        report.dailyCount[dateStr]++;
      }
    });
    
    res.json({ success: true, report });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Trends
router.get('/trends/:timeRange', authMiddleware, async (req, res) => {
  try {
    const { timeRange } = req.params;
    const trends = await getTrends(timeRange);
    res.json({ success: true, trends });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Return punctuality
router.get('/return-punctuality', authMiddleware, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const punctuality = await getReturnPunctuality(startDate, endDate);
    res.json({ success: true, stats: punctuality });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Class analytics
router.get('/class', authMiddleware, async (req, res) => {
  try {
    const permissions = await Permission.find().populate('student', 'class');
    
    const classAnalytics = {};
    permissions.forEach(permission => {
      const studentClass = permission.student?.class || 'Unknown';
      if (!classAnalytics[studentClass]) {
        classAnalytics[studentClass] = {
          total: 0,
          active: 0,
          returned: 0,
          overdue: 0
        };
      }
      
      classAnalytics[studentClass].total++;
      
      if (permission.status === 'approved') {
        classAnalytics[studentClass].active++;
        
        // Check if overdue
        if (new Date(permission.returnDate) < new Date()) {
          classAnalytics[studentClass].overdue++;
        }
      } else if (permission.status === 'returned') {
        classAnalytics[studentClass].returned++;
      }
    });
    
    res.json({ success: true, classAnalytics });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Reason analytics
router.get('/reasons', authMiddleware, async (req, res) => {
  try {
    const permissions = await Permission.find();
    
    const reasonAnalytics = {};
    permissions.forEach(permission => {
      const reason = permission.reason;
      reasonAnalytics[reason] = (reasonAnalytics[reason] || 0) + 1;
    });
    
    // Convert to array and sort
    const sortedReasons = Object.entries(reasonAnalytics)
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count);
    
    res.json({ success: true, reasons: sortedReasons });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// SMS stats
router.get('/sms-stats', authMiddleware, async (req, res) => {
  try {
    const permissions = await Permission.find();
    
    let sent = 0;
    let failed = 0;
    let demoMode = false;
    
    permissions.forEach(permission => {
      if (permission.smsNotifications?.permissionCreated?.sent) sent++;
      if (permission.smsNotifications?.permissionCreated?.error) failed++;
      if (permission.smsProvider === 'demo') demoMode = true;
    });
    
    res.json({
      success: true,
      stats: {
        total: permissions.length,
        sent,
        failed,
        demoMode,
        successRate: permissions.length > 0 ? (sent / permissions.length * 100).toFixed(1) : 0
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Weekly active permissions
router.get('/weekly-active', authMiddleware, async (req, res) => {
  try {
    const today = new Date();
    const startOfWeek = new Date(today.setDate(today.getDate() - today.getDay()));
    startOfWeek.setHours(0, 0, 0, 0);
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(endOfWeek.getDate() + 6);
    endOfWeek.setHours(23, 59, 59, 999);

    const activePermissions = await Permission.countDocuments({
      status: 'approved',
      createdAt: { $gte: startOfWeek, $lte: endOfWeek }
    });

    res.json({
      success: true,
      count: activePermissions,
      weekStart: startOfWeek,
      weekEnd: endOfWeek
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Weekly returned permissions
// Update the weekly-returned route in analytics.js
router.get('/weekly-returned', authMiddleware, async (req, res) => {
  try {
    const today = new Date();
    
    // Get start of week (Monday)
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - today.getDay() + 1); // Monday
    startOfWeek.setHours(0, 0, 0, 0);
    
    // Get end of week (Sunday)
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    endOfWeek.setHours(23, 59, 59, 999);
    
    console.log('📅 Weekly date range:', {
      start: startOfWeek,
      end: endOfWeek,
      startISO: startOfWeek.toISOString(),
      endISO: endOfWeek.toISOString()
    });
    
    // Debug: Check all returned permissions
    const allReturned = await Permission.find({ 
      status: 'returned' 
    }).select('returnedAt status');
    
    console.log('🔍 All returned permissions:', allReturned.map(p => ({
      returnedAt: p.returnedAt,
      status: p.status,
      isThisWeek: p.returnedAt >= startOfWeek && p.returnedAt <= endOfWeek
    })));
    
    // Count returned permissions this week
    const returnedPermissions = await Permission.countDocuments({
      status: 'returned',
      returnedAt: { 
        $gte: startOfWeek, 
        $lte: endOfWeek 
      }
    });
    
    console.log('✅ Count returned this week:', returnedPermissions);

    res.json({
      success: true,
      count: returnedPermissions,
      weekStart: startOfWeek,
      weekEnd: endOfWeek,
      debug: {
        allReturnedCount: allReturned.length,
        dateRange: {
          start: startOfWeek,
          end: endOfWeek
        }
      }
    });
    
  } catch (error) {
    console.error('❌ Error in weekly-returned:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Routes for individual student analytics
router.get('/student/:studentId', authMiddleware, async (req, res) => {
  try {
    const { studentId } = req.params;
    
    // Get student info
    const student = await Student.findById(studentId).select('name student_id class guardian phone');
    
    if (!student) {
      return res.status(404).json({ success: false, error: 'Student not found' });
    }
    
    // Get all permissions for this student
    const permissions = await Permission.find({ student: studentId })
      .sort({ createdAt: -1 });
    
    // Calculate stats
    const stats = {
      total: permissions.length,
      approved: permissions.filter(p => p.status === 'approved').length,
      returned: permissions.filter(p => p.status === 'returned').length,
      pending: permissions.filter(p => p.status === 'pending').length,
      overdue: permissions.filter(p => {
        return p.status === 'approved' && new Date(p.returnDate) < new Date();
      }).length
    };
    
    // Calculate monthly frequency
    const monthlyData = {};
    permissions.forEach(p => {
      const month = p.createdAt.toISOString().slice(0, 7); // YYYY-MM
      monthlyData[month] = (monthlyData[month] || 0) + 1;
    });
    
    // Get top reasons
    const reasonCounts = {};
    permissions.forEach(p => {
      reasonCounts[p.reason] = (reasonCounts[p.reason] || 0) + 1;
    });
    
    const topReasons = Object.entries(reasonCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([reason, count]) => ({ reason, count }));
    
    // Calculate average permission duration
    const returnedPermissions = permissions.filter(p => p.status === 'returned');
    let totalDuration = 0;
    returnedPermissions.forEach(p => {
      const departure = new Date(p.departure);
      const returned = new Date(p.returnedAt);
      totalDuration += (returned - departure) / (1000 * 60 * 60 * 24); // Days
    });
    
    const avgDuration = returnedPermissions.length > 0 
      ? (totalDuration / returnedPermissions.length).toFixed(1) 
      : 0;
    
    // Get recent permissions (last 5)
    const recentPermissions = permissions.slice(0, 3);
    
    res.json({
      success: true,
      student,
      stats,
      monthlyData,
      topReasons,
      avgDuration,
      recentPermissions,
      permissions: permissions // All permissions if needed
    });
    
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;