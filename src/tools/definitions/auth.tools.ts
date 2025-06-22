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
      ),
      // Note: user_context is not required for authenticate since it's used
      // before a user has logged in
      user_context: ParameterTypes.userContext()
    }
  }
];

export const authTools = authToolConfigs.map(config => ToolBuilder.fromConfig(config));