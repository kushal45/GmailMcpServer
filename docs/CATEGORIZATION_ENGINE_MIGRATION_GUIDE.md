# CategorizationEngine Migration Guide

## Overview

This guide provides step-by-step instructions for migrating from the legacy monolithic CategorizationEngine to the new modular architecture. The migration maintains backward compatibility while providing access to enhanced features and improved performance.

## Pre-Migration Assessment

### 1. Analyze Current Implementation

Before starting the migration, assess your current categorization setup:

```typescript
// Check your current CategorizationEngine usage
const currentEngine = new CategorizationEngine(dbManager, cacheManager, legacyConfig);

// Document your existing configuration
const legacyConfig = {
  highPriorityRules: [
    { type: 'keyword', keywords: ['urgent', 'critical'] },
    { type: 'domain', domains: ['company.com'] },
    { type: 'label', labels: ['IMPORTANT'] }
  ],
  lowPriorityRules: [
    { type: 'keyword', keywords: ['newsletter', 'promotional'] },
    { type: 'noReply' },
    { type: 'largeAttachment', minSize: 1048576 }
  ]
};
```

### 2. Identify Custom Configurations

Document any custom rules or configurations:
- Custom keyword lists
- Important domain lists
- Special label handling
- Performance tuning settings

### 3. Backup Current System

```bash
# Backup your current configuration
cp your-config.json your-config.backup.json

# Backup any custom rule files
cp -r custom-rules/ custom-rules.backup/

# Export current categorization data
npm run export-categorization-data
```

## Migration Process

### Step 1: Install New Modular System

The new modular system is already included in your codebase. No additional installation required.

### Step 2: Configuration Migration

#### Legacy Configuration Format
```typescript
interface LegacyCategorizationConfig {
  highPriorityRules: PriorityRuleConfig[];
  lowPriorityRules: PriorityRuleConfig[];
}

interface PriorityRuleConfig {
  type: string;
  [key: string]: any;
}
```

#### New Modular Configuration Format
```typescript
import { CategorizationSystemConfig } from './categorization/config/CategorizationConfig.js';

const newConfig: CategorizationSystemConfig = {
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
        small: 102400,    // 100KB
        medium: 1048576,  // 1MB
        large: 10485760   // 10MB
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
    },
    labelClassifier: {
      labelMappings: {
        gmailToCategory: {
          'important': 'important',
          'starred': 'important',
          'spam': 'spam',
          'promotions': 'promotions',
          'social': 'social'
        },
        spamLabels: ['spam', 'junk', 'phishing'],
        promotionalLabels: ['promotions', 'deals', 'offers'],
        socialLabels: ['social', 'facebook', 'twitter']
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
  },
  caching: {
    globalEnabled: true,
    defaultTtl: 600,
    maxCacheSize: 1000
  },
  performance: {
    enableProfiling: false,
    logSlowOperations: true,
    slowOperationThresholdMs: 1000
  }
};
```

### Step 3: Automated Configuration Conversion

Use the built-in conversion utility:

```typescript
import { CategorizationEngine } from './categorization/CategorizationEngine.js';

// The engine automatically converts legacy configurations
const engine = new CategorizationEngine(dbManager, cacheManager, legacyConfig);

// Or manually convert using the config manager
import { CategorizationConfigManager } from './categorization/config/CategorizationConfig.js';

function convertLegacyConfig(legacyConfig: LegacyCategorizationConfig): Partial<CategorizationSystemConfig> {
  return {
    analyzers: {
      importance: {
        rules: [
          // Convert high priority rules
          ...legacyConfig.highPriorityRules.map((rule, index) => ({
            id: `legacy-high-${index}`,
            name: `Legacy High Priority Rule ${index}`,
            type: rule.type,
            priority: 100 - index,
            weight: 10,
            ...rule
          })),
          // Convert low priority rules
          ...legacyConfig.lowPriorityRules.map((rule, index) => ({
            id: `legacy-low-${index}`,
            name: `Legacy Low Priority Rule ${index}`,
            type: rule.type,
            priority: 20 - index,
            weight: -5,
            ...rule
          }))
        ],
        scoring: {
          highThreshold: 8,
          lowThreshold: -3,
          defaultWeight: 1
        },
        caching: {
          enabled: true,
          keyStrategy: 'partial'
        }
      }
    }
  };
}
```

