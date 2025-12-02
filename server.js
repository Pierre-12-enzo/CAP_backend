require("dotenv").config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');


const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));      // big ZIPs
app.use('/output', express.static('output')); // <-- important for preview
app.use('/uploads', express.static('uploads')); // For uploaded files
app.use('/template', express.static('.')); // For default template if needed

//Mongo Connection
const uri = process.env.MONGO_URI;
mongoose.connect(uri)
  .then(() => console.log('MongoDB → CAP_mis'))
  .catch(e => console.error(e));

//Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/card', require('./routes/card'));
app.use('/api/students', require('./routes/student'));
app.use('/api/templates', require('./routes/templates'));
app.use('/api/permissions', require('./routes/permissions'));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`API on ${PORT}`));