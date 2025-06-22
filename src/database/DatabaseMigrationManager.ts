import fs from "fs/promises";
import path from "path";
import { logger } from "../utils/logger.js";
import { DatabaseRegistry } from "./DatabaseRegistry.js";
import { DatabaseManager } from "./DatabaseManager.js";

/**
 * Interface for migration metadata
 */
interface MigrationMeta {
  version: number;
  name: string;
  timestamp: number;
  applied: boolean;
}

/**
 * Interface for a migration script
 */
interface Migration {
  version: number;
  name: string;
  up: string[];
  down: string[];
}

/**
 * DatabaseMigrationManager class responsible for managing database schema migrations
 * across all user databases
 */
export class DatabaseMigrationManager {
  private static instance: DatabaseMigrationManager | null = null;
  private migrations: Migration[] = [];
  private migrationsPath: string;

  /**
   * Create a new DatabaseMigrationManager instance
   * @param migrationsPath Path to migrations directory
   */
  constructor(migrationsPath: string = process.env.MIGRATIONS_PATH || "./data/migrations") {
    this.migrationsPath = migrationsPath;
  }

  /**
   * Get the singleton instance of DatabaseMigrationManager
   */
  static getInstance(migrationsPath?: string): DatabaseMigrationManager {
    if (!this.instance) {
      this.instance = new DatabaseMigrationManager(migrationsPath);
      logger.info("DatabaseMigrationManager singleton created");
    }
    return this.instance;
  }

  /**
   * Initialize the migration manager
   */
  async initialize(): Promise<void> {
    try {
      // Ensure migrations directory exists
      await fs.mkdir(this.migrationsPath, { recursive: true });
      
      // Load all migrations
      await this.loadMigrations();
      
      logger.info(`DatabaseMigrationManager initialized with ${this.migrations.length} migrations`);
    } catch (error) {
      logger.error("Failed to initialize DatabaseMigrationManager:", error);
      throw error;
    }
  }

  /**
   * Load all migration scripts from the migrations directory
   */
  private async loadMigrations(): Promise<void> {
    try {
      // Create migrations table if it doesn't exist yet
      const migrationTableScript = `
        CREATE TABLE IF NOT EXISTS migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          timestamp INTEGER NOT NULL,
          applied INTEGER DEFAULT 0
        )
      `;
      
      // Store this as the first migration (version 0)
      this.migrations.push({
        version: 0,
        name: "init_migrations_table",
        up: [migrationTableScript],
        down: ["DROP TABLE IF EXISTS migrations"]
      });
      
      // Load migration files from directory
      const files = await fs.readdir(this.migrationsPath);
      const migrationFiles = files.filter(file => file.endsWith('.json'));
      
      for (const file of migrationFiles) {
        try {
          const content = await fs.readFile(path.join(this.migrationsPath, file), 'utf-8');
          const migration = JSON.parse(content) as Migration;
          
          // Validate migration
          if (!migration.version || !migration.name || !migration.up) {
            logger.warn(`Invalid migration format in ${file}, skipping`);
            continue;
          }
          
          this.migrations.push(migration);
        } catch (error) {
          logger.error(`Error parsing migration file ${file}:`, error);
        }
      }
      
      // Sort migrations by version
      this.migrations.sort((a, b) => a.version - b.version);
      
      logger.info(`Loaded ${this.migrations.length} migrations`);
    } catch (error) {
      logger.error("Error loading migrations:", error);
      throw error;
    }
  }

  /**
   * Create a new migration file
   * @param name Migration name
   * @param upQueries Array of SQL statements for up migration
   * @param downQueries Array of SQL statements for down migration
   */
  async createMigration(name: string, upQueries: string[], downQueries: string[]): Promise<Migration> {
    // Get highest current version
    const currentVersion = this.migrations.length > 0 
      ? Math.max(...this.migrations.map(m => m.version))
      : 0;
    
    const newVersion = currentVersion + 1;
    
    const migration: Migration = {
      version: newVersion,
      name: name.toLowerCase().replace(/[^a-z0-9_]/g, '_'),
      up: upQueries,
      down: downQueries
    };
    
    // Save migration to file
    const filename = `${newVersion.toString().padStart(3, '0')}_${migration.name}.json`;
    const filePath = path.join(this.migrationsPath, filename);
    
    await fs.writeFile(filePath, JSON.stringify(migration, null, 2));
    
    // Add to loaded migrations
    this.migrations.push(migration);
    
    logger.info(`Created new migration: ${filename}`);
    return migration;
  }

