require('dotenv').config({ path: './configs.conf' });
const winston = require('winston');
const chalk = require('chalk');

// Define configuration object
const config = {
  ARI_URL: process.env.ARI_URL || 'http://127.0.0.1:8088',
  ARI_USER: process.env.ARI_USERNAME,
  ARI_PASS: process.env.ARI_PASSWORD,
  ARI_APP: 'genagent_asterisk',
  EXTERNAL_MEDIA_IP: process.env.EXTERNAL_MEDIA_IP,
  RTP_SOURCE_IP: process.env.RTP_SOURCE_IP || '127.0.0.1',
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  REALTIME_URL: `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent`,
  LIVE_MODEL: process.env.LIVE_MODEL,
  RTP_PORT_START: 12000,
  MAX_CONCURRENT_CALLS: parseInt(process.env.MAX_CONCURRENT_CALLS) || 10,
  VAD_THRESHOLD: parseFloat(process.env.VAD_THRESHOLD) || 0.6,
  VAD_PREFIX_PADDING_MS: Number(process.env.VAD_PREFIX_PADDING_MS) || 200,
  VAD_SILENCE_DURATION_MS: Number(process.env.VAD_SILENCE_DURATION_MS) || 600,
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  SYSTEM_INSTRUCTION: process.env.SYSTEM_INSTRUCTION,
  INITIAL_MESSAGE: process.env.INITIAL_MESSAGE || 'Hi',
  SILENCE_PADDING_MS: parseInt(process.env.SILENCE_PADDING_MS) || 100,
  CALL_DURATION_LIMIT_SECONDS: parseInt(process.env.CALL_DURATION_LIMIT_SECONDS) || 0 // 0 means no limit
};

// Debug logging of loaded configuration
console.log('Loaded configuration:', {
  ARI_URL: config.ARI_URL,
  ARI_USER: config.ARI_USER,
  ARI_PASS: config.ARI_PASS ? 'set' : 'unset',
  GEMINI_API_KEY: config.GEMINI_API_KEY ? 'set' : 'unset',
  LOG_LEVEL: config.LOG_LEVEL,
  SYSTEM_INSTRUCTION: config.SYSTEM_INSTRUCTION ? 'set' : 'unset'
});

// Logger configuration
let sentEventCounter = 0;
let receivedEventCounter = -1;
const logger = winston.createLogger({
  level: config.LOG_LEVEL,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => {
      const [origin] = message.split(' ', 1);
      let counter, coloredMessage;
      if (origin === '[Client]') {
        counter = `C-${sentEventCounter.toString().padStart(4, '0')}`;
        sentEventCounter++;
        coloredMessage = chalk.cyanBright(message);
      } else if (origin === '[Agent]') {
        counter = `O-${receivedEventCounter.toString().padStart(4, '0')}`;
        receivedEventCounter++;
        coloredMessage = chalk.yellowBright(message);
      } else {
        counter = 'N/A';
        coloredMessage = chalk.gray(message);
      }
      return `${counter} | ${timestamp} [${level.toUpperCase()}] ${coloredMessage}`;
    })
  ),
  transports: [
    new winston.transports.Console()
  ]
});

// Validate critical configurations
if (!config.SYSTEM_INSTRUCTION || config.SYSTEM_INSTRUCTION.trim() === '') {
  logger.error('SYSTEM_INSTRUCTION is missing or empty in config.conf');
  process.exit(1);
}
logger.info('SYSTEM_INSTRUCTION loaded from config.conf');

if (config.CALL_DURATION_LIMIT_SECONDS < 0) {
  logger.error('CALL_DURATION_LIMIT_SECONDS cannot be negative in config.conf');
  process.exit(1);
}
logger.info(`CALL_DURATION_LIMIT_SECONDS set to ${config.CALL_DURATION_LIMIT_SECONDS} seconds`);

const logClient = (msg, level = 'info') => logger[level](`[Client] ${msg}`);
const logServer = (msg, level = 'info') => logger[level](`[Agent] ${msg}`);

module.exports = {
  config,
  logger,
  logClient,
  logServer
};
