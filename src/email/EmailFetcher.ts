import { gmail_v1 } from 'googleapis';
import { AuthManager } from '../auth/AuthManager.js';
import { CacheManager } from '../cache/CacheManager.js';
import { EmailMessage, EmailIndex, ListEmailsOptions } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { OAuth2Client } from 'google-auth-library';
import fetch from 'node-fetch';
import { DatabaseManager } from '../database/DatabaseManager.js';

export class EmailFetcher {
  private authManager: AuthManager;
  private cacheManager: CacheManager;
  private databaseManager: DatabaseManager;

  constructor(authManager: AuthManager, cacheManager: CacheManager, databaseManager: DatabaseManager) {
    this.authManager = authManager;
    this.cacheManager = cacheManager;
    this.databaseManager = databaseManager;
  }

  async listEmails(options: ListEmailsOptions): Promise<{ emails: EmailIndex[], total: number }> {
    // Check cache first
    const cacheKey = CacheManager.emailListKey(options);
    const cached = this.cacheManager.get<{ emails: EmailIndex[], total: number }>(cacheKey);
    if (cached) {
      logger.debug('Returning cached email list');
      return cached;
    }
    logger.info('Listing emails with options:', options);
    try {
      const gmail = await this.authManager.getGmailClient();
      
      // Build query
      let query = '';
      if (options.category) {
        // This will be refined after categorization is implemented
        query += `label:${options.category} `;
      }
      if (options.year) {
        query += `after:${options.year}/1/1 before:${options.year + 1}/1/1 `;
      }
      if (options.archived) {
        query += 'label:archived ';
      }
      logger.info('Listing emails with query:', query.trim());

      // Fetch emails
      const response = await gmail.users.messages.list({
        userId: 'me',
        q: query.trim(),
        maxResults: options.limit,
        pageToken: options.offset ? String(options.offset) : undefined
      });
      logger.info('Fetched emails:', response.data);

      const messages = response.data.messages || [];
      console.error(`Found ${messages.length} emails matching criteria`);
     const emailDetails = await this.getEmailDetails(gmail, messages.map(m => m.id!));

      const result = {
        emails: emailDetails,
        total: response.data.resultSizeEstimate || 0
      };

      // Cache the result
     // this.cacheManager.set(cacheKey, result);
      this.databaseManager.bulkUpsertEmailIndex(emailDetails);
      return result;
    } catch (error) {
      logger.error('Error listing emails:', error);
      throw error;
    }
  }

  /**
   * Get email details for a single or multiple message IDs
   */
  private async getEmailDetails(gmail: gmail_v1.Gmail, messageIds: string[]): Promise<EmailIndex[]> {
    const emailDetails: EmailIndex[] = [];

    for (const messageId of messageIds) {
      try {
        const response = await gmail.users.messages.get({
          userId: 'me',
          id: messageId,
          format: 'metadata',
          metadataHeaders: ['From', 'To', 'Subject', 'Date']
        });
        if (!response.data || !response.data.id) {
          logger.error(`Skipping message with no data or id: ${messageId}`);
          continue;
        }
        const message = response.data;
        logger.debug(`Fetched details for message ${messageId}:`, message);
        if (!message.id || !message.threadId) {
          logger.error(`Skipping message with missing id or threadId: ${messageId}`);
          continue;
        }

        // Extract headers
        const headers = message.payload?.headers || [];
        const getHeader = (name: string) => headers.find(h => h.name === name)?.value || '';

        // Parse date
        const dateStr = getHeader('Date');
        const date = dateStr ? new Date(dateStr) : new Date();

        // Extract labels
        const labels = message.labelIds || [];
        const isArchived = labels.includes('ARCHIVED');

        const emailIndex: EmailIndex = {
          id: message.id,
          threadId: message.threadId,
          category: 'low', // Default category, will be categorized later
          subject: getHeader('Subject') || 'No Subject',
          sender: getHeader('From') || 'No Sender',
          recipients: getHeader('To').split(',').map(r => r.trim()).filter(Boolean),
          date,
          year: date.getFullYear(),
          size: message.sizeEstimate || 0,
          hasAttachments: message.payload?.parts?.some(part => part.filename && part.filename.length > 0) || false,
          labels,
          snippet: message.snippet || '',
          archived: isArchived,
          archiveDate: undefined,
          archiveLocation: undefined
        };

        emailDetails.push(emailIndex);
      } catch (error) {
        logger.error(`Error fetching details for message ${messageId}:`, error);
      }
    }

    return emailDetails;
  }

