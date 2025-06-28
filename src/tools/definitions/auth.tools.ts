import { ToolBuilder, ParameterTypes, ToolConfig } from '../base/ToolBuilder.js';

export const authToolConfigs: ToolConfig[] = [
  {
    name: 'authenticate',
    description: 'Initiates OAuth2 flow for Gmail authentication',
    category: 'authentication',
    parameters: {
      scopes: ParameterTypes.array(
        { type: 'string' },
        'Additional OAuth scopes (default includes Gmail read/write)'
      )
    }
  },
  {
    name: 'poll_user_context',
    description: 'Polls for the user context (user_id, session_id) after OAuth completion using the provided state.',
    category: 'authentication',
    parameters: {
      state: ParameterTypes.string('State parameter returned from authenticate tool'),
    }
  }
];

export const authTools = authToolConfigs.map(config => ToolBuilder.fromConfig(config));