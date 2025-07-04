import winston from 'winston';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Use Node.js compatible path resolution for logs directory
const projectRoot = path.resolve(__dirname, '../../');
const logsDir = path.join(projectRoot, 'logs');
const userLogsDir = path.join(logsDir, 'users');

try {
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
  
  // Create directory for user-specific logs
  if (!fs.existsSync(userLogsDir)) {
    fs.mkdirSync(userLogsDir, { recursive: true });
  }
} catch (error) {
  // If we can't create logs dir, just use console
  console.error('Failed to create logs directory:', error);
}

// Helper to detect test environment
function isTestEnv() {
  return process.env.NODE_ENV === 'test' || process.env.CI === 'true';
}

const logLevel = isTestEnv() ? 'warn' : (process.env.LOG_LEVEL || 'info');

// Regular expressions for PII detection
const PII_PATTERNS = [
  // Email addresses
  { pattern: /([a-zA-Z0-9_\-\.]+)@([a-zA-Z0-9_\-\.]+)\.([a-zA-Z]{2,5})/g, replacement: '[REDACTED_EMAIL]' },
  // Phone numbers - various formats
  { pattern: /(\+\d{1,3}[\s-])?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/g, replacement: '[REDACTED_PHONE]' },
  // Social Security Numbers (US)
  { pattern: /\d{3}-\d{2}-\d{4}/g, replacement: '[REDACTED_SSN]' },
  // Credit Card Numbers
  { pattern: /\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}/g, replacement: '[REDACTED_CC]' },
  // IP Addresses
  { pattern: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, replacement: '[REDACTED_IP]' }
];

/**
 * Format function to redact PII data from logs
 * @param info Winston log info object
 */
const redactPII = winston.format((info) => {
  try {
    // Create a deep copy of the info object to avoid mutations
    const redactedInfo = { ...info };

    // Redact PII from string fields
    const redactString = (str: string): string => {
      let redacted = str;
      PII_PATTERNS.forEach(({ pattern, replacement }) => {
        redacted = redacted.replace(pattern, replacement);
      });
      return redacted;
    };

    // Redact message field
    if (redactedInfo.message && typeof redactedInfo.message === 'string') {
      redactedInfo.message = redactString(redactedInfo.message);
    }

    // Redact any string values in metadata
    Object.keys(redactedInfo).forEach(key => {
      if (key !== 'level' && key !== 'timestamp' && typeof redactedInfo[key] === 'string') {
        redactedInfo[key] = redactString(redactedInfo[key]);
      } else if (typeof redactedInfo[key] === 'object' && redactedInfo[key] !== null) {
        // Recursively redact nested objects (shallow level only for performance)
        const obj = redactedInfo[key] as Record<string, any>;
        Object.keys(obj).forEach(nestedKey => {
          if (typeof obj[nestedKey] === 'string') {
            obj[nestedKey] = redactString(obj[nestedKey]);
          }
        });
      }
    });

    return redactedInfo;
  } catch (e) {
    // If redaction fails, just return the original info object
    console.error('PII redaction failed:', e instanceof Error ? e.message : String(e));
    return info;
  }
});

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
// Create the main logger
export const logger = winston.createLogger({
  level: logLevel,
  format: winston.format.combine(
    winston.format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss'
    }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    //redactPII(), // Apply PII redaction
    winston.format.json()
  ),
  defaultMeta: { service: 'gmail-mcp-server' },
  transports,
  // Ensure we never accidentally log to stdout
  exitOnError: false
});

// User-specific loggers cache
const userLoggers = new Map<string, winston.Logger>();

/**
 * Get or create a user-specific logger
 * @param userId User ID to create logger for
 */
export function getUserLogger(userId: string): winston.Logger {
  if (userLoggers.has(userId)) {
    return userLoggers.get(userId)!;
  }

  // Create user-specific log file path
  const userLogPath = path.join(userLogsDir, `${userId}.log`);
  
  const userLogger = winston.createLogger({
    level: logLevel,
    format: winston.format.combine(
      winston.format.timestamp({
        format: 'YYYY-MM-DD HH:mm:ss'
      }),
      winston.format.errors({ stack: true }),
      winston.format.splat(),
      redactPII(), // Apply PII redaction
      winston.format.json()
    ),
    defaultMeta: {
      service: 'gmail-mcp-server',
      userId
    },
    transports: [
      new winston.transports.File({
        filename: userLogPath
      })
    ],
    exitOnError: false
  });
  
  userLoggers.set(userId, userLogger);
  return userLogger;
}

/**
 * Log with user context
 * @param level Log level
 * @param userId User ID
 * @param message Log message
 * @param meta Additional metadata
 */
export function logWithUser(
  level: string,
  userId: string,
  message: string,
  meta: Record<string, any> = {}
): void {
  // Log to user-specific logger
  const userLogger = getUserLogger(userId);
  userLogger.log(level, message, { ...meta, userId });
  
  // Also log to main logger with user context
  logger.log(level, message, { ...meta, userId });
}

/**
 * Get logs for a specific user
 * @param userId User ID to get logs for
 * @param options Options for log retrieval
 */
export async function getUserLogs(
  userId: string,
  options: {
    limit?: number;
    startDate?: Date;
    endDate?: Date;
    level?: string;
  } = {}
): Promise<any[]> {
  const userLogPath = path.join(userLogsDir, `${userId}.log`);
  
  try {
    // Check if user log file exists
    await fs.promises.access(userLogPath);
    
    // Read and parse log file
    const content = await fs.promises.readFile(userLogPath, 'utf-8');
    const lines = content.trim().split('\n');
    
    // Parse each line as JSON
    let logs = lines.map(line => {
      try {
        return JSON.parse(line);
      } catch (e) {
        return null;
      }
    }).filter(log => log !== null);
    
    // Apply filters
    if (options.level) {
      logs = logs.filter(log => log.level === options.level);
    }
    
    if (options.startDate) {
      const startDate = options.startDate;
      logs = logs.filter(log => new Date(log.timestamp) >= startDate);
    }
    
    if (options.endDate) {
      const endDate = options.endDate;
      logs = logs.filter(log => new Date(log.timestamp) <= endDate);
    }
    
    // Apply limit
    if (options.limit && options.limit > 0) {
      logs = logs.slice(-options.limit);
    }
    
    return logs;
  } catch (error) {
    // If file doesn't exist or can't be read, return empty array
    return [];
  }
}

// Override console methods to use stderr in production
if (process.env.NODE_ENV === 'production') {
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

/**
 * Create a user-specific stream for Morgan logging
 * @param userId User ID to create stream for
 */
export function createUserLoggerStream(userId: string) {
  return {
    write: (message: string) => {
      logWithUser('info', userId, message.trim());
    }
  };
}