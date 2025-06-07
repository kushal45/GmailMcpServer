import { ToolBuilder, ParameterTypes, ToolConfig } from '../base/ToolBuilder.js';

export const deleteToolConfigs: ToolConfig[] = [
  {
    name: 'delete_emails',
    description: 'Deletes emails based on criteria with safety checks',
    category: 'delete',
    parameters: {
      search_criteria: ParameterTypes.object({}, 'Search criteria for emails to delete'),
      category: ParameterTypes.category(),
      year: ParameterTypes.number('Delete emails from specific year'),
      size_threshold: ParameterTypes.number('Delete emails larger than bytes'),
      skip_archived: ParameterTypes.boolean('Skip archived emails', true),
      dry_run: ParameterTypes.boolean('Preview what would be deleted', false),
      confirm: ParameterTypes.boolean('Confirm deletion (required for actual deletion)', false)
    }
  }
];

export const deleteTools = deleteToolConfigs.map(config => ToolBuilder.fromConfig(config));