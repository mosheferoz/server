const express = require('express');
const router = express.Router();
const whatsappService = require('../services/whatsapp.service');
const logger = require('../logger');
const authMiddleware = require('../middleware/auth');

// נתיבים שלא דורשים אימות
router.get('/qr/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    logger.info(`QR code request received for session ${sessionId}`);
    
    // אם WhatsApp לא מחובר, נאתחל אותו
    if (!whatsappService.clients.has(sessionId)) {
      logger.info(`WhatsApp client not initialized for session ${sessionId}, initializing...`);
      await whatsappService.initialize(sessionId);
    }
    
    // נחכה קצת לקבלת ה-QR
    let attempts = 0;
    while (!whatsappService.qrCodes.has(sessionId) && attempts < 10) {
      logger.info(`Waiting for QR code, attempt ${attempts + 1}/10`);
      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;
    }

    if (!whatsappService.qrCodes.has(sessionId)) {
      logger.warn('QR code not generated after waiting');
      return res.status(404).json({ 
        error: 'QR not available',
        details: 'QR code generation timeout'
      });
    }

    logger.info('QR code found, sending response');
    res.json({ qr: whatsappService.getQR(sessionId) });
  } catch (error) {
    logger.error('Error in /qr route:', error);
    res.status(500).json({ 
      error: 'Failed to get QR code',
      details: error.message
    });
  }
});

router.get('/status/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  res.json(whatsappService.getStatus(sessionId));
});

// נתיבים שדורשים אימות
router.use(authMiddleware);

router.post('/send', async (req, res) => {
  try {
    logger.info('Received send request - Full body:', req.body);
    
    const { phoneNumber, message, recipientName, sessionId, shouldArchive = false } = req.body;
    
    if (!sessionId) {
      logger.error('Missing sessionId');
      return res.status(400).json({
        error: 'Missing sessionId',
        details: 'Session ID is required'
      });
    }
    
    // בדיקת חיבור WhatsApp
    if (!whatsappService.isConnected.get(sessionId)) {
      logger.error(`WhatsApp is not connected for session ${sessionId}`);
      return res.status(503).json({ 
        error: 'WhatsApp is not connected',
        details: 'Please scan QR code and wait for connection'
      });
    }

    // ודיקה שיש מספר טלפון
    if (!phoneNumber) {
      logger.error('Missing phone number');
      return res.status(400).json({
        error: 'Missing phone number',
        details: 'Phone number is required'
      });
    }

    // ניקוי וולידציה של מספר הטלפון
    const cleanPhoneNumber = phoneNumber.toString().replace(/[^\d]/g, '');
    
    if (!cleanPhoneNumber || !cleanPhoneNumber.match(/^\d{9,10}$/)) {
      logger.warn('Invalid phone number:', { 
        original: phoneNumber,
        cleaned: cleanPhoneNumber 
      });
      return res.status(400).json({ 
        error: 'Invalid phone number',
        details: 'Phone number must be 9-10 digits'
      });
    }

    // טיפול בהודעה - אם אין הודעה, נשתמש בערך ריק
    let finalMessage = req.body.message || '';
    
    try {
      // אם יש שם נמען ויש תבנית {name} בהודעה, נחליף אותה
      if (recipientName && finalMessage.includes('{name}')) {
        finalMessage = finalMessage.replace('{name}', recipientName.trim());
      }
      
      logger.info('Message processing:', {
        original: message,
        final: finalMessage,
        recipientName: recipientName || 'not provided'
      });

      const result = await whatsappService.sendMessage(sessionId, cleanPhoneNumber, finalMessage);
      
      // אם נדרש לארכב את הצ'אט
      if (shouldArchive && result.chatId) {
        try {
          await whatsappService.archiveChat(sessionId, result.chatId);
          logger.info(`Chat archived successfully for ${cleanPhoneNumber}`);
        } catch (archiveError) {
          logger.warn('Failed to archive chat:', archiveError);
        }
      }
      
      logger.info('Message sent successfully');
      res.json({ 
        success: true,
        phoneNumber: cleanPhoneNumber,
        message: finalMessage,
        archived: shouldArchive
      });
    } catch (error) {
      logger.error('Error processing message:', error);
      res.status(500).json({ 
        error: 'Failed to process message',
        details: error.message
      });
    }
  } catch (error) {
    logger.error('Error in /send:', error);
    res.status(500).json({ 
      error: error.message,
      details: error.stack
    });
  }
});

router.post('/archive', async (req, res) => {
  try {
    const { sessionId, chatId } = req.body;
    
    if (!sessionId || !chatId) {
      return res.status(400).json({
        error: 'Missing required fields',
        details: 'Session ID and Chat ID are required'
      });
    }

    await whatsappService.archiveChat(sessionId, chatId);
    
    res.json({ 
      success: true,
      message: 'Chat archived successfully'
    });
  } catch (error) {
    logger.error('Error in /archive:', error);
    res.status(500).json({ 
      error: error.message,
      details: error.stack
    });
  }
});

module.exports = router; 