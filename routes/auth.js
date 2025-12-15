const express = require('express');
const router = express.Router();
const User = require('../models/User');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');


// Register
router.post('/register', async (req, res) => {
    try {
        const { firstName, lastName, username, email, password, role } = req.body;

        // Validate required fields
        if (!firstName || !lastName || !username || !email || !password) {
            return res.status(400).json({
                success: false,
                error: 'All fields are required'
            });
        }

        // Check if user already exists
        const existingUser = await User.findOne({
            $or: [{ email }, { username }]
        });

        if (existingUser) {
            return res.status(400).json({
                success: false,
                error: 'User already exists with this email or username'
            });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create user
        const user = new User({
            firstName,
            lastName,
            username,
            email,
            password: hashedPassword,
            role: role || 'staff' // Use provided role or default to 'staff'
        });

        await user.save();

        // Generate token
        const token = jwt.sign({
            id: user._id,
            role: user.role
        }, process.env.JWT_SECRET || 'fallback_secret', {
            expiresIn: '24h'
        });

        // Return success response (matching frontend expectation)
        res.status(201).json({
            success: true,
            message: 'User registered successfully',
            user: {
                id: user._id,
                firstName: user.firstName,
                lastName: user.lastName,
                username: user.username,
                email: user.email,
                role: user.role
            },
            token: token
        });

    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error during registration'
        });
    }
});

// Login
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        // Validate required fields
        if (!email || !password) {
            return res.status(400).json({
                success: false,
                error: 'email and password are required'
            });
        }

        // Find user by email
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(401).json({
                success: false,
                error: 'Invalid credentials'
            });
        }

        // Check password
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({
                success: false,
                error: 'Invalid credentials'
            });
        }

        // Generate token
        const token = jwt.sign({
            id: user._id,
            role: user.role
        }, process.env.JWT_SECRET || 'fallback_secret', {
            expiresIn: '24h'
        });

        // Return success response
        res.json({
            success: true,
            message: 'Login successful',
            user: {
                id: user._id,
                firstName: user.firstName,
                lastName: user.lastName,
                username: user.username,
                email: user.email,
                role: user.role
            },
            token: token
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error during login'
        });
    }
});

// Logout
router.post('/logout', (req, res) => {
    res.json({
        success: true,
        message: 'Logged out successfully'
    });
});

//Get Profile
router.get('/profile', authMiddleware, async (req, res) => {
    try {
        // req.user is now available from authMiddleware
        res.json({
            success: true,
            user: req.user  // Single user object
        });
    } catch (err) {
        console.error('Profile error:', err);
        res.status(500).json({
            success: false,
            message: 'Server error while fetching profile'
        });
    }
});

// ✅ UPDATE USER PROFILE (name, email)
router.put('/profile', authMiddleware, async (req, res) => {
    try {
        const { firstName, lastName, username, email, institution } = req.body;
        
        // Check if email already exists (excluding current user)
        if (email) {
            const existingUser = await User.findOne({ 
                email: email.toLowerCase(), 
                _id: { $ne: req.user.id } 
            });
            
            if (existingUser) {
                return res.status(400).json({
                    success: false,
                    error: 'Email already exists'
                });
            }
        }

        const updateData = {};
        if (username) updateData.username = username;
        if (firstName) updateData.firstName = firstName;
        if (lastName) updateData.lastName = lastName;
        if (institution) updateData.institution = institution;
        if (email) updateData.email = email.toLowerCase();

        const user = await User.findByIdAndUpdate(
            req.user.id,
            updateData,
            { new: true, runValidators: true }
        ).select('-password');

        res.json({
            success: true,
            message: 'Profile updated successfully',
            user
        });

    } catch (error) {
        console.error('❌ Update profile error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ✅ CHANGE PASSWORD
router.put('/change-password', authMiddleware, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({
                success: false,
                error: 'Current password and new password are required'
            });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({
                success: false,
                error: 'New password must be at least 6 characters long'
            });
        }

        // Get user with password
        const user = await User.findById(req.user.id);
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        // Verify current password
        const isMatch = await bcrypt.compare(currentPassword, user.password);
        if (!isMatch) {
            return res.status(400).json({
                success: false,
                error: 'Current password is incorrect'
            });
        }

        // Update password
        user.password = await bcrypt.hash(newPassword, 10);

        
        
        await user.save();

        res.json({
            success: true,
            message: 'Password changed successfully'
        });

    } catch (error) {
        console.error('❌ Change password error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ✅ UPLOAD PROFILE IMAGE
router.put('/profile-image', authMiddleware, async (req, res) => {
    try {
        const { profileImage } = req.body; // You'll get this from file upload

        if (!profileImage) {
            return res.status(400).json({
                success: false,
                error: 'Profile image is required'
            });
        }

        const user = await User.findByIdAndUpdate(
            req.user.id,
            { profileImage },
            { new: true }
        ).select('-password');

        res.json({
            success: true,
            message: 'Profile image updated successfully',
            user
        });

    } catch (error) {
        console.error('❌ Profile image error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ✅ GET ALL USERS (Admin only - for user management)
router.get('/', authMiddleware, roleMiddleware('admin'),  async (req, res) => {
    try {
        // Check if user is admin (optional - remove if not needed)
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Access denied'
            });
        }

        const users = await User.find().select('-password').sort({ createdAt: -1 });

        res.json({
            success: true,
            users,
            total: users.length
        });

    } catch (error) {
        console.error('❌ Get users error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;