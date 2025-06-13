import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';
import http from 'http';
import { URL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.labels'
];

const TOKEN_PATH = path.join(__dirname, '../../token.json');
const CREDENTIALS_PATH = path.join(__dirname, '../../credentials.json');

export class AuthManager {
  private oAuth2Client: OAuth2Client | null = null;
  private authServer: http.Server | null = null;

  constructor() {}

  async initialize(): Promise<void> {
    try {
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
    } catch (error) {
      logger.error('Failed to initialize AuthManager:', error);
      throw error;
    }
  }

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

  private async loadToken(): Promise<void> {
    try {
      const token = await fs.readFile(TOKEN_PATH, 'utf-8');
      this.oAuth2Client!.setCredentials(JSON.parse(token));
      logger.info('Loaded existing authentication token');
    } catch (error) {
      logger.info('No existing token found');
    }
  }

  private async saveToken(token: any): Promise<void> {
    try {
      await fs.writeFile(TOKEN_PATH, JSON.stringify(token));
      logger.info('Token saved successfully');
    } catch (error) {
      logger.error('Error saving token:', error);
      throw error;
    }
  }

  async hasValidAuth(): Promise<boolean> {
    try {
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
          await this.refreshToken();
          return true;
        } catch (error) {
          logger.error('Failed to refresh token:', error);
          return false;
        }
      }

      return true;
    } catch (error) {
      logger.debug('Auth validation failed:', error);
      return false;
    }
  }

  async refreshToken(): Promise<void> {
    if (!this.oAuth2Client || !this.oAuth2Client.credentials.refresh_token) {
      throw new Error('No refresh token available');
    }

    try {
      const { credentials } = await this.oAuth2Client.refreshAccessToken();
      this.oAuth2Client.setCredentials(credentials);
      await this.saveToken(credentials);
      logger.info('Token refreshed successfully');
    } catch (error) {
      logger.error('Error refreshing token:', error, new Error().stack);
      throw error;
    }
  }

  async getAuthUrl(additionalScopes: string[] = []): Promise<string> {
    if (!this.oAuth2Client) {
      await this.initialize();
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

  private async startAuthServer(): Promise<void> {
    if (this.authServer) {
      return; // Server already running
    }

    return new Promise((resolve) => {
      this.authServer = http.createServer(async (req, res) => {
        const url = new URL(req.url!, `http://${req.headers.host}`);
        
        if (url.pathname === '/oauth2callback') {
          const code = url.searchParams.get('code');
          
          if (code) {
            try {
              const { tokens } = await this.oAuth2Client!.getToken(code);
              this.oAuth2Client!.setCredentials(tokens);
              await this.saveToken(tokens);
              
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
              
              // Close the server after successful auth
              this.authServer!.close();
              this.authServer = null;
            } catch (error) {
              logger.error('Error exchanging code for token:', error);
              res.writeHead(500, { 'Content-Type': 'text/html' });
              res.end(`
                <html>
                  <body>
                    <h1>Authentication Failed</h1>
                    <p>Error: ${error instanceof Error ? error.message : 'Unknown error'}</p>
                  </body>
                </html>
              `);
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
          }
        } else {
          res.writeHead(404);
          res.end();
        }
      });

      const port = 3000; // This should match the redirect URI
      this.authServer.listen(port, () => {
        logger.info(`Auth server listening on port ${port}`);
        resolve();
      });
    });
  }

  getClient(): OAuth2Client {
    if (!this.oAuth2Client) {
      throw new Error('OAuth2 client not initialized');
    }
    return this.oAuth2Client;
  }

  async getGmailClient() {
    if (!await this.hasValidAuth()) {
      throw new Error('Not authenticated');
    }
    
    return google.gmail({ version: 'v1', auth: this.oAuth2Client! });
  }
}