import { ToolBuilder, ParameterTypes } from '../base/ToolBuilder.js';
import { ToolPlugin } from '../definitions.new.js';

// Example 1: Simple custom tool
export const customEmailTools = [
  ToolBuilder.fromConfig({
    name: 'email_templates',
    description: 'Manage email templates for common responses',
    category: 'templates',
    parameters: {
      action: ParameterTypes.string('Action to perform', ['list', 'create', 'delete', 'apply']),
      template_name: ParameterTypes.string('Template name'),
      content: ParameterTypes.string('Template content'),
      email_id: ParameterTypes.string('Email ID to apply template to')
    },
    required: ['action']
  }),

  ToolBuilder.fromConfig({
    name: 'smart_unsubscribe',
    description: 'Intelligently unsubscribe from mailing lists',
    category: 'automation',
    parameters: {
      scan_days: ParameterTypes.number('Number of days to scan for newsletters', 1, 365, 30),
      auto_unsubscribe: ParameterTypes.boolean('Automatically unsubscribe from detected lists', false),
      whitelist: ParameterTypes.array({ type: 'string' }, 'Domains to never unsubscribe from')
    }
  })
];

// Example 2: Creating a plugin
export const emailAutomationPlugin: ToolPlugin = {
  name: 'email-automation',
  version: '1.0.0',
  category: 'automation',
  
  tools: [
    ToolBuilder.fromConfig({
      name: 'auto_reply',
      description: 'Set up automatic email replies',
      parameters: {
        enabled: ParameterTypes.boolean('Enable auto-reply'),
        message: ParameterTypes.string('Auto-reply message'),
        start_date: ParameterTypes.string('Start date (ISO format)'),
        end_date: ParameterTypes.string('End date (ISO format)'),
        exclude_contacts: ParameterTypes.array({ type: 'string' }, 'Email addresses to exclude')
      }
    }),

    ToolBuilder.fromConfig({
      name: 'email_scheduler',
      description: 'Schedule emails to be sent later',
      parameters: {
        recipient: ParameterTypes.string('Recipient email address'),
        subject: ParameterTypes.string('Email subject'),
        body: ParameterTypes.string('Email body'),
        send_at: ParameterTypes.string('Scheduled send time (ISO format)'),
        attachments: ParameterTypes.array({ type: 'string' }, 'File paths for attachments')
      },
      required: ['recipient', 'subject', 'body', 'send_at']
    })
  ],

  async initialize() {
    console.log('Email automation plugin initialized');
    // Setup any required resources
  },

  async cleanup() {
    console.log('Email automation plugin cleaned up');
    // Cleanup resources
  }
};

// Example 3: Dynamic tool creation based on configuration
export function createCustomFilterTool(config: {
  name: string;
  description: string;
  filters: Array<{ field: string; operator: string; value: any }>
}) {
  const parameters: Record<string, any> = {};
  
  config.filters.forEach((filter, index) => {
    parameters[`filter_${index}_enabled`] = ParameterTypes.boolean(
      `Enable filter: ${filter.field} ${filter.operator} ${filter.value}`
    );
  });

  return ToolBuilder.fromConfig({
    name: config.name,
    description: config.description,
    category: 'custom_filters',
    parameters
  });
}

// Example 4: Tool factory for creating similar tools
export class EmailActionToolFactory {
  static createBulkActionTool(action: string, description: string) {
    return ToolBuilder.fromConfig({
      name: `bulk_${action}`,
      description: `Bulk ${description}`,
      category: 'bulk_operations',
      parameters: {
        email_ids: ParameterTypes.array({ type: 'string' }, 'List of email IDs'),
        search_criteria: ParameterTypes.object({}, 'Search criteria to find emails'),
        batch_size: ParameterTypes.number('Number of emails to process at once', 1, 100, 50),
        confirm: ParameterTypes.boolean('Confirm the operation', false)
      }
    });
  }

  static createLabelTool(operation: 'add' | 'remove') {
    const parameters: Record<string, any> = {
      email_ids: ParameterTypes.array({ type: 'string' }, 'Email IDs to modify'),
      labels: ParameterTypes.array({ type: 'string' }, `Labels to ${operation}`)
    };

    if (operation === 'add') {
      parameters.create_if_missing = ParameterTypes.boolean('Create labels if they don\'t exist', true);
    }

    return ToolBuilder.fromConfig({
      name: `${operation}_labels`,
      description: `${operation === 'add' ? 'Add' : 'Remove'} labels from emails`,
      category: 'labeling',
      parameters,
      required: ['email_ids', 'labels']
    });
  }
}

// Example usage:
// const markAsReadTool = EmailActionToolFactory.createBulkActionTool('mark_read', 'mark emails as read');
// const addLabelsTool = EmailActionToolFactory.createLabelTool('add');