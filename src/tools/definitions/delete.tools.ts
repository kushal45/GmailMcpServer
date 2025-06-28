import { max } from 'lodash';
import { ToolBuilder, ParameterTypes, ToolConfig } from '../base/ToolBuilder.js';

export const deleteToolConfigs: ToolConfig[] = [
  {
    name: 'delete_emails',
    description: 'Deletes emails based on criteria with safety checks (Move the emails to trash first)',
    category: 'delete',
    parameters: {
      search_criteria: ParameterTypes.object({}, 'Search criteria for emails to delete'),
      category: ParameterTypes.category(),
      year: ParameterTypes.number('Delete emails from specific year'),
      size_threshold: ParameterTypes.number('Delete emails larger than bytes'),
      skip_archived: ParameterTypes.boolean('Skip archived emails', true),
      dry_run: ParameterTypes.boolean('Preview what would be deleted', false),
      max_count: ParameterTypes.number('Maximum number of emails to delete', 10),
      user_context: ParameterTypes.userContext()
    },
    required: ['user_context']
  },
  {
    name: 'empty_trash',
    description: 'Empties the trash folder when dryrun is false',
    category: 'delete',
    parameters: {
      dry_run: ParameterTypes.boolean('Preview what would be deleted', false),
      max_count: ParameterTypes.number('Maximum number of emails to delete', 10),
      user_context: ParameterTypes.userContext()
    },
    required: ['user_context']
  },
  {
    name: 'trigger_cleanup',
    description: 'Trigger manual cleanup using a specific policy',
    category: 'cleanup',
    parameters: {
      policy_id: ParameterTypes.string('ID of the cleanup policy to execute'),
      dry_run: ParameterTypes.boolean('Preview what would be cleaned up', false),
      max_emails: ParameterTypes.number('Maximum number of emails to process'),
      force: ParameterTypes.boolean('Force execution even if policy is disabled', false),
      user_context: ParameterTypes.userContext()
    },
    required: ['user_context']
  },
  {
    name: 'get_cleanup_status',
    description: 'Get current status of the cleanup automation system',
    category: 'cleanup',
    parameters: {
      user_context: ParameterTypes.userContext()
    },
    required: ['user_context']
  },
  {
    name: 'get_system_health',
    description: 'Get current system health metrics and status',
    category: 'cleanup',
    parameters: {
      user_context: ParameterTypes.userContext()
    },
    required: ['user_context']
  },
  {
    name: 'create_cleanup_policy',
    description: 'Create a new email cleanup policy',
    category: 'cleanup',
    parameters: {
      name: ParameterTypes.string('Name for the cleanup policy'),
      enabled: ParameterTypes.boolean('Whether the policy is enabled', true),
      priority: ParameterTypes.number('Policy priority (0-100)', 50),
      criteria: ParameterTypes.object({}, 'Cleanup criteria configuration'),
      action: ParameterTypes.object({}, 'Action to take (delete or archive)'),
      safety: ParameterTypes.object({}, 'Safety configuration'),
      schedule: ParameterTypes.object({}, 'Optional schedule configuration'),
      user_context: ParameterTypes.userContext()
    },
    required: ['user_context']
  },
  {
    name: 'update_cleanup_policy',
    description: 'Update an existing cleanup policy',
    category: 'cleanup',
    parameters: {
      policy_id: ParameterTypes.string('ID of the policy to update'),
      updates: ParameterTypes.object({}, 'Policy updates to apply'),
      user_context: ParameterTypes.userContext()
    },
    required: ['policy_id', 'updates', 'user_context']
  },
  {
    name: 'list_cleanup_policies',
    description: 'List all cleanup policies',
    category: 'cleanup',
    parameters: {
      active_only: ParameterTypes.boolean('Only return active policies', false),
      user_context: ParameterTypes.userContext()
    },
    required: ['user_context']
  },
  {
    name: 'delete_cleanup_policy',
    description: 'Delete a cleanup policy',
    category: 'cleanup',
    parameters: {
      policy_id: ParameterTypes.string('ID of the policy to delete'),
      user_context: ParameterTypes.userContext()
    },
    required: ['policy_id', 'user_context']
  },
  {
    name: 'create_cleanup_schedule',
    description: 'Create a new cleanup schedule',
    category: 'cleanup',
    parameters: {
      name: ParameterTypes.string('Name for the schedule'),
      type: ParameterTypes.string('Schedule type (daily, weekly, monthly, interval, cron)'),
      expression: ParameterTypes.string('Schedule expression (time, interval, or cron)'),
      policy_id: ParameterTypes.string('ID of the policy to schedule'),
      enabled: ParameterTypes.boolean('Whether the schedule is enabled', true),
      user_context: ParameterTypes.userContext()
    },
    required: ['name', 'type', 'expression', 'policy_id', 'user_context']
  },
  {
    name: 'update_cleanup_automation_config',
    description: 'Update cleanup automation configuration',
    category: 'cleanup',
    parameters: {
      config: ParameterTypes.object({}, 'Automation configuration updates'),
      user_context: ParameterTypes.userContext()
    },
    required: ['config', 'user_context']
  },
  {
    name: 'get_cleanup_metrics',
    description: 'Get cleanup system metrics and analytics',
    category: 'cleanup',
    parameters: {
      hours: ParameterTypes.number('Number of hours of history to include', 24),
      user_context: ParameterTypes.userContext()
    },
    required: ['user_context']
  },
  {
    name: 'get_cleanup_recommendations',
    description: 'Get recommended cleanup policies based on email analysis',
    category: 'cleanup',
    parameters: {
      user_context: ParameterTypes.userContext()
    },
    required: ['user_context']
  }
];

export const deleteTools = deleteToolConfigs.map(config => ToolBuilder.fromConfig(config));