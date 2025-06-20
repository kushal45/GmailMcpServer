import { EmailIndex } from '../../../types/index.js';
import { FormatterOptions } from '../FormatterOptions.js';
import { IFileFormatter } from '../IFileFormatter.js';
import { ValidationResult, ValidationResultFactory } from '../ValidationResult.js';
import { FormatterError } from '../FormatterError.js';

/**
 * Formatter for converting emails to MBOX format
 * 
 * Implements the MBOX format according to RFC4155
 */
export class MboxFormatter implements IFileFormatter {
  /** @inheritdoc */
  getFileExtension(): string {
    return 'mbox';
  }
  
  /** @inheritdoc */
  getFormatName(): string {
    return 'Mbox';
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
          `Cannot format emails to MBOX: ${validationResult.errors.map(e => e.message).join('; ')}`,
          validationResult
        );
      }
      
      // Implement MBOX format according to RFC4155
      let mboxContent = '';
      
      for (const email of emails) {
        mboxContent += this.createMboxHeader(email);
        mboxContent += this.createMboxBody(email, options);
        mboxContent += '\n';
      }
      
      return mboxContent;
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
    
    // MBOX format requires specific fields
    emails.forEach((email, index) => {
      // From line is critical in MBOX format
      if (!email.sender) {
        result.addIssue({
          code: 'MISSING_SENDER',
          message: `Email at index ${index} is missing sender information, which is required for MBOX format`,
          severity: 'ERROR',
          emailIndex: index,
          fieldPath: 'sender'
        });
      } else if (!this.isValidSender(email.sender)) {
        result.addIssue({
          code: 'INVALID_SENDER',
          message: `Email at index ${index} has an invalid sender format: "${email.sender}"`,
          severity: 'ERROR',
          emailIndex: index,
          fieldPath: 'sender'
        });
      }
      
      // Date is important for MBOX format, but we can use a default if missing
      if (!email.date) {
        result.addIssue({
          code: 'MISSING_DATE',
          message: `Email at index ${index} is missing date information, a default will be used`,
          severity: 'WARNING',
          emailIndex: index,
          fieldPath: 'date'
        });
      }
      
      // Content checks
      if (!email.snippet && !email.hasAttachments) {
        result.addIssue({
          code: 'EMPTY_CONTENT',
          message: `Email at index ${index} appears to have no content or attachments`,
          severity: 'WARNING',
          emailIndex: index
        });
      }
    });
    
    return result;
  }
  
  /**
   * Creates an MBOX format header for an email
   * @param email The email to create a header for
   * @returns MBOX header string
   */
  private createMboxHeader(email: EmailIndex): string {
    // Create MBOX format header (From line)
    // The From_ line format: "From sender@domain.com Day Mon DD HH:MM:SS YYYY"
    const fromLine = `From ${this.getSenderAddress(email.sender || 'unknown')} ${this.formatDate(email.date || new Date())}\n`;
    return fromLine;
  }
  
  /**
   * Creates an MBOX format body for an email
   * @param email The email to create a body for
   * @param options Formatter options
   * @returns MBOX body string
   */
  private createMboxBody(email: EmailIndex, options?: FormatterOptions): string {
    // Create standard email headers
    let headers = '';
    
    // Add common email headers
    if (email.subject) {
      headers += `Subject: ${email.subject}\n`;
    }
    
    if (email.sender) {
      headers += `From: ${email.sender}\n`;
    }
    
    if (email.recipients && email.recipients.length > 0) {
      headers += `To: ${email.recipients.join(', ')}\n`;
    }
    
    if (email.date) {
      headers += `Date: ${email.date.toUTCString()}\n`;
    }
    
    // Add additional headers if available
    if (email.threadId) {
      headers += `Message-ID: <${email.id}@gmail.com>\n`;
      headers += `References: <${email.threadId}@gmail.com>\n`;
    }
    
    if (email.labels && email.labels.length > 0) {
      headers += `X-Gmail-Labels: ${email.labels.join(', ')}\n`;
    }
    
    // Add blank line to separate headers from body
    headers += '\n';
    
    // Add email content
    let content = email.snippet || '';
    
    // Add information about attachments if requested and available
    if (options?.includeAttachments && email.hasAttachments) {
      content += '\n\n[This email contains attachments]\n';
    }
    
    return headers + content;
  }
  
  /**
   * Formats a date for MBOX From line according to RFC4155
   * @param date The date to format
   * @returns Formatted date string
   */
  private formatDate(date: Date): string {
    // Format: "Day Mon DD HH:MM:SS YYYY"
    // Example: "Mon Jan 01 00:00:00 2023"
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    
    const day = days[date.getUTCDay()];
    const month = months[date.getUTCMonth()];
    const dayOfMonth = date.getUTCDate().toString().padStart(2, '0');
    const hours = date.getUTCHours().toString().padStart(2, '0');
    const minutes = date.getUTCMinutes().toString().padStart(2, '0');
    const seconds = date.getUTCSeconds().toString().padStart(2, '0');
    const year = date.getUTCFullYear();
    
    return `${day} ${month} ${dayOfMonth} ${hours}:${minutes}:${seconds} ${year}`;
  }
  
  /**
   * Validates if a sender string is in a valid format
   * @param sender The sender string to validate
   * @returns true if valid, false otherwise
   */
  private isValidSender(sender: string): boolean {
    // Basic check for email format
    return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(sender) || 
           // OR name + email format
           /^.+\s<[^@\s]+@[^@\s]+\.[^@\s]+>$/.test(sender);
  }
  
  /**
   * Extracts the email address from a sender string
   * @param sender The sender string (can be "Name <email>" or just "email")
   * @returns The email address
   */
  private getSenderAddress(sender: string): string {
    // Check if it's in the format "Name <email@domain.com>"
    const match = sender.match(/<([^@\s]+@[^@\s]+\.[^@\s]+)>/);
    if (match && match[1]) {
      return match[1];
    }
    
    // Otherwise, assume it's just an email address
    return sender;
  }
}