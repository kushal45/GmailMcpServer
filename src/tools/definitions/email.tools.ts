import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { PriorityCategory } from '../../types/index.js';
import { logger } from '../../utils/logger.js';
import { toolRegistry } from '../ToolRegistry.js';

export function registerEmailTools() {
  
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
        },
        user_context: {
          type: 'object',
          description: 'User context for access control',
          properties: {
            user_id: {
              type: 'string',
              description: 'ID of the user making the request'
            },
            session_id: {
              type: 'string',
              description: 'Session ID of the user making the request'
            }
          },
          required: ['user_id', 'session_id']
        }
      },
      required: ['user_context']
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
        },
        user_context: {
          type: 'object',
          description: 'User context for access control',
          properties: {
            user_id: {
              type: 'string',
              description: 'ID of the user making the request'
            },
            session_id: {
              type: 'string',
              description: 'Session ID of the user making the request'
            }
          },
          required: ['user_id', 'session_id']
        }
      },
      required: ['id', 'user_context']
    }
  };

  // categorize email tool
  const categorizeEmailTool: Tool = {
    name: 'categorize_emails',
    description: 'Categorize an email into high, medium, or low priority',
    inputSchema: {
      type: 'object',
      properties: {
        year:{
          type: 'number',
          description: 'Year of the email'
        },
        force_refresh:{
          type: 'boolean',
          description: 'Force refresh of email data'
        },
        user_context: {
          type: 'object',
          description: 'User context for access control',
          properties: {
            user_id: {
              type: 'string',
              description: 'ID of the user making the request'
            },
            session_id: {
              type: 'string',
              description: 'Session ID of the user making the request'
            }
          },
          required: ['user_id', 'session_id']
        }
      },
      required: ["year", "user_context"]
    }
  };

  
  // Register tools with the registry
  toolRegistry.registerTool(categorizeEmailTool, 'email_management');
  toolRegistry.registerTool(listEmailsTool, 'email_management');
  toolRegistry.registerTool(getEmailDetailsTool, 'email_management');
  
  logger.info('Email tools registered');
}