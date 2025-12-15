// routes/testTextBee.js
const express = require('express');
const router = express.Router();
const textbeeService = require('../services/textbeeService');

// Test TextBee API with correct endpoint
router.post('/test-textbee', async (req, res) => {
  try {
    const { phone, message } = req.body;
    
    console.log('🧪 Testing TextBee with correct API endpoint...');
    console.log('API Key exists?', !!process.env.TEXTBEE_API_KEY);
    console.log('Device ID exists?', !!process.env.TEXTBEE_DEVICE_ID);
    
    if (!process.env.TEXTBEE_API_KEY || !process.env.TEXTBEE_DEVICE_ID) {
      return res.status(400).json({
        success: false,
        error: 'Missing TextBee configuration',
        required: ['TEXTBEE_API_KEY', 'TEXTBEE_DEVICE_ID']
      });
    }
    
    const testPhone = phone || '250793166542';
    const testMessage = message || 'Test SMS from School System with correct API';
    
    console.log('Test phone:', testPhone);
    console.log('Test message:', testMessage);
    console.log('Device ID:', process.env.TEXTBEE_DEVICE_ID);
    
    // Test the connection first
    const connectionTest = await textbeeService.testConnection();
    console.log('Connection test:', connectionTest);
    
    // Then send actual SMS
    const result = await textbeeService.sendSMS(testPhone, testMessage);
    
    res.json({
      success: true,
      test: {
        phone: testPhone,
        message: testMessage,
        deviceId: process.env.TEXTBEE_DEVICE_ID,
        apiKeyLength: process.env.TEXTBEE_API_KEY.length
      },
      connectionTest,
      smsResult: result
    });
    
  } catch (error) {
    console.error('Test error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Quick status check
router.get('/textbee-status', (req, res) => {
  res.json({
    success: true,
    configured: !!process.env.TEXTBEE_API_KEY && !!process.env.TEXTBEE_DEVICE_ID,
    hasApiKey: !!process.env.TEXTBEE_API_KEY,
    hasDeviceId: !!process.env.TEXTBEE_DEVICE_ID,
    apiKeyLength: process.env.TEXTBEE_API_KEY?.length || 0,
    deviceId: process.env.TEXTBEE_DEVICE_ID || 'Not set',
    endpoint: `https://api.textbee.dev/api/v1/gateway/devices/${process.env.TEXTBEE_DEVICE_ID}/send-sms`
  });
});

module.exports = router;