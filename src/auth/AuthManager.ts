import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';
import http from 'http';
import { URL } from 'url';
import crypto from 'crypto';
import { UserManager } from './UserManager.js';
import { UserSession } from './UserSession.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Default scopes required for Gmail operations
const SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.labels'
];

// Legacy single-user paths (for backward compatibility)
const TOKEN_PATH = path.join(__dirname, '../../token.json');
const CREDENTIALS_PATH = path.join(__dirname, '../../credentials.json');

// Paths for multi-user storage
const DEFAULT_STORAGE_PATH = path.join(__dirname, '../../data');

/**
 * AuthManager class for handling OAuth authentication with Google APIs
 * Supports both legacy single-user mode and new multi-user mode
 */
export class AuthManager {
  private oAuth2Client: OAuth2Client | null = null; // Legacy single-user client
  private authServer: http.Server | null = null;
  private userManager: UserManager | null = null;
  private multiUserMode: boolean = false;
  private activeAuthSessions: Map<string, { sessionId: string, userId: string }> = new Map();
  private pendingAuthRequests: Map<string, { resolve: (sessionId: string) => void, reject: (error: Error) => void }> = new Map();

  /**
   * Create a new AuthManager instance
   * @param options Configuration options
   */
  constructor(
    private options: {
      enableMultiUser?: boolean;
      storagePath?: string;
      encryptionKey?: string;
    } = {}
  ) {
    this.multiUserMode = options.enableMultiUser || false;
  }

  /**
   * Initialize the AuthManager
   */
  async initialize(): Promise<void> {
    try {
      if (this.multiUserMode) {
        // Multi-user mode initialization
        await this.initializeMultiUser();
      } else {
        // Legacy single-user mode initialization
        await this.initializeSingleUser();
      }
      
      logger.info(`AuthManager initialized in ${this.multiUserMode ? 'multi-user' : 'single-user'} mode`);
    } catch (error) {
      logger.error('Failed to initialize AuthManager:', error);
      throw error;
    }
  }

  /**
   * Initialize in multi-user mode
   */
  private async initializeMultiUser(): Promise<void> {
    const storagePath = this.options.storagePath || process.env.STORAGE_PATH || DEFAULT_STORAGE_PATH;
    
    // Initialize UserManager
    this.userManager = UserManager.getInstance();
    await this.userManager.initialize();
    
    logger.info('Multi-user auth manager initialized');
  }

  /**
   * Initialize in legacy single-user mode
   */
  private async initializeSingleUser(): Promise<void> {
    const credentials = await this.loadCredentials();
    const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;
    
    // Fix redirect URI if it's missing the callback path
    let redirectUri = redirect_uris[0];
    if (redirectUri === 'http://localhost') {
      redirectUri = 'http://localhost:3000/oauth2callback';
    }
    
    this.oAuth2Client = new google.auth.OAuth2(
      client_id,
      client_secret,
      redirectUri
    );

    // Try to load existing token
    await this.loadToken();
    
    logger.info('Single-user auth manager initialized');
  }

