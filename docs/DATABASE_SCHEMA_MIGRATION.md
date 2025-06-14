# Database Schema Migration for Analyzer Results

## Overview

This document describes the database schema modifications made to store detailed analyzer results from the Gmail MCP Server categorization system.

## Background

Previously, the `email_index` table only stored the final categorization result (`high`, `medium`, `low`) but lost valuable intermediate analysis data from the three main analyzers:

1. **ImportanceAnalyzer**: Provides importance scoring and rule matching
2. **DateSizeAnalyzer**: Analyzes email age and size factors  
3. **LabelClassifier**: Classifies Gmail labels and detects spam/promotional content

## Schema Changes

### New Columns Added

The following columns have been added to the `email_index` table:

#### Importance Analysis Results
- `importance_score` (REAL) - Numerical importance score (0.0 to 1.0)
- `importance_level` (TEXT) - Importance level: 'high', 'medium', 'low'
- `importance_matched_rules` (TEXT) - JSON array of matched rule IDs
- `importance_confidence` (REAL) - Confidence score for the analysis

#### Date/Size Analysis Results
- `age_category` (TEXT) - Age category: 'recent', 'moderate', 'old'
- `size_category` (TEXT) - Size category: 'small', 'medium', 'large'
- `recency_score` (REAL) - Numerical recency score
- `size_penalty` (REAL) - Size-based penalty factor

#### Label Classification Results
- `gmail_category` (TEXT) - Gmail category: 'primary', 'important', 'spam', 'promotions', 'social', 'updates', 'forums'
- `spam_score` (REAL) - Spam probability score
- `promotional_score` (REAL) - Promotional content score
- `social_score` (REAL) - Social content score
- `spam_indicators` (TEXT) - JSON array of spam indicators
- `promotional_indicators` (TEXT) - JSON array of promotional indicators
- `social_indicators` (TEXT) - JSON array of social indicators

#### Analysis Metadata
- `analysis_timestamp` (INTEGER) - Unix timestamp of analysis
- `analysis_version` (TEXT) - Version of the analysis engine used

### New Indexes

The following indexes have been added for improved query performance:

- `idx_email_importance_level` - Index on importance_level
- `idx_email_importance_score` - Index on importance_score
- `idx_email_age_category` - Index on age_category
- `idx_email_size_category` - Index on size_category
- `idx_email_gmail_category` - Index on gmail_category
- `idx_email_spam_score` - Index on spam_score
- `idx_email_analysis_timestamp` - Index on analysis_timestamp

## Migration Strategy

### Automatic Migration

The database migration is handled automatically by the [`DatabaseManager.migrateToAnalyzerSchema()`](../src/database/DatabaseManager.ts:208) method:

1. **Detection**: Checks if the `importance_score` column exists to determine if migration is needed
2. **Column Addition**: Uses `ALTER TABLE` statements to add new columns
3. **Index Creation**: Creates performance indexes for the new columns
4. **Error Handling**: Gracefully handles duplicate column errors for idempotent operation

### Backward Compatibility

- **Existing Data**: All existing email records are preserved during migration
- **Null Values**: New columns are nullable, so existing records have `NULL` values for analyzer results
- **Gradual Population**: New analyzer results will be populated as emails are re-analyzed

## Code Changes

### Files Modified

1. **[`src/types/index.ts`](../src/types/index.ts:42)** - Updated `EmailIndex` interface with new analyzer result fields
2. **[`src/database/DatabaseManager.ts`](../src/database/DatabaseManager.ts)** - Updated database schema, migration logic, and CRUD operations

### Key Methods Updated

- [`createTables()`](../src/database/DatabaseManager.ts:69) - Creates base table schema
- [`migrateToAnalyzerSchema()`](../src/database/DatabaseManager.ts:208) - Handles migration from old to new schema
- [`upsertEmailIndex()`](../src/database/DatabaseManager.ts:386) - Updated to handle new analyzer fields
- [`bulkUpsertEmailIndex()`](../src/database/DatabaseManager.ts:448) - Updated for bulk operations
- [`rowToEmailIndex()`](../src/database/DatabaseManager.ts:545) - Updated to parse new fields from database rows

## Testing

### Test Scripts

Two comprehensive test scripts have been created:

1. **[`scripts/test-database-schema.js`](../scripts/test-database-schema.js)** - Tests new database functionality
2. **[`scripts/test-migration.js`](../scripts/test-migration.js)** - Tests migration from old to new schema

### Test Coverage

- ✅ New table creation with analyzer columns
- ✅ Migration from old schema to new schema
- ✅ Data preservation during migration
- ✅ CRUD operations with analyzer results
- ✅ Bulk operations
- ✅ Index creation and performance

## Usage Examples

### Storing Analyzer Results

```typescript
const emailWithAnalysis: EmailIndex = {
  id: 'email-123',
  // ... basic email fields ...
  
  // Importance Analysis
  importanceScore: 0.85,
  importanceLevel: 'high',
  importanceMatchedRules: ['sender-whitelist', 'keyword-urgent'],
  importanceConfidence: 0.92,
  
  // Date/Size Analysis
  ageCategory: 'recent',
  sizeCategory: 'small',
  recencyScore: 0.95,
  sizePenalty: 0.1,
  
  // Label Classification
  gmailCategory: 'important',
  spamScore: 0.05,
  promotionalScore: 0.1,
  socialScore: 0.0,
  spamIndicators: [],
  promotionalIndicators: ['offer'],
  socialIndicators: [],
  
  // Metadata
  analysisTimestamp: new Date(),
  analysisVersion: '1.0.0'
};

await dbManager.upsertEmailIndex(emailWithAnalysis);
```

### Querying by Analyzer Results

```typescript
// Find high-importance emails
const highImportanceEmails = await dbManager.searchEmails({
  // Custom query logic can be added to filter by importance_level = 'high'
});

// Find recent emails with low spam scores
// Custom query methods can be added to leverage the new indexes
```

## Performance Considerations

### Index Strategy

- **Selective Indexing**: Only the most commonly queried analyzer fields are indexed
- **Composite Indexes**: Future optimization may include composite indexes for common query patterns
- **Query Optimization**: New indexes significantly improve performance for analyzer-based queries

### Storage Impact

- **Column Addition**: Minimal storage overhead for new columns
- **JSON Fields**: Indicator arrays stored as JSON strings for flexibility
- **Null Values**: Existing records with null analyzer results have minimal storage impact

## Future Enhancements

### Planned Improvements

1. **Composite Indexes**: Add indexes for common query combinations
2. **Query Methods**: Add specialized query methods for analyzer-based searches
3. **Analytics**: Implement analyzer result analytics and reporting
4. **Optimization**: Performance tuning based on usage patterns

### Migration Versioning

The current migration is version 1.0. Future schema changes will:
- Use versioned migration scripts
- Maintain backward compatibility
- Provide rollback capabilities

## Conclusion

The database schema migration successfully extends the Gmail MCP Server to store comprehensive analyzer results while maintaining backward compatibility and providing a smooth migration path for existing installations.