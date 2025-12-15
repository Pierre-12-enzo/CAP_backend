require("dotenv").config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const app = express();

// ==================== CORS CONFIGURATION ====================
// Allowed origins for production and development
const allowedOrigins = [
  'https://cap-mis.vercel.app',
  'http://localhost:5173', // Vite dev server
];

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      // Log unauthorized origins for debugging
      console.warn(`⚠️ Blocked CORS request from: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true, // Allow cookies/auth headers
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'Accept',
    'Origin',
    'Access-Control-Allow-Headers'
  ],
  exposedHeaders: ['Content-Disposition'], // For file downloads
  maxAge: 86400, // 24 hours
};

app.use(cors(corsOptions));

// Handle preflight requests
//app.options('/*', cors(corsOptions));

// ==================== MIDDLEWARE ====================
app.use(express.json({ limit: '50mb' })); // For large ZIP files
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Security headers
app.use((req, res, next) => {
  // Remove server signature
  res.removeHeader('X-Powered-By');
  
  // Security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  
  // CORS headers
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  
  next();
});

// ==================== STATIC FILES ====================
// Note: In production on Render.com, avoid serving static files
// from local directory. Use Cloudinary URLs instead.
app.use('/output', express.static(path.join(__dirname, 'output')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/template', express.static(path.join(__dirname, 'public/template')));

// ==================== MONGOOSE CONNECTION ====================
const uri = process.env.MONGO_URI;

mongoose.connect(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
})
.then(() => console.log('✅ MongoDB → CAP_mis connected successfully'))
.catch(e => {
  console.error('❌ MongoDB connection error:', e.message);
  console.log('📌 Please check:');
  console.log('   1. Is MongoDB Atlas cluster running?');
  console.log('   2. Is IP whitelisted in Atlas?');
  console.log('   3. Are credentials correct in .env?');
});

// Connection events
mongoose.connection.on('connected', () => {
  console.log('📊 MongoDB connection established');
});

mongoose.connection.on('error', (err) => {
  console.error('❌ MongoDB connection error:', err);
});

mongoose.connection.on('disconnected', () => {
  console.log('⚠️ MongoDB disconnected');
});

// Graceful shutdown
process.on('SIGINT', async () => {
  await mongoose.connection.close();
  console.log('MongoDB connection closed through app termination');
  process.exit(0);
});

// ==================== ROUTES ====================
// Health check endpoint (required for Render.com)
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    environment: process.env.NODE_ENV || 'development'
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'CAP_mis Backend API',
    version: '1.0.0',
    status: 'operational',
    docs: '/api-docs', // You can add Swagger later
    endpoints: [
      '/api/auth',
      '/api/card',
      '/api/students',
      '/api/templates',
      '/api/permissions',
      '/api/analytics'
    ]
  });
});

// API Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/card', require('./routes/card'));
app.use('/api/students', require('./routes/student'));
app.use('/api/templates', require('./routes/templates'));
app.use('/api/permissions', require('./routes/permissions'));
app.use('/api/analytics', require('./routes/analytics'));

// Test routes (disable in production if needed)
if (process.env.NODE_ENV !== 'production') {
  const testTextBeeRoutes = require('./routes/testTextBee');
  app.use('/api/test', testTextBeeRoutes);
}

// ==================== ERROR HANDLING ====================
// 404 handler
app.use((req, res, next) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    path: req.originalUrl
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('🔥 Global error:', err);
  
  // Handle CORS errors
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({
      success: false,
      error: 'Cross-origin request blocked',
      message: 'Your origin is not allowed to access this API'
    });
  }
  
  // Handle other errors
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    success: false,
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// ==================== SERVER START ====================
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log('='.repeat(50));
  console.log(`🚀 CAP_mis Backend Server`);
  console.log(`📡 Port: ${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`✅ CORS Allowed Origins: ${allowedOrigins.join(', ')}`);
  console.log('='.repeat(50));
  
  // Log important environment variables (masked)
  console.log('📝 Configuration:');
  console.log(`   - MongoDB: ${process.env.MONGO_URI ? 'Configured' : 'Missing'}`);
  console.log(`   - Cloudinary: ${process.env.CLOUDINARY_CLOUD_NAME ? 'Configured' : 'Missing'}`);
  console.log(`   - TextBee: ${process.env.TEXTBEE_API_KEY ? 'Configured' : 'Missing'}`);
});