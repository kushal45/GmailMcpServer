import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { logger } from '../utils/logger.js';
import { ToolConfig } from './base/ToolBuilder.js';

export interface ToolModule {
  tools: Tool[];
  configs?: ToolConfig[];
  category?: string;
}

export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();
  private categories: Map<string, Tool[]> = new Map();
  private metadata: Map<string, any> = new Map();

  constructor() {
    logger.info('Initializing Tool Registry');
  }

  /**
   * Register a single tool
   */
  registerTool(tool: Tool, category?: string, metadata?: any): void {
    if (this.tools.has(tool.name)) {
      logger.warn(`Tool ${tool.name} is already registered. Overwriting.`);
    }

    this.tools.set(tool.name, tool);
    
    if (category) {
      const categoryTools = this.categories.get(category) || [];
      categoryTools.push(tool);
      this.categories.set(category, categoryTools);
    }

    if (metadata) {
      this.metadata.set(tool.name, metadata);
    }

    logger.debug(`Registered tool: ${tool.name}`, { category });
  }

  /**
   * Register multiple tools from a module
   */
  registerModule(module: ToolModule): void {
    for (const tool of module.tools) {
      this.registerTool(tool, module.category);
    }
  }

  /**
   * Register tools from a dynamic import
   */
  async registerFromPath(modulePath: string): Promise<void> {
    try {
      const module = await import(modulePath);
      
      // Check for default export
      if (module.default && Array.isArray(module.default)) {
        module.default.forEach((tool: Tool) => this.registerTool(tool));
      }
      
      // Check for named exports
      Object.entries(module).forEach(([key, value]) => {
        if (key.endsWith('Tools') && Array.isArray(value)) {
          const category = key.replace('Tools', '');
          (value as Tool[]).forEach(tool => this.registerTool(tool, category));
        }
      });
      
      logger.info(`Loaded tools from ${modulePath}`);
    } catch (error) {
      logger.error(`Failed to load tools from ${modulePath}:`, error);
      throw error;
    }
  }

  /**
   * Get all registered tools
   */
  getAllTools(): Tool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Get a specific tool by name
   */
  getTool(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /**
   * Get tools by category
   */
  getToolsByCategory(category: string): Tool[] {
    return this.categories.get(category) || [];
  }

  /**
   * Get all categories
   */
  getCategories(): string[] {
    return Array.from(this.categories.keys());
  }

  /**
   * Check if a tool exists
   */
  hasTool(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Get tool metadata
   */
  getMetadata(toolName: string): any {
    return this.metadata.get(toolName);
  }

  /**
   * Remove a tool
   */
  unregisterTool(name: string): boolean {
    const tool = this.tools.get(name);
    if (!tool) return false;

    this.tools.delete(name);
    this.metadata.delete(name);

    // Remove from categories
    this.categories.forEach((tools, category) => {
      const filtered = tools.filter(t => t.name !== name);
      if (filtered.length !== tools.length) {
        this.categories.set(category, filtered);
      }
    });

    logger.debug(`Unregistered tool: ${name}`);
    return true;
  }

  /**
   * Get registry statistics
   */
  getStats(): {
    totalTools: number;
    categories: Record<string, number>;
    tools: string[];
  } {
    const stats: Record<string, number> = {};
    this.categories.forEach((tools, category) => {
      stats[category] = tools.length;
    });

    return {
      totalTools: this.tools.size,
      categories: stats,
      tools: Array.from(this.tools.keys())
    };
  }

  /**
   * Clear all tools
   */
  clear(): void {
    this.tools.clear();
    this.categories.clear();
    this.metadata.clear();
    logger.info('Tool registry cleared');
  }
}

// Singleton instance
export const toolRegistry = new ToolRegistry();