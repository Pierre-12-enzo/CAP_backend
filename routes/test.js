// routes/test.js
const express = require('express');
const router = express.Router();
const textbeeService = require('../services/textbeeService');

// Test SMS endpoint
router.get('/test-sms', async (req, res) => {
  try {
    const testPhone = req.query.phone || '0781234567'; // Test Rwandan number
    const testMessage = 'Test SMS from School Permission System';
    
    console.log('🧪 Testing SMS to:', testPhone);
    
    const result = await textbeeService.sendSMS(testPhone, testMessage);
    
    res.json({
      success: true,
      test: {
        phone: testPhone,
        message: testMessage,
        result: result
      },
      info: result.demo ? 
        'DEMO MODE: SMS logged to console. Add TextBee API key to send real SMS.' :
        'REAL MODE: SMS sent via TextBee API.'
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;