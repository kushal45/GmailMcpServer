import { ToolBuilder, ParameterTypes, ToolConfig } from '../base/ToolBuilder.js';

export const searchToolConfigs: ToolConfig[] = [
  {
    name: 'search_emails',
    description: 'Advanced email search with multiple filter options',
    category: 'search',
    parameters: {
      query: ParameterTypes.string('Search query string'),
      category: ParameterTypes.category(),
      year_range: ParameterTypes.yearRange(),
      size_range: ParameterTypes.sizeRange(),
      sender: ParameterTypes.string('Filter by sender email address'),
      has_attachments: ParameterTypes.boolean('Filter emails with attachments'),
      archived: ParameterTypes.boolean('Include archived emails'),
      limit: ParameterTypes.number('Maximum number of results', 1, 500, 50),
      user_context: ParameterTypes.userContext()
    },
    required: ['user_context']
  },
  
  {
    name: 'save_search',
    description: 'Saves a search query for reuse',
    category: 'search',
    parameters: {
      name: ParameterTypes.string('Name for the saved search'),
      criteria: ParameterTypes.object({}, 'Search criteria to save'),
      user_context: ParameterTypes.userContext()
    },
    required: ['name', 'criteria', 'user_context']
  },
  
  {
    name: 'list_saved_searches',
    description: 'Lists all saved searches',
    category: 'search',
    parameters: {
      user_context: ParameterTypes.userContext()
    },
    required: ['user_context']
  }
];

export const searchTools = searchToolConfigs.map(config => ToolBuilder.fromConfig(config));