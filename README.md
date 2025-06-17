# Gmail MCP Server

A Model Context Protocol (MCP) server that integrates with Gmail API to provide intelligent email management capabilities including categorization, search, archiving, deletion, and automated cleanup features.

## Features

- **Email Categorization**: Automatically categorize emails by importance (high/medium/low) using advanced analysis
- **Advanced Search**: Search emails with multiple filters and save frequent searches
- **Smart Archiving**: Archive emails based on rules with export capabilities
- **Safe Deletion**: Delete emails with confirmation and dry-run options
- **Automated Cleanup**: Continuous cleanup automation with configurable policies
- **Access Pattern Tracking**: Track email access patterns for intelligent cleanup decisions
- **Statistics**: Get detailed statistics about your email usage
- **Job Management**: Background job processing for long-running operations

## Prerequisites

- Node.js 18+ and npm
- A Google Cloud Platform account
- Gmail API enabled in your GCP project
- OAuth2 credentials

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd gmail-mcp-server
```

2. Run the setup script:
```bash
npm run setup
```

This will guide you through:
- Setting up Google Cloud credentials
- Creating necessary directories
- Copying environment configuration

3. Install dependencies:
```bash
npm install
```

4. Build the project:
```bash
npm run build
```

### Manual Setup (Alternative)

If you prefer manual setup:

1. Set up Google Cloud credentials:
   - Go to [Google Cloud Console](https://console.cloud.google.com)
   - Create a new project or select existing
   - Enable Gmail API
   - Create OAuth2 credentials (Desktop application type)
   - Download credentials as `credentials.json`
   - Place in project root

2. Configure environment:
```bash
cp .env.example .env
# Edit .env with your settings
```

3. Create necessary directories:
```bash
mkdir -p data logs archives
```

## Usage

### Starting the Server

```bash
npm start
```

### MCP Client Configuration

For Claude Desktop, add to your MCP settings:

```json
{
  "mcpServers": {
    "gmail": {
      "command": "node",
      "args": ["/path/to/gmail-mcp-server/build/index.js"],
      "env": {
        "NODE_ENV": "production"
      }
    }
  }
}
```

## Available MCP Tools

### Authentication Tools

#### `authenticate`
Initialize Gmail authentication and establish connection.

**Purpose**: Authenticate with Gmail API using OAuth2 flow
**Parameters**: None
**Returns**: Authentication status and user information

```json
{
  "tool": "authenticate"
}
```

### Email Management Tools

#### `list_emails`
List emails with various filtering options.

**Purpose**: Retrieve emails with pagination and filtering
**Parameters**:
- `limit` (number): Maximum number of emails to return
- `year` (number): Filter by specific year
- `category` (string): Filter by importance category
- `labels` (array): Filter by Gmail labels
- `hasAttachments` (boolean): Filter by attachment presence

```json
{
  "tool": "list_emails",
  "arguments": {
    "limit": 50,
    "year": 2024,
    "category": "high"
  }
}
```

#### `get_email_details`
Get detailed information about a specific email.

**Purpose**: Retrieve full email content and metadata
**Parameters**:
- `email_id` (string): Gmail message ID

```json
{
  "tool": "get_email_details",
  "arguments": {
    "email_id": "message_id_here"
  }
}
```

### Search Tools

#### `search_emails`
Advanced email search with multiple criteria.

**Purpose**: Search emails using complex filters and queries
**Parameters**:
- `query` (string): Text search query
- `year_range` (object): Date range filter
- `size_range` (object): Size range filter
- `labels` (array): Label filters
- `category` (string): Importance category
- `hasAttachments` (boolean): Attachment filter
- `limit` (number): Result limit

```json
{
  "tool": "search_emails",
  "arguments": {
    "query": "important project",
    "year_range": { "start": 2023, "end": 2024 },
    "size_range": { "min": 1048576 },
    "category": "high",
    "limit": 100
  }
}
```

### Categorization Tools

#### `categorize_emails`
Categorize emails by importance using AI analysis.

**Purpose**: Analyze and categorize emails into high/medium/low importance
**Parameters**:
- `force_refresh` (boolean): Force re-categorization of existing emails
- `year` (number): Categorize emails from specific year
- `limit` (number): Maximum emails to categorize

```json
{
  "tool": "categorize_emails",
  "arguments": {
    "force_refresh": true,
    "year": 2024
  }
}
```

#### `get_categorization_status`
Get status of ongoing categorization jobs.

**Purpose**: Monitor categorization job progress
**Parameters**: None

```json
{
  "tool": "get_categorization_status"
}
```

### Statistics Tools

#### `get_email_stats`
Get comprehensive email statistics.

**Purpose**: Retrieve detailed statistics about email usage
**Parameters**:
- `group_by` (string): Grouping method (year, category, label, all)
- `year` (number): Filter by specific year

```json
{
  "tool": "get_email_stats",
  "arguments": {
    "group_by": "category"
  }
}
```

### Archive Tools

#### `archive_emails`
Archive emails based on criteria.

**Purpose**: Archive old or large emails to free up space
**Parameters**:
- `year` (number): Archive emails from specific year
- `category` (string): Archive by importance category
- `size_threshold` (number): Archive emails larger than threshold
- `method` (string): Archive method (move, export, delete)
- `export_format` (string): Export format (mbox, json, csv)
- `dry_run` (boolean): Preview without actual archiving

```json
{
  "tool": "archive_emails",
  "arguments": {
    "year": 2022,
    "size_threshold": 5242880,
    "method": "export",
    "export_format": "mbox",
    "dry_run": false
  }
}
```

#### `restore_emails`
Restore previously archived emails.

**Purpose**: Restore emails from archive back to Gmail
**Parameters**:
- `archive_id` (string): Archive identifier
- `email_ids` (array): Specific email IDs to restore

```json
{
  "tool": "restore_emails",
  "arguments": {
    "archive_id": "archive_2022_01"
  }
}
```

#### `create_archive_rule`
Create automatic archiving rules.

**Purpose**: Set up automated archiving based on criteria
**Parameters**:
- `name` (string): Rule name
- `criteria` (object): Archiving criteria
- `schedule` (string): Execution schedule
- `enabled` (boolean): Rule status

```json
{
  "tool": "create_archive_rule",
  "arguments": {
    "name": "Archive Old Large Emails",
    "criteria": {
      "age_days": 365,
      "size_threshold": 10485760
    },
    "schedule": "weekly",
    "enabled": true
  }
}
```

#### `list_archive_rules`
List all archive rules.

**Purpose**: View all configured archive rules
**Parameters**: None

```json
{
  "tool": "list_archive_rules"
}
```

#### `export_emails`
Export emails to various formats.

**Purpose**: Export emails for backup or migration
**Parameters**:
- `format` (string): Export format (mbox, json, csv, eml)
- `criteria` (object): Email selection criteria
- `output_path` (string): Export destination

```json
{
  "tool": "export_emails",
  "arguments": {
    "format": "mbox",
    "criteria": {
      "year": 2023,
      "category": "low"
    }
  }
}
```

### Deletion Tools

#### `delete_emails`
Safely delete emails with confirmation.

**Purpose**: Delete emails with safety checks and confirmation
**Parameters**:
- `criteria` (object): Deletion criteria
- `category` (string): Delete by importance category
- `dry_run` (boolean): Preview without actual deletion
- `max_count` (number): Maximum emails to delete [TODO]

```json
{
  "tool": "delete_emails",
  "arguments": {
    "category": "low",
    "dry_run": true,
    "max_count": 100
  }
}
```

#### `empty_trash`
Empty Gmail trash folder permanently.
**Purpose**: Permanently delete all emails in the trash
**Parameters**: 
- `max_count` (number): Maximum emails to delete
- `dry_run` (boolean): Preview without actual deletion
```json
{
  "tool": "empty_trash",
  "arguments": {
    "confirm": true,
    "max_count": 100
  }
}
```

### Cleanup Automation Tools

#### `start_cleanup_automation` [TODO]
Start automated cleanup processes.

**Purpose**: Begin continuous cleanup automation
**Parameters**:
- `policies` (array): Cleanup policies to enable
- `schedule` (string): Cleanup schedule

```json
{
  "tool": "start_cleanup_automation",
  "arguments": {
    "policies": ["old_emails", "large_attachments"],
    "schedule": "daily"
  }
}
```

#### `stop_cleanup_automation` [TODO]
Stop automated cleanup processes.

**Purpose**: Halt all cleanup automation
**Parameters**: None

```json
{
  "tool": "stop_cleanup_automation"
}
```

#### `get_cleanup_status`
Get status of cleanup operations.

**Purpose**: Monitor cleanup job progress and results
**Parameters**: None

```json
{
  "tool": "get_cleanup_status"
}
```

### Job Management Tools

#### `list_jobs`
List all background jobs.

**Purpose**: View status of all background processing jobs
**Parameters**:
- `status` (string): Filter by job status
- `type` (string): Filter by job type

```json
{
  "tool": "list_jobs",
  "arguments": {
    "status": "running"
  }
}
```

#### `get_job_status`
Get detailed status of a specific job.

**Purpose**: Monitor individual job progress
**Parameters**:
- `job_id` (string): Job identifier

```json
{
  "tool": "get_job_status",
  "arguments": {
    "job_id": "cleanup_continuous_1234567890"
  }
}
```

#### `cancel_job`
Cancel a running job.

**Purpose**: Stop a background job
**Parameters**:
- `job_id` (string): Job identifier

```json
{
  "tool": "cancel_job",
  "arguments": {
    "job_id": "categorization_job_1234567890"
  }
}
```

## Example Workflows

### Initial Setup
```json
// 1. Authenticate
{
  "tool": "authenticate"
}

