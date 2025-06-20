import { EmailIndex } from '../../types/index.js';

/**
 * Represents a validation issue found during email validation
 */
export interface ValidationIssue {
  /** Machine-readable error code (e.g., 'MISSING_SENDER') */
  code: string;
  
  /** Human-readable error message */
  message: string;
  
  /** Issue severity */
  severity: 'ERROR' | 'WARNING';
  
  /** Index of problematic email (if applicable) */
  emailIndex?: number;
  
  /** Path to problematic field (e.g., 'sender', 'payload.headers') */
  fieldPath?: string;
  
  /** Additional context */
  metadata?: any;
}

/**
 * Represents the result of a validation operation
 */
export interface ValidationResult {
  /** Overall validity (no errors, warnings are ok) */
  valid: boolean;
  
  /** Combined list of all issues */
  issues: ValidationIssue[];
  
  /** Helper accessor for error issues */
  get errors(): ValidationIssue[];
  
  /** Helper accessor for warning issues */
  get warnings(): ValidationIssue[];
  
  /** Helper method to add issues */
  addIssue(issue: ValidationIssue): void;
}

/**
 * Factory for creating validation results
 */
export class ValidationResultFactory {
  /**
   * Creates a valid validation result with no issues
   */
  static createValid(): ValidationResult {
    return {
      valid: true,
      issues: [],
      get errors() { 
        return this.issues.filter(i => i.severity === 'ERROR'); 
      },
      get warnings() { 
        return this.issues.filter(i => i.severity === 'WARNING'); 
      },
      addIssue(issue: ValidationIssue) {
        this.issues.push(issue);
        if (issue.severity === 'ERROR') {
          this.valid = false;
        }
      }
    };
  }
  
  /**
   * Creates a validation result with an error
   * @param code Error code
   * @param message Error message
   * @param emailIndex Optional index of the problematic email
   */
  static createError(code: string, message: string, emailIndex?: number): ValidationResult {
    const result = this.createValid();
    result.addIssue({
      code,
      message,
      severity: 'ERROR',
      emailIndex
    });
    return result;
  }
  
  /**
   * Creates a validation result with a warning
   * @param code Warning code
   * @param message Warning message
   * @param emailIndex Optional index of the problematic email
   */
  static createWarning(code: string, message: string, emailIndex?: number): ValidationResult {
    const result = this.createValid();
    result.addIssue({
      code,
      message,
      severity: 'WARNING',
      emailIndex
    });
    return result;
  }
}