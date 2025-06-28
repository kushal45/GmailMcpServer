import { logger } from "../utils/logger.js";
import { DatabaseRegistry } from "./DatabaseRegistry.js";
import { DatabaseMigrationManager } from "./DatabaseMigrationManager.js";
import { DatabaseManager } from "./DatabaseManager.js";

/**
 * Class responsible for initializing user-specific databases
 * Handles creation, schema setup, and migration for new user databases
 */
export class UserDatabaseInitializer {
  private dbRegistry: DatabaseRegistry;
  private migrationManager: DatabaseMigrationManager;

  /**
   * Create a new UserDatabaseInitializer
   */
  constructor() {
    this.dbRegistry = DatabaseRegistry.getInstance();
    this.migrationManager = DatabaseMigrationManager.getInstance();
  }

  /**
   * Initialize the database system
   * This should be called once at application startup
   */
  async initializeDatabaseSystem(): Promise<void> {
    try {
      // Initialize the database registry
      await this.dbRegistry.initialize();
      
      // Initialize the migration manager
      await this.migrationManager.initialize();
      
      logger.info("Database system initialized successfully");
    } catch (error) {
      logger.error("Failed to initialize database system:", error);
      throw error;
    }
  }

  /**
   * Initialize a database for a new user
   * Creates the database if it doesn't exist and applies all migrations
   * @param userId User ID to initialize database for
   */
  async initializeUserDatabase(userId: string): Promise<DatabaseManager> {
    try {
      logger.info(`Initializing database for user ${userId}`);
      
      // Check if database already exists
      const exists = await this.dbRegistry.databaseExists(userId);
      
      if (exists) {
        logger.info(`Database for user ${userId} already exists, migrating to latest version`);
        
        // Get the database manager
        const dbManager = await this.dbRegistry.getDatabaseManager(userId);
        
        // Apply any pending migrations
        await this.migrationManager.migrateDatabase(dbManager);
        
        return dbManager;
      } else {
        logger.info(`Creating new database for user ${userId}`);
        
        // Create a new database
        const dbManager = await this.dbRegistry.createUserDatabase(userId);
        
        // Apply all migrations to set up schema
        await this.migrationManager.migrateDatabase(dbManager);
        
        logger.info(`Database for user ${userId} created and initialized successfully`);
        
        return dbManager;
      }
    } catch (error) {
      logger.error(`Failed to initialize database for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Get a database manager for a user
   * Ensures the database exists and is properly initialized
   * @param userId User ID to get database for
   */
  async getUserDatabaseManager(userId: string): Promise<DatabaseManager> {
    try {
      // Check if database exists
      const exists = await this.dbRegistry.databaseExists(userId);
      
      if (!exists) {
        // Initialize the database if it doesn't exist
        return this.initializeUserDatabase(userId);
      }
      
      // Get the database manager
      return this.dbRegistry.getDatabaseManager(userId);
    } catch (error) {
      logger.error(`Failed to get database manager for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Delete a user's database
   * @param userId User ID to delete database for
   */
  async deleteUserDatabase(userId: string): Promise<void> {
    try {
      logger.info(`Deleting database for user ${userId}`);
      
      // Delete the database
      await this.dbRegistry.deleteUserDatabase(userId);
      
      logger.info(`Database for user ${userId} deleted successfully`);
    } catch (error) {
      logger.error(`Failed to delete database for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * List all user databases
   */
  async listUserDatabases(): Promise<string[]> {
    return this.dbRegistry.listUserDatabases();
  }

  /**
   * Clean up database resources
   */
  async cleanup(): Promise<void> {
    await this.dbRegistry.cleanup();
  }
}

// Export a singleton instance for convenience
export const userDatabaseInitializer = new UserDatabaseInitializer();