  /**
   * Load OAuth credentials for single-user mode
   */
  private async loadCredentials(): Promise<any> {
    try {
      const content = await fs.readFile(CREDENTIALS_PATH, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      logger.error('Error loading credentials:', error);
      throw new Error(
        'Unable to load credentials. Please ensure credentials.json is present in the project root.'
      );
    }
  }

  /**
   * Load token for single-user mode
   */
  private async loadToken(): Promise<void> {
    try {
      const token = await fs.readFile(TOKEN_PATH, 'utf-8');
      this.oAuth2Client!.setCredentials(JSON.parse(token));
      logger.info('Loaded existing authentication token');
    } catch (error) {
      logger.info('No existing token found');
    }
  }

  /**
   * Save token for single-user mode
   */
  private async saveToken(token: any): Promise<void> {
    try {
      await fs.writeFile(TOKEN_PATH, JSON.stringify(token));
      logger.info('Token saved successfully');
    } catch (error) {
      logger.error('Error saving token:', error);
      throw error;
    }
  }

  /**
   * Enable multi-user mode
   */
  async enableMultiUserMode(): Promise<void> {
    if (this.multiUserMode) {
      return; // Already in multi-user mode
    }
    
    logger.info('Switching to multi-user mode');
    this.multiUserMode = true;
    await this.initializeMultiUser();
  }

  /**
   * Check if multi-user mode is enabled
   */
  isMultiUserMode(): boolean {
    return this.multiUserMode;
  }

  /**
   * Check if user has valid authentication
   * @param sessionId Optional session ID for multi-user mode
   */
  async hasValidAuth(sessionId?: string): Promise<boolean> {
    try {
      if (this.multiUserMode && sessionId) {
        // Multi-user mode with session
        return await this.hasValidAuthMultiUser(sessionId);
      } else if (this.multiUserMode) {
        // Multi-user mode but no session - fail
        logger.error('Session ID required in multi-user mode');
        return false;
      } else {
        // Legacy single-user mode
        return await this.hasValidAuthSingleUser();
      }
    } catch (error) {
      logger.debug('Auth validation failed:', error);
      return false;
    }
  }

  /**
   * Check auth validity in multi-user mode
   */
  private async hasValidAuthMultiUser(sessionId: string): Promise<boolean> {
    if (!this.userManager) {
      throw new Error('UserManager not initialized');
    }

    // Get the session
    const session = this.userManager.getSession(sessionId);
    if (!session || !session.isValid()) {
      logger.debug(`Invalid or expired session: ${sessionId}`);
      return false;
    }

    try {
      // Check if token exists
      if (await session.hasToken()) {
        const token = await session.getToken();
        
        // Check if token is expired
        if (token.expiry_date && token.expiry_date <= Date.now()) {
          try {
            await this.refreshTokenMultiUser(sessionId);
            return true;
          } catch (error) {
            logger.error(`Failed to refresh token for session ${sessionId}:`, error);
            return false;
          }
        }
        
        return true;
      }
      
      return false;
    } catch (error) {
      logger.error(`Error checking auth validity for session ${sessionId}:`, error);
      return false;
    }
  }

  /**
   * Check auth validity in single-user mode
   */
  private async hasValidAuthSingleUser(): Promise<boolean> {
    if (!this.oAuth2Client) {
      await this.initialize();
    }

    const credentials = this.oAuth2Client!.credentials;
    if (!credentials || !credentials.access_token) {
      return false;
    }

    // Check if token is expired
    if (credentials.expiry_date && credentials.expiry_date <= Date.now()) {
      try {
        await this.refreshTokenSingleUser();
        return true;
      } catch (error) {
        logger.error('Failed to refresh token:', error);
        return false;
      }
    }

    return true;
  }

  /**
   * Refresh token in multi-user mode
   * @param sessionId Session ID to refresh token for
   */
  async refreshToken(sessionId?: string): Promise<void> {
    if (this.multiUserMode && sessionId) {
      // Multi-user mode with session
      await this.refreshTokenMultiUser(sessionId);
    } else if (this.multiUserMode) {
      // Multi-user mode but no session - fail
      throw new Error('Session ID required in multi-user mode');
    } else {
      // Legacy single-user mode
      await this.refreshTokenSingleUser();
    }
  }

  /**
   * Refresh token in multi-user mode
   */
  private async refreshTokenMultiUser(sessionId: string): Promise<void> {
    if (!this.userManager) {
      throw new Error('UserManager not initialized');
    }

    // Get the session
    const session = this.userManager.getSession(sessionId);
    if (!session || !session.isValid()) {
      throw new Error('Invalid or expired session');
    }

    try {
      // Get token
      const token = await session.getToken();
      if (!token.refresh_token) {
        throw new Error('No refresh token available');
      }

      // Create OAuth client
      const oAuth2Client = await this.userManager.getOAuthClientForSession(
        sessionId,
        (clientId, clientSecret, redirectUri) => new google.auth.OAuth2(clientId, clientSecret, redirectUri)
      );

      // Refresh the token
      const { credentials } = await oAuth2Client.refreshAccessToken();
      
      // Store updated token
      await session.updateToken(credentials);
      
      logger.info(`Token refreshed successfully for session ${sessionId}`);
    } catch (error) {
      logger.error(`Error refreshing token for session ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Refresh token in single-user mode
   */
  private async refreshTokenSingleUser(): Promise<void> {
    if (!this.oAuth2Client || !this.oAuth2Client.credentials.refresh_token) {
      throw new Error('No refresh token available');
    }

    try {
      const { credentials } = await this.oAuth2Client.refreshAccessToken();
      this.oAuth2Client.setCredentials(credentials);
      await this.saveToken(credentials);
      logger.info('Token refreshed successfully');
    } catch (error) {
      logger.error('Error refreshing token:', error);
      throw error;
    }
  }

  /**
   * Get authentication URL
   * @param options Auth options
   */
  async getAuthUrl(
    options: {
      email?: string;
      displayName?: string;
      additionalScopes?: string[];
      sessionId?: string;
    } = {}
  ): Promise<string> {
    if (this.multiUserMode) {
      // Multi-user mode
      return this.getAuthUrlMultiUser(options);
    } else {
      // Legacy single-user mode
      return this.getAuthUrlSingleUser(options.additionalScopes || []);
    }
  }

  /**
   * Get auth URL in multi-user mode
   */
  private async getAuthUrlMultiUser(
    options: {
      email?: string;
      displayName?: string;
      additionalScopes?: string[];
      sessionId?: string;
    }
  ): Promise<string> {
    if (!this.userManager) {
      throw new Error('UserManager not initialized');
    }

    // Verify credentials are available in environment
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/oauth2callback';
    
    if (!clientId || !clientSecret) {
      throw new Error('Missing Google OAuth credentials in environment');
    }
    
    // Create temporary OAuth client for generating auth URL
    const tempOAuth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret,
      redirectUri
    );

    // Set up scopes
    const scopes = [...SCOPES, ...(options.additionalScopes || [])];
    
    // Generate a unique state parameter to track this auth request
    const stateParam = crypto.randomUUID();
    
    // Create a promise that will be resolved when auth is complete
    const authPromise = new Promise<string>((resolve, reject) => {
      this.pendingAuthRequests.set(stateParam, { resolve, reject });
    });
    authPromise.then((sessionId) => {
      logger.info(`Authentication successful for user ${options.email} with sessionId ${sessionId}`);
    });
    
    // Generate auth URL with state parameter
    const authUrl = tempOAuth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      prompt: 'consent',
      state: stateParam
    });

    // Store email and display name if provided
    if (options.email) {
      this.activeAuthSessions.set(stateParam, { 
        sessionId: options.sessionId || '', 
        userId: options.email
      });
    }

    // Start local server to handle callback
    await this.startAuthServer();

    return authUrl;
  }

  /**
   * Get auth URL in single-user mode
   */
  private async getAuthUrlSingleUser(additionalScopes: string[] = []): Promise<string> {
    if (!this.oAuth2Client) {
      await this.initializeSingleUser();
    }

    const scopes = [...SCOPES, ...additionalScopes];
    
    const authUrl = this.oAuth2Client!.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      prompt: 'consent'
    });

    // Start local server to handle callback
    await this.startAuthServer();

    return authUrl;
  }

  /**
   * Start auth server to handle OAuth callback
   */
  private async startAuthServer(): Promise<void> {
    if (this.authServer) {
      return; // Server already running
    }

    return new Promise((resolve) => {
      this.authServer = http.createServer(async (req, res) => {
        const url = new URL(req.url!, `http://${req.headers.host}`);
        
        if (url.pathname === '/oauth2callback') {
          const code = url.searchParams.get('code');
          const state = url.searchParams.get('state');
          // Only process if code and state are present and state is pending
          if (code && state && this.pendingAuthRequests.has(state)) {
            try {
              if (this.multiUserMode && state) {
                // Multi-user mode
                await this.handleMultiUserCallback(code, state, res);
              } else {
                // Legacy single-user mode
                await this.handleSingleUserCallback(code, res);
              }
            } catch (error) {
              logger.error('Error processing OAuth callback:', error);
              res.writeHead(500, { 'Content-Type': 'text/html' });
              res.end(`
                <html>
                  <body>
                    <h1>Authentication Failed</h1>
                    <p>Error: ${error instanceof Error ? error.message : 'Unknown error'}</p>
                  </body>
                </html>
              `);
              
              // Reject any pending promise
              if (state && this.pendingAuthRequests.has(state)) {
                this.pendingAuthRequests.get(state)!.reject(
                  error instanceof Error ? error : new Error('Unknown error during authentication')
                );
                this.pendingAuthRequests.delete(state);
              }
            }
          } else {
            res.writeHead(400, { 'Content-Type': 'text/html' });
            res.end(`
              <html>
                <body>
                  <h1>Authentication Failed</h1>
                  <p>No authorization code received.</p>
                </body>
              </html>
            `);
            
            // Reject any pending promise
            if (state && this.pendingAuthRequests.has(state)) {
              this.pendingAuthRequests.get(state)!.reject(
                new Error('No authorization code received')
              );
              this.pendingAuthRequests.delete(state);
            }
          }
        } else {
          //res.writeHead(404);
          //res.end();
          return;
        }
      });

      const port = 3000; // This should match the redirect URI
      this.authServer.listen(port, () => {
        logger.info(`Auth server listening on port ${port}`);
        resolve();
      });
    });
  }
  
  /**
   * Handle OAuth callback in multi-user mode
   */
  private async handleMultiUserCallback(code: string, state: string, res: http.ServerResponse): Promise<void> {
    if (!this.userManager) {
      throw new Error('UserManager not initialized');
    }

    // Verify credentials are available
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/oauth2callback';
    
    if (!clientId || !clientSecret) {
      throw new Error('Missing Google OAuth credentials in environment');
    }
    
    // Create OAuth client for token exchange
    const oAuth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret,
      redirectUri
    );

    // Exchange code for token
    const { tokens,res:gaxiosResponse } = await oAuth2Client.getToken(code);
    
    // Get the user's email from the ID token
    let email = '';
    let displayName = '';
    
    if (tokens.id_token) {
      const ticket = await oAuth2Client.verifyIdToken({
        idToken: tokens.id_token,
        audience: clientId
      });
      
      const payload = ticket.getPayload();
      if (payload && payload.email) {
        email = payload.email;
        displayName = payload.name || email.split('@')[0];
      }
    }
    
    // Use stored email if available
    if (!email && this.activeAuthSessions.has(state)) {
      email = this.activeAuthSessions.get(state)!.userId;
    }
    
    if (!email) {
      throw new Error('Unable to determine user email from authentication response');
    }
    
    const session = await this.createUserSession(email, displayName);
    
    // Store the token
    await session.storeToken(tokens);
    
    // Send success response
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
      <html>
        <body>
          <h1>Authentication Successful!</h1>
          <p>Hello, ${displayName || email}! You can now close this window and return to the application.</p>
          <p>Your session ID is ${session.getSessionData().sessionId}</p>
          <p>Your user ID is ${session.getSessionData().userId}</p>
          <script>window.close();</script>
        </body>
      </html>
    `);
    
    logger.info(`Authentication successful for user ${email}`);
    
    // Close the server if no pending requests
    if (this.pendingAuthRequests.size === 1) {
      this.authServer!.close();
      this.authServer = null;
    }
    
    // Resolve the pending promise
    if (this.pendingAuthRequests.has(state)) {
      this.pendingAuthRequests.get(state)!.resolve(session.getSessionData().sessionId);
      this.pendingAuthRequests.delete(state);
    }
    
    // Clean up auth session
    this.activeAuthSessions.delete(state);
  }

  /**
   * Handle OAuth callback in single-user mode
   */
  private async handleSingleUserCallback(code: string, res: http.ServerResponse): Promise<void> {
    // Exchange code for token
    const { tokens } = await this.oAuth2Client!.getToken(code);
    this.oAuth2Client!.setCredentials(tokens);
    await this.saveToken(tokens);
    
    // Send success response
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
      <html>
        <body>
          <h1>Authentication Successful!</h1>
          <p>You can now close this window and return to the application.</p>
          <script>window.close();</script>
        </body>
      </html>
    `);
    
    logger.info('Authentication successful');
    
    // Close the server
    this.authServer!.close();
    this.authServer = null;
  }

  /**
   * Get OAuth client
   * @param sessionId Optional session ID for multi-user mode
   */
  getClient(sessionId?: string): OAuth2Client {
    if (this.multiUserMode && sessionId) {
      throw new Error('Use getClientForSession in multi-user mode');
    } else if (this.multiUserMode) {
      throw new Error('Session ID required in multi-user mode');
    }
    
    if (!this.oAuth2Client) {
      throw new Error('OAuth2 client not initialized');
    }
    
    return this.oAuth2Client;
  }

  /**
   * Get OAuth client for a specific session
   * @param sessionId Session ID to get client for
   */
  async getClientForSession(sessionId: string): Promise<OAuth2Client> {
    if (!this.multiUserMode) {
      throw new Error('Not in multi-user mode');
    }
    
    if (!this.userManager) {
      throw new Error('UserManager not initialized');
    }
    
    return this.userManager.getOAuthClientForSession(
      sessionId,
      (clientId, clientSecret, redirectUri) => new google.auth.OAuth2(clientId, clientSecret, redirectUri)
    );
  }

  /**
   * Get Gmail API client
   * @param sessionId Optional session ID for multi-user mode
   */
  async getGmailClient(sessionId?: string) {
    if (this.multiUserMode && sessionId) {
      // Multi-user mode with session
      if (!await this.hasValidAuth(sessionId)) {
        throw new Error('Not authenticated');
      }
      
      const oAuth2Client = await this.getClientForSession(sessionId);
      return google.gmail({ version: 'v1', auth: oAuth2Client });
    } else if (this.multiUserMode) {
      // Multi-user mode but no session - fail
      throw new Error('Session ID required in multi-user mode');
    } else {
      // Legacy single-user mode
      if (!await this.hasValidAuth()) {
        throw new Error('Not authenticated');
      }
      
      return google.gmail({ version: 'v1', auth: this.oAuth2Client! });
    }
  }

  /**
   * Create a new user session or get existing one
   * @param email User email
   * @param displayName Optional display name
   */
  async createUserSession(email: string, displayName?: string): Promise<UserSession> {
    if (!this.multiUserMode) {
      throw new Error('Not in multi-user mode');
    }
    
    if (!this.userManager) {
      throw new Error('UserManager not initialized');
    }
    
    // Get or create user
    const user = await this.userManager.createUser(email, displayName);
    
    // Create session
    const session = this.userManager.createSession(user.userId);
    
    return session;
  }

  /**
   * Get user ID for a session
   * @param sessionId Session ID to get user for
   */
  getUserIdForSession(sessionId: string): string {
    if (!this.multiUserMode) {
      throw new Error('Not in multi-user mode');
    }
    
    if (!this.userManager) {
      throw new Error('UserManager not initialized');
    }
    
    const session = this.userManager.getSession(sessionId);
    if (!session || !session.isValid()) {
      throw new Error('Invalid or expired session');
    }
    
    return session.getSessionData().userId;
  }

  /**
   * fetch sessionId from userId 
   */
  getSessionId(userId?: string): string {
    if (!this.multiUserMode) {
      throw new Error('Not in multi-user mode');
    }

    if (!this.userManager) {
      throw new Error('UserManager not initialized');
    }

    if(!userId) {
      throw new Error('User ID required');
    }

    const session = this.userManager.getUserSessions(userId)[0];
    if (!session || !session.isValid()) {
      throw new Error('Invalid or expired session');
    }

    return session.getSessionData().sessionId;
  }

  /**
   * Authenticate a user via OAuth
   * @param email User email
   * @param displayName Optional display name
   */
  async authenticateUser(email: string, displayName?: string): Promise<string> {
    if (!this.multiUserMode) {
      throw new Error('Not in multi-user mode');
    }
    
    // Get auth URL
    const authUrl = await this.getAuthUrl({ email, displayName });
    
    // Log the URL for the user to visit
    logger.info(`Please visit this URL to authenticate: ${authUrl}`);
    
    // This will be resolved when auth is complete
    return new Promise<string>((resolve, reject) => {
      // Timeout after 5 minutes
      const timeout = setTimeout(() => {
        reject(new Error('Authentication timed out'));
      }, 5 * 60 * 1000);
      
      // Wait for auth to complete
      const stateParam = new URL(authUrl).searchParams.get('state');
      if (stateParam) {
        this.pendingAuthRequests.set(stateParam, {
          resolve: (sessionId) => {
            clearTimeout(timeout);
            resolve(sessionId);
          },
          reject: (error) => {
            clearTimeout(timeout);
            reject(error);
          }
        });
      } else {
        reject(new Error('Invalid auth URL'));
      }
    });
  }

  /**
   * Invalidate a user session
   * @param sessionId Session ID to invalidate
   */
  invalidateSession(sessionId: string): void {
    if (!this.multiUserMode) {
      throw new Error('Not in multi-user mode');
    }
    
    if (!this.userManager) {
      throw new Error('UserManager not initialized');
    }
    
    this.userManager.invalidateSession(sessionId);
  }

  /**
   * Get all active users
   */
  getAllUsers(): any[] {
    if (!this.multiUserMode) {
      throw new Error('Not in multi-user mode');
    }
    
    if (!this.userManager) {
      throw new Error('UserManager not initialized');
    }
    
    return this.userManager.getAllUsers();
  }

  /**
   * Get user by ID
   * @param userId User ID to look up
   */
  getUserById(userId: string): any {
    if (!this.multiUserMode) {
      throw new Error('Not in multi-user mode');
    }
    
    if (!this.userManager) {
      throw new Error('UserManager not initialized');
    }
    
    return this.userManager.getUserById(userId);
  }

  /**
   * Get user by email
   * @param email Email to look up
   */
  getUserByEmail(email: string): any {
    if (!this.multiUserMode) {
      throw new Error('Not in multi-user mode');
    }
    
    if (!this.userManager) {
      throw new Error('UserManager not initialized');
    }
    
    return this.userManager.getUserByEmail(email);
  }

  /**
   * Clean up resources
   */
  async cleanup(): Promise<void> {
    // Close auth server if running
    if (this.authServer) {
      this.authServer.close();
      this.authServer = null;
    }
    
    // Clean up any other resources
    if (this.multiUserMode && this.userManager) {
      this.userManager.cleanupExpiredSessions();
    }
  }
}