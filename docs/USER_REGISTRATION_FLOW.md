# User Registration Flow in Gmail MCP Server

This document explains the correct flow for user registration and authentication in the Gmail MCP Server, particularly for testing scenarios.

## Understanding the Registration Flow

### First User Registration (Bootstrap)

The first user registration is special and doesn't require authentication:

```typescript
// First user registration - no authentication required
const registerResp = await client.callTool({
  name: "register_user",
  arguments: {
    email: "first-user@gmail.com",
    display_name: "First User",
    role: "admin",
    user_context: userContext, // This is ignored for first user
  },
});
```

**Key Points:**
- No authentication required
- Automatically becomes admin regardless of specified role
- `user_context` parameter is ignored
- This creates the bootstrap admin user

### Subsequent User Registration

All subsequent user registrations require an authenticated admin user:

```typescript
// Must authenticate first user before registering others
const authResp = await client.callTool({
  name: "authenticate",
  arguments: {
    email: "first-user@gmail.com",
    display_name: "First User",
    session_id: "sess1",
  },
});

// Complete OAuth flow to get real user_id and session_id
// userContext is updated with real values from OAuth

// Now register second user with authenticated admin context
const registerUser2Resp = await client.callTool({
  name: "register_user",
  arguments: {
    email: "second-user@gmail.com",
    display_name: "Second User", 
    role: "user",
    user_context: userContext, // Must be valid authenticated admin context
  },
});
```

**Key Points:**
- Requires valid authenticated session
- Caller must be an admin user
- `user_context` must contain real `user_id` and `session_id` from OAuth flow

## Common Errors and Solutions

### Error: "Invalid session. Please authenticate again."

**Cause:** Trying to register a second user without proper authentication.

**Solution:** Complete the OAuth flow first:

```typescript
// ❌ WRONG - This will fail
const userContext = { user_id: "user1", session_id: "sess1" }; // Fake context
await client.callTool({
  name: "register_user",
  arguments: {
    email: "second-user@gmail.com",
    user_context: userContext, // Invalid session
  },
});

// ✅ CORRECT - Authenticate first
// 1. Register first user (no auth needed)
// 2. Authenticate via OAuth (gets real session)
// 3. Use authenticated context for second user
```

### Error: "Only administrators can register new users."

**Cause:** Trying to register a user with a non-admin account.

**Solution:** Ensure the authenticated user has admin role:

```typescript
// First user automatically becomes admin
// Use first user's context to register others
```

## Modular Registration Functions

The test suite provides modular helper functions for user registration:

### Core Registration Function

```typescript
const registerUser = async (
  email: string,
  displayName: string,
  role: 'user' | 'admin',
  authenticatedUserContext: any,
  isFirstUser: boolean = false
) => {
  // Handles both first user (bootstrap) and subsequent user registration
  // Provides detailed logging and validation
  // Returns registration response
};
```

### Convenience Functions

```typescript
// Register first user (bootstrap admin)
const registerFirstUser = async (email: string, displayName: string, role: 'user' | 'admin' = 'admin') => {
  return await registerUser(email, displayName, role, userContext, true);
};

// Register additional users (requires authentication)
const registerAdditionalUser = async (email: string, displayName: string, role: 'user' | 'admin', authenticatedContext: any) => {
  return await registerUser(email, displayName, role, authenticatedContext, false);
};

// Bulk register test users from configuration
const registerTestUsers = async (authenticatedContext?: any) => {
  // Registers primary user, and secondary user if authenticated context provided
  // Returns { primaryUser, secondaryUser? }
};
```

## Complete Test Flow Example

```typescript
test("should register multiple users correctly", async () => {
  // Step 1: Register first user (bootstrap admin) - Modular approach
  await registerFirstUser("admin@gmail.com", "Admin User", "admin");

  // Step 2: Authenticate first user via OAuth
  const authResp = await client.callTool({
    name: "authenticate",
    arguments: {
      email: "admin@gmail.com",
      display_name: "Admin User",
      session_id: "sess1",
    },
  });

  // Step 3: Complete OAuth flow (browser automation)
  // This updates userContext with real user_id and session_id

  // Step 4: Register additional users - Modular approach
  await registerAdditionalUser("user1@gmail.com", "User One", "user", userContext);
  await registerAdditionalUser("user2@gmail.com", "User Two", "admin", userContext);

  // Or use bulk registration
  const users = await registerTestUsers(userContext);
});
```

## Modular Usage Examples

### Single Test Setup
```typescript
test("should test email functionality", async () => {
  // Quick setup - register test users from config
  const users = await registerTestUsers(authenticatedContext);

  // Now test email functionality with registered users
  // ...
});
```

### Custom User Registration
```typescript
test("should test with specific user roles", async () => {
  // Register users with specific requirements
  await registerAdditionalUser("manager@company.com", "Manager", "admin", userContext);
  await registerAdditionalUser("employee@company.com", "Employee", "user", userContext);

  // Test role-specific functionality
  // ...
});
```

### Reusable Test Setup
```typescript
describe("Multi-user email tests", () => {
  let adminContext: any;

  beforeAll(async () => {
    // One-time setup: register and authenticate admin
    await registerFirstUser(testConfig.primaryUser.email, testConfig.primaryUser.displayName);
    // ... complete OAuth flow ...
    adminContext = userContext;
  });

  test("should handle user A", async () => {
    await registerAdditionalUser("userA@test.com", "User A", "user", adminContext);
    // Test specific to User A
  });

  test("should handle user B", async () => {
    await registerAdditionalUser("userB@test.com", "User B", "admin", adminContext);
    // Test specific to User B
  });
});
```

## Security Implications

### Why This Flow Exists

1. **Bootstrap Security**: First user becomes admin to prevent lockout
2. **Access Control**: Only admins can create new users
3. **Session Validation**: Ensures requests come from authenticated users
4. **Audit Trail**: All user creation is tied to an authenticated admin

### Best Practices

1. **Use Real OAuth**: Don't try to bypass authentication with fake sessions
2. **Admin First**: Always register and authenticate an admin user first
3. **Validate Sessions**: Ensure OAuth flow completes successfully
4. **Error Handling**: Check for authentication errors before proceeding

## Testing Considerations

### Environment Setup

```bash
# Required for OAuth automation
GMAIL_TEST_EMAIL=admin@gmail.com
GMAIL_TEST_PASSWORD=your-app-password
GMAIL_USE_APP_PASSWORD=true
```

### Test Structure

```typescript
describe("Multi-user tests", () => {
  let authenticatedAdminContext: any;

  beforeAll(async () => {
    // Register and authenticate admin user once
    // Store authenticated context for reuse
  });

  test("should register user A", async () => {
    await registerUser("userA@gmail.com", "User A", "user", authenticatedAdminContext);
  });

  test("should register user B", async () => {
    await registerUser("userB@gmail.com", "User B", "admin", authenticatedAdminContext);
  });
});
```

## Troubleshooting

### Debug Steps

1. **Check User Count**: Verify if this is first user or subsequent
2. **Validate Session**: Ensure OAuth flow completed successfully
3. **Check Admin Role**: Verify calling user has admin privileges
4. **Session Expiry**: Sessions may expire, re-authenticate if needed

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| Invalid session | Fake user context | Complete OAuth flow |
| Not admin | Non-admin trying to register | Use admin context |
| Session expired | Old session | Re-authenticate |
| Missing context | No user_context provided | Provide valid context |

## Related Documentation

- [Testing Setup Guide](TESTING_SETUP.md)
- [Automated OAuth Testing](AUTOMATED_OAUTH_TESTING.md)
- [User Management API](../README.md#user-management)
