// models/Template.js - COMPLETE TEMPLATE WITH BOTH SIDES
const mongoose = require('mongoose');

const templateSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    description: {
        type: String,
        default: ''
    },
    // Front side (for dynamic data)
    frontSide: {
        filename: { type: String, required: true },
        filepath: { type: String, required: true }
    },
    // Back side (static content)
    backSide: {
        filename: { type: String, required: true },
        filepath: { type: String, required: true }
    },
    isDefault: {
        type: Boolean,
        default: false
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('Template', templateSchema);