# ImportanceAnalyzer Low-Level Sequence Diagram

## Overview

This document provides a comprehensive low-level sequence diagram for the [`ImportanceAnalyzer`](../src/categorization/analyzers/ImportanceAnalyzer.ts) class and its interaction with the Categorization Engine. The diagram shows the complete end-to-end flow of email importance analysis, including detailed rule evaluation processes, caching mechanisms, error handling, and performance optimization flows.

## Architecture Components

### Core Components
- **CategorizationEngine** - Main orchestrator for email categorization
- **ImportanceAnalyzer** - Core importance analysis component
- **AnalyzerFactory** - Factory for creating analyzer instances
- **CacheManager** - In-memory caching layer for performance optimization
- **DatabaseManager** - SQLite-based data persistence layer
- **ImportanceRule[]** - Collection of configurable importance rules
- **Logger** - Centralized logging system

### Key Interfaces
- **EmailAnalysisContext** - Context object containing email data for analysis
- **ImportanceResult** - Result object containing analysis outcomes
- **RuleResult** - Individual rule evaluation result
- **ImportanceAnalyzerConfig** - Configuration for the analyzer

## Complete End-to-End Sequence Diagram

```mermaid
sequenceDiagram
    participant Client
    participant CE as CategorizationEngine
    participant AF as AnalyzerFactory
    participant IA as ImportanceAnalyzer
    participant CM as CacheManager
    participant DM as DatabaseManager
    participant Rules as ImportanceRule[]
    participant Logger

    Note over Client,Logger: Phase 1: System Initialization & Setup
    
    Client->>CE: new CategorizationEngine(dbManager, cacheManager, config)
    activate CE
    CE->>AF: new AnalyzerFactory(dbManager, cacheManager)
    activate AF
    CE->>AF: createImportanceAnalyzer(config)
    AF->>IA: new ImportanceAnalyzer(config, cacheManager, dbManager)
    activate IA
    
    IA->>IA: initializeRules()
    loop For each rule config in config.rules
        IA->>IA: createRuleFromConfig(ruleConfig)
        IA->>Rules: create ImportanceRule with evaluate function
        activate Rules
        Rules-->>IA: rule instance
        deactivate Rules
    end
    IA->>Logger: info("Rules initialized", {count: rules.length})
    AF-->>CE: importanceAnalyzer instance
    deactivate AF
    deactivate IA
    deactivate CE
    
    Note over Client,Logger: Phase 2: Email Categorization Request
    
    Client->>CE: categorizeEmails(options)
    activate CE
    CE->>DM: getEmailsForCategorization(options)
    activate DM
    alt forceRefresh = true
        DM->>DM: searchEmails({year: options.year})
    else forceRefresh = false
        DM->>DM: searchEmails({year: options.year, category: null})
    end
    DM-->>CE: EmailIndex[]
    deactivate DM
    
    loop For each email in emails
        CE->>CE: determineCategory(email)
        activate CE
        CE->>CE: createAnalysisContext(email)
        
        Note over CE: Validate required fields
        alt Missing subject
            CE->>Logger: warn("Email subject is missing")
            CE->>CE: throw Error("Email subject is missing")
        end
        alt Missing sender
            CE->>Logger: warn("Email sender is missing")
            CE->>CE: throw Error("Email sender is missing")
        end
        alt Missing snippet
            CE->>Logger: warn("Email snippet is missing")
            CE->>CE: throw Error("Email snippet is missing")
        end
        
        CE->>CE: orchestrateAnalysis(context)
        activate CE
        
        Note over Client,Logger: Phase 3: Importance Analysis Deep Dive
        
        alt Sequential Processing (default)
            CE->>IA: analyzeImportance(context)
            activate IA
        else Parallel Processing (if enabled)
            CE->>CE: runWithTimeout(() => IA.analyzeImportance(context), timeoutMs)
            activate CE
            CE->>IA: analyzeImportance(context)
            activate IA
            deactivate CE
        end
        
        IA->>IA: generateContextHash(context)
        activate IA
        alt keyStrategy = 'partial'
            IA->>IA: hash = `importance:${email.id}:${subject}:${sender}`
        else keyStrategy = 'full'
            IA->>IA: hash = `importance:${base64(JSON.stringify(context))}`
        end
        deactivate IA
        
        alt Caching enabled
            IA->>CM: get<ImportanceResult>(contextHash)
            activate CM
            alt Cache hit
                CM->>Logger: debug("Cache hit for key", contextHash)
                CM-->>IA: cached ImportanceResult
                IA->>Logger: debug("ImportanceAnalyzer: Cache hit")
                IA-->>CE: cached result
                deactivate CM
                deactivate IA
            else Cache miss
                CM->>Logger: debug("Cache miss for key", contextHash)
                CM-->>IA: null
                deactivate CM
            end
        end
        
        alt Cache miss or caching disabled
            IA->>IA: getApplicableRules(context)
            activate IA
            IA->>IA: return rules.sort((a, b) => b.priority - a.priority)
            IA-->>IA: sorted ImportanceRule[]
            deactivate IA
            
            Note over IA,Rules: Rule Evaluation Loop
            loop For each rule in applicableRules
                IA->>Rules: rule.evaluate(context)
                activate Rules
                Rules->>IA: evaluateRuleCondition(condition, context)
                activate IA
                
                alt condition.type = 'keyword'
                    IA->>IA: evaluateKeywordRule(condition, subject, snippet)
                    activate IA
                    IA->>IA: content = `${subject} ${snippet}`.toLowerCase()
                    IA->>Logger: debug("Evaluating keyword rule", {content, keywords})
                    loop For each keyword in condition.keywords
                        IA->>IA: regex = new RegExp(`\\b${escapedKeyword}\\b`, 'i')
                        IA->>IA: test regex against content
                    end
                    IA->>Logger: debug("Keyword matching result", {matchedKeywords})
                    alt matchedKeywords.length > 0
                        IA-->>IA: {matched: true, score: matchedKeywords.length * weight, reason}
                    else
                        IA-->>IA: {matched: false, score: 0}
                    end
                    deactivate IA
                    
                else condition.type = 'domain'
                    IA->>IA: evaluateDomainRule(condition, sender)
                    activate IA
                    loop For each domain in condition.domains
                        IA->>IA: check if sender.toLowerCase().includes(domain.toLowerCase())
                    end
                    alt matchedDomains.length > 0
                        IA-->>IA: {matched: true, score: weight, reason}
                    else
                        IA-->>IA: {matched: false, score: 0}
                    end
                    deactivate IA
                    
                else condition.type = 'label'
                    IA->>IA: evaluateLabelRule(condition, labels)
                    activate IA
                    IA->>Logger: debug("Evaluating label rule", {labels, ruleLabels})
                    loop For each ruleLabel in condition.labels
                        IA->>IA: check case-insensitive match in email labels
                    end
                    IA->>Logger: debug("Label matching result", {matchedLabels})
                    alt matchedLabels.length > 0
                        IA-->>IA: {matched: true, score: matchedLabels.length * weight, reason}
                    else
                        IA-->>IA: {matched: false, score: 0}
                    end
                    deactivate IA
                    
                else condition.type = 'noReply'
                    IA->>IA: evaluateNoReplyRule(condition, sender)
                    activate IA
                    IA->>Logger: debug("Evaluating no-reply rule", {sender})
                    IA->>IA: check sender against ['no-reply', 'noreply', 'no-reply']
                    IA->>Logger: debug("No-reply matching result", {matched})
                    alt matched
                        IA-->>IA: {matched: true, score: weight, reason: "No-reply sender detected"}
                    else
                        IA-->>IA: {matched: false, score: 0}
                    end
                    deactivate IA
                    
                else condition.type = 'largeAttachment'
                    IA->>IA: evaluateLargeAttachmentRule(condition, context)
                    activate IA
                    IA->>Logger: debug("Evaluating large attachment rule", {minSize, emailSize, hasAttachments})
                    IA->>IA: matched = emailSize > minSize && hasAttachments
                    IA->>Logger: debug("Large attachment matching result", {matched})
                    alt matched
                        IA-->>IA: {matched: true, score: weight, reason: `Large attachment: ${emailSize}MB`}
                    else
                        IA-->>IA: {matched: false, score: 0}
                    end
                    deactivate IA
                    
                else Unknown rule type
                    IA->>Logger: warn("Unknown rule type", {type: condition.type})
                    IA-->>IA: {matched: false, score: 0, reason: "Unknown rule type"}
                end
                
                deactivate IA
                Rules-->>IA: RuleResult{matched, score, reason}
                deactivate Rules
                
                alt result.matched = true
                    IA->>Logger: debug("Rule matched", {ruleId, ruleName, score})
                else Rule evaluation error
                    IA->>Logger: error("Rule evaluation failed", {ruleId, error})
                end
            end
            
            Note over IA: Score Calculation & Result Generation
            IA->>IA: calculateImportanceScore(ruleEvaluations)
            activate IA
            IA->>IA: sum scores from matched rules
            IA-->>IA: totalScore
            deactivate IA
            
            IA->>IA: determineImportanceLevel(score)
            activate IA
            alt score >= config.scoring.highThreshold
                IA-->>IA: 'high'
            else score <= config.scoring.lowThreshold
                IA-->>IA: 'low'
            else
                IA-->>IA: 'medium'
            end
            deactivate IA
            
            IA->>IA: calculateConfidence(ruleEvaluations)
            activate IA
            IA->>IA: baseConfidence = matchedRules / totalRules
            IA->>IA: priorityWeight = sum(matchedRulePriorities) / 100
            IA->>IA: confidence = Math.min(1, baseConfidence + priorityWeight)
            IA-->>IA: confidence
            deactivate IA
            
            IA->>IA: create ImportanceResult{score, level, matchedRules, confidence}
            
            Note over Client,Logger: Phase 4: Caching & Persistence
            
            alt Caching enabled
                IA->>CM: set(contextHash, result, 300)
                activate CM
                CM->>Logger: debug("Cached data for key", contextHash)
                deactivate CM
            end
            
            IA->>Logger: debug("Analysis complete", {level, score, matchedRules: matchedRules.length})
            IA-->>CE: ImportanceResult
            deactivate IA
        end
        
        CE->>CE: combineAnalysisResults(importance, dateSize, labelClassification)
        activate CE
        alt importance.level = 'high'
            CE-->>CE: PriorityCategory.HIGH
        else importance.level = 'low' && other factors don't override
            CE-->>CE: PriorityCategory.LOW
        else importance.level = 'medium'
            alt recent && important labels
                CE-->>CE: PriorityCategory.HIGH
            else spam/promotional
                CE-->>CE: PriorityCategory.LOW
            else
                CE-->>CE: PriorityCategory.MEDIUM
            end
        end
        deactivate CE
        
        CE->>CE: calculateOverallConfidence(importance, dateSize, labelClassification)
        CE->>CE: generateReasoning(importance, dateSize, labelClassification)
        CE-->>CE: CombinedAnalysisResult{finalCategory, confidence, reasoning}
        deactivate CE
        
        CE->>DM: upsertEmailIndex(email with category)
        activate DM
        DM->>DM: INSERT OR REPLACE INTO email_index
        alt Database success
            DM-->>CE: void
        else Database error
            DM->>Logger: error("Database update failed")
            DM-->>CE: throw error
        end
        deactivate DM
        
        alt Database error
            CE->>Logger: error("Category determination failed")
            CE-->>CE: return PriorityCategory.MEDIUM (fallback)
        end
        
        deactivate CE
    end
    
    Note over Client,Logger: Phase 5: Cleanup & Response
    
    CE->>CM: flush()
    activate CM
    CM->>CM: clear()
    CM->>Logger: info("Cache cleared")
    deactivate CM
    
    CE->>Logger: info("Categorization completed", {processed, categories})
    CE-->>Client: {processed: number, categories: {high, medium, low}}
    deactivate CE

    Note over Client,Logger: Error Handling Scenarios
    
    rect rgb(255, 200, 200)
        Note over IA,CM: Cache Operation Failures
        IA->>CM: get(contextHash)
        activate CM
        CM->>CM: cache operation fails
        CM->>Logger: error("Cache retrieval failed", {contextHash, error})
        CM-->>IA: null
        deactivate CM
        IA->>IA: continue with normal analysis flow
    end
    
    rect rgb(255, 200, 200)
        Note over CE,IA: Timeout Protection
        CE->>CE: runWithTimeout(analyzeImportance, timeoutMs, "ImportanceAnalyzer")
        activate CE
        CE->>Logger: debug("Starting ImportanceAnalyzer with timeout")
        
        alt Analysis completes within timeout
            CE->>IA: analyzeImportance(context)
            activate IA
            IA-->>CE: ImportanceResult
            deactivate IA
            CE->>Logger: debug("ImportanceAnalyzer completed successfully")
            CE-->>CE: result
        else Timeout exceeded
            CE->>Logger: error("ImportanceAnalyzer timed out after timeoutMs")
            CE-->>CE: throw Error("ImportanceAnalyzer timed out")
        end
        deactivate CE
    end
    
    rect rgb(255, 200, 200)
        Note over DM: Database Transaction Failures
        CE->>DM: upsertEmailIndex(email)
        activate DM
        DM->>DM: BEGIN TRANSACTION
        DM->>DM: INSERT OR REPLACE fails
        DM->>DM: ROLLBACK
        DM->>Logger: error("Database transaction failed")
        DM-->>CE: throw error
        deactivate DM
        CE->>Logger: error("Email categorization failed", {emailId, error})
        CE-->>CE: continue with next email
    end
```

