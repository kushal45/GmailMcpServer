import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { AuthManager } from "./auth/AuthManager.js";
import { EmailFetcher } from "./email/EmailFetcher.js";
import { SearchEngine } from "./search/SearchEngine.js";
import { ArchiveManager } from "./archive/ArchiveManager.js";
import { DeleteManager } from "./delete/DeleteManager.js";
import { DatabaseManager } from "./database/DatabaseManager.js";
import { CacheManager } from "./cache/CacheManager.js";
import { logger } from "./utils/logger.js";
import { toolDefinitions } from "./tools/definitions.js";
import { handleToolCall } from "./tools/handler.js";
import { JobQueue } from "./database/JobQueue.js";
import { CategorizationEngine } from "./categorization/CategorizationEngine.js";
import { CategorizationWorker } from "./categorization/CategorizationWorker.js";
import { JobStatusStore } from "./database/JobStatusStore.js";
import { CleanupAutomationEngine } from "./cleanup/CleanupAutomationEngine.js";
import { setupFormatterRegistry } from "./archive/setupFormatters.js";
import { FileAccessControlManager } from "./services/FileAccessControlManager.js";
import { UserManager } from "./auth/UserManager.js";
import { userDatabaseInitializer } from "./database/UserDatabaseInitializer.js";
import { setupConnectionMonitoring, globalConnectionMonitor } from "./utils/ConnectionHealthMonitor.js";
import { userDatabaseManagerFactory } from "./database/UserDatabaseManagerFactory.js";

export class GmailMcpServer {
  private server: Server;
  private authManager: AuthManager;
  private emailFetcher: EmailFetcher;
  private searchEngine: SearchEngine;
  private archiveManager: ArchiveManager;
  private deleteManager: DeleteManager;
  private databaseManager: DatabaseManager;
  private cacheManager: CacheManager;
  private jobQueue: JobQueue;
  private categorizationEngine: CategorizationEngine;
  private jobStatusStore: JobStatusStore;
  private categorizationWorker: CategorizationWorker | null = null;
  private cleanupAutomationEngine: CleanupAutomationEngine;
  private fileAccessControlManager: FileAccessControlManager;
  private userManager: UserManager;
  constructor() {
    this.server = new Server(
      {
        name: "gmail-mcp-server",
        version: "0.1.0",
        description:
          "MCP server for Gmail integration with email categorization, search, archive, and delete capabilities",
      },
      {
        capabilities: {
          resources: {},
          tools: {},
        },
      }
    );

    // Initialize managers
    this.databaseManager = DatabaseManager.getInstance();
    this.jobStatusStore = JobStatusStore.getInstance();
    this.cacheManager = new CacheManager();
    this.userManager = UserManager.getInstance();
    const enableMultiUser = process.env.MULTI_USER_MODE === 'true';
    this.authManager = new AuthManager({enableMultiUser});
    this.fileAccessControlManager = new FileAccessControlManager(this.databaseManager);
    this.emailFetcher = new EmailFetcher(
      userDatabaseManagerFactory,
      this.authManager,
      this.cacheManager
    );
    this.searchEngine = new SearchEngine(
      userDatabaseInitializer,
      this.userManager
    );
    const formatRegistry = setupFormatterRegistry()
    this.archiveManager = new ArchiveManager(
      this.authManager,
      userDatabaseManagerFactory,
      formatRegistry,
      this.fileAccessControlManager
    );
    this.deleteManager = new DeleteManager(
      this.authManager,
      userDatabaseManagerFactory
    );
    this.jobQueue = new JobQueue();
    this.categorizationEngine = new CategorizationEngine(
      userDatabaseManagerFactory,
      this.cacheManager
    );

    // Initialize cleanup automation engine (will be started in initialize())
    this.cleanupAutomationEngine = CleanupAutomationEngine.getInstance(
      this.databaseManager,
      this.jobQueue,
      this.deleteManager
    );

    this.setupHandlers();
    this.setupErrorHandling();
  }

