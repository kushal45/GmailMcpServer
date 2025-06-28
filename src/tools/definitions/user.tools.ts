import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { logger } from '../../utils/logger.js';
import { toolRegistry } from '../ToolRegistry.js';

/**
 * Register user management tools
 */
export function registerUserTools() {
  // Register register_user tool
  const registerUserTool: Tool = {
    name: 'register_user',
    description: 'Register a new user account',
    inputSchema: {
      type: 'object',
      properties: {
        email: {
          type: 'string',
          description: 'User email address'
        },
        display_name: {
          type: 'string',
          description: 'User display name'
        },
        role: {
          type: 'string',
          enum: ['user', 'admin'],
          description: 'User role'
        },
        user_context: {
          type: 'object',
          description: 'User context for access control',
          properties: {
            user_id: {
              type: 'string',
              description: 'ID of the user making the request'
            },
            session_id: {
              type: 'string',
              description: 'Session ID of the user making the request'
            }
          },
          required: ['user_id', 'session_id']
        }
      },
      required: ['email', 'user_context']
    }
  };

  // Register get_user_profile tool
  const getUserProfileTool: Tool = {
    name: 'get_user_profile',
    description: 'Retrieve user information',
    inputSchema: {
      type: 'object',
      properties: {
        target_user_id: {
          type: 'string',
          description: 'ID of the user to retrieve (defaults to the requesting user if not provided)'
        },
        user_context: {
          type: 'object',
          description: 'User context for access control',
          properties: {
            user_id: {
              type: 'string',
              description: 'ID of the user making the request'
            },
            session_id: {
              type: 'string',
              description: 'Session ID of the user making the request'
            }
          },
          required: ['user_id', 'session_id']
        }
      },
      required: ['user_context']
    }
  };

  // Register switch_user tool
  const switchUserTool: Tool = {
    name: 'switch_user',
    description: 'Change the active user in a session',
    inputSchema: {
      type: 'object',
      properties: {
        target_user_id: {
          type: 'string',
          description: 'ID of the user to switch to'
        },
        user_context: {
          type: 'object',
          description: 'User context for access control',
          properties: {
            user_id: {
              type: 'string',
              description: 'ID of the user making the request'
            },
            session_id: {
              type: 'string',
              description: 'Session ID of the user making the request'
            }
          },
          required: ['user_id', 'session_id']
        }
      },
      required: ['target_user_id', 'user_context']
    }
  };

  // Register list_users tool
  const listUsersTool: Tool = {
    name: 'list_users',
    description: 'Admin tool to list all registered users',
    inputSchema: {
      type: 'object',
      properties: {
        active_only: {
          type: 'boolean',
          description: 'Whether to only return active users'
        },
        user_context: {
          type: 'object',
          description: 'User context for access control',
          properties: {
            user_id: {
              type: 'string',
              description: 'ID of the user making the request'
            },
            session_id: {
              type: 'string',
              description: 'Session ID of the user making the request'
            }
          },
          required: ['user_id', 'session_id']
        }
      },
      required: ['user_context']
    }
  };

  // Register tools with the registry
  toolRegistry.registerTool(registerUserTool, 'user_management');
  toolRegistry.registerTool(getUserProfileTool, 'user_management');
  toolRegistry.registerTool(switchUserTool, 'user_management');
  toolRegistry.registerTool(listUsersTool, 'user_management');

  logger.info('User management tools registered');
}