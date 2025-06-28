# OAuth Troubleshooting Guide

This guide helps resolve common OAuth authentication issues in Gmail MCP Server tests.

## Common Error: "Invalid session. Please authenticate again."

This error occurs when the OAuth flow doesn't complete successfully, leaving the test with invalid session credentials.

### Root Causes

1. **OAuth Flow Interruption**: Browser automation fails during Google OAuth
2. **Session Extraction Failure**: Can't extract user_id/session_id from callback page
3. **Network Issues**: Timeouts or connectivity problems
4. **Google Security Measures**: Account protection blocking automation
5. **Credential Issues**: Wrong email/password or expired App Passwords

## Diagnostic Steps

### 1. Enable Debug Mode

```bash
# Run with visible browser to see what's happening
npm run test:mcp:debug
```

### 2. Check Screenshots

The test automatically captures screenshots on failures:
- `oauth-error-screenshot.png` - Error during OAuth flow
- `oauth-callback-page.png` - OAuth callback page content

### 3. Enable Verbose Logging

```bash
# In your .env.test file
VERBOSE_TEST_LOGGING=true
CAPTURE_SCREENSHOTS=true
```

### 4. Check OAuth Callback Page

Look for these elements in the callback page:
- Text containing "session ID is [value]"
- Text containing "user ID is [value]"
- JSON data with user_id and session_id
- Data attributes with session information

## Solutions by Error Type

### OAuth Flow Fails (Browser Automation)

**Symptoms:**
- Browser closes unexpectedly
- Stuck on Google login page
- 2FA prompts appear

**Solutions:**

1. **Use App Passwords (Recommended)**
   ```bash
   GMAIL_USE_APP_PASSWORD=true
   GMAIL_TEST_PASSWORD=your-16-char-app-password
   ```

2. **Check Credentials**
   ```bash
   # Verify email and password are correct
   GMAIL_TEST_EMAIL=your-correct-email@gmail.com
   GMAIL_TEST_PASSWORD=your-correct-password
   ```

3. **Increase Timeouts**
   ```bash
   BROWSER_TIMEOUT=300000  # 5 minutes
   OAUTH_RETRY_ATTEMPTS=5
   OAUTH_RETRY_DELAY=10000
   ```

### Session Extraction Fails

**Symptoms:**
- OAuth completes but user_id/session_id are undefined
- "Failed to extract valid user context" error

**Solutions:**

1. **Check Callback Page Format**
   - Enable screenshots to see callback page
   - Verify the page contains session information

2. **Update Extraction Logic**
   - The test uses multiple extraction strategies
   - Check if callback page format changed

3. **Use Mock OAuth for Testing**
   ```bash
   USE_MOCK_OAUTH=true
   ```

### Network/Connectivity Issues

**Symptoms:**
- Timeouts during OAuth flow
- "Navigation timeout" errors

**Solutions:**

1. **Increase Network Timeouts**
   ```bash
   BROWSER_TIMEOUT=300000
   ```

2. **Check Network Connection**
   - Verify internet connectivity
   - Check for proxy/firewall issues

3. **Retry Configuration**
   ```bash
   OAUTH_RETRY_ATTEMPTS=5
   OAUTH_RETRY_DELAY=15000
   ```

## Advanced Troubleshooting

### Mock OAuth Mode

For testing when OAuth is problematic:

```bash
# In .env.test
USE_MOCK_OAUTH=true
```

This bypasses real OAuth and uses mock credentials for testing.

### Custom Browser Configuration

```bash
# For corporate networks or special setups
HEADLESS_BROWSER=false  # See browser interactions
PRESERVE_BROWSER_SESSION=true  # Keep browser open for debugging
```

### Session Validation

The test validates OAuth sessions by calling `get_user_profile`. If this fails:

1. Check if the user profile endpoint works
2. Verify session format matches expected structure
3. Check server logs for authentication errors

## Environment-Specific Solutions

### CI/CD Environments

```bash
# Recommended CI/CD settings
USE_MOCK_OAUTH=true
HEADLESS_BROWSER=true
OAUTH_RETRY_ATTEMPTS=1
TEST_TIMEOUT=300000
```

### Development Environment

```bash
# Recommended development settings
HEADLESS_BROWSER=false
VERBOSE_TEST_LOGGING=true
CAPTURE_SCREENSHOTS=true
PRESERVE_BROWSER_SESSION=true
OAUTH_RETRY_ATTEMPTS=3
```

### Production Testing

```bash
# Recommended production testing settings
GMAIL_USE_APP_PASSWORD=true
HEADLESS_BROWSER=true
OAUTH_RETRY_ATTEMPTS=5
OAUTH_RETRY_DELAY=10000
```

## Step-by-Step Debugging

### 1. Basic Connectivity Test

```bash
# Test if server starts correctly
npm run test:mcp -- --testNamePattern="should get system health"
```

### 2. First User Registration Test

```bash
# Test if first user registration works (no OAuth needed)
npm run test:mcp -- --testNamePattern="register first user"
```

### 3. OAuth Flow Test

```bash
# Test OAuth flow in isolation
HEADLESS_BROWSER=false npm run test:mcp -- --testNamePattern="authenticate"
```

### 4. Session Validation Test

```bash
# Test if extracted session works
npm run test:mcp -- --testNamePattern="get user profile"
```

## Common Fixes

### Fix 1: App Password Setup

1. Go to [Google Account Security](https://myaccount.google.com/security)
2. Enable 2-Step Verification
3. Go to [App Passwords](https://myaccount.google.com/apppasswords)
4. Generate password for "Mail"
5. Use 16-character password in `GMAIL_TEST_PASSWORD`
6. Set `GMAIL_USE_APP_PASSWORD=true`

### Fix 2: Update Chrome Path

If Chrome isn't found:

```typescript
// In test file, update executablePath
executablePath: "/usr/bin/google-chrome"  // Linux
executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"  // macOS
```

### Fix 3: Network Proxy

For corporate networks:

```typescript
// Add proxy settings to browser launch
args: [
  "--proxy-server=http://proxy.company.com:8080",
  "--no-sandbox",
  "--disable-setuid-sandbox"
]
```

## Getting Help

### Log Analysis

Check these log messages for clues:
- "OAuth attempt X/Y" - Shows retry progress
- "Strategy X successful" - Shows which extraction method worked
- "Session validation successful" - Confirms valid session

### Debug Information

The test provides detailed debug info:
- Page content and URL
- Extraction attempts and results
- Session validation responses
- Error stack traces

### Support Checklist

When seeking help, provide:
- [ ] Error message and stack trace
- [ ] Test environment configuration (without passwords)
- [ ] Screenshots from failed OAuth flow
- [ ] Browser and OS information
- [ ] Network environment details (proxy, firewall, etc.)

## Related Documentation

- [Test Environment Setup](TEST_ENVIRONMENT_SETUP.md)
- [Automated OAuth Testing](AUTOMATED_OAUTH_TESTING.md)
- [User Registration Flow](USER_REGISTRATION_FLOW.md)
