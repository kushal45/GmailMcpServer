import { EmailIndex } from '../../../types/index.js';
import { FormatterOptions } from '../FormatterOptions.js';
import { IFileFormatter } from '../IFileFormatter.js';
import { ValidationResult, ValidationResultFactory } from '../ValidationResult.js';
import { FormatterError } from '../FormatterError.js';

/**
 * Formatter for converting emails to JSON format
 */
export class JsonFormatter implements IFileFormatter {
  /** Indentation level for pretty printing */
  private indentLevel: number;
  private readonly defaultFormat: string = 'json';
  private readonly formatName: string = 'JSON';

  /**
   * Creates a new JSON formatter
   * @param indentLevel Indentation level for pretty printing (default: 2)
   */
  constructor(indentLevel: number = 2) {
    this.indentLevel = indentLevel;
  }
  
  /** @inheritdoc */
  getFileExtension(): string {
   return this.defaultFormat
  }
  
  /** @inheritdoc */
  getFormatName(): string {
   return this.formatName;
  }
  
  /** @inheritdoc */
  async formatEmails(emails: EmailIndex[], options?: FormatterOptions): Promise<string> {
    try {
      // Perform validation first
      const validationResult = this.validateEmails(emails);
      
      // If there are errors, don't proceed with formatting
      if (!validationResult.valid) {
        throw new FormatterError(
          'VALIDATION_FAILED',
          `Cannot format emails: ${validationResult.errors.map(e => e.message).join('; ')}`,
          validationResult
        );
      }
      
      const prettyPrint = options?.prettyPrint !== false;
      
      const data = {
        exportDate: new Date(),
        emailCount: emails.length,
        emails: emails,
        metadata: options?.includeMetadata ? this.createMetadata(emails) : undefined
      };
      
      return JSON.stringify(data, null, prettyPrint ? this.indentLevel : 0);
    } catch (error) {
      // Check if this is already a formatter error
      if (error instanceof FormatterError) {
        throw error;
      }
      
      // Otherwise, wrap it
      throw new FormatterError(
        'UNEXPECTED_ERROR',
        `Unexpected error in ${this.getFormatName()} formatter: ${error instanceof Error ? error.message : String(error)}`,
        undefined,
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }
  
  /** @inheritdoc */
  validateEmails(emails: EmailIndex[]): ValidationResult {
    const result = ValidationResultFactory.createValid();
    
    // Check for circular references (a common JSON serialization issue)
    try {
      // Test serialization
      JSON.stringify(emails);
    } catch (error) {
      result.addIssue({
        code: 'JSON_CIRCULAR_REF',
        message: `Cannot serialize to JSON: ${error instanceof Error ? error.message : String(error)}`,
        severity: 'ERROR'
      });
      return result;
    }
    
    // Check for extremely large emails that might cause performance issues
    const sizeWarningThreshold = 10 * 1024 * 1024; // 10MB
    
    emails.forEach((email, index) => {
      // Check for missing required fields
      if (!email.id) {
        result.addIssue({
          code: 'MISSING_ID',
          message: `Email at index ${index} is missing ID`,
          severity: 'ERROR',
          emailIndex: index,
          fieldPath: 'id'
        });
      }
      
      // Check size warning
      if (email.size && email.size > sizeWarningThreshold) {
        result.addIssue({
          code: 'LARGE_EMAIL',
          message: `Email at index ${index} is very large (${(email.size / 1024 / 1024).toFixed(2)}MB), which may cause performance issues`,
          severity: 'WARNING',
          emailIndex: index,
          fieldPath: 'size',
          metadata: { size: email.size }
        });
      }
    });
    
    return result;
  }
  
  /**
   * Creates metadata about the exported emails
   * @param emails List of emails to create metadata for
   * @returns Metadata object
   */
  private createMetadata(emails: EmailIndex[]): object {
    return {
      exportTimestamp: new Date().toISOString(),
      totalEmails: emails.length,
      sizeStats: this.calculateSizeStats(emails),
      dateRange: this.calculateDateRange(emails)
    };
  }
  
  /**
   * Calculates size statistics for a list of emails
   * @param emails List of emails to calculate statistics for
   * @returns Size statistics
   */
  private calculateSizeStats(emails: EmailIndex[]) {
    const totalSize = emails.reduce((sum, email) => sum + (email.size || 0), 0);
    return {
      totalSize,
      averageSize: emails.length ? totalSize / emails.length : 0
    };
  }
  
  /**
   * Calculates date range for a list of emails
   * @param emails List of emails to calculate date range for
   * @returns Date range object
   */
  private calculateDateRange(emails: EmailIndex[]) {
    const dates = emails
      .filter(email => email.date instanceof Date)
      .map(email => email.date as Date);
    
    if (dates.length === 0) {
      return { earliest: null, latest: null };
    }
    
    return {
      earliest: new Date(Math.min(...dates.map(d => d.getTime()))).toISOString(),
      latest: new Date(Math.max(...dates.map(d => d.getTime()))).toISOString()
    };
  }
}