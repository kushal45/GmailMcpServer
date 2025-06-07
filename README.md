# Gmail MCP Server

A Model Context Protocol (MCP) server that integrates with Gmail API to provide intelligent email management capabilities including categorization, search, archiving, and deletion features.

## Features

- **Email Categorization**: Automatically categorize emails by importance (high/medium/low)
- **Advanced Search**: Search emails with multiple filters and save frequent searches
- **Smart Archiving**: Archive emails based on rules with export capabilities
- **Safe Deletion**: Delete emails with confirmation and dry-run options
- **Statistics**: Get detailed statistics about your email usage

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

### Available Tools

1. **authenticate** - Initialize Gmail authentication
2. **list_emails** - List emails with filters
3. **search_emails** - Advanced email search
4. **categorize_emails** - Categorize emails by importance
5. **get_email_stats** - Get email statistics
6. **archive_emails** - Archive emails
7. **restore_emails** - Restore archived emails
8. **create_archive_rule** - Create automatic archive rules
9. **list_archive_rules** - List archive rules
10. **export_emails** - Export emails to various formats
11. **delete_emails** - Delete emails with safety checks

### Example Workflows

#### Initial Setup
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

#### Clean Up Old Emails
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

## Development

### Project Structure
```
gmail-mcp-server/
├── src/
│   ├── auth/           # Authentication management
│   ├── cache/          # Caching layer
│   ├── categorization/ # Email categorization engine
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

## Security

- OAuth2 tokens are encrypted at rest
- All bulk operations require confirmation
- Audit logging for all operations
- Rate limiting implemented for Gmail API

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