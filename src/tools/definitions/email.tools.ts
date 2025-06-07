import { ToolBuilder, ParameterTypes, ToolConfig } from '../base/ToolBuilder.js';

export const emailToolConfigs: ToolConfig[] = [
  {
    name: 'list_emails',
    description: 'Lists emails with optional filters',
    category: 'email_management',
    parameters: {
      category: ParameterTypes.category(),
      year: ParameterTypes.number('Filter by year'),
      size_range: ParameterTypes.sizeRange(),
      archived: ParameterTypes.boolean('Include archived emails'),
      limit: ParameterTypes.number('Maximum number of emails to return', 1, 500, 50),
      offset: ParameterTypes.number('Number of emails to skip', 0, undefined, 0)
    }
  },
  
  {
    name: 'categorize_emails',
    description: 'Analyzes and categorizes emails by importance',
    category: 'email_management',
    parameters: {
      force_refresh: ParameterTypes.boolean('Force re-categorization of all emails', false),
      year: ParameterTypes.number('Categorize emails only from specific year')
    }
  },
  
  {
    name: 'get_email_stats',
    description: 'Returns comprehensive email statistics',
    category: 'email_management',
    parameters: {
      group_by: ParameterTypes.string(
        'How to group statistics',
        ['category', 'year', 'size', 'archived', 'all'],
        'all'
      ),
      include_archived: ParameterTypes.boolean('Include archived emails in statistics', true)
    },
    required: ['group_by']
  }
];

export const emailTools = emailToolConfigs.map(config => ToolBuilder.fromConfig(config));