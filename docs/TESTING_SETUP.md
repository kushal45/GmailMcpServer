# Testing Setup Guide

This guide explains how to set up automated testing for the Gmail MCP Server, including automated OAuth authentication.

## Prerequisites

1. **Node.js and npm** - Ensure you have Node.js installed
2. **Google Chrome** - Required for Puppeteer automation
3. **Gmail Account** - A test Gmail account for automated testing

## Environment Setup

### 1. Copy Environment Template

```bash
cp .env.test.example .env.test
```

### 2. Configure Test Credentials

Edit `.env.test` with your actual values:

```bash
# Your test Gmail account
GMAIL_TEST_EMAIL=your-test-email@gmail.com

# Your App Password (recommended) or regular password
GMAIL_TEST_PASSWORD=your-app-password-here

# Use App Password for better security
GMAIL_USE_APP_PASSWORD=true

# Set to false to see browser during testing (for debugging)
HEADLESS_BROWSER=true
```

## Setting Up App Passwords (Recommended)

App Passwords are the most secure way to authenticate automated tests:

### Step 1: Enable 2-Factor Authentication
1. Go to [Google Account Security](https://myaccount.google.com/security)
2. Enable 2-Step Verification if not already enabled

### Step 2: Generate App Password
1. Go to [App Passwords](https://myaccount.google.com/apppasswords)
2. Select "Mail" as the app type
3. Generate a new password
4. Copy the 16-character password (spaces will be removed automatically)

### Step 3: Configure Environment
```bash
GMAIL_TEST_PASSWORD=abcdabcdabcdabcd  # Your 16-character app password
GMAIL_USE_APP_PASSWORD=true
```

## Alternative: Regular Password (Less Secure)

If you prefer to use your regular password:

```bash
GMAIL_USE_APP_PASSWORD=false
GMAIL_TEST_PASSWORD=your-regular-password
```

**Note**: This may require enabling "Less secure app access" and handling 2FA manually.

## Running Tests

### Load Environment Variables
```bash
# Load test environment
source .env.test

# Or use dotenv
npx dotenv -e .env.test -- npm test
```

### Run Specific Test
```bash
npm test -- tests/integration/mcp/McpClientCombinations.test.ts
```

### Debug Mode (See Browser)
```bash
HEADLESS_BROWSER=false npm test
```

## Troubleshooting

### OAuth Automation Fails

1. **Check Credentials**: Verify email and password are correct
2. **Use App Password**: Regular passwords may be blocked
3. **Debug Mode**: Set `HEADLESS_BROWSER=false` to see what's happening
4. **Check Screenshots**: Look for `oauth-error-screenshot.png` in the project root
5. **2FA Issues**: Use App Passwords to bypass 2FA requirements

### Common Issues

#### "2FA detected" Warning
- **Solution**: Use App Passwords instead of regular passwords
- **Alternative**: Implement 2FA code automation (advanced)

#### "Less secure app access" Error
- **Solution**: Use App Passwords instead of enabling less secure access
- **Why**: App Passwords are more secure and don't require lowering security

#### Browser Launch Fails
- **Check**: Chrome installation path in test file
- **Update**: Modify `executablePath` in the test file if needed
- **Alternative**: Let Puppeteer use its bundled Chromium

### Environment Variables Reference

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `GMAIL_TEST_EMAIL` | Test Gmail address | `sensennium.kushal4@gmail.com` | No |
| `GMAIL_TEST_PASSWORD` | Password or App Password | - | Yes |
| `GMAIL_USE_APP_PASSWORD` | Use App Password method | `false` | No |
| `HEADLESS_BROWSER` | Run browser in headless mode | `true` | No |
| `STORAGE_PATH` | Custom storage directory | `./data` | No |

## Security Best Practices

1. **Use App Passwords**: More secure than regular passwords
2. **Separate Test Account**: Don't use your primary Gmail account
3. **Environment Files**: Never commit `.env.test` to version control
4. **Rotate Passwords**: Regularly update test credentials
5. **Limit Permissions**: Use accounts with minimal necessary permissions

## CI/CD Integration

For continuous integration, set environment variables in your CI system:

```yaml
# GitHub Actions example
env:
  GMAIL_TEST_EMAIL: ${{ secrets.GMAIL_TEST_EMAIL }}
  GMAIL_TEST_PASSWORD: ${{ secrets.GMAIL_TEST_PASSWORD }}
  GMAIL_USE_APP_PASSWORD: true
  HEADLESS_BROWSER: true
```

## Advanced Configuration

### Custom Chrome Path
If Chrome is installed in a non-standard location, update the test file:

```typescript
executablePath: "/path/to/your/chrome"
```

### Proxy Configuration
For corporate networks, you may need to configure proxy settings in the Puppeteer launch options.

### Custom Timeouts
Adjust timeouts in the test file based on your network speed and system performance.