### Step 4: Update Code Dependencies

#### Before (Legacy Usage)
```typescript
import { CategorizationEngine } from './categorization/CategorizationEngine.js';

const engine = new CategorizationEngine(dbManager, cacheManager);

// Register rules manually
engine.registerHighPriorityRule({ type: 'keyword', keywords: ['urgent'] });
engine.registerLowPriorityRule({ type: 'keyword', keywords: ['newsletter'] });

// Categorize emails
const result = await engine.categorizeEmails({ forceRefresh: false });
```

#### After (Modular Usage)
```typescript
import { CategorizationEngine } from './categorization/CategorizationEngine.js';
import { CategorizationSystemConfig } from './categorization/config/CategorizationConfig.js';

// Create with modular configuration
const config: CategorizationSystemConfig = {
  // ... configuration as shown above
};

const engine = new CategorizationEngine(dbManager, cacheManager, config);

// Categorize emails (same API)
const result = await engine.categorizeEmails({ forceRefresh: false });

// Access new features
const metrics = engine.getAnalysisMetrics();
const analyzers = engine.getAnalyzers();
```

### Step 5: Update Factory Usage (Optional)

For advanced usage, you can use the analyzer factory directly:

```typescript
import { AnalyzerFactory } from './categorization/factories/AnalyzerFactory.js';

const factory = new AnalyzerFactory(dbManager, cacheManager);

// Create individual analyzers
const importanceAnalyzer = factory.createImportanceAnalyzer(importanceConfig);
const dateSizeAnalyzer = factory.createDateSizeAnalyzer(dateSizeConfig);
const labelClassifier = factory.createLabelClassifier(labelConfig);

// Use analyzers independently
const importanceResult = await importanceAnalyzer.analyzeImportance(emailContext);
const dateSizeResult = await dateSizeAnalyzer.analyzeDateSize(emailContext);
const labelResult = await labelClassifier.classifyLabels(email.labels);
```

## Testing Migration

### Step 1: Unit Test Updates

Update your existing tests to work with the new architecture:

```typescript
// Before
describe('CategorizationEngine', () => {
  it('should categorize emails correctly', async () => {
    const engine = new CategorizationEngine(mockDb, mockCache);
    engine.registerHighPriorityRule({ type: 'keyword', keywords: ['urgent'] });
    
    const result = await engine.categorizeEmails({ forceRefresh: false });
    expect(result.processed).toBeGreaterThan(0);
  });
});

// After
describe('CategorizationEngine', () => {
  it('should categorize emails correctly', async () => {
    const config: CategorizationSystemConfig = {
      analyzers: {
        importance: {
          rules: [{
            id: 'test-urgent',
            name: 'Test Urgent',
            type: 'keyword',
            priority: 100,
            weight: 10,
            keywords: ['urgent']
          }],
          scoring: { highThreshold: 8, lowThreshold: -3, defaultWeight: 1 },
          caching: { enabled: false, keyStrategy: 'partial' }
        }
        // ... other analyzer configs
      }
      // ... other config sections
    };
    
    const engine = new CategorizationEngine(mockDb, mockCache, config);
    
    const result = await engine.categorizeEmails({ forceRefresh: false });
    expect(result.processed).toBeGreaterThan(0);
    
    // Test new features
    const metrics = engine.getAnalysisMetrics();
    expect(metrics.totalProcessingTime).toBeGreaterThan(0);
  });
});
```

### Step 2: Integration Testing

Run the comprehensive integration test suite:

```bash
# Run all categorization tests
npm test -- tests/integration/categorization/

# Run performance tests
npm test -- tests/performance/categorization/

# Run specific migration validation
npm test -- tests/integration/categorization/CategorizationEngine.integration.test.ts
```