## Rule Evaluation Details

### Rule Types and Evaluation Logic

#### 1. Keyword Rules (`type: 'keyword'`)
- **Purpose**: Matches important keywords in email subject and snippet
- **Logic**: Uses word boundary regex matching (`\b${keyword}\b`) for precise matching
- **Scoring**: `matchedKeywords.length * rule.weight`
- **Examples**: 'urgent', 'asap', 'important', 'critical', 'deadline'

#### 2. Domain Rules (`type: 'domain'`)
- **Purpose**: Identifies emails from important domains
- **Logic**: Case-insensitive substring matching in sender email
- **Scoring**: `rule.weight` for any domain match
- **Examples**: 'company.com', 'client.com'

#### 3. Label Rules (`type: 'label'`)
- **Purpose**: Evaluates Gmail labels for importance indicators
- **Logic**: Case-insensitive exact matching of label names
- **Scoring**: `matchedLabels.length * rule.weight`
- **Examples**: 'important', 'automated', 'promotional', 'spam'

#### 4. No-Reply Rules (`type: 'noReply'`)
- **Purpose**: Identifies automated/no-reply senders (typically low priority)
- **Logic**: Pattern matching against known no-reply indicators
- **Scoring**: `rule.weight` (usually negative)
- **Patterns**: 'no-reply', 'noreply', 'no-reply'

