// models/Student.js
const mongoose = require('mongoose');

const studentSchema = new mongoose.Schema({
    student_id: {
        type: String,
        required: true,
        unique: true
    },
    name: {
        type: String,
        required: true
    },
    class: {
        type: String,
        required: true
    },
    level: {
        type: String,
        default: 'N/A'
    },
    residence: {
        type: String,
        default: 'N/A'
    },
    gender: {
        type: String,
        default: 'N/A'
    },
    academic_year: {
        type: String,
        default: 'N/A'
    },
    parent_phone: {
        type: String,
        default: ''
    },
    // Cloudinary fields
    photo_url: { type: String }, // Cloudinary URL
    photo_public_id: { type: String }, // Cloudinary public_id for management
    photo_metadata: {
        width: Number,
        height: Number,
        format: String,
        bytes: Number
    },
    has_photo: {
        type: Boolean,
        default: false
    },
    photo_uploaded_at: {
        type: Date
    },
    card_generated: {
        type: Boolean,
        default: false
    },
    card_generation_count: {
        type: Number,
        default: 0
    },
    last_card_generated: {
        type: Date
    },
    first_card_generated: {
        type: Date
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('Student', studentSchema);