  /**
   * Get the current database version for a specific user
   * @param dbManager DatabaseManager instance to check version for
   */
  private async getDatabaseVersion(dbManager: DatabaseManager): Promise<number> {
    try {
      // Check if migrations table exists
      const tableExists = await dbManager.query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='migrations'"
      );
      
      if (!tableExists) {
        return -1; // No migrations table, needs initialization
      }
      
      // Get highest applied migration version
      const result = await dbManager.query(
        "SELECT MAX(version) as version FROM migrations WHERE applied = 1"
      );
      
      return result && result.version !== null ? result.version : -1;
    } catch (error) {
      logger.error("Error getting database version:", error);
      return -1;
    }
  }

  /**
   * Apply all pending migrations to a specific database
   * @param dbManager DatabaseManager instance to migrate
   */
  async migrateDatabase(dbManager: DatabaseManager): Promise<void> {
    try {
      // Get current database version
      const currentVersion = await this.getDatabaseVersion(dbManager);
      
      // Find migrations that need to be applied
      const pendingMigrations = this.migrations.filter(m => m.version > currentVersion);
      
      if (pendingMigrations.length === 0) {
        logger.info(`Database for ${dbManager.getUserId() || 'single-user'} is up to date (version ${currentVersion})`);
        return;
      }
      
      logger.info(`Migrating database for ${dbManager.getUserId() || 'single-user'} from version ${currentVersion} to ${pendingMigrations[pendingMigrations.length - 1].version}`);
      
      // Apply each migration in order
      for (const migration of pendingMigrations) {
        try {
          // Begin transaction
          await dbManager.execute("BEGIN TRANSACTION");
          
          // Apply each statement in the migration
          for (const statement of migration.up) {
            await dbManager.execute(statement);
          }
          
          // Record the migration in the migrations table
          await dbManager.execute(
            "INSERT INTO migrations (version, name, timestamp, applied) VALUES (?, ?, ?, 1)",
            [migration.version, migration.name, Date.now()]
          );
          
          // Commit transaction
          await dbManager.execute("COMMIT");
          
          logger.info(`Applied migration ${migration.version}: ${migration.name}`);
        } catch (error) {
          // Rollback on error
          await dbManager.execute("ROLLBACK");
          logger.error(`Failed to apply migration ${migration.version}: ${migration.name}`, error);
          throw error;
        }
      }
      
      logger.info(`Database migration completed successfully for ${dbManager.getUserId() || 'single-user'}`);
    } catch (error) {
      logger.error(`Database migration failed for ${dbManager.getUserId() || 'single-user'}:`, error);
      throw error;
    }
  }

  /**
   * Rollback the database to a specific version
   * @param dbManager DatabaseManager instance to rollback
   * @param targetVersion Version to rollback to
   */
  async rollbackDatabase(dbManager: DatabaseManager, targetVersion: number): Promise<void> {
    try {
      // Get current database version
      const currentVersion = await this.getDatabaseVersion(dbManager);
      
      if (currentVersion <= targetVersion) {
        logger.info(`Database already at or below target version ${targetVersion}`);
        return;
      }
      
      // Find migrations that need to be rolled back (in reverse order)
      const migrationsToRollback = this.migrations
        .filter(m => m.version > targetVersion && m.version <= currentVersion)
        .sort((a, b) => b.version - a.version);
      
      logger.info(`Rolling back database from version ${currentVersion} to ${targetVersion}`);
      
      // Apply each rollback in reverse order
      for (const migration of migrationsToRollback) {
        try {
          // Begin transaction
          await dbManager.execute("BEGIN TRANSACTION");
          
          // Apply each statement in the down migration
          for (const statement of migration.down) {
            await dbManager.execute(statement);
          }
          
          // Update the migration in the migrations table
          await dbManager.execute(
            "UPDATE migrations SET applied = 0, timestamp = ? WHERE version = ?",
            [Date.now(), migration.version]
          );
          
          // Commit transaction
          await dbManager.execute("COMMIT");
          
          logger.info(`Rolled back migration ${migration.version}: ${migration.name}`);
        } catch (error) {
          // Rollback on error
          await dbManager.execute("ROLLBACK");
          logger.error(`Failed to roll back migration ${migration.version}: ${migration.name}`, error);
          throw error;
        }
      }
      
      logger.info(`Database rollback completed successfully`);
    } catch (error) {
      logger.error("Database rollback failed:", error);
      throw error;
    }
  }

  /**
   * Migrate all user databases to the latest version
   */
  async migrateAllDatabases(): Promise<void> {
    // Get database registry
    const dbRegistry = DatabaseRegistry.getInstance();
    
    try {
      // First, migrate the single-user database (for backward compatibility)
      const singleUserDb = DatabaseManager.getInstance();
      await this.migrateDatabase(singleUserDb);
      
      // Get all user IDs
      const userIds = await dbRegistry.listUserDatabases();
      
      // Migrate each user database
      for (const userId of userIds) {
        const dbManager = await dbRegistry.getDatabaseManager(userId);
        await this.migrateDatabase(dbManager);
      }
      
      logger.info(`Successfully migrated all databases (${userIds.length + 1} total)`);
    } catch (error) {
      logger.error("Failed to migrate all databases:", error);
      throw error;
    }
  }

  /**
   * Get migration status for all databases
   */
  async getMigrationStatus(): Promise<Record<string, MigrationMeta[]>> {
    const result: Record<string, MigrationMeta[]> = {};
    
    // Get database registry
    const dbRegistry = DatabaseRegistry.getInstance();
    
    try {
      // First, get status for single-user database
      const singleUserDb = DatabaseManager.getInstance();
      result["single-user"] = await this.getDatabaseMigrationStatus(singleUserDb);
      
      // Get all user IDs
      const userIds = await dbRegistry.listUserDatabases();
      
      // Get status for each user database
      for (const userId of userIds) {
        const dbManager = await dbRegistry.getDatabaseManager(userId);
        result[userId] = await this.getDatabaseMigrationStatus(dbManager);
      }
      
      return result;
    } catch (error) {
      logger.error("Failed to get migration status:", error);
      throw error;
    }
  }

  /**
   * Get migration status for a specific database
   * @param dbManager DatabaseManager instance to check
   */
  private async getDatabaseMigrationStatus(dbManager: DatabaseManager): Promise<MigrationMeta[]> {
    try {
      // Check if migrations table exists
      const tableExists = await dbManager.query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='migrations'"
      );
      
      if (!tableExists) {
        // No migrations table, return all migrations as not applied
        return this.migrations.map(m => ({
          version: m.version,
          name: m.name,
          timestamp: 0,
          applied: false
        }));
      }
      
      // Get all applied migrations
      const appliedMigrations = await dbManager.queryAll(
        "SELECT version, name, timestamp, applied FROM migrations ORDER BY version"
      );
      
      // Convert to map for easy lookup
      const appliedMap = new Map<number, MigrationMeta>();
      for (const migration of appliedMigrations) {
        appliedMap.set(migration.version, {
          version: migration.version,
          name: migration.name,
          timestamp: migration.timestamp,
          applied: migration.applied === 1
        });
      }
      
      // Create status for all known migrations
      return this.migrations.map(m => {
        const applied = appliedMap.get(m.version);
        return applied || {
          version: m.version,
          name: m.name,
          timestamp: 0,
          applied: false
        };
      });
    } catch (error) {
      logger.error(`Error getting migration status for ${dbManager.getUserId() || 'single-user'}:`, error);
      return [];
    }
  }
}