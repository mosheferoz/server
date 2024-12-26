const { Client } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const fs = require('fs-extra');
const { rimraf } = require('rimraf');
const config = require('../config');
const logger = require('../logger');
const path = require('path');
const { LocalAuth } = require('whatsapp-web.js');
const csv = require('csv-parser');

class WhatsAppService {
  constructor() {
    this.clients = new Map();
    this.qrCodes = new Map();
    this.isConnected = new Map();
    this.isInitializing = new Map();
    this.authPath = path.join(__dirname, '../whatsapp-auth');
  }

  async cleanupAuthFolder(sessionId) {
    try {
      logger.info(`Starting auth folder cleanup for session ${sessionId}...`);
      const sessionPath = path.join(this.authPath, `session-${sessionId}`);

      if (this.clients.has(sessionId)) {
        try {
          await this.clients.get(sessionId).destroy();
          this.clients.delete(sessionId);
          logger.info(`Existing client destroyed for session ${sessionId}`);
          await new Promise(resolve => setTimeout(resolve, 3000));
        } catch (err) {
          logger.warn('Error destroying client:', err);
        }
      }

      if (fs.existsSync(sessionPath)) {
        await rimraf(sessionPath, { 
          maxRetries: 3,
          recursive: true,
          force: true
        });
        logger.info('Session folder removed');
      }

      await fs.ensureDir(sessionPath);
      logger.info('Session folder recreated');

      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (error) {
      logger.error('Error in cleanupAuthFolder:', error);
    }
  }

  async initialize(sessionId = 'default') {
    const validSessionId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
    
    if (this.isInitializing.get(validSessionId)) {
      logger.info(`WhatsApp client is already initializing for session ${validSessionId}`);
      return;
    }

    try {
      this.isInitializing.set(validSessionId, true);
      this.isConnected.set(validSessionId, false);
      logger.info(`Starting WhatsApp client initialization for session ${validSessionId}...`);

      await this.cleanupAuthFolder(validSessionId);
      const sessionPath = path.join(this.authPath, `session-${validSessionId}`);

      const client = new Client({
        restartOnAuthFail: true,
        authStrategy: new LocalAuth({
          clientId: validSessionId,
          dataPath: sessionPath
        }),
        puppeteer: {
          headless: true,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
            '--aggressive-cache-discard',
            '--disable-cache',
            '--disable-application-cache',
            '--disable-offline-load-stale-cache',
            '--disk-cache-size=0'
          ],
          timeout: 120000,
          waitForInitialPage: true,
        }
      });

      client.on('ready', () => {
        this.isConnected.set(validSessionId, true);
        this.qrCodes.delete(validSessionId);
        logger.info(`WhatsApp client is ready and connected for session ${validSessionId}`);
      });

      client.on('qr', async (qr) => {
        try {
          logger.info(`Received QR code from WhatsApp for session ${validSessionId}`);
          const qrCode = await qrcode.toDataURL(qr);
          this.qrCodes.set(validSessionId, qrCode);
          logger.info('QR code converted to data URL');
        } catch (error) {
          logger.error('Error generating QR code:', error);
          this.qrCodes.delete(validSessionId);
        }
      });

      client.on('authenticated', () => {
        this.isConnected.set(validSessionId, true);
        this.qrCodes.delete(validSessionId);
        logger.info(`WhatsApp client authenticated for session ${validSessionId}`);
      });

      client.on('auth_failure', async (err) => {
        this.isConnected.set(validSessionId, false);
        this.qrCodes.delete(validSessionId);
        logger.error(`WhatsApp authentication failed for session ${validSessionId}:`, err);
        
        await this.cleanupAuthFolder(validSessionId);
        setTimeout(() => this.initialize(validSessionId), 5000);
      });

      client.on('disconnected', async (reason) => {
        this.isConnected.set(validSessionId, false);
        this.qrCodes.delete(validSessionId);
        logger.error(`WhatsApp client disconnected for session ${validSessionId}:`, reason);
        
        try {
          if (this.clients.has(validSessionId)) {
            await this.clients.get(validSessionId).destroy();
            this.clients.delete(validSessionId);
            await new Promise(resolve => setTimeout(resolve, 5000));
          }
          
          await this.cleanupAuthFolder(validSessionId);
          
          setTimeout(() => {
            if (!this.isInitializing.get(validSessionId)) {
              this.initialize(validSessionId);
            }
          }, 5000);
        } catch (error) {
          logger.error('Error handling disconnection:', error);
        }
      });

      await client.initialize();
      this.clients.set(validSessionId, client);
      logger.info(`WhatsApp client initialized successfully for session ${validSessionId}`);
    } catch (error) {
      logger.error(`WhatsApp initialization error for session ${validSessionId}:`, error);
      this.isConnected.set(validSessionId, false);
      this.qrCodes.delete(validSessionId);
      
      if (this.clients.has(validSessionId)) {
        try {
          await this.clients.get(validSessionId).destroy();
        } catch (destroyError) {
          logger.error('Error destroying client:', destroyError);
        }
        this.clients.delete(validSessionId);
      }
      
      setTimeout(() => this.initialize(validSessionId), 10000);
    } finally {
      this.isInitializing.delete(validSessionId);
    }
  }