  async getEmailDetailsBulk(messageIds: string[]): Promise<EmailIndex[]> {
    if (!messageIds || messageIds.length === 0) {
      logger.warn('No message IDs provided for bulk fetch');
      return [];
    }
    try {
      const emailDetails = await this.fetchEmailBatchViaHttpBatch(messageIds);
      
      // Log warning if some emails couldn't be fetched, but don't throw error
      if (!emailDetails || emailDetails.length === 0) {
        logger.warn(`No email details retrieved for message IDs: ${messageIds.join(', ')}`);
        logger.warn('This might be due to deleted messages or permission issues');
        return [];
      }
      
      if (emailDetails.length < messageIds.length) {
        logger.warn(`Only fetched ${emailDetails.length} out of ${messageIds.length} requested emails`);
        const fetchedIds = new Set(emailDetails.map(e => e.id));
        const missingIds = messageIds.filter(id => !fetchedIds.has(id));
        logger.debug('Missing email IDs:', missingIds);
      }

      return emailDetails;
    } catch (error) {
      logger.error(`Error fetching email details for batch:`, error);
      logger.error(`Failed message IDs: ${messageIds.join(', ')}`);
      
      // Try to fall back to individual fetching for critical cases
      if (messageIds.length <= 10) {
        logger.info('Attempting fallback to individual email fetching...');
        try {
          const gmail = await this.authManager.getGmailClient();
          return await this.getEmailDetails(gmail, messageIds);
        } catch (fallbackError) {
          logger.error('Fallback individual fetching also failed:', fallbackError);
        }
      }
      
      return [];
    }
  }

 