// 2. Categorize all emails
{
  "tool": "categorize_emails",
  "arguments": {
    "force_refresh": true
  }
}

// 3. View statistics
{
  "tool": "get_email_stats",
  "arguments": {
    "group_by": "all"
  }
}
```

### Clean Up Old Emails
```json
// 1. Search for old large emails
{
  "tool": "search_emails",
  "arguments": {
    "year_range": { "end": 2022 },
    "size_range": { "min": 5242880 }
  }
}

// 2. Archive them
{
  "tool": "archive_emails",
  "arguments": {
    "year": 2022,
    "size_threshold": 5242880,
    "method": "export",
    "export_format": "mbox"
  }
}
```

### Automated Cleanup Setup
```json
// 1. Start cleanup automation [TODO]
{
  "tool": "start_cleanup_automation",
  "arguments": {
    "policies": ["old_emails", "large_attachments"],
    "schedule": "daily"
  }
}

// 2. Monitor cleanup status
{
  "tool": "get_cleanup_status"
}
```

## Development

### Project Structure
```
gmail-mcp-server/
├── src/
│   ├── auth/           # Authentication management
│   ├── cache/          # Caching layer
│   ├── categorization/ # Email categorization engine
│   ├── cleanup/        # Cleanup automation
│   ├── database/       # SQLite database management
│   ├── delete/         # Email deletion logic
│   ├── email/          # Email fetching and processing
│   ├── search/         # Search functionality
│   ├── archive/        # Archive management
│   ├── tools/          # MCP tool definitions
│   ├── types/          # TypeScript type definitions
│   └── utils/          # Utility functions
├── build/              # Compiled JavaScript
├── data/               # Local storage
├── logs/               # Application logs
└── archives/           # Email archives
```

### Running in Development
```bash
npm run watch  # Watch mode for TypeScript
npm run dev    # Run with tsx (hot reload)
```

### Testing with MCP Inspector
```bash
npm run inspector
```

## Testing

The project includes comprehensive test suites to ensure reliability and correctness of all features.

### Running Tests
```bash
# Run all tests
npm test

