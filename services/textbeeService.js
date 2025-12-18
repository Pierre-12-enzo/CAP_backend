// services/textbeeService.js - IMPROVED VERSION
const axios = require('axios');

class TextBeeService {
  constructor() {
    this.apiKey = process.env.TEXTBEE_API_KEY;
    this.deviceId = process.env.TEXTBEE_DEVICE_ID;
    this.baseURL = 'https://api.textbee.dev/api/v1';
    this.isConfigured = !!this.apiKey && !!this.deviceId;
    
    if (this.isConfigured) {
      console.log(`✅ TextBee: Ready (Device: ${this.deviceId})`);
    }
  }

  async sendSMS(to, message, retries = 2) {
    if (!this.isConfigured) {
      console.log('📱 [DEMO SMS]:', message.substring(0, 50) + '...');
      return { success: true, demo: true };
    }

    const formattedPhone = this.formatPhone(to);
    
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        console.log(`📱 Attempt ${attempt}/${retries}: Sending to ${formattedPhone}`);
        
        const response = await axios.post(
          `${this.baseURL}/gateway/devices/${this.deviceId}/send-sms`,
          {
            recipients: [formattedPhone],
            message: message
          },
          {
            headers: {
              'x-api-key': this.apiKey,
              'Content-Type': 'application/json'
            },
            timeout: 15000 // Increased timeout to 15 seconds
          }
        );
        
        console.log(`✅ SMS sent successfully!`);
        console.log('Batch ID:', response.data.smsBatchId);
        console.log('Message:', response.data.message);
        
        return {
          success: true,
          data: response.data,
          provider: 'textbee',
          batchId: response.data.smsBatchId,
          attempt: attempt
        };
        
      } catch (error) {
        console.error(`❌ Attempt ${attempt} failed:`, error.message);
        
        if (attempt < retries) {
          console.log(`⏳ Retrying in 2 seconds...`);
          await new Promise(resolve => setTimeout(resolve, 2000));
          continue;
        }
        
        return {
          success: false,
          error: error.message,
          provider: 'textbee',
          attempts: attempt
        };
      }
    }
  }

  formatPhone(phone) {
    let cleaned = phone.replace(/\D/g, '');
    
    if (cleaned.startsWith('0')) {
      return `+250${cleaned.substring(1)}`;
    }
    
    if (cleaned.startsWith('250')) {
      return `+${cleaned}`;
    }
    
    if (cleaned.length === 9) {
      return `+250${cleaned}`;
    }
    
    return `+${cleaned}`;
  }

   // Check SMS delivery status
  async checkDeliveryStatus(batchId) {
    try {
      const response = await axios.get(
        `${this.baseURL}/gateway/sms-batches/${batchId}`,
        {
          headers: { 'x-api-key': this.apiKey }
        }
      );
      
      return {
        success: true,
        status: response.data.status,
        data: response.data
      };
      
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  // School-specific SMS templates
  async sendPermissionCreated(student, permission, parentPhone) {
    const message = `Mwiriwe Neza Umwana Wanyu: 📚\n\n` +
                   `Witwa ${student.name}\n` +
                   `Wiga: ${student.class}\n` +
                   `Atashye Kubera Impamvu Ikurikira: ${permission.reason}\n` +
                   `Akaba Atashye i: ${permission.destination}\n` +
                   `Itariki yo kugaruka: ${new Date(permission.returnDate).toLocaleDateString('rw-RW')}\n` +
                   `Numero y'uruhushya: ${permission.permissionNumber}\n\n` +
                   `Ku Bindi Bisobanuro Mwavugisha DOD W'ikigo,  Murakoze.`;
    
    return this.sendSMS(parentPhone, message);
  }

  async sendReturnConfirmation(student, permission, parentPhone) {
    const message = `MWIRIWE NEZA ✅\n\n` +
                   `Umwana Wanyu Witwa ${student.name}\n` +
                   `Yasubiye mu ishuri neza.\n` +
                   `Numero y'uruhushya: ${permission.permissionNumber}\n` +
                   `Itariki: ${new Date().toLocaleDateString('rw-RW')}\n\n` +
                   `Murakoze cyane.`;
    
    return this.sendSMS(parentPhone, message);
  }
}

module.exports = new TextBeeService();