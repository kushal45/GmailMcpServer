# CategorizationEngine API Documentation

## Overview

This document provides comprehensive API documentation for the modular CategorizationEngine system. It includes detailed interface specifications, usage examples, configuration options, and best practices for developers.

## Table of Contents

1. [Core Interfaces](#core-interfaces)
2. [CategorizationEngine API](#categorizationengine-api)
3. [Analyzer APIs](#analyzer-apis)
4. [Factory Pattern Usage](#factory-pattern-usage)
5. [Configuration System](#configuration-system)
6. [Error Handling](#error-handling)
7. [Performance Considerations](#performance-considerations)
8. [Integration Examples](#integration-examples)

## Core Interfaces

### IAnalyzer

Base interface for all analyzers in the categorization system.

```typescript
interface IAnalyzer {
  /**
   * Performs analysis on the provided context
   * @param context - The analysis context containing email data
   * @returns Promise resolving to analysis result
   */
  analyze(context: AnalysisContext): Promise<AnalysisResult>;

  /**
   * Configures the analyzer with provided settings
   * @param config - Configuration object for the analyzer
   */
  configure(config: AnalyzerConfig): void;
}
```

**Usage Example:**
```typescript
import { IAnalyzer } from './categorization/interfaces/IAnalyzer.js';

// Generic analyzer usage
const analyzer: IAnalyzer = factory.createImportanceAnalyzer();
const result = await analyzer.analyze(emailContext);
```

### EmailAnalysisContext

Context object containing email data for analysis.

```typescript
interface EmailAnalysisContext {
  email: EmailIndex;           // Complete email object
  subject: string;             // Normalized subject (lowercase)
  sender: string;              // Normalized sender (lowercase)
  snippet: string;             // Normalized snippet (lowercase)
  labels: string[];            // Gmail labels array
  date: Date;                  // Email date
  size: number;                // Email size in bytes
  hasAttachments: boolean;     // Attachment indicator
}
```

**Creation Example:**
```typescript
function createAnalysisContext(email: EmailIndex): EmailAnalysisContext {
  return {
    email,
    subject: email.subject?.toLowerCase() || '',
    sender: email.sender?.toLowerCase() || '',
    snippet: email.snippet?.toLowerCase() || '',
    labels: email.labels || [],
    date: email.date || new Date(),
    size: email.size || 0,
    hasAttachments: email.hasAttachments || false
  };
}
```

## CategorizationEngine API

### Constructor

```typescript
constructor(
  databaseManager: DatabaseManager,
  cacheManager: CacheManager,
  config?: LegacyCategorizationConfig | CategorizationSystemConfig
)
```

**Parameters:**
- `databaseManager`: Database interface for email storage
- `cacheManager`: Cache interface for performance optimization
- `config`: Optional configuration (supports both legacy and new formats)

**Example:**
```typescript
import { CategorizationEngine } from './categorization/CategorizationEngine.js';
import { CategorizationSystemConfig } from './categorization/config/CategorizationConfig.js';

const config: CategorizationSystemConfig = {
  analyzers: {
    importance: {
      rules: [
        {
          id: 'urgent-keywords',
          name: 'Urgent Keywords',
          type: 'keyword',
          priority: 100,
          weight: 15,
          keywords: ['urgent', 'critical', 'asap']
        }
      ],
      scoring: {
        highThreshold: 10,
        lowThreshold: -5,
        defaultWeight: 1
      },
      caching: {
        enabled: true,
        keyStrategy: 'partial'
      }
    },
    dateSize: {
      sizeThresholds: {
        small: 102400,
        medium: 1048576,
        large: 10485760
      },
      ageCategories: {
        recent: 7,
        moderate: 30,
        old: 90
      },
      scoring: {
        recencyWeight: 0.7,
        sizeWeight: 0.3
      },
      caching: {
        enabled: true,
        ttl: 3600
      }
    },
    labelClassifier: {
      labelMappings: {
        gmailToCategory: {
          'important': 'important',
          'starred': 'important',
          'spam': 'spam',
          'promotions': 'promotions'
        },
        spamLabels: ['spam', 'junk'],
        promotionalLabels: ['promotions', 'deals'],
        socialLabels: ['social', 'facebook']
      },
      scoring: {
        spamThreshold: 0.8,
        promotionalThreshold: 0.6,
        socialThreshold: 0.5
      },
      caching: {
        enabled: true,
        ttl: 1800
      }
    }
  },
  orchestration: {
    enableParallelProcessing: true,
    batchSize: 50,
    timeoutMs: 30000,
    retryAttempts: 3
  }
};

const engine = new CategorizationEngine(dbManager, cacheManager, config);
```

### Primary Methods

#### categorizeEmails()

Categorizes emails based on configured analyzers.

```typescript
async categorizeEmails(options: CategorizeOptions): Promise<{
  processed: number;
  categories: { high: number; medium: number; low: number; };
}>
```

**Parameters:**
```typescript
interface CategorizeOptions {
  forceRefresh?: boolean;  // Recategorize all emails (default: false)
  year?: number;           // Limit to specific year (optional)
}
```

**Example:**
```typescript
// Categorize only uncategorized emails
const result = await engine.categorizeEmails({ forceRefresh: false });
console.log(`Processed ${result.processed} emails`);
console.log(`Categories: ${JSON.stringify(result.categories)}`);

// Force recategorization of all emails from 2024
const result2024 = await engine.categorizeEmails({ 
  forceRefresh: true, 
  year: 2024 
});
```

#### getStatistics()

Retrieves email statistics with various grouping options.

```typescript
async getStatistics(options: {
  groupBy: string;
  includeArchived: boolean;
}): Promise<EmailStatistics>
```

**Example:**
```typescript
const stats = await engine.getStatistics({
  groupBy: 'category',
  includeArchived: true
});

console.log('Category distribution:', stats.categories);
console.log('Year distribution:', stats.years);
console.log('Size distribution:', stats.sizes);
```

#### analyzeEmail()

Analyzes a single email without database updates (useful for testing).

```typescript
async analyzeEmail(email: EmailIndex): Promise<CombinedAnalysisResult>
```

**Example:**
```typescript
const email: EmailIndex = {
  id: 'test-email',
  subject: 'URGENT: System maintenance required',
  sender: 'admin@company.com',
  snippet: 'Critical system update needed immediately',
  labels: ['INBOX', 'IMPORTANT'],
  date: new Date(),
  size: 75000,
  hasAttachments: false
  // ... other properties
};

const analysis = await engine.analyzeEmail(email);
console.log(`Final category: ${analysis.finalCategory}`);
console.log(`Confidence: ${analysis.confidence}`);
console.log(`Reasoning: ${analysis.reasoning.join(', ')}`);
console.log(`Processing time: ${analysis.processingTime}ms`);
```

### Configuration Management

#### getConfiguration()

Returns the current system configuration.

```typescript
getConfiguration(): CategorizationSystemConfig
```

#### updateConfiguration()

Updates the system configuration and reinitializes analyzers.

```typescript
updateConfiguration(updates: Partial<CategorizationSystemConfig>): void
```

**Example:**
```typescript
// Get current configuration
const currentConfig = engine.getConfiguration();

// Update specific settings
engine.updateConfiguration({
  orchestration: {
    enableParallelProcessing: false,
    batchSize: 25,
    timeoutMs: 15000,
    retryAttempts: 2
  },
  caching: {
    globalEnabled: true,
    defaultTtl: 1200,
    maxCacheSize: 2000
  }
});

// Verify changes
const updatedConfig = engine.getConfiguration();
console.log('Parallel processing:', updatedConfig.orchestration.enableParallelProcessing);
```

#### validateConfiguration()

Validates the current configuration.

```typescript
validateConfiguration(): { valid: boolean; errors: string[] }
```

**Example:**
```typescript
const validation = engine.validateConfiguration();
if (!validation.valid) {
  console.error('Configuration errors:');
  validation.errors.forEach(error => console.error(`- ${error}`));
} else {
  console.log('Configuration is valid');
}
```

### Performance Monitoring

#### getAnalysisMetrics()

Returns performance metrics for monitoring and debugging.

```typescript
getAnalysisMetrics(): AnalysisMetrics
```

**Example:**
```typescript
const metrics = engine.getAnalysisMetrics();
console.log('Performance Metrics:', {
  totalProcessingTime: metrics.totalProcessingTime,
  averageTimePerEmail: metrics.totalProcessingTime / emailCount,
  importanceAnalysisTime: metrics.importanceAnalysisTime,
  dateSizeAnalysisTime: metrics.dateSizeAnalysisTime,
  labelClassificationTime: metrics.labelClassificationTime,
  cacheHitRate: metrics.cacheHits / (metrics.cacheHits + metrics.cacheMisses),
  rulesEvaluated: metrics.rulesEvaluated
});
```

#### resetMetrics()

Resets all performance metrics.

```typescript
resetMetrics(): void
```

### Advanced Usage

#### getAnalyzers()

Returns analyzer instances for advanced usage.

```typescript
getAnalyzers(): {
  importanceAnalyzer: IImportanceAnalyzer;
  dateSizeAnalyzer: IDateSizeAnalyzer;
  labelClassifier: ILabelClassifier;
}
```

**Example:**
```typescript
const analyzers = engine.getAnalyzers();

// Use individual analyzers
const importanceResult = await analyzers.importanceAnalyzer.analyzeImportance(context);
const dateSizeResult = await analyzers.dateSizeAnalyzer.analyzeDateSize(context);
const labelResult = await analyzers.labelClassifier.classifyLabels(email.labels);

// Register custom rules
analyzers.importanceAnalyzer.registerRule({
  id: 'custom-rule',
  name: 'Custom Priority Rule',
  priority: 75,
  condition: { type: 'keyword', keywords: ['custom'] },
  weight: 8,
  evaluate: (context) => ({
    matched: context.subject.includes('custom'),
    score: 8,
    reason: 'Custom keyword matched'
  })
});
```

## Analyzer APIs

### IImportanceAnalyzer

Analyzes email importance based on configurable rules.

```typescript
interface IImportanceAnalyzer extends IAnalyzer {
  analyzeImportance(context: EmailAnalysisContext): Promise<ImportanceResult>;
  registerRule(rule: ImportanceRule): void;
  getApplicableRules(context: EmailAnalysisContext): ImportanceRule[];
}
```

**Usage Example:**
```typescript
import { AnalyzerFactory } from './categorization/factories/AnalyzerFactory.js';

const factory = new AnalyzerFactory(dbManager, cacheManager);
const analyzer = factory.createImportanceAnalyzer({
  rules: [
    {
      id: 'vip-senders',
      name: 'VIP Senders',
      type: 'domain',
      priority: 95,
      weight: 12,
      domains: ['ceo@company.com', 'board@company.com']
    }
  ],
  scoring: {
    highThreshold: 10,
    lowThreshold: -5,
    defaultWeight: 1
  },
  caching: {
    enabled: true,
    keyStrategy: 'partial'
  }
});

const result = await analyzer.analyzeImportance(emailContext);
console.log(`Importance: ${result.level} (score: ${result.score})`);
console.log(`Matched rules: ${result.matchedRules.join(', ')}`);
console.log(`Confidence: ${result.confidence}`);
```

**Rule Types:**

1. **Keyword Rules**
```typescript
{
  id: 'urgent-keywords',
  name: 'Urgent Keywords',
  type: 'keyword',
  priority: 100,
  weight: 15,
  keywords: ['urgent', 'critical', 'asap', 'emergency']
}
```

2. **Domain Rules**
```typescript
{
  id: 'important-domains',
  name: 'Important Domains',
  type: 'domain',
  priority: 90,
  weight: 10,
  domains: ['company.com', 'client.com', 'partner.org']
}
```

3. **Label Rules**
```typescript
{
  id: 'important-labels',
  name: 'Important Labels',
  type: 'label',
  priority: 85,
  weight: 8,
  labels: ['IMPORTANT', 'STARRED', 'PRIORITY']
}
```

4. **No-Reply Rules**
```typescript
{
  id: 'no-reply-detection',
  name: 'No Reply Detection',
  type: 'noReply',
  priority: 20,
  weight: -5
}
```

5. **Large Attachment Rules**
```typescript
{
  id: 'large-attachments',
  name: 'Large Attachments',
  type: 'largeAttachment',
  priority: 15,
  weight: -3,
  minSize: 5242880  // 5MB
}
```

### IDateSizeAnalyzer

Analyzes emails based on date (age) and size characteristics.

```typescript
interface IDateSizeAnalyzer extends IAnalyzer {
  analyzeDateSize(context: EmailAnalysisContext): Promise<DateSizeResult>;
  categorizeByAge(date: Date): AgeCategory;
  categorizeBySize(size: number): SizeCategory;
}
```

**Usage Example:**
```typescript
const dateSizeAnalyzer = factory.createDateSizeAnalyzer({
  sizeThresholds: {
    small: 100000,    // 100KB
    medium: 1000000,  // 1MB
    large: 10000000   // 10MB
  },
  ageCategories: {
    recent: 7,    // 7 days
    moderate: 30, // 30 days
    old: 90       // 90 days
  },
  scoring: {
    recencyWeight: 0.7,
    sizeWeight: 0.3
  },
  caching: {
    enabled: true,
    ttl: 3600
  }
});

const result = await dateSizeAnalyzer.analyzeDateSize(emailContext);
console.log(`Age: ${result.ageCategory}, Size: ${result.sizeCategory}`);
console.log(`Recency score: ${result.recencyScore}`);
console.log(`Size penalty: ${result.sizePenalty}`);

// Direct categorization
const ageCategory = dateSizeAnalyzer.categorizeByAge(new Date('2024-01-01'));
const sizeCategory = dateSizeAnalyzer.categorizeBySize(500000);
```

### ILabelClassifier

Classifies emails based on Gmail labels and detects spam/promotional indicators.

```typescript
interface ILabelClassifier extends IAnalyzer {
  classifyLabels(labels: string[]): Promise<LabelClassification>;
  detectSpamIndicators(labels: string[]): SpamScore;
  categorizeByGmailLabels(labels: string[]): GmailCategory;
}
```

**Usage Example:**
```typescript
const labelClassifier = factory.createLabelClassifier({
  labelMappings: {
    gmailToCategory: {
      'important': 'important',
      'starred': 'important',
      'spam': 'spam',
      'promotions': 'promotions',
      'social': 'social',
      'updates': 'updates',
      'forums': 'forums'
    },
    spamLabels: ['spam', 'junk', 'phishing', 'malware'],
    promotionalLabels: ['promotions', 'deals', 'offers', 'sale'],
    socialLabels: ['social', 'facebook', 'twitter', 'linkedin']
  },
  scoring: {
    spamThreshold: 0.8,
    promotionalThreshold: 0.6,
    socialThreshold: 0.5
  },
  caching: {
    enabled: true,
    ttl: 1800
  }
});

const labels = ['INBOX', 'PROMOTIONS', 'DEALS'];
const classification = await labelClassifier.classifyLabels(labels);

console.log(`Category: ${classification.category}`);
console.log(`Spam score: ${classification.spamScore}`);
console.log(`Promotional score: ${classification.promotionalScore}`);
console.log(`Social score: ${classification.socialScore}`);
console.log(`Indicators:`, classification.indicators);

// Direct spam detection
const spamScore = labelClassifier.detectSpamIndicators(['SPAM', 'JUNK']);
console.log(`Spam detected: ${spamScore.score > 0.5}`);
console.log(`Indicators: ${spamScore.indicators.join(', ')}`);

// Gmail category detection
const gmailCategory = labelClassifier.categorizeByGmailLabels(['IMPORTANT', 'STARRED']);
console.log(`Gmail category: ${gmailCategory}`);
```

## Factory Pattern Usage

### AnalyzerFactory

Creates analyzer instances with proper dependency injection.

```typescript
class AnalyzerFactory {
  constructor(databaseManager?: DatabaseManager, cacheManager?: CacheManager);
  
  createImportanceAnalyzer(config?: ImportanceAnalyzerConfig): IImportanceAnalyzer;
  createDateSizeAnalyzer(config?: DateSizeAnalyzerConfig): IDateSizeAnalyzer;
  createLabelClassifier(config?: LabelClassifierConfig): ILabelClassifier;
  createAllAnalyzers(configs?: AnalyzerConfigs): AllAnalyzers;
}
```

**Complete Factory Usage:**
```typescript
import { AnalyzerFactory } from './categorization/factories/AnalyzerFactory.js';

// Create factory with dependencies
const factory = new AnalyzerFactory(databaseManager, cacheManager);

// Create individual analyzers
const importanceAnalyzer = factory.createImportanceAnalyzer(importanceConfig);
const dateSizeAnalyzer = factory.createDateSizeAnalyzer(dateSizeConfig);
const labelClassifier = factory.createLabelClassifier(labelConfig);

// Create all analyzers at once
const allAnalyzers = factory.createAllAnalyzers({
  importance: importanceConfig,
  dateSize: dateSizeConfig,
  labelClassifier: labelConfig
});

// Use analyzers independently
const emailContext = createAnalysisContext(email);

const [importanceResult, dateSizeResult, labelResult] = await Promise.all([
  allAnalyzers.importanceAnalyzer.analyzeImportance(emailContext),
  allAnalyzers.dateSizeAnalyzer.analyzeDateSize(emailContext),
  allAnalyzers.labelClassifier.classifyLabels(emailContext.labels)
]);

// Combine results manually
const finalCategory = combineResults(importanceResult, dateSizeResult, labelResult);
```

## Configuration System

### CategorizationConfigManager

Manages system-wide configuration with validation and updates.

```typescript
class CategorizationConfigManager {
  constructor(config?: Partial<CategorizationSystemConfig>);
  
  getConfig(): CategorizationSystemConfig;
  getAnalyzerConfig<T>(analyzerType: T): CategorizationSystemConfig['analyzers'][T];
  updateConfig(updates: Partial<CategorizationSystemConfig>): void;
  updateAnalyzerConfig<T>(analyzerType: T, updates: Partial<T>): void;
  resetToDefaults(): void;
  validateConfig(): { valid: boolean; errors: string[] };
}
```

**Usage Example:**
```typescript
import { CategorizationConfigManager } from './categorization/config/CategorizationConfig.js';

// Create config manager
const configManager = new CategorizationConfigManager({
  analyzers: {
    importance: {
      rules: [/* custom rules */],
      scoring: { highThreshold: 12, lowThreshold: -6, defaultWeight: 2 }
    }
  }
});

// Get specific analyzer config
const importanceConfig = configManager.getAnalyzerConfig('importance');

// Update analyzer-specific config
configManager.updateAnalyzerConfig('importance', {
  scoring: { highThreshold: 15, lowThreshold: -8, defaultWeight: 3 }
});

// Validate configuration
const validation = configManager.validateConfig();
if (!validation.valid) {
  console.error('Configuration errors:', validation.errors);
}

// Reset to defaults if needed
configManager.resetToDefaults();
```

## Error Handling

### Exception Types

The system defines specific exception types for different error scenarios:

```typescript
// Configuration errors
try {
  const engine = new CategorizationEngine(dbManager, cacheManager, invalidConfig);
} catch (error) {
  if (error.message.includes('Configuration')) {
    console.error('Configuration error:', error.message);
    // Handle configuration issues
  }
}

// Analysis errors
try {
  const result = await analyzer.analyzeImportance(context);
} catch (error) {
  if (error.message.includes('requires EmailAnalysisContext')) {
    console.error('Invalid context provided');
    // Provide proper context
  }
}

// Timeout errors
try {
  const result = await engine.categorizeEmails({ forceRefresh: true });
} catch (error) {
  if (error.message.includes('timed out')) {
    console.error('Analysis timed out, consider increasing timeout or reducing batch size');
    // Adjust configuration
  }
}
```

### Graceful Degradation

The system implements graceful degradation for various failure scenarios:

```typescript
// Cache failures don't stop analysis
const analyzer = factory.createImportanceAnalyzer({
  caching: { enabled: true, keyStrategy: 'partial' }
});

// If cache fails, analysis continues without caching
const result = await analyzer.analyzeImportance(context);
// Result is still valid even if caching failed

// Rule evaluation failures don't stop overall analysis
const engine = new CategorizationEngine(dbManager, cacheManager, config);
// If one rule fails, other rules continue to be evaluated
const categorization = await engine.categorizeEmails({ forceRefresh: false });
```

### Error Recovery

```typescript
// Implement retry logic for transient failures
async function robustCategorization(engine: CategorizationEngine, options: CategorizeOptions) {
  const maxRetries = 3;
  let lastError: Error;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await engine.categorizeEmails(options);
    } catch (error) {
      lastError = error as Error;
      console.warn(`Categorization attempt ${attempt} failed:`, error.message);
      
      if (attempt < maxRetries) {
        // Wait before retry with exponential backoff
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
      }
    }
  }
  
  throw new Error(`Categorization failed after ${maxRetries} attempts: ${lastError.message}`);
}
```

## Performance Considerations

### Caching Strategies

```typescript
// Configure caching for optimal performance
const performanceOptimizedConfig: CategorizationSystemConfig = {
  analyzers: {
    importance: {
      caching: {
        enabled: true,
        keyStrategy: 'partial'  // Faster key generation
      }
    },
    dateSize: {
      caching: {
        enabled: true,
        ttl: 7200  // Longer TTL for stable data
      }
    },
    labelClassifier: {
      caching: {
        enabled: true,
        ttl: 3600  // Medium TTL for label data
      }
    }
  },
  caching: {
    globalEnabled: true,
    defaultTtl: 600,
    maxCacheSize: 2000  // Larger cache for better hit rates
  }
};
```

### Batch Processing

```typescript
// Optimize batch processing for large datasets
const batchOptimizedConfig: CategorizationSystemConfig = {
  orchestration: {
    enableParallelProcessing: true,
    batchSize: 100,  // Larger batches for efficiency
    timeoutMs: 60000,  // Longer timeout for large batches
    retryAttempts: 2
  }
};

// Process emails in chunks for memory efficiency
async function processLargeEmailSet(engine: CategorizationEngine, emails: EmailIndex[]) {
  const chunkSize = 1000;
  const results = [];
  
  for (let i = 0; i < emails.length; i += chunkSize) {
    const chunk = emails.slice(i, i + chunkSize);
    console.log(`Processing chunk ${Math.floor(i / chunkSize) + 1}/${Math.ceil(emails.length / chunkSize)}`);
    
    // Process chunk
    const result = await engine.categorizeEmails({ forceRefresh: true });
    results.push(result);
    
    // Optional: Clear cache between chunks to manage memory
    if (i % (chunkSize * 5) === 0) {
      engine.resetMetrics();
    }
  }
  
  return results;
}
```

### Memory Management

```typescript
// Monitor memory usage during processing
function monitorMemoryUsage(engine: CategorizationEngine) {
  const interval = setInterval(() => {
    const usage = process.memoryUsage();
    const metrics = engine.getAnalysisMetrics();
    
    console.log('Memory Usage:', {
      rss: Math.round(usage.rss / 1024 / 1024) + 'MB',
      heapUsed: Math.round(usage.heapUsed / 1024 / 1024) + 'MB',
      cacheHits: metrics.cacheHits,
      cacheMisses: metrics.cacheMisses
    });
    
    // Clear metrics if memory usage is high
    if (usage.heapUsed > 500 * 1024 * 1024) { // 500MB threshold
      console.log('High memory usage detected, clearing metrics');
      engine.resetMetrics();
    }
  }, 10000);
  
  return () => clearInterval(interval);
}
```

## Integration Examples

### Basic Integration

```typescript
import { CategorizationEngine } from './categorization/CategorizationEngine.js';
import { DatabaseManager } from './database/DatabaseManager.js';
import { CacheManager } from './cache/CacheManager.js';

async function basicIntegration() {
  // Initialize dependencies
  const dbManager = new DatabaseManager();
  await dbManager.initialize();
  
  const cacheManager = new CacheManager();
  
  // Create engine with default configuration
  const engine = new CategorizationEngine(dbManager, cacheManager);
  
  // Categorize emails
  const result = await engine.categorizeEmails({ forceRefresh: false });
  console.log(`Categorized ${result.processed} emails`);
  
  // Get statistics
  const stats = await engine.getStatistics({ groupBy: 'category', includeArchived: false });
  console.log('Email distribution:', stats.categories);
}
```

### Advanced Integration with Custom Configuration

```typescript
import { DEFAULT_CATEGORIZATION_CONFIG } from './categorization/config/CategorizationConfig.js';

async function advancedIntegration() {
  // Custom configuration
  const customConfig: CategorizationSystemConfig = {
    ...DEFAULT_CATEGORIZATION_CONFIG,
    analyzers: {
      ...DEFAULT_CATEGORIZATION_CONFIG.analyzers,
      importance: {
        ...DEFAULT_CATEGORIZATION_CONFIG.analyzers.importance,
        rules: [
          // Add custom rules
          {
            id: 'company-executives',
            name: 'Company Executives',
            type: 'domain',
            priority: 100,
            weight: 20,
            domains: ['ceo@company.com', 'cto@company.com']
          },
          ...DEFAULT_CATEGORIZATION_CONFIG.analyzers.importance.rules
        ],
        scoring: {
          highThreshold: 15,  // Higher threshold for stricter high priority
          lowThreshold: -8,   // Lower threshold for more low priority
          defaultWeight: 2
        }
      }
    },
    orchestration: {
      enableParallelProcessing: true,
      batchSize: 75,
      timeoutMs: 45000,
      retryAttempts: 3
    }
  };
  
  const engine = new CategorizationEngine(dbManager, cacheManager, customConfig);
  
  // Monitor performance
  const stopMonitoring = monitorMemoryUsage(engine);
  
  try {
    // Process emails with progress tracking
    const result = await engine.categorizeEmails({ forceRefresh: true });
    
    // Analyze results
    const metrics = engine.getAnalysisMetrics();
    console.log('Performance Analysis:', {
      totalEmails: result.processed,
      averageTimePerEmail: metrics.totalProcessingTime / result.processed,
      cacheEfficiency: metrics.cacheHits / (metrics.cacheHits + metrics.cacheMisses),
      categoryDistribution: result.categories
    });
    
    // Validate configuration effectiveness
    const validation = engine.validateConfiguration();
    if (!validation.valid) {
      console.warn('Configuration issues detected:', validation.errors);
    }
    
  } finally {
    stopMonitoring();
  }
}
```

### Integration with External Systems

```typescript
// Integration with external monitoring/alerting
class CategorizationMonitor {
  private engine: CategorizationEngine;
  private alertThresholds = {
    maxProcessingTime: 60000,  // 1 minute
    minCacheHitRate: 0.7,      // 70%
    maxErrorRate: 0.05         // 5%
  };
  
  constructor(engine: CategorizationEngine) {
    this.engine = engine;
  }
  
  async monitorCategorization(): Promise<void> {
    const startTime = Date.now();
    let errors = 0;
    
    try {
      const result = await this.engine.categorizeEmails({ forceRefresh: false });
      const metrics = this.engine.getAnalysisMetrics();
      
      // Check performance thresholds
      const processingTime = Date.now() - startTime;
      const cacheHitRate = metrics.cacheHits / (metrics.cacheHits + metrics.cacheMisses);
      
      if (processingTime > this.alertThresholds.maxProcessingTime) {
        this.sendAlert('HIGH_PROCESSING_TIME', { processingTime, threshold: this.alertThresholds.maxProcessingTime });
      }
      
      if (cacheHitRate < this.alertThresholds.minCacheHitRate) {
        this.sendAlert('LOW_CACHE_HIT_RATE', { cacheHitRate, threshold: this.alertThresholds.minCacheHitRate });
      }
      
      // Log success metrics
      this.logMetrics('CATEGORIZATION_SUCCESS', {
        processed: result.processed,
        processingTime,
        cacheHitRate,
        categories: result.categories
      });
      
    } catch (error) {
      errors++;
      this.sendAlert('CATEGORIZATION_ERROR', { error: error.