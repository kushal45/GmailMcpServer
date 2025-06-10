import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { EmailFetcher } from '../../email/EmailFetcher.js';
import { DatabaseManager } from '../../database/DatabaseManager.js';
import { AuthManager } from '../../auth/AuthManager.js';
import { CacheManager } from '../../cache/CacheManager.js';
import { PriorityCategory } from '../../types/index.js';
import { logger } from '../../utils/logger.js';
import { toolRegistry } from '../ToolRegistry.js';

export function registerEmailTools() {
  // Initialize required services
  const dbManager = new DatabaseManager();
  const authManager = new AuthManager();
  const cacheManager = new CacheManager();
  
  // Initialize services
  let initialized = false;
  let emailFetcher: EmailFetcher;
  
  // Lazy initialization function
  const getEmailFetcher = async () => {
    if (!initialized) {
      await dbManager.initialize();
      emailFetcher = new EmailFetcher(dbManager, authManager, cacheManager);
      initialized = true;
    }
    return emailFetcher;
  };
  
  // Register list_emails tool
  const listEmailsTool: Tool = {
    name: 'list_emails',
    description: 'List emails with filtering options',
    inputSchema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          enum: [PriorityCategory.HIGH, PriorityCategory.MEDIUM, PriorityCategory.LOW],
          description: 'Filter by email priority category'
        },
        year: {
          type: 'number',
          description: 'Filter by year'
        },
        size_min: {
          type: 'number',
          description: 'Minimum size in bytes'
        },
        size_max: {
          type: 'number',
          description: 'Maximum size in bytes'
        },
        archived: {
          type: 'boolean',
          description: 'Include archived emails'
        },
        has_attachments: {
          type: 'boolean',
          description: 'Filter emails with attachments'
        },
        labels: {
          type: 'array',
          items: {
            type: 'string'
          },
          description: 'Filter by Gmail labels'
        },
        query: {
          type: 'string',
          description: 'Custom Gmail query string'
        },
        limit: {
          type: 'number',
          description: 'Maximum number of emails to return',
          default: 50
        },
        offset: {
          type: 'number',
          description: 'Number of emails to skip',
          default: 0
        }
      }
    }
  };
  
  // Register get_email_details tool
  const getEmailDetailsTool: Tool = {
    name: 'get_email_details',
    description: 'Get detailed information about a specific email',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Email ID to retrieve'
        }
      },
      required: ['id']
    }
  };
  
  // Register tools with the registry
  toolRegistry.registerTool(listEmailsTool, 'email_management');
  toolRegistry.registerTool(getEmailDetailsTool, 'email_management');
  
  logger.info('Email tools registered');
}