#### 5. Large Attachment Rules (`type: 'largeAttachment'`)
- **Purpose**: Considers email size and attachment presence
- **Logic**: Checks if `emailSize > minSize && hasAttachments`
- **Scoring**: `rule.weight`
- **Default**: minSize = 1MB

## Caching Strategy

### Cache Key Generation
- **Partial Strategy**: `importance:${email.id}:${subject}:${sender}`
- **Full Strategy**: `importance:${base64(JSON.stringify(fullContext))}`

### Cache Configuration
- **TTL**: 300 seconds (5 minutes)
- **Storage**: In-memory Map-based cache
- **Expiration**: Automatic cleanup on access

### Cache Operations
1. **Cache Hit**: Return cached `ImportanceResult` immediately
2. **Cache Miss**: Perform full analysis and cache result
3. **Cache Error**: Log error and continue with analysis

## Performance Optimizations

### Rule Processing
- **Priority Sorting**: Rules sorted by priority (high to low)
- **Early Termination**: Could be implemented for high-confidence matches
- **Parallel Processing**: Optional parallel execution of analyzers

### Timeout Protection
- **Default Timeout**: Configurable per analyzer
- **Timeout Handling**: Graceful degradation with error logging
- **Fallback**: Return medium priority on timeout

### Metrics Tracking
- **Processing Time**: Total and per-analyzer timing
- **Cache Performance**: Hit/miss ratios
- **Rule Evaluation**: Count of rules processed