  getStatus(sessionId) {
    return {
      connected: this.isConnected.get(sessionId) || false,
      hasQR: this.qrCodes.has(sessionId)
    };
  }

  getQR(sessionId) {
    logger.debug(`getQR called for session ${sessionId}`);
    
    if (!this.clients.has(sessionId)) {
      throw new Error('WhatsApp client not initialized');
    }
    if (!this.qrCodes.has(sessionId)) {
      throw new Error('No QR code available yet. Please wait for QR generation.');
    }
    return this.qrCodes.get(sessionId);
  }

  async sendMessage(sessionId, phoneNumber, message) {
    try {
      logger.info(`Starting sendMessage for session ${sessionId}:`, { phoneNumber, message });
      
      if (!this.isConnected.get(sessionId)) {
        logger.error(`WhatsApp client is not connected for session ${sessionId}`);
        throw new Error('WhatsApp client is not connected');
      }

      const client = this.clients.get(sessionId);
      if (!client) {
        throw new Error('WhatsApp client not found');
      }

      if (!phoneNumber || !message) {
        logger.error('Missing required fields:', { phoneNumber, message });
        throw new Error('Phone number and message are required');
      }

      const cleanPhone = phoneNumber.replace(/[^\d+]/g, '');
      if (!cleanPhone) {
        logger.error('Invalid phone number after cleaning:', phoneNumber);
        throw new Error('Phone number must contain digits');
      }

      try {
        const formattedNumber = this.formatPhoneNumber(cleanPhone);
        logger.info('Formatted phone number:', formattedNumber);
        
        const chatId = `${formattedNumber}@c.us`;
        logger.info('Attempting to send message to:', chatId);
        
        const chat = await client.getChatById(chatId);
        if (!chat) {
          throw new Error('Chat not found for this number');
        }

        await chat.sendMessage(message);
        logger.info('Message sent successfully to:', formattedNumber);
        
        return {
          success: true,
          phoneNumber: formattedNumber,
          message: message
        };
      } catch (error) {
        logger.error('Error in sendMessage:', error);
        throw new Error(`Failed to send message: ${error.message}`);
      }
    } catch (error) {
      logger.error(`Top level error in sendMessage for session ${sessionId}:`, error);
      throw error;
    }
  }

  formatPhoneNumber(phoneNumber) {
    logger.debug('Formatting phone number:', phoneNumber);
    const formatted = phoneNumber.startsWith('+')
      ? phoneNumber.slice(1)
      : `972${phoneNumber.startsWith('0') ? phoneNumber.slice(1) : phoneNumber}`;
    logger.debug('Formatted result:', formatted);
    return formatted;
  }

  async processCsvFile(filePath) {
    const results = [];
    const errors = [];

    return new Promise((resolve, reject) => {
      fs.createReadStream(filePath)
        .pipe(csv())
        .on('data', async (row) => {
          try {
            const message = row.message.replace('{name}', row.name || '');
            await this.sendMessage(row.phone, message);
            results.push({
              phone: row.phone,
              status: 'success'
            });
          } catch (error) {
            errors.push({
              phone: row.phone,
              error: error.message
            });
          }
        })
        .on('end', () => {
          resolve({
            success: results,
            errors: errors
          });
        })
        .on('error', (error) => {
          reject(error);
        });
    });
  }
}

module.exports = new WhatsAppService(); 