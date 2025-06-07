export interface ToolsConfiguration {
  // Enable/disable tool categories
  enabledCategories: string[];
  
  // Tool-specific settings
  toolSettings: {
    [toolName: string]: {
      enabled: boolean;
      rateLimit?: {
        maxCalls: number;
        windowMs: number;
      };
      customParams?: Record<string, any>;
    };
  };
  
  // Plugin settings
  plugins: {
    enabled: boolean;
    autoLoad: boolean;
    directories: string[];
  };
  
  // Validation settings
  validation: {
    strict: boolean;
    allowUnknownParams: boolean;
  };
  
  // Export settings
  export: {
    formats: ('json' | 'markdown' | 'yaml')[];
    outputDir: string;
  };
}

// Default configuration
export const defaultToolsConfig: ToolsConfiguration = {
  enabledCategories: [
    'authentication',
    'email_management',
    'search',
    'archive',
    'delete'
  ],
  
  toolSettings: {
    // Example: Limit delete operations
    'delete_emails': {
      enabled: true,
      rateLimit: {
        maxCalls: 10,
        windowMs: 60000 // 1 minute
      }
    },
    
    // Example: Customize archive settings
    'archive_emails': {
      enabled: true,
      customParams: {
        defaultMethod: 'gmail',
        maxBatchSize: 100
      }
    }
  },
  
  plugins: {
    enabled: true,
    autoLoad: false,
    directories: ['./plugins', './custom-tools']
  },
  
  validation: {
    strict: true,
    allowUnknownParams: false
  },
  
  export: {
    formats: ['json', 'markdown'],
    outputDir: './docs/tools'
  }
};

// Configuration loader
export class ToolsConfigManager {
  private config: ToolsConfiguration;
  
  constructor(customConfig?: Partial<ToolsConfiguration>) {
    this.config = { ...defaultToolsConfig, ...customConfig };
  }
  
  getConfig(): ToolsConfiguration {
    return this.config;
  }
  
  isToolEnabled(toolName: string): boolean {
    const toolConfig = this.config.toolSettings[toolName];
    return toolConfig?.enabled !== false;
  }
  
  isCategoryEnabled(category: string): boolean {
    return this.config.enabledCategories.includes(category);
  }
  
  getToolRateLimit(toolName: string): { maxCalls: number; windowMs: number } | undefined {
    return this.config.toolSettings[toolName]?.rateLimit;
  }
  
  updateToolSetting(toolName: string, settings: Partial<ToolsConfiguration['toolSettings'][string]>): void {
    if (!this.config.toolSettings[toolName]) {
      this.config.toolSettings[toolName] = { enabled: true };
    }
    Object.assign(this.config.toolSettings[toolName], settings);
  }
  
  enableCategory(category: string): void {
    if (!this.config.enabledCategories.includes(category)) {
      this.config.enabledCategories.push(category);
    }
  }
  
  disableCategory(category: string): void {
    this.config.enabledCategories = this.config.enabledCategories.filter(c => c !== category);
  }
  
  async loadFromFile(configPath: string): Promise<void> {
    try {
      const fs = await import('fs/promises');
      const content = await fs.readFile(configPath, 'utf-8');
      const loadedConfig = JSON.parse(content) as Partial<ToolsConfiguration>;
      this.config = { ...this.config, ...loadedConfig };
    } catch (error) {
      console.error('Failed to load tools configuration:', error);
    }
  }
  
  async saveToFile(configPath: string): Promise<void> {
    try {
      const fs = await import('fs/promises');
      await fs.writeFile(configPath, JSON.stringify(this.config, null, 2));
    } catch (error) {
      console.error('Failed to save tools configuration:', error);
    }
  }
}

// Global instance
export const toolsConfig = new ToolsConfigManager();