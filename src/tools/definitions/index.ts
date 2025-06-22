import { registerEmailTools } from './email.tools.js';
import { registerUserTools } from './user.tools.js';
import { toolRegistry } from '../ToolRegistry.js';
import { logger } from '../../utils/logger.js';

export async function registerAllTools() {
  try {
    logger.info('Registering all tools...');
    
    // Register email tools
    registerEmailTools();
    
    // Register user management tools
    registerUserTools();
    
    // Register other tool categories here
    
    logger.info(`Successfully registered ${toolRegistry.getAllTools().length} tools`);
  } catch (error) {
    logger.error('Error registering tools:', error);
    throw error;
  }
}