const mongoose = require('mongoose');

const permissionSchema = new mongoose.Schema({
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Student',
    required: true
  },
  reason: {
    type: String,
    required: true,
    trim: true
  },
  destination: {
    type: String,
    required: true,
    trim: true
  },
  guardian: {
    name: { type: String, required: true },
    relationship: { type: String, required: true },
    phone: { type: String }
  },
  departure: {
    type: Date,
    required: true
  },
  returnDate: {
    type: Date
  },
  status: {
    type: String,
    enum: ['returned', 'approved'],
    default: 'approved'
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  permissionNumber: {
    type: String,
    unique: true,
    sparse: true
  },
  qrCode: {
    type: String // URL or data for QR code
  }
}, {
  timestamps: true
});

// Generate permission number before save
permissionSchema.pre('save', async function(next) {
  if (!this.permissionNumber || this.permissionNumber === 'null') {
    try {
      // Generate more unique number
      const year = new Date().getFullYear();
      const month = String(new Date().getMonth() + 1).padStart(2, '0');
      const day = String(new Date().getDate()).padStart(2, '0');
      const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
      
      // Get count for today
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      
      const dailyCount = await mongoose.model('Permission').countDocuments({
        createdAt: { $gte: today, $lt: tomorrow }
      });
      
      this.permissionNumber = `PERM-${year}${month}${day}-${String(dailyCount + 1).padStart(3, '0')}-${random}`;
    } catch (error) {
      // Ultimate fallback
      this.permissionNumber = `PERM-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
    }
  }
  next();
});

module.exports = mongoose.model('Permission', permissionSchema);