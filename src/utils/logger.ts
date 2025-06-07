import winston from 'winston';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, '../../logs');
try {
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
} catch (error) {
  // If we can't create logs dir, just use console
  console.error('Failed to create logs directory:', error);
}

const logLevel = process.env.LOG_LEVEL || 'info';

// Create transports array
const transports: winston.transport[] = [];

// Only add file transports if we can write to the logs directory
try {
  transports.push(
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error'
    }),
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log')
    })
  );
} catch (error) {
  console.error('Failed to create file transports:', error);
}

// For MCP servers in production, we should NOT output to console at all
// stdout is reserved for JSON-RPC communication
if (process.env.NODE_ENV !== 'production') {
  transports.push(
    new winston.transports.Console({
      stderrLevels: ['error', 'warn', 'info', 'debug'], // All levels go to stderr
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  );
}

export const logger = winston.createLogger({
  level: logLevel,
  format: winston.format.combine(
    winston.format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss'
    }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
  ),
  defaultMeta: { service: 'gmail-mcp-server' },
  transports,
  // Ensure we never accidentally log to stdout
  exitOnError: false
});

// Override console methods to use stderr in production
if (process.env.NODE_ENV === 'production') {
  const originalConsoleLog = console.log;
  const originalConsoleInfo = console.info;
  const originalConsoleWarn = console.warn;
  const originalConsoleDebug = console.debug;
  
  console.log = (...args: any[]) => console.error('[console.log]', ...args);
  console.info = (...args: any[]) => console.error('[console.info]', ...args);
  console.warn = (...args: any[]) => console.error('[console.warn]', ...args);
  console.debug = (...args: any[]) => console.error('[console.debug]', ...args);
}

// Create a stream object with a 'write' function for Morgan
export const loggerStream = {
  write: (message: string) => {
    logger.info(message.trim());
  }
};