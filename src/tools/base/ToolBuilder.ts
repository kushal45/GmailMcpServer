import { Tool } from '@modelcontextprotocol/sdk/types.js';

export interface ToolParameter {
  type: string;
  description?: string;
  enum?: string[];
  default?: any;
  items?: any;
  properties?: Record<string, any>;
  required?: string[];
  minimum?: number;
  maximum?: number;
}

export interface ToolConfig {
  name: string;
  description: string;
  category?: string;
  version?: string;
  deprecated?: boolean;
  parameters?: Record<string, ToolParameter>;
  required?: string[];
  examples?: any[];
}

export class ToolBuilder {
  private tool: Tool;

  constructor(config: ToolConfig) {
    this.tool = {
      name: config.name,
      description: config.description,
      inputSchema: this.buildInputSchema(config)
    };
  }

  private buildInputSchema(config: ToolConfig): any {
    const schema: any = {
      type: 'object',
      properties: {}
    };

    if (config.parameters) {
      for (const [key, param] of Object.entries(config.parameters)) {
        schema.properties[key] = this.buildParameterSchema(param);
      }
    }

    if (config.required && config.required.length > 0) {
      schema.required = config.required;
    }

    return schema;
  }

  private buildParameterSchema(param: ToolParameter): any {
    const schema: any = {
      type: param.type
    };

    if (param.description) schema.description = param.description;
    if (param.enum) schema.enum = param.enum;
    if (param.default !== undefined) schema.default = param.default;
    if (param.items) schema.items = param.items;
    if (param.properties) schema.properties = param.properties;
    if (param.minimum !== undefined) schema.minimum = param.minimum;
    if (param.maximum !== undefined) schema.maximum = param.maximum;

    return schema;
  }

  build(): Tool {
    return this.tool;
  }

  static fromConfig(config: ToolConfig): Tool {
    return new ToolBuilder(config).build();
  }
}

// Helper function for creating common parameter types
export const ParameterTypes = {
  string: (description?: string, enumValues?: string[], defaultValue?: string): ToolParameter => ({
    type: 'string',
    description,
    enum: enumValues,
    default: defaultValue
  }),

  number: (description?: string, min?: number, max?: number, defaultValue?: number): ToolParameter => ({
    type: 'number',
    description,
    minimum: min,
    maximum: max,
    default: defaultValue
  }),

  boolean: (description?: string, defaultValue?: boolean): ToolParameter => ({
    type: 'boolean',
    description,
    default: defaultValue
  }),

  array: (itemType: any, description?: string): ToolParameter => ({
    type: 'array',
    items: itemType,
    description
  }),

  object: (properties: Record<string, any>, description?: string): ToolParameter => ({
    type: 'object',
    properties,
    description
  }),

  category: (): ToolParameter => ({
    type: 'string',
    enum: ['high', 'medium', 'low'],
    description: 'Email importance category'
  }),

  yearRange: (): ToolParameter => ({
    type: 'object',
    properties: {
      start: { type: 'number', description: 'Start year' },
      end: { type: 'number', description: 'End year' }
    },
    description: 'Filter by year range'
  }),

  sizeRange: (): ToolParameter => ({
    type: 'object',
    properties: {
      min: { type: 'number', description: 'Minimum size in bytes' },
      max: { type: 'number', description: 'Maximum size in bytes' }
    },
    description: 'Filter by size range'
  })
};