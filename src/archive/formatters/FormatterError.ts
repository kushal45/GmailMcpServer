import { ValidationResult } from './ValidationResult.js';

/**
 * Base error class for formatter errors
 */
export class FormatterError extends Error {
  public readonly code: string;
  public readonly validationResult?: ValidationResult;
  public readonly originalError?: Error;
  
  constructor(
    code: string,
    message: string,
    validationResult?: ValidationResult,
    originalError?: Error
  ) {
    super(message);
    this.name = 'FormatterError';
    this.code = code;
    this.validationResult = validationResult;
    this.originalError = originalError;
    
    // Maintain proper stack trace
    // Using type assertion for Node.js specific feature
    if ((Error as any).captureStackTrace) {
      (Error as any).captureStackTrace(this, FormatterError);
    }
  }
}

/**
 * Error thrown when an unsupported format is requested
 */
export class UnsupportedFormatError extends Error {
  constructor(format: string) {
    super(`Unsupported format: ${format}`);
    this.name = 'UnsupportedFormatError';
    
    if ((Error as any).captureStackTrace) {
      (Error as any).captureStackTrace(this, UnsupportedFormatError);
    }
  }
}

/**
 * Error thrown when there's an issue with the formatter registry
 */
export class FormatterRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FormatterRegistryError';
    
    if ((Error as any).captureStackTrace) {
      (Error as any).captureStackTrace(this, FormatterRegistryError);
    }
  }
}

/**
 * Utility class for formatting errors
 */
export class ErrorFormatter {
  /**
   * Converts internal errors to user-friendly messages
   */
  static formatErrorForUser(error: Error | FormatterError | any): string {
    if (error instanceof FormatterError) {
      switch (error.code) {
        case 'VALIDATION_FAILED':
          return `Email validation failed. Please check that your emails contain all required information.`;
        
        case 'FORMAT_OPERATION_FAILED':
          return `There was a problem formatting your emails. This might be due to an issue with the email data.`;
        
        case 'UNEXPECTED_ERROR':
          return `An unexpected error occurred during formatting. Please try again or contact support.`;
        
        default:
          return `Error: ${error.message}`;
      }
    } else if (error instanceof UnsupportedFormatError) {
      return `The requested export format is not supported. Please choose one of the available formats.`;
    } else if (error instanceof FormatterRegistryError) {
      return `There was a configuration issue with the export system. Please contact support.`;
    } else if (error instanceof Error) {
      return `Error: ${error.message}`;
    } else {
      return `An unknown error occurred.`;
    }
  }
  
  /**
   * Generates detailed technical error information for logs
   */
  static formatErrorForLogs(error: any): object {
    const result: any = {
      message: error.message || 'Unknown error',
      name: error.name || 'Error',
      stack: error.stack
    };
    
    if (error instanceof FormatterError) {
      result.code = error.code;
      
      if (error.validationResult) {
        result.validation = {
          valid: error.validationResult.valid,
          errors: error.validationResult.errors,
          warnings: error.validationResult.warnings
        };
      }
      
      if (error.originalError) {
        result.cause = this.formatErrorForLogs(error.originalError);
      }
    }
    
    return result;
  }
}