  private setupHandlers() {
    // The MCP SDK handles the initialize request automatically
    // We just need to handle tools listing and tool calls
    // NOTE: CategorizationWorker startup moved to initialize() method to avoid race condition
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
     // console.error("[DEBUG] Handling list tools request");
      return {
        tools: toolDefinitions,
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      //console.error("[DEBUG] Handling tool call:", request.params.name);
      //console.error("[DEBUG] Tool arguments:", request.params.arguments);
      try {
        const result = await handleToolCall(
          request.params.name,
          request.params.arguments || {},
          {
            authManager: this.authManager,
            emailFetcher: this.emailFetcher,
            searchEngine: this.searchEngine,
            archiveManager: this.archiveManager,
            deleteManager: this.deleteManager,
            databaseManager: this.databaseManager,
            cacheManager: this.cacheManager,
            jobQueue: this.jobQueue,
            categorizationEngine: this.categorizationEngine,
            cleanupAutomationEngine: this.cleanupAutomationEngine,
            userManager: this.userManager,
          }
        );
        return result;
      } catch (error) {
        if (error instanceof McpError) {
          throw error;
        }
        logger.error("Tool call error:", error);
        throw new McpError(
          ErrorCode.InternalError,
          `Tool execution failed: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    });
  }

  private setupErrorHandling() {
    this.server.onerror = (error) => {
      logger.error("MCP Server error:", error);
    };

    // Enhanced connection handling for SSE/transport stability
    this.server.onclose = () => {
      logger.info("MCP Server connection closed");
    };

    process.on("unhandledRejection", (reason) => {
      logger.error(`Unhandled Rejection with reason : ${JSON.stringify(reason)}`);
    });

    process.on("uncaughtException", (error) => {
      logger.error("Uncaught Exception:", error);
      //process.exit(1);
    });

    // Handle process termination more gracefully
    process.on("beforeExit", (code) => {
      logger.info(`Process beforeExit with code: ${code}`);
    });

    process.on("exit", (code) => {
      logger.info(`Process exit with code: ${code}`);
    });
  }

  async connect(transport: StdioServerTransport) {
    await this.initialize();

    // Setup connection monitoring
    setupConnectionMonitoring(this.server);
    globalConnectionMonitor.onConnectionEstablished('stdio');

    await this.server.connect(transport);
    logger.debug("Gmail MCP server connected to transport");
  }

  private async initialize() {
    try {
      // Initialize database
      await this.databaseManager.initialize().then(async () => {
       this.categorizationWorker = new CategorizationWorker(
          this.jobQueue,
          this.categorizationEngine
        );
        this.categorizationWorker.start();
        await this.jobStatusStore.initialize();
      });
      
      logger.debug("Database initialized");

      // Start categorization worker AFTER database is initialized to prevent race condition
      logger.debug(
        "Starting categorization worker after database initialization",
        {
          timestamp: new Date().toISOString(),
          databaseInitialized: this.databaseManager.isInitialized(),
        }
      );

      logger.debug("Categorization worker started successfully");

      // Initialize auth manager (but don't check for valid auth yet)
      try {
        await this.authManager.initialize();
        logger.debug("Auth manager initialized");
      } catch (error) {
        logger.warn(
          "Auth manager initialization failed - credentials may be missing:",
          error
        );
        // Continue without auth - user will need to authenticate
      }

      // Initialize cleanup automation engine
      try {
        await this.cleanupAutomationEngine.initialize();
        logger.debug("Cleanup automation engine initialized");
      } catch (error) {
        logger.warn("Cleanup automation engine initialization failed:", error);
        // Continue without cleanup automation - it's optional
      }
    } catch (error) {
      logger.error("Failed to initialize server:", error);
      throw error;
    }
  }

  async close() {
    try {
      // Stop categorization worker before closing database
      if (this.categorizationWorker) {
        this.categorizationWorker.stop();
        logger.info("Categorization worker stopped");
      }

      // Cleanup auth manager resources
      try {
        await this.authManager.cleanup();
        logger.debug("Auth manager cleanup complete");
      } catch (error) {
        logger.error("Error during auth manager cleanup:", error);
      }

      // Shutdown cleanup automation engine
      try {
        await this.cleanupAutomationEngine.shutdown();
        logger.debug("Cleanup automation engine shutdown");
      } catch (error) {
        logger.error("Error shutting down cleanup automation engine:", error);
      }

      await this.databaseManager.close();
      await this.server.close();
      logger.debug("Gmail MCP server closed");
    } catch (error) {
      logger.error("Error closing server:", error);
    }
  }
}
