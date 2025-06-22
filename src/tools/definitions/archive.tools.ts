import { ToolBuilder, ParameterTypes, ToolConfig } from '../base/ToolBuilder.js';

// Shared parameter definitions for archive tools
const archiveMethodParam = ParameterTypes.string(
  'Archive method',
  ['gmail', 'export'],
  'gmail'
);

const exportFormatParam = ParameterTypes.string(
  'Export format when method is export',
  ['mbox', 'json']
);

export const archiveToolConfigs: ToolConfig[] = [
  {
    name: 'archive_emails',
    description: 'Archives emails based on specified criteria',
    category: 'archive',
    parameters: {
      search_criteria: ParameterTypes.object({}, 'Search criteria for emails to archive'),
      category: ParameterTypes.category(),
      year: ParameterTypes.number('Archive emails from specific year'),
      older_than_days: ParameterTypes.number('Archive emails older than specified days'),
      method: archiveMethodParam,
      export_format: exportFormatParam,
      export_path: ParameterTypes.string('Custom export path'),
      dry_run: ParameterTypes.boolean('Preview what would be archived without actually archiving', false),
      user_context: ParameterTypes.userContext()
    },
    required: ['method', 'user_context']
  },
  
  {
    name: 'restore_emails',
    description: 'Restores previously archived emails',
    category: 'archive',
    parameters: {
      archive_id: ParameterTypes.string('Archive record ID to restore from'),
      email_ids: ParameterTypes.array({ type: 'string' }, 'Specific email IDs to restore'),
      restore_labels: ParameterTypes.array({ type: 'string' }, 'Labels to apply to restored emails'),
      user_context: ParameterTypes.userContext()
    },
    required: ['user_context']
  },
  
  {
    name: 'create_archive_rule',
    description: 'Creates automatic archive rules',
    category: 'archive',
    parameters: {
      name: ParameterTypes.string('Rule name'),
      criteria: ParameterTypes.object({
        category: ParameterTypes.category(),
        older_than_days: ParameterTypes.number('Archive emails older than days'),
        size_greater_than: ParameterTypes.number('Archive emails larger than bytes'),
        labels: ParameterTypes.array({ type: 'string' }, 'Gmail labels to match')
      }, 'Archive criteria'),
      action: ParameterTypes.object({
        method: archiveMethodParam,
        export_format: exportFormatParam
      }, 'Archive action'),
      schedule: ParameterTypes.string('How often to run the rule', ['daily', 'weekly', 'monthly']),
      user_context: ParameterTypes.userContext()
    },
    required: ['name', 'criteria', 'action', 'user_context']
  },
  
  {
    name: 'list_archive_rules',
    description: 'Lists all configured archive rules',
    category: 'archive',
    parameters: {
      active_only: ParameterTypes.boolean('Show only active rules', false),
      user_context: ParameterTypes.userContext()
    },
    required: ['user_context']
  },
  
  {
    name: 'export_emails',
    description: 'Exports emails to external formats',
    category: 'archive',
    parameters: {
      search_criteria: ParameterTypes.object({}, 'Search criteria for emails to export'),
      format: ParameterTypes.string('Export format', ['mbox', 'json', 'csv']),
      include_attachments: ParameterTypes.boolean('Include attachments in export', false),
      output_path: ParameterTypes.string('Output file path'),
      cloud_upload: ParameterTypes.object({
        provider: ParameterTypes.string('Cloud storage provider', ['gdrive', 's3', 'dropbox']),
        path: ParameterTypes.string('Cloud storage path')
      }, 'Cloud upload configuration'),
      user_context: ParameterTypes.userContext()
    },
    required: ['format', 'user_context']
  }
];

export const archiveTools = archiveToolConfigs.map(config => ToolBuilder.fromConfig(config));