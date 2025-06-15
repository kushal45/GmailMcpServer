# Gmail MCP Server - Email Cleanup System API Reference

## Overview

The Email Cleanup System provides a comprehensive set of MCP tools for automated email management, policy-based cleanup, and system monitoring. This reference documents all available tools, their parameters, and usage patterns.

## Quick Navigation

- [Policy Management Tools](#policy-management-tools)
- [Automation Control Tools](#automation-control-tools)
- [Monitoring & Health Tools](#monitoring--health-tools)
- [Scheduling Tools](#scheduling-tools)
- [Core Delete Tools](#core-delete-tools)
- [Error Handling](#error-handling)
- [Integration Patterns](#integration-patterns)

---

## Policy Management Tools

### `create_cleanup_policy`

Creates a new email cleanup policy with configurable criteria and actions.

**Parameters:**

```typescript
{
  name: string;                    // Policy display name
  enabled?: boolean;               // Default: true
  priority?: number;               // 0-100, default: 50
  criteria: {
    age_days_min: number;          // Minimum age in days
    importance_level_max: 'high' | 'medium' | 'low';
    size_threshold_min?: number;   // Minimum size in bytes
    spam_score_min?: number;       // 0-1, minimum spam score
    promotional_score_min?: number; // 0-1, minimum promotional score
    access_score_max?: number;     // 0-1, maximum access score
    no_access_days?: number;       // Days without access
  };
  action: {
    type: 'archive' | 'delete';
    method?: 'gmail' | 'export';
    export_format?: 'mbox' | 'json';
  };
  safety: {
    max_emails_per_run: number;
    require_confirmation: boolean;
    dry_run_first: boolean;
    preserve_important: boolean;
  };
  schedule?: {
    frequency: 'continuous' | 'daily' | 'weekly' | 'monthly';
    time?: string;                 // HH:MM format
    enabled: boolean;
  };
}
```

**Example Request:**

```json
{
  "tool": "create_cleanup_policy",
  "arguments": {
    "name": "Aggressive Spam Cleanup",
    "enabled": true,
    "priority": 80,
    "criteria": {
      "age_days_min": 30,
      "importance_level_max": "low",
      "spam_score_min": 0.8,
      "no_access_days": 60
    },
    "action": {
      "type": "delete",
      "method": "gmail"
    },
    "safety": {
      "max_emails_per_run": 100,
      "require_confirmation": false,
      "dry_run_first": true,
      "preserve_important": true
    },
    "schedule": {
      "frequency": "daily",
      "time": "02:00",
      "enabled": true
    }
  }
}
```

**Response:**

```json
{
  "policyId": "policy_1703123456789_abc123",
  "message": "Cleanup policy created successfully"
}
```

**Use Cases:**
- Creating spam removal policies
- Setting up promotional email cleanup
- Configuring size-based cleanup rules
- Establishing automated maintenance schedules

---

### `update_cleanup_policy`

Updates an existing cleanup policy with new configuration.

**Parameters:**

```typescript
{
  policy_id: string;               // Policy ID to update
  updates: Partial<CleanupPolicy>; // Fields to update
}
```

**Example Request:**

```json
{
  "tool": "update_cleanup_policy",
  "arguments": {
    "policy_id": "policy_1703123456789_abc123",
    "updates": {
      "enabled": false,
      "criteria": {
        "age_days_min": 45,
        "spam_score_min": 0.9
      }
    }
  }
}
```

**Response:**

```json
{
  "message": "Cleanup policy updated successfully"
}
```

---

### `list_cleanup_policies`

Retrieves all cleanup policies or only active ones.

**Parameters:**

```typescript
{
  active_only?: boolean;           // Default: false
}
```

**Response:**

```json
[
  {
    "id": "policy_1703123456789_abc123",
    "name": "Aggressive Spam Cleanup",
    "enabled": true,
    "priority": 80,
    "criteria": { /* ... */ },
    "action": { /* ... */ },
    "safety": { /* ... */ },
    "schedule": { /* ... */ },
    "created_at": "2024-12-20T10:30:00Z",
    "updated_at": "2024-12-20T10:30:00Z"
  }
]
```

---

### `delete_cleanup_policy`

Permanently removes a cleanup policy.

**Parameters:**

```typescript
{
  policy_id: string;               // Policy ID to delete
}
```

**Response:**

```json
{
  "message": "Cleanup policy deleted successfully"
}
```

---

## Automation Control Tools

### `trigger_cleanup`

Manually triggers cleanup execution for a specific policy.

**Parameters:**

```typescript
{
  policy_id: string;               // Policy to execute
  dry_run?: boolean;               // Default: false
  max_emails?: number;             // Override policy limit
  force?: boolean;                 // Execute even if disabled
}
```

**Example Request:**

```json
{
  "tool": "trigger_cleanup",
  "arguments": {
    "policy_id": "policy_1703123456789_abc123",
    "dry_run": true,
    "max_emails": 50
  }
}
```

**Response:**

```json
{
  "jobId": "cleanup_manual_1703123456789_xyz789",
  "message": "Cleanup job triggered successfully"
}
```

**Integration Pattern:**

```typescript
// Trigger cleanup and monitor progress
const response = await mcpClient.callTool('trigger_cleanup', {
  policy_id: 'policy_123',
  dry_run: false,
  max_emails: 100
});

const jobId = response.jobId;

// Monitor job progress
const status = await mcpClient.callTool('get_job_status', {
  id: jobId
});
```

---

### `get_cleanup_status`

Retrieves the current state of the cleanup automation system.

**Parameters:** None

**Response:**

```json
{
  "continuous_cleanup_running": true,
  "scheduled_jobs_count": 3,
  "active_policies_count": 5,
  "last_cleanup_time": "2024-12-20T02:00:00Z",
  "next_scheduled_cleanup": "2024-12-21T02:00:00Z",
  "system_health": {
    "storage_usage_percent": 75.5,
    "average_query_time_ms": 150,
    "cache_hit_rate": 0.85
  }
}
```

---

### `update_cleanup_automation_config`

Updates the global automation configuration.

**Parameters:**

```typescript
{
  config: {
    continuous_cleanup?: {
      enabled: boolean;
      target_emails_per_minute: number;
      max_concurrent_operations: number;
      pause_during_peak_hours: boolean;
      peak_hours: { start: string; end: string };
    };
    event_triggers?: {
      storage_threshold: {
        enabled: boolean;
        warning_threshold_percent: number;
        critical_threshold_percent: number;
        emergency_policies: string[];
      };
      performance_threshold: {
        enabled: boolean;
        query_time_threshold_ms: number;
        cache_hit_rate_threshold: number;
      };
      email_volume_threshold: {
        enabled: boolean;
        daily_email_threshold: number;
        immediate_cleanup_policies: string[];
      };
    };
  }
}
```

**Example Request:**

```json
{
  "tool": "update_cleanup_automation_config",
  "arguments": {
    "config": {
      "continuous_cleanup": {
        "enabled": true,
        "target_emails_per_minute": 10,
        "max_concurrent_operations": 3,
        "pause_during_peak_hours": true,
        "peak_hours": { "start": "09:00", "end": "17:00" }
      },
      "event_triggers": {
        "storage_threshold": {
          "enabled": true,
          "warning_threshold_percent": 80,
          "critical_threshold_percent": 95,
          "emergency_policies": ["policy_emergency_cleanup"]
        }
      }
    }
  }
}
```

---

## Monitoring & Health Tools

### `get_system_health`

Retrieves current system health metrics and status.

**Parameters:** None

**Response:**

```json
{
  "storage_usage_percent": 75.5,
  "average_query_time_ms": 150,
  "cache_hit_rate": 0.85,
  "status": "healthy",
  "warnings": [],
  "errors": [],
  "last_check": "2024-12-20T15:30:00Z"
}
```

**Status Values:**
- `"healthy"` - All systems operating normally
- `"warning"` - Some metrics approaching thresholds
- `"critical"` - Immediate attention required

---

### `get_cleanup_metrics`

Retrieves cleanup system metrics and performance data.

**Parameters:**

```typescript
{
  hours?: number;                  // Hours of history, default: 24
}
```

**Response:**

```json
[
  {
    "timestamp": "2024-12-20T15:00:00Z",
    "storage_usage_percent": 75.5,
    "storage_used_bytes": 750000000,
    "storage_total_bytes": 1000000000,
    "average_query_time_ms": 150,
    "cache_hit_rate": 0.85,
    "active_connections": 1,
    "cleanup_rate_per_minute": 10,
    "system_load_average": 0.5
  }
]
```

**Monitoring Integration Example:**

```typescript
// Set up continuous monitoring
setInterval(async () => {
  const health = await mcpClient.callTool('get_system_health');
  const metrics = await mcpClient.callTool('get_cleanup_metrics', { hours: 1 });
  
  // Send to monitoring dashboard
  dashboard.updateMetrics({
    health: health,
    metrics: metrics
  });
  
  // Alert on critical status
  if (health.status === 'critical') {
    alerting.sendAlert('Cleanup system critical', health.errors);
  }
}, 60000); // Check every minute
```

---

## Scheduling Tools

### `create_cleanup_schedule`

Creates a new automated cleanup schedule.

**Parameters:**

```typescript
{
  name: string;                    // Schedule display name
  type: 'daily' | 'weekly' | 'monthly' | 'interval' | 'cron';
  expression: string;              // Schedule expression
  policy_id: string;               // Policy to execute
  enabled?: boolean;               // Default: true
}
```

**Schedule Expression Formats:**

| Type | Format | Example |
|------|--------|---------|
| `daily` | `HH:MM` | `"02:30"` |
| `weekly` | `day:HH:MM` or `daynum:HH:MM` | `"sunday:02:30"` or `"0:02:30"` |
| `monthly` | `DD:HH:MM` | `"15:02:30"` (15th day) |
| `interval` | `milliseconds` | `"3600000"` (1 hour) |
| `cron` | `minute hour day month dayOfWeek` | `"30 2 * * 0"` |

**Example Request:**

```json
{
  "tool": "create_cleanup_schedule",
  "arguments": {
    "name": "Weekly Large Email Cleanup",
    "type": "weekly",
    "expression": "sunday:03:00",
    "policy_id": "policy_large_cleanup",
    "enabled": true
  }
}
```

**Response:**

```json
{
  "scheduleId": "schedule_1703123456789_def456",
  "message": "Cleanup schedule created successfully"
}
```

---

## Core Delete Tools

### `delete_emails`

Direct email deletion with safety checks (enhanced for cleanup system).

**Parameters:**

```typescript
{
  search_criteria?: SearchCriteria;
  category?: 'high' | 'medium' | 'low';
  year?: number;
  size_threshold?: number;
  skip_archived?: boolean;         // Default: true
  dry_run?: boolean;               // Default: false
  confirm?: boolean;               // Required for actual deletion
}
```

**Enhanced Safety Features:**
- Automatic importance level protection
- Access pattern consideration
- Staleness score validation
- Batch processing with failure tolerance

**Example Request:**

```json
{
  "tool": "delete_emails",
  "arguments": {
    "category": "low",
    "year": 2022,
    "size_threshold": 1048576,
    "dry_run": false,
    "confirm": true
  }
}
```

---

### `get_cleanup_recommendations`

Generates intelligent cleanup policy recommendations based on email analysis.

**Parameters:** None

**Response:**

```json
{
  "recommended_policies": [
    {
      "name": "Spam Email Cleanup",
      "description": "Remove emails identified as spam or junk",
      "criteria": {
        "age_days_min": 30,
        "importance_level_max": "low",
        "spam_score_min": 0.7
      },
      "estimated_cleanup_count": 450,
      "estimated_storage_freed": 22500000
    }
  ],
  "analysis_summary": {
    "total_emails": 15000,
    "spam_emails": 450,
    "promotional_emails": 800,
    "old_emails": 5000,
    "large_emails": 200
  }
}
```

---

## Error Handling

### Error Response Format

All tools return errors in a consistent format:

```json
{
  "error": {
    "code": "INVALID_PARAMS",
    "message": "Policy ID is required",
    "details": {
      "tool": "trigger_cleanup",
      "missing_parameter": "policy_id"
    }
  }
}
```

### Common Error Codes

| Code | Description | Common Causes |
|------|-------------|---------------|
| `INVALID_PARAMS` | Invalid or missing parameters | Required fields missing, invalid types |
| `NOT_AUTHENTICATED` | User not authenticated | OAuth token expired or invalid |
| `POLICY_NOT_FOUND` | Policy doesn't exist | Invalid policy ID |
| `SYSTEM_UNAVAILABLE` | Cleanup system offline | Database connection issues |
| `RATE_LIMITED` | Too many requests | Exceeding API limits |
| `SAFETY_CHECK_FAILED` | Safety validation failed | Attempting to delete protected emails |

### Error Handling Patterns

```typescript
try {
  const result = await mcpClient.callTool('trigger_cleanup', {
    policy_id: 'invalid-id'
  });
} catch (error) {
  switch (error.code) {
    case 'POLICY_NOT_FOUND':
      console.log('Policy does not exist');
      break;
    case 'NOT_AUTHENTICATED':
      await reauthenticate();
      break;
    default:
      console.error('Unexpected error:', error);
  }
}
```

---

## Integration Patterns

### Event-Driven Cleanup

```typescript
// Monitor system health and trigger cleanup
const monitorAndCleanup = async () => {
  const health = await mcpClient.callTool('get_system_health');
  
  if (health.storage_usage_percent > 90) {
    // Trigger emergency cleanup
    await mcpClient.callTool('trigger_cleanup', {
      policy_id: 'emergency_policy',
      force: true
    });
  }
};
```

### Batch Policy Management

```typescript
// Create multiple related policies
const createSpamCleanupPolicies = async () => {
  const policies = [
    {
      name: 'High Confidence Spam',
      criteria: { spam_score_min: 0.9, age_days_min: 7 }
    },
    {
      name: 'Medium Confidence Spam',
      criteria: { spam_score_min: 0.7, age_days_min: 30 }
    }
  ];
  
  for (const policy of policies) {
    await mcpClient.callTool('create_cleanup_policy', {
      ...policy,
      action: { type: 'delete', method: 'gmail' },
      safety: { max_emails_per_run: 100, preserve_important: true }
    });
  }
};
```

### Custom Monitoring Dashboard

```typescript
// Real-time dashboard integration
class CleanupDashboard {
  async refreshMetrics() {
    const [status, health, metrics] = await Promise.all([
      mcpClient.callTool('get_cleanup_status'),
      mcpClient.callTool('get_system_health'),
      mcpClient.callTool('get_cleanup_metrics', { hours: 24 })
    ]);
    
    this.updateUI({
      status,
      health,
      metrics,
      timestamp: new Date()
    });
  }
  
  async executeCleanup(policyId: string) {
    const jobId = await mcpClient.callTool('trigger_cleanup', {
      policy_id: policyId,
      dry_run: false
    });
    
    return this.monitorJob(jobId);
  }
}
```

---

## Performance Considerations

### Batch Operations

- Use `max_emails` parameter to control batch sizes
- Monitor system health during large operations
- Implement exponential backoff for failed operations

### Rate Limiting

- Respect Gmail API quotas (250 quota units per user per second)
- Use `dry_run` for testing and validation
- Implement proper error handling and retries

### Resource Management

- Monitor storage usage with `get_system_health`
- Use appropriate `target_emails_per_minute` settings
- Consider peak hours configuration

---

## Migration and Compatibility

### Version Compatibility

The Email Cleanup System is compatible with:
- Gmail MCP Server v0.1.0+
- Node.js 18+
- SQLite 3.x

### Data Migration

When updating policies, existing cleanup history is preserved. Use the following pattern for safe updates:

```typescript
// Safe policy update pattern
const updatePolicyWithBackup = async (policyId: string, updates: any) => {
  // Get current policy
  const policies = await mcpClient.callTool('list_cleanup_policies');
  const currentPolicy = policies.find(p => p.id === policyId);
  
  // Store backup
  const backup = { ...currentPolicy };
  
  try {
    // Apply updates
    await mcpClient.callTool('update_cleanup_policy', {
      policy_id: policyId,
      updates
    });
  } catch (error) {
    // Restore from backup if needed
    console.error('Update failed, policy preserved:', error);
    throw error;
  }
};
```

---

## Support and Troubleshooting

### Debug Mode

Enable detailed logging by setting the tool context:

```typescript
const debugContext = {
  debug: true,
  logLevel: 'DEBUG'
};

const result = await mcpClient.callTool('trigger_cleanup', args, debugContext);
```

### Health Checks

Regular health monitoring:

```typescript
const performHealthCheck = async () => {
  const health = await mcpClient.callTool('get_system_health');
  
  if (health.status !== 'healthy') {
    console.warn('System health issues detected:', health.warnings);
    
    if (health.status === 'critical') {
      console.error('Critical system issues:', health.errors);
      // Implement emergency procedures
    }
  }
  
  return health;
};
```

For additional support, see the [User Guide](EMAIL_CLEANUP_SYSTEM_USER_GUIDE.md) and [Deployment Guide](EMAIL_CLEANUP_SYSTEM_DEPLOYMENT.md).