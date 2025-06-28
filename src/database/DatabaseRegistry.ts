import { fileURLToPath } from 'url';
import path from "path";
import fs from "fs/promises";
import { logger } from "../utils/logger.js";
import { DatabaseManager } from "./DatabaseManager.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * DatabaseRegistry class responsible for managing user-specific database connections
 * Implements a registry pattern to maintain and manage per-user database connections
 */
export class DatabaseRegistry {
  private static instance: DatabaseRegistry | null = null;
  private dbInstances: Map<string, DatabaseManager> = new Map();
  private dbBasePath: string;

  /**
   * Create a new DatabaseRegistry instance
   * @param basePath Base path for database storage
   */
  constructor(basePath: string = process.env.STORAGE_PATH ? path.resolve(__dirname, '../../', process.env.STORAGE_PATH) : path.resolve(__dirname, '../../data/db')) {
    this.dbBasePath = basePath;
  }

  /**
   * Get the singleton instance of DatabaseRegistry
   */
  static getInstance(basePath?: string): DatabaseRegistry {
    if (!this.instance) {
      this.instance = new DatabaseRegistry(basePath);
      logger.info("DatabaseRegistry singleton created");
    }
    return this.instance;
  }

  /**
   * Initialize the DatabaseRegistry
   */
  async initialize(): Promise<void> {
    try {
      // Ensure base directory exists
      await fs.mkdir(this.dbBasePath, { recursive: true });
      logger.info(`DatabaseRegistry initialized with base path: ${this.dbBasePath}`);
    } catch (error) {
      logger.error("Failed to initialize DatabaseRegistry:", error);
      throw error;
    }
  }

  /**
   * Get the database path for a specific user
   * @param userId User ID to get database path for
   */
  getDatabasePath(userId: string): string {
    return path.join(this.dbBasePath, `user_${userId}_gmail-mcp.db`);
  }

  /**
   * Get a DatabaseManager instance for a specific user
   * Creates the database if it doesn't exist
   * @param userId User ID to get database for
   */
  async getDatabaseManager(userId: string): Promise<DatabaseManager> {
    // Check if we already have an instance for this user
    if (this.dbInstances.has(userId)) {
      return this.dbInstances.get(userId)!;
    }

    // Create a new DatabaseManager instance for this user
    const dbPath = this.getDatabasePath(userId);
    const dbManager = DatabaseManager.createForUser(userId);
    
    // Initialize the database
    await dbManager.initialize(dbPath);
    
    // Store the instance
    this.dbInstances.set(userId, dbManager);
    
    logger.info(`Created DatabaseManager for user ${userId} at ${dbPath}`);
    return dbManager;
  }

  /**
   * Remove a DatabaseManager instance for a specific user
   * @param userId User ID to remove database for
   */
  async removeDatabaseManager(userId: string): Promise<void> {
    if (!this.dbInstances.has(userId)) {
      return;
    }

    // Get the instance
    const dbManager = this.dbInstances.get(userId)!;
    
    // Close the database connection
    await dbManager.close();
    
    // Remove from instances map
    this.dbInstances.delete(userId);
    
    logger.info(`Removed DatabaseManager for user ${userId}`);
  }

  /**
   * Check if a database exists for a specific user
   * @param userId User ID to check database for
   */
  async databaseExists(userId: string): Promise<boolean> {
    const dbPath = this.getDatabasePath(userId);
    try {
      await fs.access(dbPath);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Create a new database for a user
   * @param userId User ID to create database for
   */
  async createUserDatabase(userId: string): Promise<DatabaseManager> {
    // Ensure the database directory exists
    await fs.mkdir(path.dirname(this.getDatabasePath(userId)), { recursive: true });
    
    // Create and initialize the database
    return this.getDatabaseManager(userId);
  }

  /**
   * Delete a user's database
   * @param userId User ID to delete database for
   */
  async deleteUserDatabase(userId: string): Promise<void> {
    // Remove the database instance if it exists
    await this.removeDatabaseManager(userId);
    
    // Delete the database file
    const dbPath = this.getDatabasePath(userId);
    try {
      await fs.unlink(dbPath);
      logger.info(`Deleted database for user ${userId} at ${dbPath}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.error(`Error deleting database for user ${userId}:`, error);
        throw error;
      }
    }
  }

  /**
   * List all user database IDs
   */
  async listUserDatabases(): Promise<string[]> {
    try {
      const files = await fs.readdir(this.dbBasePath);
      const userIds = files
        .filter(file => file.startsWith('user_') && file.endsWith('_gmail-mcp.db'))
        .map(file => {
          const match = file.match(/^user_(.+)_gmail-mcp\.db$/);
          return match ? match[1] : null;
        })
        .filter((userId): userId is string => userId !== null);
      
      return userIds;
    } catch (error) {
      logger.error("Error listing user databases:", error);
      return [];
    }
  }

  /**
   * Clean up resources
   */
  async cleanup(): Promise<void> {
    // Close all database connections
    for (const [userId, dbManager] of this.dbInstances.entries()) {
      try {
        await dbManager.close();
        logger.debug(`Closed database connection for user ${userId}`);
      } catch (error) {
        logger.error(`Error closing database connection for user ${userId}:`, error);
      }
    }
    
    // Clear the instances map
    this.dbInstances.clear();
    
    logger.info("DatabaseRegistry cleaned up");
  }

  /**
   * Reset the singleton instance (for test isolation)
   */
  static resetInstance(): void {
    this.instance = null;
    logger.info('DatabaseRegistry: Resetting singleton instance for test isolation');
  }
}