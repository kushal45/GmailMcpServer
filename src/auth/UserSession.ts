import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { logger } from '../utils/logger.js';
import { UserSession as UserSessionType } from '../types/index.js';
import { Credentials } from 'google-auth-library';

/**
 * Class for managing user sessions and OAuth tokens
 */
export class UserSession {
  private sessionData: UserSessionType;
  private tokenData: Credentials | null = null;
  private tokenPath: string;
  private readonly TOKEN_ENCRYPTION_KEY: string;
  private readonly SESSION_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

  /**
   * Create a new UserSession instance
   * @param userId The ID of the user this session belongs to
   * @param storagePath Path where tokens will be stored
   * @param encryptionKey Key used for token encryption (from env or generated)
   */
  constructor(
    userId: string,
    private storagePath: string,
    encryptionKey?: string
  ) {
    // Generate a session ID
    const sessionId = crypto.randomUUID();
    
    // Create the session data
    const now = new Date();
    this.sessionData = {
      sessionId,
      userId,
      created: now,
      expires: new Date(now.getTime() + this.SESSION_DURATION_MS),
      lastAccessed: now,
      isValid: true
    };

    // Set up token storage path
    this.tokenPath = path.join(this.storagePath, `${userId}_token.enc`);
    
    // Use provided encryption key or generate one
    this.TOKEN_ENCRYPTION_KEY = encryptionKey || 
      process.env.TOKEN_ENCRYPTION_KEY || 
      crypto.randomBytes(32).toString('hex');
  }

  /**
   * Get the session data
   */
  getSessionData(): UserSessionType {
    return { ...this.sessionData };
  }

  /**
   * Check if the session is valid
   */
  isValid(): boolean {
    if (!this.sessionData.isValid) {
      return false;
    }

    // Check if session has expired
    if (new Date() > this.sessionData.expires) {
      this.invalidate();
      return false;
    }

    // Update last accessed time
    this.sessionData.lastAccessed = new Date();
    return true;
  }

  /**
   * Extend the session's expiry time
   * @param durationMs Optional duration in milliseconds to extend the session by
   */
  extendSession(durationMs = this.SESSION_DURATION_MS): void {
    if (!this.isValid()) {
      throw new Error('Cannot extend an invalid session');
    }

    this.sessionData.expires = new Date(Date.now() + durationMs);
    logger.debug(`Session ${this.sessionData.sessionId} extended to ${this.sessionData.expires}`);
  }

  /**
   * Invalidate the session
   */
  invalidate(): void {
    this.sessionData.isValid = false;
    logger.debug(`Session ${this.sessionData.sessionId} invalidated`);
  }

  /**
   * Store OAuth token for this user session
   * @param token The OAuth credentials to store
   */
  async storeToken(token: Credentials): Promise<void> {
    try {
      this.tokenData = token;
      
      // Encrypt the token data
      const encryptedData = this.encryptData(JSON.stringify(token));
      
      // Ensure the directory exists
      await fs.mkdir(path.dirname(this.tokenPath), { recursive: true });
      
      // Write the encrypted token to file
      await fs.writeFile(this.tokenPath, encryptedData);
      logger.info(`Token stored successfully for user ${this.sessionData.userId}`);
    } catch (error) {
      logger.error('Error storing token:', error);
      throw error;
    }
  }

  /**
   * Get the stored OAuth token
   */
  async getToken(): Promise<Credentials> {
    if (this.tokenData) {
      return this.tokenData;
    }

    try {
      // Read and decrypt the token file
      const encryptedData = await fs.readFile(this.tokenPath, 'utf-8');
      const tokenJson = this.decryptData(encryptedData);
      const parsedToken = JSON.parse(tokenJson) as Credentials;
      this.tokenData = parsedToken;
      return parsedToken;
    } catch (error) {
      logger.error(`Error loading token for user ${this.sessionData.userId}:`, error);
      throw new Error('No valid token available');
    }
  }

  /**
   * Check if token exists for this user session
   */
  async hasToken(): Promise<boolean> {
    try {
      if (this.tokenData) {
        return true;
      }

      await fs.access(this.tokenPath);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Update the stored token with new credentials
   * @param token Updated OAuth credentials
   */
  async updateToken(token: Credentials): Promise<void> {
    await this.storeToken(token);
  }

  /**
   * Remove the stored token
   */
  async removeToken(): Promise<void> {
    try {
      this.tokenData = null;
      await fs.unlink(this.tokenPath);
      logger.info(`Token removed for user ${this.sessionData.userId}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.error('Error removing token:', error);
        throw error;
      }
    }
  }

  /**
   * Encrypt data using the encryption key
   * @param data Data to encrypt
   */
  private encryptData(data: string): string {
    const iv = crypto.randomBytes(16);
    const key = crypto.createHash('sha256').update(this.TOKEN_ENCRYPTION_KEY).digest('base64').substring(0, 32);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    
    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    // Return IV + encrypted data
    return iv.toString('hex') + ':' + encrypted;
  }

  /**
   * Decrypt data using the encryption key
   * @param encryptedData Data to decrypt
   */
  private decryptData(encryptedData: string): string {
    const parts = encryptedData.split(':');
    if (parts.length !== 2) {
      throw new Error('Invalid encrypted data format');
    }
    
    const iv = Buffer.from(parts[0], 'hex');
    const encryptedText = parts[1];
    const key = crypto.createHash('sha256').update(this.TOKEN_ENCRYPTION_KEY).digest('base64').substring(0, 32);
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }
}