# Run with coverage
npm test -- --coverage

# Run specific test suite
npm test -- --testPathPattern=delete
```

### Integration Tests

#### Delete Email Tests
The delete functionality has extensive integration tests covering all scenarios:

```bash
# Run delete integration tests with the dedicated runner
node scripts/test-delete-integration.js

# With coverage report
node scripts/test-delete-integration.js --coverage

# Run specific test scenarios
node scripts/test-delete-integration.js --filter "delete by category"
```

For detailed information about delete email testing, see [Delete Email Testing Documentation](docs/DELETE_EMAIL_TESTING.md).

### Test Structure
```
tests/
├── unit/               # Unit tests for individual components
├── integration/        # Integration tests for complete features
│   └── delete/        # Delete email integration tests
├── fixtures/          # Shared test data
└── setup.ts          # Test environment setup
```

### Writing Tests
- Follow the existing test patterns
- Use descriptive test names
- Mock external dependencies
- Test both success and error cases
- Maintain test coverage above 80%

## Security

- OAuth2 tokens are encrypted at rest
- All bulk operations require confirmation
- Audit logging for all operations
- Rate limiting implemented for Gmail API
- Access pattern tracking for security monitoring

## Troubleshooting

### Authentication Issues
- Ensure credentials.json is in the correct location
- Check that Gmail API is enabled in GCP
- Verify redirect URI matches your configuration

### Performance
- First categorization may take time for large mailboxes
- Use pagination for large result sets
- Enable caching in production

## License

MIT

## Contributing

Contributions are welcome! Please read our contributing guidelines before submitting PRs.