## Error Handling

### Rule Evaluation Errors
- **Strategy**: Log error and continue with remaining rules
- **Impact**: Partial analysis results still usable
- **Recovery**: Graceful degradation

### Cache Failures
- **Strategy**: Log error and proceed without caching
- **Impact**: Performance degradation but functional
- **Recovery**: Automatic retry on next request

### Database Errors
- **Strategy**: Transaction rollback and error logging
- **Impact**: Email categorization may fail
- **Recovery**: Continue with next email, fallback category

### Timeout Scenarios
- **Strategy**: Interrupt analysis and return timeout error
- **Impact**: Analysis incomplete
- **Recovery**: Fallback to medium priority category

## Configuration

### Default Rule Configuration
```typescript
{
  rules: [
    {
      id: 'high-priority-keywords',
      type: 'keyword',
      priority: 100,
      weight: 10,
      keywords: ['urgent', 'asap', 'important', 'critical', 'deadline']
    },
    {
      id: 'important-domains',
      type: 'domain',
      priority: 90,
      weight: 8,
      domains: ['company.com', 'client.com']
    }
    // ... more rules
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
```

### Scoring Thresholds
- **High Priority**: score >= 8
- **Low Priority**: score <= -3
- **Medium Priority**: -3 < score < 8

## Integration Points

