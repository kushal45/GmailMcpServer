# Test Environment Setup Guide

This guide explains how to set up and use the dedicated test environment configuration for Gmail MCP Server integration tests.

## Overview

The test environment system provides:
- ✅ Isolated test configuration separate from main application
- ✅ Type-safe environment variable handling
- ✅ Comprehensive validation and error reporting
- ✅ Flexible configuration for different testing scenarios
- ✅ Automatic environment loading and validation

## Quick Setup

### 1. Initialize Test Environment

```bash
# Copy the test environment template
npm run test:mcp:setup

# Or manually:
cp tests/integration/mcp/.env.test.example tests/integration/mcp/.env.test
```

### 2. Configure Test Credentials

Edit `tests/integration/mcp/.env.test`:

```bash
# Required: Your test Gmail credentials
GMAIL_TEST_EMAIL=your-test-email@gmail.com
GMAIL_TEST_PASSWORD=your-app-password-here
GMAIL_TEST_DISPLAY_NAME=Your Test Name

# Optional: Secondary user for multi-user testing
GMAIL_TEST_EMAIL_2=your-second-test-email@gmail.com
GMAIL_TEST_DISPLAY_NAME_2=Second Test User

# OAuth settings
GMAIL_USE_APP_PASSWORD=true
HEADLESS_BROWSER=true
```

### 3. Run Tests

```bash
# Run tests with automatic environment loading
npm run test:mcp

# Debug mode (visible browser)
npm run test:mcp:debug
```

## Environment Configuration

### Core Test Settings

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `GMAIL_TEST_EMAIL` | Primary test Gmail address | - | Yes |
| `GMAIL_TEST_PASSWORD` | Password or App Password | - | Yes |
| `GMAIL_TEST_DISPLAY_NAME` | Display name for primary user | "Primary Test User" | No |
| `GMAIL_TEST_EMAIL_2` | Secondary test Gmail address | - | No |
| `GMAIL_TEST_DISPLAY_NAME_2` | Display name for secondary user | "Secondary Test User" | No |

### OAuth Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `GMAIL_USE_APP_PASSWORD` | Use App Password method | `true` |
| `HEADLESS_BROWSER` | Run browser in headless mode | `true` |
| `BROWSER_TIMEOUT` | Browser operation timeout (ms) | `120000` |
| `OAUTH_RETRY_ATTEMPTS` | OAuth retry attempts | `3` |
| `OAUTH_RETRY_DELAY` | Delay between retries (ms) | `5000` |

### Test Behavior

| Variable | Description | Default |
|----------|-------------|---------|
| `TEST_TIMEOUT` | Test timeout (ms) | `120000` |
| `ENABLE_TEST_CLEANUP` | Clean up test data after tests | `true` |
| `PRESERVE_TEST_DATA` | Keep test data for debugging | `false` |
| `VERBOSE_TEST_LOGGING` | Enable detailed logging | `true` |
| `CAPTURE_SCREENSHOTS` | Take screenshots on failures | `true` |

### Storage Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `STORAGE_PATH` | Test data storage directory | `./tests/data` |
| `ARCHIVE_PATH` | Test archive directory | `./tests/archives` |

## Usage in Tests

### Automatic Environment Loading

The test environment is automatically loaded and validated:

```typescript
import { initializeTestEnvironment } from './test-env-loader.js';

describe("My Tests", () => {
  let testEnv: TestEnvironmentConfig;

  beforeAll(async () => {
    // Automatically loads tests/integration/mcp/.env.test
    testEnv = initializeTestEnvironment();
  });

  test("should use test environment", async () => {
    // Access configuration
    console.log(testEnv.primaryUser.email);
    console.log(testEnv.oauth.useAppPassword);
    console.log(testEnv.test.timeout);
  });
});
```

### Configuration Structure

```typescript
interface TestEnvironmentConfig {
  primaryUser: {
    email: string;
    password: string;
    displayName: string;
  };
  secondaryUser: {
    email: string;
    displayName: string;
  };
  oauth: {
    useAppPassword: boolean;
    headless: boolean;
    timeout: number;
    retryAttempts: number;
    retryDelay: number;
  };
  test: {
    timeout: number;
    enableCleanup: boolean;
    preserveTestData: boolean;
    verboseLogging: boolean;
    captureScreenshots: boolean;
  };
  // ... more configuration sections
}
```

