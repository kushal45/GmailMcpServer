import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { 
  getToolDefinitions, 
  registerCustomTool, 
  installPlugin,
  exportToolsAsJSON,
  exportToolsAsMarkdown
} from './definitions.new.js';

// Export the tool definitions for backward compatibility
export const toolDefinitions: Tool[] = getToolDefinitions();

// Re-export useful functions for extensibility
export { 
  registerCustomTool, 
  installPlugin,
  exportToolsAsJSON,
  exportToolsAsMarkdown
};

// Re-export the registry for advanced usage
export { toolRegistry } from './ToolRegistry.js';

// Re-export the builder for creating custom tools
export { ToolBuilder, ParameterTypes } from './base/ToolBuilder.js';

// Re-export configuration
export { toolsConfig } from './config/tools.config.js';