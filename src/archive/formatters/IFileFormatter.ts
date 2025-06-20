import { EmailIndex } from '../../types/index.js';
import { FormatterOptions } from './FormatterOptions.js';
import { ValidationResult } from './ValidationResult.js';

/**
 * Interface for email file formatters
 * 
 * Provides a common interface for different file formatters
 * that can export emails to various formats.
 */
export interface IFileFormatter {
  /**
   * Returns the file extension this formatter handles (without the dot)
   */
  getFileExtension(): string;
  
  /**
   * Returns a human-readable name for this format
   */
  getFormatName(): string;
  
  /**
   * Formats the provided emails into the target format
   * @param emails List of email indexes to format
   * @param options Additional formatting options
   * @returns Formatted content as a string
   */
  formatEmails(emails: EmailIndex[], options?: FormatterOptions): Promise<string>;

  /**
   * Validates if the provided emails can be formatted with this formatter
   * @param emails List of email indexes to validate
   * @returns Validation result with any potential issues
   */
  validateEmails(emails: EmailIndex[]): ValidationResult;
}