import { IFileFormatter } from './IFileFormatter.js';
import { UnsupportedFormatError, FormatterRegistryError } from './FormatterError.js';
import { logger } from '../../utils/logger.js';

/**
 * Registry for file formatters
 * 
 * Manages available formatters and provides a way to retrieve them by format
 */
export class FileFormatterRegistry {
  /** Map of formatter keys to formatter instances */
  private formatters: Map<string, IFileFormatter> = new Map();
  
  /** Default formatter key */
  private defaultFormatter: string = 'json';
  
  /**
   * Creates a new formatter registry
   * @param defaultFormat Default format to use when no format is specified
   */
  constructor(defaultFormat?: string) {
    if (defaultFormat) {
      this.defaultFormatter = defaultFormat.toLowerCase();
    }
  }
  
  /**
   * Register a formatter 
   * @param formatter The formatter implementation
   */
  registerFormatter(formatter: IFileFormatter): void {
    const format = formatter.getFileExtension().toLowerCase();
    this.formatters.set(format, formatter);
    logger.debug(`Registered formatter for ${formatter.getFormatName()} format`);
    
    // If this is the first formatter, set it as default
    if (this.formatters.size === 1) {
      this.defaultFormatter = format;
      logger.debug(`Set ${formatter.getFormatName()} as default formatter`);
    }
  }
  
  /**
   * Get a formatter for a specific format
   * @param format The format name or file extension
   * @throws UnsupportedFormatError if no formatter is found for the format
   */
  getFormatter(format: string): IFileFormatter {
    const normalizedFormat = format.toLowerCase();
    const formatter = this.formatters.get(normalizedFormat);
    
    if (!formatter) {
      // Try to find by file extension without dot
      if (normalizedFormat.startsWith('.')) {
        const withoutDot = normalizedFormat.substring(1);
        const formatterByExt = this.formatters.get(withoutDot);
        if (formatterByExt) {
          return formatterByExt;
        }
      }
      
      // If still not found, try to find by name
      const matchByName = Array.from(this.formatters.values())
        .find(f => f.getFormatName().toLowerCase() === normalizedFormat);
      
      if (matchByName) {
        return matchByName;
      }
      
      // No formatter found
      throw new UnsupportedFormatError(format);
    }
    
    return formatter;
  }
  
  /**
   * Check if a formatter exists for a specific format
   * @param format The format name or file extension
   */
  hasFormatter(format: string): boolean {
    try {
      this.getFormatter(format);
      return true;
    } catch (error) {
      if (error instanceof UnsupportedFormatError) {
        return false;
      }
      throw error;
    }
  }
  
  /**
   * Get all supported formats
   * @returns Array of supported format extensions
   */
  getSupportedFormats(): string[] {
    return Array.from(this.formatters.keys());
  }
  
  /**
   * Get the default formatter
   * @throws FormatterRegistryError if no default formatter is configured
   */
  getDefaultFormatter(): IFileFormatter {
    const formatter = this.formatters.get(this.defaultFormatter);
    
    if (!formatter) {
      if (this.formatters.size === 0) {
        throw new FormatterRegistryError('No formatters registered');
      }
      
      // Fall back to the first registered formatter
      const firstFormatter = this.formatters.values().next().value;
      if (!firstFormatter) {
        throw new FormatterRegistryError('Unexpected error: formatter is registered but cannot be retrieved');
      }
      return firstFormatter;
    }
    
    return formatter;
  }
  
  /**
   * Set the default formatter
   * @param format The format to set as default
   * @throws FormatterRegistryError if the format is not registered
   */
  setDefaultFormatter(format: string): void {
    const normalizedFormat = format.toLowerCase();
    
    if (!this.hasFormatter(normalizedFormat)) {
      throw new FormatterRegistryError(`Cannot set default formatter: format ${format} is not registered`);
    }
    
    this.defaultFormatter = normalizedFormat;
    logger.debug(`Set ${format} as default formatter`);
  }
}