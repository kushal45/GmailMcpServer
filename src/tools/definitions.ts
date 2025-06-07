import { Tool } from '@modelcontextprotocol/sdk/types.js';

export const toolDefinitions: Tool[] = [
  {
    name: 'authenticate',
    description: 'Initiates OAuth2 flow for Gmail authentication',
    inputSchema: {
      type: 'object',
      properties: {
        scopes: {
          type: 'array',
          items: { type: 'string' },
          description: 'Additional OAuth scopes (default includes Gmail read/write)',
          default: []
        }
      }
    }
  },
  {
    name: 'list_emails',
    description: 'Lists emails with optional filters',
    inputSchema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          enum: ['high', 'medium', 'low'],
          description: 'Filter by importance category'
        },
        year: {
          type: 'number',
          description: 'Filter by year'
        },
        size_range: {
          type: 'object',
          properties: {
            min: { type: 'number', description: 'Minimum size in bytes' },
            max: { type: 'number', description: 'Maximum size in bytes' }
          },
          description: 'Filter by size range'
        },
        archived: {
          type: 'boolean',
          description: 'Include archived emails'
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
  },
  {
    name: 'search_emails',
    description: 'Advanced email search with multiple filter options',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query string'
        },
        category: {
          type: 'string',
          enum: ['high', 'medium', 'low'],
          description: 'Filter by importance category'
        },
        year_range: {
          type: 'object',
          properties: {
            start: { type: 'number', description: 'Start year' },
            end: { type: 'number', description: 'End year' }
          },
          description: 'Filter by year range'
        },
        size_range: {
          type: 'object',
          properties: {
            min: { type: 'number', description: 'Minimum size in bytes' },
            max: { type: 'number', description: 'Maximum size in bytes' }
          },
          description: 'Filter by size range'
        },
        sender: {
          type: 'string',
          description: 'Filter by sender email address'
        },
        has_attachments: {
          type: 'boolean',
          description: 'Filter emails with attachments'
        },
        archived: {
          type: 'boolean',
          description: 'Include archived emails'
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results',
          default: 50
        }
      }
    }
  },
  {
    name: 'categorize_emails',
    description: 'Analyzes and categorizes emails by importance',
    inputSchema: {
      type: 'object',
      properties: {
        force_refresh: {
          type: 'boolean',
          description: 'Force re-categorization of all emails',
          default: false
        },
        year: {
          type: 'number',
          description: 'Categorize emails only from specific year'
        }
      }
    }
  },
  {
    name: 'get_email_stats',
    description: 'Returns comprehensive email statistics',
    inputSchema: {
      type: 'object',
      properties: {
        group_by: {
          type: 'string',
          enum: ['category', 'year', 'size', 'archived', 'all'],
          description: 'How to group statistics',
          default: 'all'
        },
        include_archived: {
          type: 'boolean',
          description: 'Include archived emails in statistics',
          default: true
        }
      },
      required: ['group_by']
    }
  },
  {
    name: 'archive_emails',
    description: 'Archives emails based on specified criteria',
    inputSchema: {
      type: 'object',
      properties: {
        search_criteria: {
          type: 'object',
          description: 'Search criteria for emails to archive'
        },
        category: {
          type: 'string',
          enum: ['high', 'medium', 'low'],
          description: 'Archive by importance category'
        },
        year: {
          type: 'number',
          description: 'Archive emails from specific year'
        },
        older_than_days: {
          type: 'number',
          description: 'Archive emails older than specified days'
        },
        method: {
          type: 'string',
          enum: ['gmail', 'export'],
          description: 'Archive method',
          default: 'gmail'
        },
        export_format: {
          type: 'string',
          enum: ['mbox', 'json'],
          description: 'Export format when method is export'
        },
        export_path: {
          type: 'string',
          description: 'Custom export path'
        },
        dry_run: {
          type: 'boolean',
          description: 'Preview what would be archived without actually archiving',
          default: false
        }
      },
      required: ['method']
    }
  },
  {
    name: 'restore_emails',
    description: 'Restores previously archived emails',
    inputSchema: {
      type: 'object',
      properties: {
        archive_id: {
          type: 'string',
          description: 'Archive record ID to restore from'
        },
        email_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Specific email IDs to restore'
        },
        restore_labels: {
          type: 'array',
          items: { type: 'string' },
          description: 'Labels to apply to restored emails'
        }
      }
    }
  },
  {
    name: 'create_archive_rule',
    description: 'Creates automatic archive rules',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Rule name'
        },
        criteria: {
          type: 'object',
          properties: {
            category: {
              type: 'string',
              enum: ['high', 'medium', 'low'],
              description: 'Category to archive'
            },
            older_than_days: {
              type: 'number',
              description: 'Archive emails older than days'
            },
            size_greater_than: {
              type: 'number',
              description: 'Archive emails larger than bytes'
            },
            labels: {
              type: 'array',
              items: { type: 'string' },
              description: 'Gmail labels to match'
            }
          }
        },
        action: {
          type: 'object',
          properties: {
            method: {
              type: 'string',
              enum: ['gmail', 'export'],
              description: 'Archive method'
            },
            export_format: {
              type: 'string',
              enum: ['mbox', 'json'],
              description: 'Export format if method is export'
            }
          },
          required: ['method']
        },
        schedule: {
          type: 'string',
          enum: ['daily', 'weekly', 'monthly'],
          description: 'How often to run the rule'
        }
      },
      required: ['name', 'criteria', 'action']
    }
  },
  {
    name: 'list_archive_rules',
    description: 'Lists all configured archive rules',
    inputSchema: {
      type: 'object',
      properties: {
        active_only: {
          type: 'boolean',
          description: 'Show only active rules',
          default: false
        }
      }
    }
  },
  {
    name: 'export_emails',
    description: 'Exports emails to external formats',
    inputSchema: {
      type: 'object',
      properties: {
        search_criteria: {
          type: 'object',
          description: 'Search criteria for emails to export'
        },
        format: {
          type: 'string',
          enum: ['mbox', 'json', 'csv'],
          description: 'Export format'
        },
        include_attachments: {
          type: 'boolean',
          description: 'Include attachments in export',
          default: false
        },
        output_path: {
          type: 'string',
          description: 'Output file path'
        },
        cloud_upload: {
          type: 'object',
          properties: {
            provider: {
              type: 'string',
              enum: ['gdrive', 's3', 'dropbox'],
              description: 'Cloud storage provider'
            },
            path: {
              type: 'string',
              description: 'Cloud storage path'
            }
          }
        }
      },
      required: ['format']
    }
  },
  {
    name: 'delete_emails',
    description: 'Deletes emails based on criteria with safety checks',
    inputSchema: {
      type: 'object',
      properties: {
        search_criteria: {
          type: 'object',
          description: 'Search criteria for emails to delete'
        },
        category: {
          type: 'string',
          enum: ['high', 'medium', 'low'],
          description: 'Delete by importance category'
        },
        year: {
          type: 'number',
          description: 'Delete emails from specific year'
        },
        size_threshold: {
          type: 'number',
          description: 'Delete emails larger than bytes'
        },
        skip_archived: {
          type: 'boolean',
          description: 'Skip archived emails',
          default: true
        },
        dry_run: {
          type: 'boolean',
          description: 'Preview what would be deleted',
          default: false
        },
        confirm: {
          type: 'boolean',
          description: 'Confirm deletion (required for actual deletion)',
          default: false
        }
      }
    }
  },
  {
    name: 'save_search',
    description: 'Saves a search query for reuse',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name for the saved search'
        },
        criteria: {
          type: 'object',
          description: 'Search criteria to save'
        }
      },
      required: ['name', 'criteria']
    }
  },
  {
    name: 'list_saved_searches',
    description: 'Lists all saved searches',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  }
];