### Step 3: Performance Validation

Compare performance before and after migration:

```typescript
// Performance comparison script
async function validateMigrationPerformance() {
  const testEmails = generateTestEmails(1000);
  
  // Test legacy configuration
  const legacyEngine = new CategorizationEngine(dbManager, cacheManager, legacyConfig);
  const legacyStart = Date.now();
  await legacyEngine.categorizeEmails({ forceRefresh: true });
  const legacyTime = Date.now() - legacyStart;
  
  // Test new modular configuration
  const modularEngine = new CategorizationEngine(dbManager, cacheManager, newConfig);
  const modularStart = Date.now();
  await modularEngine.categorizeEmails({ forceRefresh: true });
  const modularTime = Date.now() - modularStart;
  
  console.log(`Legacy processing time: ${legacyTime}ms`);
  console.log(`Modular processing time: ${modularTime}ms`);
  console.log(`Performance improvement: ${((legacyTime - modularTime) / legacyTime * 100).toFixed(1)}%`);
  
  // Validate metrics
  const metrics = modularEngine.getAnalysisMetrics();
  console.log('Analysis metrics:', metrics);
}
```

## Rollback Procedures

If you need to rollback to the legacy system:

### Step 1: Restore Legacy Configuration

```typescript
// Restore from backup
const legacyConfig = JSON.parse(fs.readFileSync('your-config.backup.json', 'utf8'));

// Create engine with legacy config (automatically supported)
const engine = new CategorizationEngine(dbManager, cacheManager, legacyConfig);
```

### Step 2: Disable New Features

```typescript
// Disable new features if needed
const safeConfig: CategorizationSystemConfig = {
  // ... config
  orchestration: {
    enableParallelProcessing: false,  // Disable parallel processing
    batchSize: 1,                     // Process one at a time
    timeoutMs: 60000,                 // Longer timeout
    retryAttempts: 1                  // Minimal retries
  },
  caching: {
    globalEnabled: false,             // Disable caching
    defaultTtl: 0,
    maxCacheSize: 0
  }
};
```

### Step 3: Restore Data

```bash
# Restore categorization data if needed
npm run import-categorization-data your-backup-file.json
```

## Troubleshooting

### Common Migration Issues

#### Issue 1: Configuration Validation Errors

**Problem**: Configuration validation fails with new format.

**Solution**:
```typescript
// Validate configuration before using
const configManager = new CategorizationConfigManager(newConfig);
const validation = configManager.validateConfig();

if (!validation.valid) {
  console.error('Configuration errors:', validation.errors);
  // Fix configuration issues
}
```

#### Issue 2: Performance Degradation

**Problem**: New system is slower than expected.

**Solution**:
```typescript
// Enable performance optimizations
const optimizedConfig: CategorizationSystemConfig = {
  // ... other config
  orchestration: {
    enableParallelProcessing: true,   // Enable parallel processing
    batchSize: 100,                   // Larger batch size
    timeoutMs: 30000,
    retryAttempts: 3
  },
  caching: {
    globalEnabled: true,              // Enable caching
    defaultTtl: 600,
    maxCacheSize: 2000               // Larger cache
  }
};

// Monitor performance
const metrics = engine.getAnalysisMetrics();
console.log('Performance metrics:', metrics);
```

#### Issue 3: Rule Conversion Issues

**Problem**: Legacy rules not working as expected.

**Solution**:
```typescript
// Debug rule conversion
const engine = new CategorizationEngine(dbManager, cacheManager, legacyConfig);
const analyzers = engine.getAnalyzers();

// Check converted rules
const importanceRules = analyzers.importanceAnalyzer.getApplicableRules(testContext);
console.log('Converted rules:', importanceRules);

// Test individual rules
for (const rule of importanceRules) {
  const result = rule.evaluate(testContext);
  console.log(`Rule ${rule.name}: matched=${result.matched}, score=${result.score}`);
}
```

#### Issue 4: Memory Usage Issues

