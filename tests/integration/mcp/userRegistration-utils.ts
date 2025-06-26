import { Client } from "@modelcontextprotocol/sdk/client/index.js";

interface EmailOption {
    email: string;
    displayName: string;
    role?: 'user' | 'admin';
    client: Client;
    isFirstUser?: boolean;
    authenticatedUserContext?: any;
}

// Helper function to register a user (handles both first user and subsequent users)
const registerUser = async (
    emailOption:EmailOption
  ) => {
    const isFirstUser=emailOption.isFirstUser;
    const authenticatedUserContext=emailOption?.authenticatedUserContext;
    const email=emailOption.email;
    const displayName=emailOption.displayName;
    const role=emailOption.role;
    const client=emailOption.client;
    const userType = isFirstUser ? 'first user (bootstrap admin)' : 'user';
    console.info(`Registering ${userType}: ${email} (${displayName}) with role: ${role}`);

    if (isFirstUser) {
      console.info('  → No authentication required for first user');
      console.info('  → Will automatically become admin regardless of specified role');
    } else {
      console.info('  → Requires authenticated admin user context');
      console.info(`  → Using context: user_id=${authenticatedUserContext?.user_id}, session_id=${authenticatedUserContext?.session_id}`);
    }

    const registerResp = await client.callTool({
      name: "register_user",
      arguments: {
        email: email,
        display_name: displayName,
        role: isFirstUser? 'admin' : role,
        user_context: authenticatedUserContext, // Ignored for first user, required for subsequent users
      },
    });

    const registrationContent = JSON.parse((registerResp as any).content[0].text);
    console.info(`Registration response for ${email}:`, registrationContent);

    // Validate response
    expect(registrationContent.success).toBe(true);
    expect(registrationContent.userId).toBeDefined();
    expect(registrationContent.displayName).toBe(displayName);

    // For first user, role is always 'admin' regardless of what was requested
    const expectedRole = isFirstUser ? 'admin' : role;
    expect(registrationContent.role).toBe(expectedRole);

    if (isFirstUser) {
      console.info('  ✅ First user registered successfully and promoted to admin');
    } else {
      console.info(`  ✅ User registered successfully with role: ${role}`);
    }

    return registrationContent;
  };

 

  

  // Convenience function to register test users from config
  /*
  const registerTestUsers = async (authenticatedContext?: any) => {
    console.info('=== Registering Test Users ===');

    // Register primary user (first user - becomes admin automatically)
    console.info('Registering primary test user...');
    const primaryUser = await registerFirstUser(
      testEnv.primaryUser.email,
      testEnv.primaryUser.displayName,
      'admin' // First user always becomes admin
    );

    // Register secondary user if authenticated context is provided
    if (authenticatedContext) {
      console.info('Registering secondary test user...');
      const secondaryUser = await registerAdditionalUser(
        testEnv.secondaryUser.email,
        testEnv.secondaryUser.displayName,
        'admin', // Secondary user role
        authenticatedContext,
        true
      );
      return { primaryUser, secondaryUser };
    }

    return { primaryUser };
  };
  */

  export { registerUser };