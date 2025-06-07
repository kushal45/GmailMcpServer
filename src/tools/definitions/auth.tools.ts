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
  }
];

export const authTools = authToolConfigs.map(config => ToolBuilder.fromConfig(config));