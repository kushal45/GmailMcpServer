import { EmailIndex } from './../../../src/types/index';
import fs from 'fs';
import { randomUUID } from "crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  describe,
  test,
  expect,
  beforeAll,
  afterAll,
  jest,
} from "@jest/globals";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import Ajv from "ajv";
import puppeteer from "puppeteer";
import path from "path";
import os from "os";
import { fileURLToPath } from 'url';

const ajv = new Ajv();

// Add interfaces for validated responses
type AuthResponse = {
  success: boolean;
  user_id: string;
  session_id: string;
};

type ListEmailsResponse = {
  emails: EmailIndex[];
  total: number;
};

jest.setTimeout(120000);

describe("Gmail MCP Server - All MCP Tool Combinations", () => {
  let client: Client;
  let userContext: { user_id: string; session_id: string } = {
    user_id: "user1",
    session_id: "sess1",
  };
  let userContext2: { user_id: string; session_id: string } = {
    user_id: "user2",
    session_id: "sess2",
  };
  let jobId: string;
  let policyId: string;
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  beforeAll(async () => {
    // remove all user profiles and token files
    const userProfilesPath = path.join(process.env.STORAGE_PATH || path.join(__dirname, '../../../data/users'));
    if (fs.existsSync(userProfilesPath)) {
      fs.rmSync(userProfilesPath, { recursive: true });
    }
    const tokenStoragePath = path.join(process.env.STORAGE_PATH || path.join(__dirname, '../../../data/tokens'));
    if (fs.existsSync(tokenStoragePath)) {
      fs.rmSync(tokenStoragePath, { recursive: true });
    }
    const transport = new StdioClientTransport({
      command: "node",
      args: ["--inspect-brk", "./build/index.js"],
    });
    client = new Client({
      name: "gmail-mcp-server",
      version: "1.0.0",
      title: "Gmail MCP Server",
      description: "A server for the Gmail MCP",
    });
    await client.connect(transport);
    console.info("Client connected to transport");

    // Wait for server to be ready by polling get_system_health
    let ready = false;
    for (let i = 0; i < 10; i++) {
      try {
        await client.callTool({
          name: "get_system_health",
          arguments: {
            user_context: { user_id: "user1", session_id: "sess1" },
          },
        });
        console.info("Server is ready");
        ready = true;
        break;
      } catch (e) {
        await new Promise((res) => setTimeout(res, 500));
      }
    }
    if (!ready) throw new Error("Server did not become ready in time");
  });

  afterAll(async () => {
    console.log("Disconnecting client");
    if (client) {
      await client.close();
    }
  });

  // --- AUTHENTICATION ---
  test("should register, authenticate and obtain user context", async () => {
    
    const registerResp = await client.callTool({
      name: "register_user",
      arguments: {
        email: "sensennium.kushal4@gmail.com",
        display_name: "Kushal",
        role: "admin",
        user_context: userContext,
      },
    });
    const registrationContent = JSON.parse((registerResp as any).content[0].text);
    console.info("Register user response:", registrationContent);
    expect(registrationContent.success).toBe(true);
    expect(registrationContent.userId).toBeDefined();
    expect(registrationContent.displayName).toBe("Kushal");
    expect(registrationContent.role).toBe("admin");
    const registerUser2Resp = await client.callTool({
      name: "register_user",
      arguments: {
        email: "chakrabortycsoumi@gmail.com",
        display_name: "Soumi",
        role: "admin",
        user_context: userContext,
      },
    });
    const registrationContent2 = JSON.parse((registerUser2Resp as any).content[0].text);
    console.info("Register user response:", registrationContent2);
    expect(registrationContent2.success).toBe(true);
    expect(registrationContent2.userId).toBeDefined();

    
    const authenticateSchema = {
      type: "object",
      properties: {
        success: { type: "boolean" },
        user_id: { type: "string", nullable: true },
        session_id: { type: "string", nullable: true },
        authUrl: { type: "string" },
      },
      required: ["success", "authUrl"],
    };
    const validateAuthenticate = ajv.compile(authenticateSchema);
    console.info("Calling authenticate tool");
    const resp = await client.callTool({
      name: "authenticate",
      arguments: {
        email: "sensennium.kushal4@gmail.com",
        display_name: "Test User",
        session_id: "sess1",
      },
    });
    const content = (resp as any).content[0].text;
    const contentObj = JSON.parse(content);
    console.info("Authenticate tool response:", contentObj);
    expect(validateAuthenticate(contentObj)).toBe(true);
    expect(contentObj.success).toBe(true);
    const authUrl = contentObj.authUrl;
    // mimimc handle click on authUrl
    try {
      const randomUUID = crypto.randomUUID();
      const newUserDataDir = path.join(
        `${os.tmpdir()}-${randomUUID}`,
        "puppeteer_profile"
      ); // Or a more permanent location
      const browser = await puppeteer.launch({
        headless: false,
        executablePath:
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        userDataDir: newUserDataDir,
        slowMo: 100,
        args: [
          "--disable-blink-features=AutomationControlled",
          "--disable-infobars",
          // ... other args
        ],
      });
      const page = await browser.newPage();
      await page.goto(authUrl, { waitUntil: "networkidle0" });
      // Wait for the OAuth flow to finish and redirect to your callback
      await page.waitForFunction(
        'window.location.pathname.includes("/oauth2callback")',
        { timeout: 120000 }
      );
      
      // Wait for the unique text to appear (robust against duplicate/empty pages)
      userContext = (await page.evaluate(() => {
        // This assumes your HTML contains <p>Your session ID is ...</p> and <p>Your user ID is ...</p>
        const sessionIdText = Array.from(document.querySelectorAll("p")).find(
          (p) => p.textContent?.includes("session ID")
        )?.textContent;
        const userIdText = Array.from(document.querySelectorAll("p")).find(
          (p) => p.textContent?.includes("user ID")
        )?.textContent;
        const session_id = sessionIdText?.split("session ID is ")[1]?.trim();
        const user_id = userIdText?.split("user ID is ")[1]?.trim();
        console.info("User context:", { user_id, session_id });
        return { user_id, session_id };
      })) as { user_id: string; session_id: string };
      console.info("User context:", userContext);
      await browser.close();
    } catch (error) {
      console.error("Error launching browser:", error);
      throw error;
    }

    // Now use userContext for all further tool calls
    expect(userContext.user_id).toBeDefined();
    expect(userContext.session_id).toBeDefined();
  });

  // --- USER MANAGEMENT ---
  test("should list, get profile, and switch user", async () => {
    const listUsersResp = await client.callTool({
      name: "list_users",
      arguments: { user_context: userContext },
    });
    console.info("List users response:", listUsersResp);

    const getUserProfileResp = await client.callTool({
      name: "get_user_profile",
      arguments: { user_context: userContext },
    });
    console.info("List users response:", listUsersResp);
    console.info("Get user profile response:", getUserProfileResp);
    await expect( client.callTool({
      name: "switch_user",
      arguments: { target_user_id: "user1", user_context: userContext },
    })).rejects.toThrow(/User with ID user1 not found/);
  });

  // --- EMAIL MANAGEMENT ---
  test("should list, get details, and categorize emails", async () => {
    const listResp = await client.callTool({
      name: "list_emails",
      arguments: { user_context: userContext },
    });
    // Schema validation for list_emails response
    const listEmailsSchema = {
      type: "object",
      properties: {
        emails: { type: "array", items: { type: "object" } },
        total: { type: "number" },
      },
      required: ["emails", "total"],
    };
    const validateListEmails = ajv.compile(listEmailsSchema);
    const listEmailsContent = JSON.parse((listResp as any).content[0].text);
    expect(validateListEmails(listEmailsContent)).toBe(true);
    const emailsResp = listEmailsContent as ListEmailsResponse;
    console.info("Emails response:", listEmailsContent);
    expect(emailsResp.total).toBeGreaterThan(0);
    expect(emailsResp.emails.length).toBeGreaterThan(0);
    expect(emailsResp.emails[0].id).toBeDefined();
    expect(emailsResp.emails[0].subject).toBeDefined();
    expect(emailsResp.emails[0].sender).toBeDefined();
    expect(emailsResp.emails[0].promotional_score).toBeDefined();
    expect(emailsResp.emails[0].date).toBeDefined();
    expect(emailsResp.emails[0].size).toBeDefined();
    expect(emailsResp.emails[0].labels).toBeDefined();
    expect(emailsResp.emails[0].hasAttachments).toBeDefined();
    expect(emailsResp.emails[0].archived).toBeDefined();
    expect(emailsResp.emails[0].category).toBeDefined();
    
    /*
    if (emailsResp.emails.length > 0) {
      await client.callTool({
        name: "get_email_details",
        arguments: { id: emailsResp.emails[0].id, user_context: userContext },
      });
    }
    await client.callTool({
      name: "categorize_emails",
      arguments: { year: 2024, force_refresh: true, user_context: userContext },
    });
    */
  });

  // --- SEARCH ---
  xtest("should search, save, and list saved searches", async () => {
    await client.callTool({
      name: "search_emails",
      arguments: { query: "test", user_context: userContext },
    });
    await client.callTool({
      name: "save_search",
      arguments: {
        name: "Test Search",
        criteria: { query: "test" },
        user_context: userContext,
      },
    });
    await client.callTool({
      name: "list_saved_searches",
      arguments: { user_context: userContext },
    });
  });

  // --- ARCHIVE ---
  xtest("should archive, restore, create/list archive rules, and export emails", async () => {
    await client.callTool({
      name: "archive_emails",
      arguments: { method: "gmail", user_context: userContext },
    });
    // Optionally, test restore_emails if you have an archive_id
    await client.callTool({
      name: "create_archive_rule",
      arguments: {
        name: "Auto-archive test",
        criteria: { category: "low", older_than_days: 30 },
        action: { method: "gmail" },
        schedule: "weekly",
        user_context: userContext,
      },
    });
    await client.callTool({
      name: "list_archive_rules",
      arguments: { user_context: userContext },
    });
    await client.callTool({
      name: "export_emails",
      arguments: { format: "json", user_context: userContext },
    });
  });

  // --- DELETE & CLEANUP ---
  xtest("should delete, empty trash, trigger cleanup, and manage cleanup policies", async () => {
    await client.callTool({
      name: "delete_emails",
      arguments: { dry_run: true, user_context: userContext },
    });
    await client.callTool({
      name: "empty_trash",
      arguments: { dry_run: true, user_context: userContext },
    });
    // Create a cleanup policy
    const createPolicyResp = await client.callTool({
      name: "create_cleanup_policy",
      arguments: {
        name: "Test Cleanup",
        enabled: true,
        priority: 50,
        criteria: {},
        action: {},
        safety: {},
        schedule: {},
        user_context: userContext,
      },
    });
    policyId =
      typeof createPolicyResp.policy_id === "string"
        ? createPolicyResp.policy_id
        : "policy1";
    await client.callTool({
      name: "trigger_cleanup",
      arguments: { policy_id: policyId, user_context: userContext },
    });
    await client.callTool({
      name: "get_cleanup_status",
      arguments: { user_context: userContext },
    });
    await client.callTool({
      name: "get_system_health",
      arguments: { user_context: userContext },
    });
    await client.callTool({
      name: "update_cleanup_policy",
      arguments: {
        policy_id: policyId,
        updates: { enabled: false },
        user_context: userContext,
      },
    });
    await client.callTool({
      name: "list_cleanup_policies",
      arguments: { user_context: userContext },
    });
    await client.callTool({
      name: "delete_cleanup_policy",
      arguments: { policy_id: policyId, user_context: userContext },
    });
    await client.callTool({
      name: "create_cleanup_schedule",
      arguments: {
        name: "Weekly Cleanup",
        type: "weekly",
        expression: "0 0 * * 0",
        policy_id: policyId,
        enabled: true,
        user_context: userContext,
      },
    });
    await client.callTool({
      name: "update_cleanup_automation_config",
      arguments: { config: {}, user_context: userContext },
    });
    await client.callTool({
      name: "get_cleanup_metrics",
      arguments: { hours: 24, user_context: userContext },
    });
    await client.callTool({
      name: "get_cleanup_recommendations",
      arguments: { user_context: userContext },
    });
  });

  // --- JOB MANAGEMENT ---
  xtest("should list jobs, get/cancel job status", async () => {
    const listResp = await client.callTool({
      name: "list_jobs",
      arguments: { limit: 10, user_context: userContext },
    });
    // Schema validation for list_jobs response
    const listJobsSchema = {
      type: "object",
      properties: {
        jobs: { type: "array", items: { type: "object" } },
      },
      required: ["jobs"],
    };
    const validateListJobs = ajv.compile(listJobsSchema);
    expect(validateListJobs(listResp)).toBe(true);
    if (Array.isArray(listResp.jobs) && listResp.jobs.length > 0) {
      jobId = listResp.jobs[0].id;
      await client.callTool({
        name: "get_job_status",
        arguments: { id: jobId, user_context: userContext },
      });
      await client.callTool({
        name: "cancel_job",
        arguments: { id: jobId, user_context: userContext },
      });
    }
  });

  // --- ERROR CASES ---
  xtest("should handle invalid tool and missing params", async () => {
    try {
      await client.callTool({ name: "nonexistent_tool", arguments: {} });
      throw new Error("Should have failed");
    } catch (err: any) {
      expect(err).toHaveProperty("code");
    }
    try {
      await client.callTool({ name: "list_emails", arguments: {} }); // missing user_context
      throw new Error("Should have failed");
    } catch (err: any) {
      expect(err).toHaveProperty("code");
    }
  });

  // --- RESPONSE SCHEMA VALIDATION (EXAMPLE) ---
  xtest("should validate list_emails response schema", async () => {
    const resp = await client.callTool({
      name: "list_emails",
      arguments: { user_context: userContext },
    });
    const schema = {
      type: "object",
      properties: {
        emails: { type: "array", items: { type: "object" } },
        total: { type: "number" },
      },
      required: ["emails", "total"],
    };
    const validate = ajv.compile(schema);
    expect(validate(resp)).toBe(true);
  });

  // --- MULTI-USER FLOW ---
  xtest("should register and switch to a second user and repeat flows", async () => {
    const regResp = await client.callTool({
      name: "register_user",
      arguments: {
        email: "user2@example.com",
        display_name: "User Two",
        role: "user",
        user_context: userContext,
      },
    });
    expect(regResp).toBeDefined();
    await client.callTool({
      name: "switch_user",
      arguments: { target_user_id: "user2", user_context: userContext },
    });
    await client.callTool({
      name: "list_emails",
      arguments: { user_context: userContext },
    });
    // ...repeat other flows as needed for user2
  });
});
