# Gmail MCP Server - Modular Tools System

## Overview

The Gmail MCP Server now features a highly modular and extensible tool system that allows for easy addition of new tools, dynamic tool loading, and plugin support.

## Architecture

### Core Components

1. **ToolBuilder** (`src/tools/base/ToolBuilder.ts`)
   - Provides a fluent API for creating tool definitions
   - Includes helper functions for common parameter types
   - Validates tool configurations

2. **ToolRegistry** (`src/tools/ToolRegistry.ts`)
   - Central registry for all tools
   - Supports categorization and metadata
   - Dynamic tool loading and unloading

3. **Tool Definitions** (modular files in `src/tools/definitions/`)
   - Separated by functionality (auth, email, search, archive, delete)
   - Each module exports tool configurations
   - Easy to add new categories

4. **Configuration System** (`src/tools/config/tools.config.ts`)
   - Enable/disable tools and categories
   - Rate limiting configuration
   - Plugin management settings

## Creating Custom Tools

### Method 1: Using ToolBuilder

```typescript
import { ToolBuilder, ParameterTypes } from '@gmail-mcp/tools';

const myCustomTool = ToolBuilder.fromConfig({
  name: 'my_custom_tool',
  description: 'Does something amazing',
  category: 'custom',
  parameters: {
    input: ParameterTypes.string('Input text'),
    count: ParameterTypes.number('Number of items', 1, 100, 10),
    enabled: ParameterTypes.boolean('Enable feature', true)
  },
  required: ['input']
});

// Register the tool
registerCustomTool(myCustomTool);
```

### Method 2: Creating a Tool Module

Create a new file `src/tools/definitions/custom.tools.ts`:

```typescript
import { ToolBuilder, ParameterTypes, ToolConfig } from '../base/ToolBuilder.js';

export const customToolConfigs: ToolConfig[] = [
  {
    name: 'custom_analysis',
    description: 'Perform custom email analysis',
    category: 'analysis',
    parameters: {
      metric: ParameterTypes.string('Analysis metric', ['sentiment', 'urgency', 'topic']),
      depth: ParameterTypes.string('Analysis depth', ['basic', 'detailed'], 'basic')
    }
  }
];

export const customTools = customToolConfigs.map(config => ToolBuilder.fromConfig(config));
```

### Method 3: Creating a Plugin

```typescript
import { ToolPlugin } from '@gmail-mcp/tools';

const myPlugin: ToolPlugin = {
  name: 'email-insights',
  version: '1.0.0',
  category: 'insights',
  
  tools: [
    // Tool definitions
  ],
  
  async initialize() {
    // Setup code
  },
  
  async cleanup() {
    // Cleanup code
  }
};

// Install the plugin
await installPlugin(myPlugin);
```

## Common Parameter Types

The `ParameterTypes` helper provides shortcuts for common parameter patterns:

```typescript
// Basic types
ParameterTypes.string(description, enumValues?, defaultValue?)
ParameterTypes.number(description, min?, max?, defaultValue?)
ParameterTypes.boolean(description, defaultValue?)
ParameterTypes.array(itemType, description)
ParameterTypes.object(properties, description)

// Gmail-specific types
ParameterTypes.category()      // Email category (high/medium/low)
ParameterTypes.yearRange()     // Year range filter
ParameterTypes.sizeRange()     // Size range filter
```

## Configuration

### Enable/Disable Tools

```typescript
import { toolsConfig } from '@gmail-mcp/tools';

// Disable a specific tool
toolsConfig.updateToolSetting('delete_emails', { enabled: false });

// Disable an entire category
toolsConfig.disableCategory('delete');

// Set rate limits
toolsConfig.updateToolSetting('archive_emails', {
  rateLimit: {
    maxCalls: 5,
    windowMs: 60000 // 1 minute
  }
});
```

### Load Configuration from File

```json
// tools.config.json
{
  "enabledCategories": ["authentication", "email_management", "search"],
  "toolSettings": {
    "delete_emails": {
      "enabled": false
    }
  },
  "plugins": {
    "enabled": true,
    "directories": ["./my-plugins"]
  }
}
```

```typescript
await toolsConfig.loadFromFile('./tools.config.json');
```

## Dynamic Tool Loading

### Load Tools from Directory

