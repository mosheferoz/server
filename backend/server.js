require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const config = require('./config');
const logger = require('./logger');
const rateLimiter = require('./middleware/rateLimiter');
const scraperRoutes = require('./routes/scraper.routes');
const whatsappService = require('./services/whatsapp.service');

// יצירת אפליקציית Express
const app = express();

// יצירת שרת HTTP
const server = require('http').createServer(app);

// הגדרת Socket.IO
const io = require('socket.io')(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? process.env.CORS_ORIGIN.split(',')
    : '*',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(bodyParser.json());
app.use(helmet());
app.use(compression());
app.use(rateLimiter);

// נתיבים
app.use('/api/scraper', scraperRoutes);
app.use('/api/whatsapp', require('./routes/whatsapp.routes'));

// נתיב בדיקת בריאות
app.use('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// טיפול בשגיאות 404
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// טיפול בשגיאות כלליות
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// אתחול WhatsApp והפעלת השרת
(async () => {
  try {
    await whatsappService.initialize();
    await startServer();
  } catch (err) {
    logger.error('Failed to initialize:', err);
    process.exit(1);
  }
})();

// הגעלת השרת
const startServer = async () => {
  // קבלת הפורט מRender או שימוש בברירת מחדל
  const PORT = process.env.PORT || 3000;
  
  try {
    // הגדרת האזנה לכל הממשקים
    const options = {
      port: PORT,
      host: '0.0.0.0'
    };

    await new Promise((resolve, reject) => {
      server.listen(options)
        .once('error', (err) => {
          logger.error('Server error:', err);
          reject(err);
        })
        .once('listening', () => {
          const addr = server.address();
          logger.info(`Server is running on port ${addr.port}`);
          resolve();
        });
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};
