#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import dotenv from "dotenv";
import { GmailMcpServer } from "./server.js";
import path from "path";
import { fileURLToPath } from "url";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Main entry point for the Gmail MCP server.
 * Loads environment variables, initializes the server, and connects to transport.
 */

async function main() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    dotenv.config({
      path: path.join(__dirname, "../.env"),
      override: true,
    });
    console.error(
      "environment variables loaded",
      JSON.stringify({
        env: {
          NODE_ENV: process.env.NODE_ENV,
          ARCHIVE_PATH: process.env.ARCHIVE_PATH,
          GMAIL_CLIENT_ID: process.env.GMAIL_CLIENT_ID,
          GMAIL_CLIENT_SECRET: process.env.GMAIL_CLIENT_SECRET,
          GMAIL_REDIRECT_URI: process.env.GMAIL_REDIRECT_URI,
          GMAIL_REFRESH_TOKEN: process.env.GMAIL_REFRESH_TOKEN,
          GMAIL_USER_EMAIL: process.env.GMAIL_USER_EMAIL,
          MCP_SERVER_PORT: process.env.MCP_SERVER_PORT || "3000",
          GMAIL_BATCH_SIZE: process.env.GMAIL_BATCH_SIZE,
        },
      })
    );
    //console.error("Starting Gmail MCP server...");
    const server = new GmailMcpServer();
    const transport = new StdioServerTransport();
    //console.error("Connecting to transport...");
    await server.connect(transport);
    //console.error("Server connected successfully");

    // Handle graceful shutdown
    process.on("SIGINT", async () => {
      console.error("Received SIGINT");
      await server.close();
      process.exit(0);
    });

    process.on("SIGTERM", async () => {
      console.error("Received SIGTERM sleeping for 4 seconds");
       await sleep(4000);
       process.stdin.resume();
       process.stdout.resume();
       await server.close();
       process.exit(0);
    });

    // Keep the process alive
    process.stdin.resume();
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

// Run the server
main().catch((error) => {
  //console.error("Main function error:", error);
  process.exit(1);
});
