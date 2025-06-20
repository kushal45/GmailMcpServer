import { createDefaultFormatterRegistry } from './formatters/index.js';
import { logger } from '../utils/logger.js';

/**
 * Sets up and configures the formatter registry for the application
 * 
 * @returns Configured formatter registry with all available formatters
 */
export function setupFormatterRegistry() {
  logger.info('Setting up file formatter registry');
  
  // Create the registry with JSON as the default format
  const formatterRegistry = createDefaultFormatterRegistry('json');
  
  // Log available formats
  const formats = formatterRegistry.getSupportedFormats();
  logger.info(`Formatter registry initialized with formats: ${formats.join(', ')}`);
  
  return formatterRegistry;
}