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
    unique: true
  },
  qrCode: {
    type: String // URL or data for QR code
  }
}, {
  timestamps: true
});

// Generate permission number before save
permissionSchema.pre('save', async function(next) {
  if (!this.permissionNumber) {
    const count = await mongoose.model('Permission').countDocuments();
    this.permissionNumber = `PERM-${Date.now()}-${count + 1}`;
  }
  next();
});

module.exports = mongoose.model('Permission', permissionSchema);