### CategorizationEngine Integration
- **Factory Pattern**: Created via `AnalyzerFactory`
- **Orchestration**: Part of multi-analyzer pipeline
- **Result Combination**: Combined with DateSize and Label analysis

### Database Integration
- **Email Storage**: Results stored in `email_index` table
- **Batch Processing**: Supports bulk email categorization
- **Transaction Safety**: ACID compliance for data integrity

### Cache Integration
- **Shared Cache**: Uses system-wide `CacheManager`
- **Key Namespacing**: Prefixed with 'importance:'
- **TTL Management**: Automatic expiration handling

## Monitoring and Debugging

### Logging Levels
- **DEBUG**: Cache hits/misses, rule matching details
- **INFO**: Analysis completion, rule initialization
- **WARN**: Missing email fields, unknown rule types
- **ERROR**: Rule evaluation failures, cache/database errors

### Performance Metrics
- **Total Processing Time**: End-to-end analysis duration
- **Rule Evaluation Count**: Number of rules processed
- **Cache Hit Ratio**: Caching effectiveness
- **Error Rate**: Failure frequency

### Debug Information
- **Context Hash**: For cache debugging
- **Matched Rules**: Which rules triggered
- **Score Breakdown**: How final score was calculated
- **Confidence Factors**: Confidence calculation details

## Future Enhancements

### Potential Optimizations
1. **Smart Rule Filtering**: Pre-filter rules based on context
2. **Machine Learning**: ML-based importance scoring
3. **Adaptive Thresholds**: Dynamic threshold adjustment
4. **Rule Performance**: Track and optimize slow rules
5. **Batch Caching**: Cache multiple results together

### Scalability Considerations
1. **Distributed Caching**: Redis/Memcached integration
2. **Database Sharding**: Horizontal scaling support
3. **Async Processing**: Non-blocking rule evaluation
4. **Rule Compilation**: Pre-compile regex patterns
5. **Memory Management**: Efficient rule storage

This comprehensive sequence diagram provides complete visibility into the [`ImportanceAnalyzer`](../src/categorization/analyzers/ImportanceAnalyzer.ts) implementation, showing every interaction, decision point, and data flow in the email importance analysis process.