  /**
   * Fetch email details in bulk using Gmail batch endpoint (multipart/mixed HTTP request)
   * This is more efficient than individual API calls for large numbers of emails
   */
  private async fetchEmailBatchViaHttpBatch(messageIds: string[]): Promise<EmailIndex[]> {
    const gmail = await this.authManager.getGmailClient();
    const oAuth2Client: OAuth2Client = this.authManager.getClient();
    const emails: EmailIndex[] = [];
    const batchSize = parseInt(process.env.GMAIL_BATCH_SIZE || '100', 10);
    const endpoint = 'https://gmail.googleapis.com/batch/gmail/v1';

    for (let i = 0; i < messageIds.length; i += batchSize) {
      const batch = messageIds.slice(i, i + batchSize);
      const boundary = 'batch_' + Math.random().toString(36).substring(2);
      let body = '';
      for (const id of batch) {
        body += `--${boundary}\r\n`;
        body += 'Content-Type: application/http\r\n';
        body += 'Content-Transfer-Encoding: binary\r\n\r\n';
        body += `GET /gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date HTTP/1.1\r\n`;
        body += 'Host: gmail.googleapis.com\r\n\r\n';
      }
      body += `--${boundary}--\r\n`;

      const token = (await oAuth2Client.getAccessToken()).token;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': `multipart/mixed; boundary=${boundary}`
        },
        body
      });
      
      if (!response.ok) {
        logger.error(`Batch API request failed with status ${response.status}: ${response.statusText}`);
        const errorText = await response.text();
        logger.error('Error response:', errorText);
        continue;
      }
      
      const text = await response.text();
      logger.info(`Batch response received for ${text} emails`);

      // Log the response for debugging
      logger.debug('Batch API response status:', response.status);
      logger.debug('Response headers:', response.headers);
      
      // Log first 500 chars of response for debugging
      if (text.length > 0) {
        logger.debug('Response preview (first 500 chars):', text.substring(0, 500));
      }
      
      // Check if this is a multipart response or a single response
      const isMultipart = text.includes(`--${boundary}`);
      
      if (!isMultipart) {
        // Handle single response (when batch contains only one item)
        logger.debug('Handling single response format');
        
        // The response includes HTTP headers, we need to extract the JSON body
        // Look for the double line break that separates headers from body
        const bodyStartIndex = text.indexOf('\r\n\r\n');
        if (bodyStartIndex === -1) {
          logger.error('Could not find HTTP body separator in response');
          continue;
        }
        
        // Extract the body part (after headers)
        const bodyContent = text.substring(bodyStartIndex + 4).trim();
        
        // Find the JSON content in the body
        const jsonStartIndex = bodyContent.indexOf('{');
        if (jsonStartIndex !== -1) {
          try {
            // Find the matching closing brace for proper JSON extraction
            let braceCount = 0;
            let jsonEndIndex = -1;
            
            for (let i = jsonStartIndex; i < bodyContent.length; i++) {
              if (bodyContent[i] === '{') braceCount++;
              else if (bodyContent[i] === '}') {
                braceCount--;
                if (braceCount === 0) {
                  jsonEndIndex = i;
                  break;
                }
              }
            }
            
            if (jsonEndIndex !== -1) {
              const jsonContent = bodyContent.substring(jsonStartIndex, jsonEndIndex + 1);
              const json = JSON.parse(jsonContent);
            
            if (json && json.id && json.threadId) {
              const headers = json.payload?.headers || [];
              const getHeader = (name: string) => headers.find((h: any) => h.name === name)?.value || '';
              
              const dateStr = getHeader('Date');
              const date = dateStr ? new Date(dateStr) : new Date();
              const labels = json.labelIds || [];
              
              const emailIndex: EmailIndex = {
                id: json.id,
                threadId: json.threadId,
                category: 'low',
                subject: getHeader('Subject') || 'No Subject',
                sender: getHeader('From') || 'No Sender',
                recipients: getHeader('To').split(',').map((r: string) => r.trim()).filter(Boolean),
                date,
                year: date.getFullYear(),
                size: json.sizeEstimate || 0,
                hasAttachments: json.payload?.parts?.some((part: any) => part.filename && part.filename.length > 0) || false,
                labels,
                snippet: json.snippet || '',
                archived: labels.includes('ARCHIVED'),
                archiveDate: undefined,
                archiveLocation: undefined
              };
              
              emails.push(emailIndex);
            }
            } else {
              logger.error('Could not find matching closing brace for JSON');
            }
          } catch (e) {
            logger.error('Failed to parse single response JSON:', e);
            logger.debug('Body content that failed to parse:', bodyContent.substring(0, 500));
          }
        } else {
          logger.error('No JSON content found in response body');
        }
      } else {
        // Parse multipart/mixed response
        const parts = text.split(`--${boundary}`);
        logger.debug(`Found ${parts.length} parts in batch response`);
        
        for (const part of parts) {
          if (part.includes('Content-Type: application/http')) {
            try {
              // Find the HTTP response part - improved regex to handle various line endings
              const httpResponseMatch = part.match(/HTTP\/\d\.\d\s+(\d+)\s+[\w\s]+\r?\n([\s\S]*?)(\r?\n\r?\n)([\s\S]*)/);
              
              if (httpResponseMatch) {
                const statusCode = parseInt(httpResponseMatch[1]);
                let responseBody = httpResponseMatch[4];
                
                // Only process successful responses
                if (statusCode === 200 && responseBody) {
                  // Clean up the response body - remove any trailing boundary markers or extra content
                  responseBody = responseBody.trim();
                  
                  // Find the start of JSON content (starts with '{')
                  const jsonStartIndex = responseBody.indexOf('{');
                  if (jsonStartIndex !== -1) {
                    // Find the matching closing brace
                    let braceCount = 0;
                    let jsonEndIndex = -1;
                    
                    for (let i = jsonStartIndex; i < responseBody.length; i++) {
                      if (responseBody[i] === '{') braceCount++;
                      else if (responseBody[i] === '}') {
                        braceCount--;
                        if (braceCount === 0) {
                          jsonEndIndex = i;
                          break;
                        }
                      }
                    }
                    
                    if (jsonEndIndex !== -1) {
                      // Extract only the JSON content
                      const jsonContent = responseBody.substring(jsonStartIndex, jsonEndIndex + 1);
                      
                      try {
                        const json = JSON.parse(jsonContent);
                        
                        if (json && json.id && json.threadId) {
                          // Parse the batch response directly
                          const headers = json.payload?.headers || [];
                          const getHeader = (name: string) => headers.find((h: any) => h.name === name)?.value || '';
                          
                          const dateStr = getHeader('Date');
                          const date = dateStr ? new Date(dateStr) : new Date();
                          const labels = json.labelIds || [];
                          
                          const emailIndex: EmailIndex = {
                            id: json.id,
                            threadId: json.threadId,
                            category: 'low', // Default category, will be categorized later
                            subject: getHeader('Subject') || 'No Subject',
                            sender: getHeader('From') || 'No Sender',
                            recipients: getHeader('To').split(',').map((r: string) => r.trim()).filter(Boolean),
                            date,
                            year: date.getFullYear(),
                            size: json.sizeEstimate || 0,
                            hasAttachments: json.payload?.parts?.some((part: any) => part.filename && part.filename.length > 0) || false,
                            labels,
                            snippet: json.snippet || '',
                            archived: labels.includes('ARCHIVED'),
                            archiveDate: undefined,
                            archiveLocation: undefined
                          };
                          
                          emails.push(emailIndex);
                        }
                      } catch (parseError) {
                        logger.error('Failed to parse JSON content:', parseError);
                        logger.debug('JSON content that failed to parse:', jsonContent.substring(0, 200));
                      }
                    } else {
                      logger.warn('Could not find matching closing brace for JSON in response');
                    }
                  } else {
                    logger.warn('Response body does not contain JSON (no opening brace found)');
                    logger.debug('Response body preview:', responseBody.substring(0, 100));
                  }
                } else {
                  logger.warn(`Batch response returned status ${statusCode} for one of the messages`);
                }
              }
            } catch (e) {
              logger.error('Failed to parse batch email response:', e);
              logger.debug('Problematic part (first 500 chars):', part.substring(0, 500));
              logger.debug('Part length:', part.length);
              
              // Try to extract any useful information from the error
              if (part.includes('"id"') && part.includes('"threadId"')) {
                logger.debug('Part appears to contain email data but failed to parse');
              }
            }
          }
        }
      }
      // Small delay between batches
      if (i + batchSize < messageIds.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    return emails;
  }

  async getAllMessageIds(query: string = ''): Promise<string[]> {
    const gmail = await this.authManager.getGmailClient();
    const messageIds: string[] = [];
    let pageToken: string | undefined;

    do {
      const response = await gmail.users.messages.list({
        userId: 'me',
        q: query,
        maxResults: 500,
        pageToken
      });

      const messages = response.data.messages || [];
      messageIds.push(...messages.map(m => m.id!));
      
      pageToken = response.data.nextPageToken || undefined;
    } while (pageToken);

    return messageIds;
  }
}
