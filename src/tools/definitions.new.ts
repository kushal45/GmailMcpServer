import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { toolRegistry } from './ToolRegistry.js';
import { authTools } from './definitions/auth.tools.js';
import { emailTools } from './definitions/email.tools.js';
import { searchTools } from './definitions/search.tools.js';
import { archiveTools } from './definitions/archive.tools.js';
import { deleteTools } from './definitions/delete.tools.js';
import { logger } from '../utils/logger.js';

// Register all built-in tools
export function registerBuiltInTools(): void {
  logger.info('Registering built-in tools');

  // Register tools by category
  authTools.forEach(tool => toolRegistry.registerTool(tool, 'authentication'));
  emailTools.forEach(tool => toolRegistry.registerTool(tool, 'email_management'));
  searchTools.forEach(tool => toolRegistry.registerTool(tool, 'search'));
  archiveTools.forEach(tool => toolRegistry.registerTool(tool, 'archive'));
  deleteTools.forEach(tool => toolRegistry.registerTool(tool, 'delete'));

  const stats = toolRegistry.getStats();
  logger.info('Built-in tools registered', stats);
}

// Load custom tools from a directory
export async function loadCustomTools(toolsDir?: string): Promise<void> {
  if (!toolsDir) return;

  try {
    const fs = await import('fs/promises');
    const path = await import('path');
    
    const files = await fs.readdir(toolsDir);
    const toolFiles = files.filter(f => f.endsWith('.tools.js') || f.endsWith('.tools.ts'));

    for (const file of toolFiles) {
      const modulePath = path.join(toolsDir, file);
      await toolRegistry.registerFromPath(modulePath);
    }

    logger.info(`Loaded ${toolFiles.length} custom tool modules`);
  } catch (error) {
    logger.error('Error loading custom tools:', error);
  }
}

// Get all tool definitions for MCP
export function getToolDefinitions(): Tool[] {
  // Ensure built-in tools are registered
  if (toolRegistry.getAllTools().length === 0) {
    registerBuiltInTools();
  }

  return toolRegistry.getAllTools();
}

// Export for backward compatibility
export const toolDefinitions = getToolDefinitions();

// Advanced features for extensibility

/**
 * Register a custom tool at runtime
 */
export function registerCustomTool(tool: Tool, category?: string): void {
  toolRegistry.registerTool(tool, category || 'custom');
  logger.info(`Registered custom tool: ${tool.name}`);
}

/**
 * Create a tool plugin system
 */
export interface ToolPlugin {
  name: string;
  version: string;
  tools: Tool[];
  category?: string;
  initialize?: () => Promise<void>;
  cleanup?: () => Promise<void>;
}

const plugins: Map<string, ToolPlugin> = new Map();

export async function installPlugin(plugin: ToolPlugin): Promise<void> {
  if (plugins.has(plugin.name)) {
    throw new Error(`Plugin ${plugin.name} is already installed`);
  }

  // Initialize plugin if needed
  if (plugin.initialize) {
    await plugin.initialize();
  }

  // Register plugin tools
  plugin.tools.forEach(tool => {
    toolRegistry.registerTool(tool, plugin.category || plugin.name);
  });

  plugins.set(plugin.name, plugin);
  logger.info(`Installed plugin: ${plugin.name} v${plugin.version}`);
}

export async function uninstallPlugin(pluginName: string): Promise<void> {
  const plugin = plugins.get(pluginName);
  if (!plugin) {
    throw new Error(`Plugin ${pluginName} is not installed`);
  }

  // Cleanup plugin if needed
  if (plugin.cleanup) {
    await plugin.cleanup();
  }

  // Unregister plugin tools
  plugin.tools.forEach(tool => {
    toolRegistry.unregisterTool(tool.name);
  });

  plugins.delete(pluginName);
  logger.info(`Uninstalled plugin: ${pluginName}`);
}

/**
 * Tool validation and testing
 */
export function validateTool(tool: Tool): string[] {
  const errors: string[] = [];

  if (!tool.name) {
    errors.push('Tool must have a name');
  }

  if (!tool.description) {
    errors.push('Tool must have a description');
  }

  if (!tool.inputSchema || typeof tool.inputSchema !== 'object') {
    errors.push('Tool must have a valid input schema');
  }

  return errors;
}

/**
 * Export tool definitions to different formats
 */
export function exportToolsAsJSON(): string {
  const tools = toolRegistry.getAllTools();
  const categories = toolRegistry.getCategories();

  return JSON.stringify({
    version: '1.0',
    totalTools: tools.length,
    categories: categories,
    tools: tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      category: categories.find(cat => 
        toolRegistry.getToolsByCategory(cat).some(t => t.name === tool.name)
      ),
      schema: tool.inputSchema
    }))
  }, null, 2);
}

export function exportToolsAsMarkdown(): string {
  const tools = toolRegistry.getAllTools();
  const categories = toolRegistry.getCategories();

  let markdown = '# Available Tools\n\n';

  for (const category of categories) {
    markdown += `## ${category}\n\n`;
    const categoryTools = toolRegistry.getToolsByCategory(category);

    for (const tool of categoryTools) {
      markdown += `### ${tool.name}\n\n`;
      markdown += `${tool.description}\n\n`;
      
      if (tool.inputSchema.properties && Object.keys(tool.inputSchema.properties).length > 0) {
        markdown += '**Parameters:**\n';
        for (const [param, schema] of Object.entries(tool.inputSchema.properties)) {
          markdown += `- \`${param}\`: ${(schema as any).description || 'No description'}\n`;
        }
        markdown += '\n';
      }
    }
  }

  return markdown;
}

// Don't initialize on import - let getToolDefinitions handle it
// registerBuiltInTools();