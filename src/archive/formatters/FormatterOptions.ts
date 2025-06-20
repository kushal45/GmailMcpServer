/**
 * Common options for all formatters
 */
export interface FormatterOptions {
  /** Include email attachments in the formatted output */
  includeAttachments?: boolean;
  
  /** Include metadata about the export in the formatted output */
  includeMetadata?: boolean;
  
  /** Format the output in a human-readable way (when applicable) */
  prettyPrint?: boolean;
  
  /** Maximum size in bytes for the output (when applicable) */
  maxSizeBytes?: number;
  
  /** Format-specific options can be added via string indexing */
  [key: string]: any;
}