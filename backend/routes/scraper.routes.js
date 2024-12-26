const express = require('express');
const router = express.Router();
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const logger = require('../logger');

router.post('/scrape', async (req, res) => {
    try {
        const { url } = req.body;
        logger.info(`התחלת תהליך סקרייפינג עבור URL: ${url}`);
        
        if (!url) {
            logger.warn('לא סופק URL בבקשה');
            return res.status(400).json({ error: 'URL is required' });
        }

        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            logger.warn(`פורמט URL לא תקין: ${url}`);
            return res.status(400).json({ error: 'Invalid URL format. URL must start with http:// or https://' });
        }

        const pythonScriptPath = path.join(__dirname, '../services/python_scraper.py');
        logger.info(`נתיב סקריפט Python: ${pythonScriptPath}`);
        
        const pythonPath = 'python3';
        logger.info(`משתמש בנתיב Python: ${pythonPath}`);
        
        // בדיקה שהסקריפט קיים
        const fs = require('fs');
        if (!fs.existsSync(pythonScriptPath)) {
            logger.error(`סקריפט Python לא נמצא בנתיב: ${pythonScriptPath}`);
            return res.status(500).json({ error: 'Python script not found' });
        }
        
        const pythonProcess = spawn(pythonPath, [pythonScriptPath, url]);

        let dataString = '';
        let errorString = '';

        pythonProcess.stdout.on('data', (data) => {
            const output = data.toString();
            logger.debug(`פלט Python: ${output}`);
            dataString += output;
        });

        pythonProcess.stderr.on('data', (data) => {
            const error = data.toString();
            logger.error(`שגיאת Python: ${error}`);
            errorString += error;
        });

        pythonProcess.on('error', (error) => {
            logger.error(`כשל בהפעלת תהליך Python: ${error.message}`);
            res.status(500).json({ 
                error: 'Failed to start scraping process',
                details: error.message
            });
        });

        pythonProcess.on('close', (code) => {
            logger.info(`תהליך Python הסתיים עם קוד: ${code}`);
            
            if (code !== 0) {
                logger.error('תהליך Python נכשל');
                logger.error(`פלט שגיאה: ${errorString}`);
                
                try {
                    const errorObj = JSON.parse(errorString);
                    return res.status(500).json({ 
                        error: 'Failed to scrape data',
                        details: errorObj
                    });
                } catch (parseError) {
                    return res.status(500).json({ 
                        error: 'Failed to scrape data',
                        details: errorString
                    });
                }
            }

            try {
                logger.debug(`מנסה לפרסר פלט Python: ${dataString}`);
                const result = JSON.parse(dataString);
                
                if (!result.eventName) {
                    logger.warn('לא נמצא שם אירוע בנתונים שנאספו');
                    return res.status(404).json({ 
                        error: 'No event data found',
                        details: 'Could not find event information on the page'
                    });
                }
                
                logger.info(`נאספו נתונים בהצלחה: ${JSON.stringify(result)}`);
                res.json(result);
            } catch (error) {
                logger.error(`כשל בפרסור פלט Python: ${error.message}`);
                logger.error(`פלט גולמי: ${dataString}`);
                res.status(500).json({ 
                    error: 'Failed to parse scraped data',
                    details: error.message,
                    raw: dataString
                });
            }
        });

    } catch (error) {
        logger.error(`שגיאת שרת: ${error.message}`);
        res.status(500).json({ 
            error: 'Internal server error',
            details: error.message
        });
    }
});

module.exports = router; 