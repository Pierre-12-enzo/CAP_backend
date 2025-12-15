// test-cloudinary.js
require('dotenv').config();
const cloudinary = require('cloudinary').v2;

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

// Test connection
async function testCloudinary() {
  try {
    console.log('🔄 Testing Cloudinary connection...');
    console.log('📁 Cloud Name:', process.env.CLOUDINARY_CLOUD_NAME);
    
    // Test API access by getting account info
    const result = await cloudinary.api.ping();
    console.log('✅ Cloudinary connection successful!');
    console.log('📊 Status:', result.status);
    
    // Test upload with a simple image
    const uploadResult = await cloudinary.uploader.upload(
      'https://res.cloudinary.com/demo/image/upload/sample.jpg',
      { folder: 'test-uploads' }
    );
    console.log('✅ Test upload successful!');
    console.log('📤 Uploaded to:', uploadResult.secure_url);
    
    // Clean up test file
    await cloudinary.uploader.destroy(uploadResult.public_id);
    console.log('🧹 Test file cleaned up');
    
  } catch (error) {
    console.error('❌ Cloudinary test failed:', error.message);
    console.log('🔍 Please check:');
    console.log('   1. Are CLOUDINARY env variables set correctly?');
    console.log('   2. Is your Cloudinary account active?');
    console.log('   3. Do you have internet connection?');
  }
}

testCloudinary();