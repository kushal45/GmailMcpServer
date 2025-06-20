// Export interfaces
export type { IFileFormatter } from './IFileFormatter.js';
export type { FormatterOptions } from './FormatterOptions.js';
export type { ValidationResult, ValidationIssue } from './ValidationResult.js';
export { ValidationResultFactory } from './ValidationResult.js';

// Export errors
export { 
  FormatterError, 
  UnsupportedFormatError, 
  FormatterRegistryError,
  ErrorFormatter
} from './FormatterError.js';

// Export registry
export { FileFormatterRegistry } from './FormatterRegistry.js';

// Export formatters
export { JsonFormatter } from './formatters/JsonFormatter.js';
export { MboxFormatter } from './formatters/MboxFormatter.js';

// Import necessary classes for createDefaultFormatterRegistry
import { FileFormatterRegistry } from './FormatterRegistry.js';
import { JsonFormatter } from './formatters/JsonFormatter.js';
import { MboxFormatter } from './formatters/MboxFormatter.js';

/**
 * Creates and configures a formatter registry with all available formatters
 * @param defaultFormat Optional default format (defaults to 'json')
 * @returns Configured formatter registry
 */
export function createDefaultFormatterRegistry(defaultFormat: string = 'json'): FileFormatterRegistry {
  // Create registry
  const registry = new FileFormatterRegistry(defaultFormat);
  
  // Register formatters
  registry.registerFormatter(new JsonFormatter());
  registry.registerFormatter(new MboxFormatter());
  
  return registry;
}