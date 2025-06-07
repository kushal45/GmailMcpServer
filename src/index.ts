#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import dotenv from 'dotenv';
import { GmailMcpServer } from './server.js';
import { logger } from './utils/logger.js';

// Load environment variables
dotenv.config();

async function main() {
  try {
    const server = new GmailMcpServer();
    const transport = new StdioServerTransport();
    
    await server.connect(transport);
    logger.info('Gmail MCP server started successfully');
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      logger.info('Shutting down Gmail MCP server...');
      await server.close();
      process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
      logger.info('Shutting down Gmail MCP server...');
      await server.close();
      process.exit(0);
    });
    
  } catch (error) {
    logger.error('Failed to start Gmail MCP server:', error);
    process.exit(1);
  }
}

// Run the server
main().catch((error) => {
  logger.error('Unhandled error:', error);
  process.exit(1);
});