```typescript
import { loadCustomTools } from '@gmail-mcp/tools';

// Load all .tools.js files from a directory
await loadCustomTools('./custom-tools');
```

### Runtime Tool Registration

```typescript
import { toolRegistry } from '@gmail-mcp/tools';

// Register a single tool
toolRegistry.registerTool(myTool, 'custom');

// Get all tools in a category
const searchTools = toolRegistry.getToolsByCategory('search');

// Check if a tool exists
if (toolRegistry.hasTool('my_custom_tool')) {
  // Use the tool
}
```

## Tool Validation

```typescript
import { validateTool } from '@gmail-mcp/tools';

const errors = validateTool(myTool);
if (errors.length > 0) {
  console.error('Tool validation failed:', errors);
}
```

## Exporting Tool Documentation

```typescript
import { exportToolsAsJSON, exportToolsAsMarkdown } from '@gmail-mcp/tools';

// Export as JSON
const toolsJson = exportToolsAsJSON();
fs.writeFileSync('tools.json', toolsJson);

// Export as Markdown
const toolsMarkdown = exportToolsAsMarkdown();
fs.writeFileSync('TOOLS.md', toolsMarkdown);
```

## Best Practices

1. **Categorization**: Group related tools in the same category
2. **Naming**: Use descriptive, action-oriented names (e.g., `archive_emails`, not `archiver`)
3. **Descriptions**: Provide clear, concise descriptions
4. **Parameters**: Include descriptions for all parameters
5. **Validation**: Always validate custom tools before registration
6. **Error Handling**: Tools should handle errors gracefully
7. **Rate Limiting**: Consider rate limits for resource-intensive operations

## Example: Complete Custom Tool Module

```typescript
// email-analytics.tools.ts
import { ToolBuilder, ParameterTypes, ToolConfig } from '../base/ToolBuilder.js';

export const analyticsToolConfigs: ToolConfig[] = [
  {
    name: 'analyze_email_patterns',
    description: 'Analyze email communication patterns',
    category: 'analytics',
    parameters: {
      time_range: ParameterTypes.object({
        start: { type: 'string', description: 'Start date (ISO format)' },
        end: { type: 'string', description: 'End date (ISO format)' }
      }, 'Time range for analysis'),
      metrics: ParameterTypes.array(
        { type: 'string', enum: ['frequency', 'response_time', 'thread_length'] },
        'Metrics to analyze'
      ),
      group_by: ParameterTypes.string(
        'Group results by',
        ['sender', 'domain', 'category', 'day_of_week'],
        'sender'
      )
    },
    required: ['time_range', 'metrics']
  },
  
  {
    name: 'email_sentiment_analysis',
    description: 'Analyze sentiment in email communications',
    category: 'analytics',
    parameters: {
      email_ids: ParameterTypes.array({ type: 'string' }, 'Email IDs to analyze'),
      include_threads: ParameterTypes.boolean('Include entire email threads', false),
      language: ParameterTypes.string('Language for analysis', ['en', 'es', 'fr'], 'en')
    }
  }
];

export const analyticsTools = analyticsToolConfigs.map(config => 
  ToolBuilder.fromConfig(config)
);

// Optional: Export a plugin
export const analyticsPlugin = {
  name: 'email-analytics',
  version: '1.0.0',
  tools: analyticsTools,
  category: 'analytics'
};
```

## Migration from Old System

The new system maintains backward compatibility. Existing code using `toolDefinitions` will continue to work:

```typescript
// Old way (still works)
import { toolDefinitions } from './tools/definitions.js';

// New way (recommended)
import { getToolDefinitions } from './tools/definitions.js';
const tools = getToolDefinitions();
```

## Troubleshooting

### Tool Not Appearing
1. Check if the tool is registered: `toolRegistry.hasTool('tool_name')`
2. Verify the category is enabled: `toolsConfig.isCategoryEnabled('category')`
3. Check for validation errors: `validateTool(tool)`

### Plugin Not Loading
1. Ensure the plugin follows the correct interface
2. Check the plugin directory is in the configuration
3. Look for initialization errors in logs

### Performance Issues
1. Enable rate limiting for resource-intensive tools
2. Use caching for frequently accessed data
3. Consider async/batch operations for bulk actions