## Environment Validation

The system automatically validates your configuration:

### ✅ Valid Configuration
```
🚀 Initializing test environment...
✅ Loaded test environment from: /path/to/.env.test
✅ Test environment configuration validated successfully

🧪 Test Environment Configuration Summary:
👤 Primary User:    test@gmail.com (Test User)
👤 Secondary User:  test2@gmail.com (Test User 2)
🔐 OAuth Settings:
  • Method:         App Password
  • Browser:        Headless
  • Timeout:        120000ms
```

### ❌ Invalid Configuration
```
❌ Test Environment Configuration Errors:
  • GMAIL_TEST_PASSWORD is required for automated OAuth testing
  • GMAIL_TEST_EMAIL must be a valid email address
  • TEST_TIMEOUT should be at least 30000ms (30 seconds)

Please check your test environment configuration in:
  /path/to/tests/integration/mcp/.env.test
```

## Different Testing Scenarios

### Development Testing
```bash
# .env.test for development
HEADLESS_BROWSER=false
VERBOSE_TEST_LOGGING=true
PRESERVE_TEST_DATA=true
CAPTURE_SCREENSHOTS=true
```

### CI/CD Testing
```bash
# .env.test for CI/CD
HEADLESS_BROWSER=true
VERBOSE_TEST_LOGGING=false
PRESERVE_TEST_DATA=false
TEST_TIMEOUT=300000
```

### Performance Testing
```bash
# .env.test for performance testing
MAX_TEST_EMAILS=1000
TEST_EMAIL_BATCH_SIZE=50
ENABLE_CACHE=true
CACHE_SIZE=500
```

## Security Best Practices

### 1. Use App Passwords
```bash
GMAIL_USE_APP_PASSWORD=true
GMAIL_TEST_PASSWORD=your-16-char-app-password
```

### 2. Separate Test Accounts
- Use dedicated Gmail accounts for testing
- Don't use production or personal accounts
- Regularly rotate test credentials

### 3. Environment File Security
- Never commit `.env.test` files to version control
- Use different credentials for different environments
- Limit access to test credential files

### 4. CI/CD Integration
```yaml
# GitHub Actions example
env:
  GMAIL_TEST_EMAIL: ${{ secrets.GMAIL_TEST_EMAIL }}
  GMAIL_TEST_PASSWORD: ${{ secrets.GMAIL_TEST_PASSWORD }}
  GMAIL_USE_APP_PASSWORD: true
  HEADLESS_BROWSER: true
```

## Troubleshooting

### Environment File Not Found
```
Warning: Could not load test environment file from /path/to/.env.test
Using default values and system environment variables
```

**Solution**: Run `npm run test:mcp:setup` to create the template file.

### Invalid Configuration
Check the validation errors and update your `.env.test` file accordingly.

### OAuth Failures
1. Verify credentials are correct
2. Use App Passwords for better reliability
3. Check browser timeout settings
4. Enable debug mode to see browser interactions

### Permission Issues
Ensure the test has write access to:
- `STORAGE_PATH` directory
- `ARCHIVE_PATH` directory
- Temporary directories for browser profiles

## Advanced Configuration

### Custom Environment Files
```typescript
// Load from custom location
const config = loadTestEnvironment('/custom/path/.env.test');
```

### Environment Overrides
```bash
# Override specific settings
HEADLESS_BROWSER=false npm run test:mcp
```

### Multiple Test Environments
```bash
# Different environments for different test suites
tests/integration/mcp/.env.test.staging
tests/integration/mcp/.env.test.production
tests/integration/mcp/.env.test.performance
```

## Related Documentation

- [User Registration Flow](USER_REGISTRATION_FLOW.md)
- [Automated OAuth Testing](AUTOMATED_OAUTH_TESTING.md)
- [Testing Setup Guide](TESTING_SETUP.md)
