# Enhanced OAuth Validation Guide

This guide explains how to use the enhanced OAuth validation script to thoroughly test and debug your OAuth flow.

## Overview

The enhanced OAuth validation script (`oauth-validation.cjs`) provides:
- ✅ Step-by-step OAuth flow validation
- 📸 Screenshot capture at each step
- 🔍 Multiple session extraction strategies
- 🛠️ Comprehensive error reporting
- 📊 Detailed progress tracking

## Quick Start

### Basic Validation
```bash
npm run test:oauth:validate
```

### Debug Mode (Visible Browser)
```bash
npm run test:oauth:validate:debug
```

### Mock OAuth (Skip Real Authentication)
```bash
npm run test:oauth:validate:mock
```

## What the Script Tests

### Step 1: MCP Server Connection
- Connects to the Gmail MCP server
- Verifies server is responsive
- Tests system health endpoint

### Step 2: User Registration
- Registers a test user (first user becomes admin)
- Validates registration response
- Confirms user creation

### Step 3: OAuth URL Generation
- Calls authenticate endpoint
- Validates OAuth URL is generated
- Confirms proper OAuth parameters

### Step 4: Browser Automation
- **Email Input**: Validates email field detection and input
- **Password Input**: Validates password field detection and input
- **2FA Detection**: Checks for and handles 2FA prompts
- **Consent Screen**: Enhanced consent screen detection and handling

### Step 5: Session Extraction
- **Strategy 1**: Paragraph elements with session/user ID text
- **Strategy 2**: Any elements containing session information
- **Strategy 3**: JSON data in script tags
- **Strategy 4**: Data attributes with session information

### Step 6: Session Validation
- Tests extracted session with API call
- Validates session actually works
- Confirms user profile access

## Generated Files

The script generates detailed debug files:

### Screenshots
- `oauth-step1-email.png` - Email input step
- `oauth-step2-password.png` - Password input step
- `oauth-step4-before-consent.png` - Before consent screen
- `oauth-step4-after-consent.png` - After consent screen
- `oauth-step5-callback.png` - OAuth callback page

### Debug Files
- `oauth-callback-content.txt` - Full callback page content
- `oauth-timeout-error.png` - Screenshot if timeout occurs

## Understanding the Output

### Success Output
```
🎉 OAuth Validation PASSED!
=====================================
✅ Step 1: MCP Server Connection - SUCCESS
✅ Step 2: User Registration - SUCCESS
✅ Step 3: OAuth URL Generation - SUCCESS
✅ Step 4: Browser Automation - SUCCESS
✅ Step 5: Session Extraction - SUCCESS
✅ Step 6: Session Validation - SUCCESS
=====================================
```

### Failure Output
```
💥 OAuth Validation FAILED!
=====================================
❌ OAuth flow is not working correctly
❌ Error: [Specific error message]
=====================================
```

## Common Issues and Solutions

### Issue: Email Input Fails
**Symptoms:**
```
❌ Email step failed: Email input field not found
```

**Solutions:**
1. Check if Google changed their login page structure
2. Verify network connectivity
3. Try with visible browser: `HEADLESS_BROWSER=false`

### Issue: Password Input Fails
**Symptoms:**
```
❌ Password step failed: Password input field not found
```

**Solutions:**
1. Verify credentials are correct
2. Check for 2FA requirements
3. Use App Passwords instead of regular passwords

### Issue: 2FA Detected
**Symptoms:**
```
⚠️ 2FA detected - manual intervention may be required
```

**Solutions:**
1. **Recommended**: Use App Passwords
   ```bash
   GMAIL_USE_APP_PASSWORD=true
   ```
2. Set up App Password in Google Account settings
3. Use the 16-character App Password instead of regular password

### Issue: Consent Screen Not Found
**Symptoms:**
```
⚠️ No consent screen found - may have been pre-approved
```

**This is usually normal** - consent may be pre-approved for your app.

### Issue: Session Extraction Fails
**Symptoms:**
```
❌ Failed to extract user context
❌ Strategy 1 (Paragraph Elements): FAILED
❌ Strategy 2 (Any Elements): FAILED
```

**Solutions:**
1. Check `oauth-step5-callback.png` screenshot
2. Review `oauth-callback-content.txt` for page content
3. Verify OAuth callback URL is correct
4. Check if callback page format changed

### Issue: Session Validation Fails
**Symptoms:**
```
❌ Session validation failed: Invalid session
```

**Solutions:**
1. Verify extracted session IDs are valid format
2. Check server logs for authentication errors
3. Ensure OAuth flow completed successfully

## Advanced Usage

### Custom Timeout
```bash
BROWSER_TIMEOUT=300000 npm run test:oauth:validate
```

### Force Consent Screen
Add `prompt=consent` to OAuth URL to force consent screen display.

### Debug with Specific Browser
```bash
# Use system Chrome
CHROME_PATH=/usr/bin/google-chrome npm run test:oauth:validate:debug
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `GMAIL_TEST_EMAIL` | Test Gmail address | Required |
| `GMAIL_TEST_PASSWORD` | Password or App Password | Required |
| `GMAIL_USE_APP_PASSWORD` | Use App Password method | `false` |
| `HEADLESS_BROWSER` | Run browser headlessly | `true` |
| `BROWSER_TIMEOUT` | Browser operation timeout | `120000` |
| `USE_MOCK_OAUTH` | Skip real OAuth | `false` |

## Troubleshooting Workflow

1. **Run Basic Validation**
   ```bash
   npm run test:oauth:validate
   ```

2. **If Fails, Run Debug Mode**
   ```bash
   npm run test:oauth:validate:debug
   ```

3. **Check Generated Screenshots**
   - Look at each step screenshot
   - Identify where the flow breaks

4. **Try App Passwords**
   ```bash
   # Set in .env.test
   GMAIL_USE_APP_PASSWORD=true
   ```

5. **Use Mock OAuth for Testing**
   ```bash
   npm run test:oauth:validate:mock
   ```

6. **Increase Timeouts**
   ```bash
   # Set in .env.test
   BROWSER_TIMEOUT=300000
   ```

## Integration with Full Test Suite

Once OAuth validation passes:

1. ✅ OAuth is confirmed working
2. 🧪 Run full test suite: `npm run test:mcp`
3. 🔧 If full tests still fail, check timeout settings
4. 📚 See `OAUTH_TROUBLESHOOTING.md` for advanced options

## Best Practices

1. **Always validate OAuth first** before running full test suite
2. **Use App Passwords** for reliable automation
3. **Check screenshots** when debugging issues
4. **Keep credentials secure** in `.env.test` file
5. **Use mock OAuth** for rapid testing cycles

## Related Documentation

- [OAuth Troubleshooting](OAUTH_TROUBLESHOOTING.md)
- [Test Environment Setup](TEST_ENVIRONMENT_SETUP.md)
- [User Registration Flow](USER_REGISTRATION_FLOW.md)