**Problem**: Higher memory usage with new system.

**Solution**:
```typescript
// Optimize memory usage
const memoryOptimizedConfig: CategorizationSystemConfig = {
  // ... other config
  caching: {
    globalEnabled: true,
    defaultTtl: 300,                  // Shorter TTL
    maxCacheSize: 500                 // Smaller cache
  },
  orchestration: {
    enableParallelProcessing: false,  // Reduce concurrent operations
    batchSize: 25,                    // Smaller batches
    timeoutMs: 30000,
    retryAttempts: 2
  }
};

// Monitor memory usage
setInterval(() => {
  const usage = process.memoryUsage();
  console.log('Memory usage:', {
    rss: Math.round(usage.rss / 1024 / 1024) + 'MB',
    heapUsed: Math.round(usage.heapUsed / 1024 / 1024) + 'MB'
  });
}, 10000);
```

## Backward Compatibility

### Maintained APIs

The following APIs remain unchanged:

```typescript
// These methods work exactly the same
await engine.categorizeEmails(options);
await engine.getStatistics(options);
await engine.updateImportantDomains(domains);
await engine.analyzeEmailPatterns();
```

### Legacy Configuration Support

Legacy configurations are automatically converted:

```typescript
// This still works
const legacyConfig = {
  highPriorityRules: [/* rules */],
  lowPriorityRules: [/* rules */]
};

const engine = new CategorizationEngine(dbManager, cacheManager, legacyConfig);
// Automatically converts to new format internally
```

### Deprecated Methods

These methods are deprecated but still functional:

```typescript
// Deprecated but still works
engine.registerHighPriorityRule(rule);  // Use configuration instead
engine.registerLowPriorityRule(rule);   // Use configuration instead

// Preferred new approach
const config = engine.getConfiguration();
config.analyzers.importance.rules.push(newRule);
engine.updateConfiguration(config);
```

## Migration Checklist

- [ ] **Pre-Migration Assessment**
  - [ ] Document current configuration
  - [ ] Identify custom rules and settings
  - [ ] Backup current system and data
  - [ ] Run baseline performance tests

- [ ] **Configuration Migration**
  - [ ] Convert legacy configuration to new format
  - [ ] Validate new configuration
  - [ ] Test configuration with sample data
  - [ ] Document any custom mappings

- [ ] **Code Updates**
  - [ ] Update CategorizationEngine instantiation
  - [ ] Replace deprecated method calls
  - [ ] Add new feature usage (optional)
  - [ ] Update error handling

- [ ] **Testing**
  - [ ] Update unit tests
  - [ ] Run integration tests
  - [ ] Perform performance validation
  - [ ] Test rollback procedures

- [ ] **Deployment**
  - [ ] Deploy to staging environment
  - [ ] Run full system tests
  - [ ] Monitor performance and errors
  - [ ] Deploy to production

- [ ] **Post-Migration**
  - [ ] Monitor system performance
  - [ ] Validate categorization accuracy
  - [ ] Clean up legacy code (optional)
  - [ ] Update documentation

## Support and Resources

### Documentation References
- [API Documentation](./CATEGORIZATION_ENGINE_API.md)
- [Performance Guide](./CATEGORIZATION_ENGINE_PERFORMANCE.md)
- [Maintenance Guide](./CATEGORIZATION_ENGINE_MAINTENANCE.md)
- [Architecture Overview](./CATEGORIZATION_ENGINE_MODULAR_ARCHITECTURE.md)

### Test Examples
- [Integration Tests](../tests/integration/categorization/)
- [Performance Tests](../tests/performance/categorization/)
- [Unit Tests](../tests/unit/categorization/)

### Configuration Examples
- [Default Configuration](../src/categorization/config/CategorizationConfig.ts)
- [Factory Usage](../src/categorization/factories/AnalyzerFactory.ts)
- [Test Configurations](../tests/integration/categorization/helpers/testHelpers.ts)

For additional support or questions about the migration process, refer to the comprehensive test suite and documentation provided with the modular system.