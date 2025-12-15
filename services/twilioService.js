// services/twilioService.js
const twilio = require('twilio');

class TwilioService {
  constructor() {
    this.client = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );
  }

  async sendSMS(to, message) {
    try {
      // Format phone number (Rwanda format: +250XXXXXXXXX)
      const formattedPhone = this.formatPhoneNumber(to);
      
      const response = await this.client.messages.create({
        body: message,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: formattedPhone
      });
      
      console.log('SMS sent:', response.sid);
      return { success: true, messageId: response.sid };
    } catch (error) {
      console.error('Twilio error:', error);
      return { success: false, error: error.message };
    }
  }

  formatPhoneNumber(phone) {
    // Remove spaces, dashes, etc.
    let cleaned = phone.replace(/\D/g, '');
    
    // If starts with 0, replace with +250
    if (cleaned.startsWith('0')) {
      cleaned = '+250' + cleaned.substring(1);
    }
    // If starts with 250, add +
    else if (cleaned.startsWith('250')) {
      cleaned = '+' + cleaned;
    }
    // If starts with 7 or 78 (Rwanda), add +250
    else if (cleaned.startsWith('7')) {
      cleaned = '+250' + cleaned;
    }
    
    return cleaned;
  }

  // Permission-specific SMS templates
  async sendPermissionCreated(student, permission, parentPhone) {
    const message = `📚 PERMISSION NOTICE\n\n` +
                   `Dear Parent/Guardian,\n\n` +
                   `Student: ${student.name}\n` +
                   `Class: ${student.class}\n` +
                   `Permission: ${permission.reason}\n` +
                   `Destination: ${permission.destination}\n` +
                   `Departure: ${new Date(permission.departure).toLocaleDateString()}\n` +
                   `Return: ${new Date(permission.returnDate).toLocaleDateString()}\n` +
                   `Permission #: ${permission.permissionNumber}\n\n` +
                   `Please ensure student returns on time.\n` +
                   `Contact school for any questions.`;
    
    return this.sendSMS(parentPhone, message);
  }

  async sendReturnReminder(student, permission, parentPhone) {
    const returnDate = new Date(permission.returnDate);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    if (returnDate.toDateString() === tomorrow.toDateString()) {
      const message = `⏰ RETURN REMINDER\n\n` +
                     `Dear Parent/Guardian,\n\n` +
                     `Reminder: ${student.name} is expected to return tomorrow.\n` +
                     `Return Date: ${returnDate.toLocaleDateString()}\n` +
                     `Permission #: ${permission.permissionNumber}\n\n` +
                     `Please ensure timely return to school.`;
      
      return this.sendSMS(parentPhone, message);
    }
  }

  async sendOverdueAlert(student, permission, parentPhone) {
    const message = `⚠️ OVERDUE ALERT\n\n` +
                   `Dear Parent/Guardian,\n\n` +
                   `URGENT: ${student.name} has not returned as scheduled.\n` +
                   `Expected Return: ${new Date(permission.returnDate).toLocaleDateString()}\n` +
                   `Current Status: OVERDUE\n` +
                   `Permission #: ${permission.permissionNumber}\n\n` +
                   `Please contact school immediately.`;
    
    return this.sendSMS(parentPhone, message);
  }

  async sendReturnConfirmation(student, permission, parentPhone) {
    const message = `✅ RETURN CONFIRMED\n\n` +
                   `Dear Parent/Guardian,\n\n` +
                   `${student.name} has successfully returned to school.\n` +
                   `Permission #: ${permission.permissionNumber}\n` +
                   `Return Time: ${new Date().toLocaleString()}\n\n` +
                   `Thank you for your cooperation.`;
    
    return this.sendSMS(parentPhone, message);
  }
}

module.exports = new TwilioService();