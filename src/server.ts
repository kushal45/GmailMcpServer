import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { AuthManager } from './auth/AuthManager.js';
import { EmailFetcher } from './email/EmailFetcher.js';
import { CategorizationEngine } from './categorization/CategorizationEngine.js';
import { SearchEngine } from './search/SearchEngine.js';
import { ArchiveManager } from './archive/ArchiveManager.js';
import { DeleteManager } from './delete/DeleteManager.js';
import { DatabaseManager } from './database/DatabaseManager.js';
import { CacheManager } from './cache/CacheManager.js';
import { logger } from './utils/logger.js';
import { toolDefinitions } from './tools/definitions.js';
import { handleToolCall } from './tools/handler.js';

export class GmailMcpServer {
  private server: Server;
  private authManager: AuthManager;
  private emailFetcher: EmailFetcher;
  private categorizationEngine: CategorizationEngine;
  private searchEngine: SearchEngine;
  private archiveManager: ArchiveManager;
  private deleteManager: DeleteManager;
  private databaseManager: DatabaseManager;
  private cacheManager: CacheManager;

  constructor() {
    this.server = new Server(
      {
        name: 'gmail-mcp-server',
        version: '0.1.0',
        description: 'MCP server for Gmail integration with email categorization, search, archive, and delete capabilities',
      },
      {
        capabilities: {
          resources: {},
          tools: {},
        },
      }
    );

    // Initialize managers
    this.databaseManager = new DatabaseManager();
    this.cacheManager = new CacheManager();
    this.authManager = new AuthManager();
    this.emailFetcher = new EmailFetcher(this.authManager, this.cacheManager);
    this.categorizationEngine = new CategorizationEngine(this.databaseManager, this.cacheManager);
    this.searchEngine = new SearchEngine(this.databaseManager, this.emailFetcher);
    this.archiveManager = new ArchiveManager(this.authManager, this.databaseManager);
    this.deleteManager = new DeleteManager(this.authManager, this.databaseManager);

    this.setupHandlers();
    this.setupErrorHandling();
  }

  private setupHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: toolDefinitions,
    }));

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        const result = await handleToolCall(
          request.params.name,
          request.params.arguments || {},
          {
            authManager: this.authManager,
            emailFetcher: this.emailFetcher,
            categorizationEngine: this.categorizationEngine,
            searchEngine: this.searchEngine,
            archiveManager: this.archiveManager,
            deleteManager: this.deleteManager,
            databaseManager: this.databaseManager,
            cacheManager: this.cacheManager,
          }
        );
        return result;
      } catch (error) {
        if (error instanceof McpError) {
          throw error;
        }
        logger.error('Tool call error:', error);
        throw new McpError(
          ErrorCode.InternalError,
          `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    });
  }

  private setupErrorHandling() {
    this.server.onerror = (error) => {
      logger.error('MCP Server error:', error);
    };

    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
    });

    process.on('uncaughtException', (error) => {
      logger.error('Uncaught Exception:', error);
      process.exit(1);
    });
  }

  async connect(transport: StdioServerTransport) {
    await this.initialize();
    await this.server.connect(transport);
    logger.info('Gmail MCP server connected to transport');
  }

  private async initialize() {
    try {
      // Initialize database
      await this.databaseManager.initialize();
      logger.info('Database initialized');

      // Initialize cache
      await this.cacheManager.initialize();
      logger.info('Cache initialized');

      // Check for existing auth
      const hasAuth = await this.authManager.hasValidAuth();
      if (hasAuth) {
        logger.info('Found existing authentication');
      } else {
        logger.info('No existing authentication found - user will need to authenticate');
      }
    } catch (error) {
      logger.error('Failed to initialize server:', error);
      throw error;
    }
  }

  async close() {
    try {
      await this.databaseManager.close();
      await this.server.close();
      logger.info('Gmail MCP server closed');
    } catch (error) {
      logger.error('Error closing server:', error);
    }
  }
}