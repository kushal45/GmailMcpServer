import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { logger } from '../utils/logger.js';
import { UserProfile, UserSession as UserSessionType } from '../types/index.js';
import { UserSession } from './UserSession.js';
import { OAuth2Client } from 'google-auth-library';

/**
 * UserManager class responsible for managing user profiles and authentication state
 */
export class UserManager {
  private users: Map<string, UserProfile> = new Map();
  private sessions: Map<string, UserSession> = new Map();
  private userProfilesPath: string;
  private tokenStoragePath: string;
  private readonly encryptionKey: string;
  private static instance: UserManager;
  /**
   * Create a new UserManager instance
   * @param storagePath Base path for user data storage
   * @param encryptionKey Optional encryption key for token storage
   */
  constructor(
    private storagePath: string = process.env.STORAGE_PATH || './data',
    encryptionKey?: string
  ) {
    this.userProfilesPath = path.join(this.storagePath, 'users');
    this.tokenStoragePath = path.join(this.storagePath, 'tokens');
    this.encryptionKey = encryptionKey || 
      process.env.TOKEN_ENCRYPTION_KEY || 
      crypto.randomBytes(32).toString('hex');
  }

  static getInstance(): UserManager {
    if (!UserManager.instance) {
      UserManager.instance = new UserManager();
    }
    return UserManager.instance;
  }

  /**
   * Initialize the UserManager
   */
  async initialize(): Promise<void> {
    try {
      // Ensure directories exist
      await fs.mkdir(this.userProfilesPath, { recursive: true });
      await fs.mkdir(this.tokenStoragePath, { recursive: true });
      
      // Load all user profiles
      await this.loadUserProfiles();
      
      logger.info('UserManager initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize UserManager:', error);
      throw error;
    }
  }

  /**
   * Load all user profiles from storage
   */
  private async loadUserProfiles(): Promise<void> {
    try {
      const files = await fs.readdir(this.userProfilesPath);
      
      // Process each user profile file
      for (const file of files) {
        if (file.endsWith('.json')) {
          try {
            const content = await fs.readFile(path.join(this.userProfilesPath, file), 'utf-8');
            const userProfile = JSON.parse(content) as UserProfile;
            
            // Convert date strings to Date objects
            userProfile.created = new Date(userProfile.created);
            if (userProfile.lastLogin) {
              userProfile.lastLogin = new Date(userProfile.lastLogin);
            }
            
            this.users.set(userProfile.userId, userProfile);
          } catch (err) {
            logger.error(`Error parsing user profile ${file}:`, err);
          }
        }
      }
      
      logger.info(`Loaded ${this.users.size} user profiles`);
    } catch (error) {
      logger.error('Error loading user profiles:', error);
      throw error;
    }
  }

  /**
   * Get all users
   */
  getAllUsers(): UserProfile[] {
    return Array.from(this.users.values());
  }

  /**
   * Get user by ID
   * @param userId User ID to look up
   */
  getUserById(userId: string): UserProfile | undefined {
    return this.users.get(userId);
  }

  /**
   * Get user by email
   * @param email Email to look up
   */
  getUserByEmail(email: string): UserProfile | undefined {
    return Array.from(this.users.values()).find(user => user.email === email);
  }

  /**
   * Create a new user
   * @param email User's email address
   * @param displayName Optional display name
   * @param userId Optional userId (for testability)
   */
  async createUser(email: string, displayName?: string, userId?: string): Promise<UserProfile> {
    // Check if user already exists
    const existingUser = this.getUserByEmail(email);
    if (existingUser) {
      return existingUser;
    }
    // Use provided userId for tests, or generate a new one
    const newUserId = userId || crypto.randomUUID();
    const now = new Date();
    const newUser: UserProfile = {
      userId: newUserId,
      email,
      displayName: displayName || email.split('@')[0],
      created: now,
      lastLogin: now,
      preferences: {},
      isActive: true
    };
    // Store user in memory and on disk
    this.users.set(newUserId, newUser);
    await this.saveUserProfile(newUser);
    logger.info(`Created new user: ${email} (${newUserId})`);
    return newUser;
  }

  /**
   * Update a user's profile
   * @param userId User ID to update
   * @param updates Fields to update
   */
  async updateUser(userId: string, updates: Partial<UserProfile>): Promise<UserProfile> {
    const user = this.getUserById(userId);
    if (!user) {
      throw new Error(`User not found: ${userId}`);
    }
    
    // Apply updates (but don't allow changing userId or email)
    const updatedUser = {
      ...user,
      ...updates,
      userId: user.userId,
      email: user.email
    };
    
    // Store updated user
    this.users.set(userId, updatedUser);
    await this.saveUserProfile(updatedUser);
    
    logger.info(`Updated user profile: ${userId}`);
    return updatedUser;
  }

  /**
   * Deactivate a user
   * @param userId User ID to deactivate
   */
  async deactivateUser(userId: string): Promise<void> {
    const user = this.getUserById(userId);
    if (!user) {
      throw new Error(`User not found: ${userId}`);
    }
    
    // Update user status
    user.isActive = false;
    
    // Store updated user
    this.users.set(userId, user);
    await this.saveUserProfile(user);
    
    // Invalidate all sessions for this user
    this.invalidateAllUserSessions(userId);
    
    logger.info(`Deactivated user: ${userId}`);
  }

  /**
   * Save a user profile to disk
   * @param user User profile to save
   */
  private async saveUserProfile(user: UserProfile): Promise<void> {
    try {
      const filePath = path.join(this.userProfilesPath, `${user.userId}.json`);
      await fs.writeFile(filePath, JSON.stringify(user, null, 2), 'utf-8');
      logger.debug(`Saved user profile to ${filePath}`);
    } catch (error) {
      logger.error(`Error saving user profile for ${user.userId}:`, error);
      throw error;
    }
  }

  /**
   * Create a new session for a user
   * @param userId User ID to create session for
   */
  createSession(userId: string): UserSession {
    const user = this.getUserById(userId);
    if (!user) {
      throw new Error(`User not found: ${userId}`);
    }
    
    if (!user.isActive) {
      throw new Error(`User is not active: ${userId}`);
    }
    
    // Create new session
    const session = new UserSession(userId, this.tokenStoragePath, this.encryptionKey);
    
    // Store session
    this.sessions.set(session.getSessionData().sessionId, session);
    
    // Update last login
    this.updateUser(userId, { lastLogin: new Date() }).catch(err => {
      logger.error(`Error updating last login for ${userId}:`, err);
    });
    
    logger.info(`Created new session for user ${userId}: ${session.getSessionData().sessionId}`);
    return session;
  }

  /**
   * Get a session by ID
   * @param sessionId Session ID to look up
   */
  getSession(sessionId: string): UserSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Get all active sessions for a user
   * @param userId User ID to get sessions for
   */
  getUserSessions(userId: string): UserSession[] {
    return Array.from(this.sessions.values())
      .filter(session => session.getSessionData().userId === userId && session.isValid());
  }

  /**
   * Invalidate a session
   * @param sessionId Session ID to invalidate
   */
  invalidateSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.invalidate();
      logger.info(`Invalidated session ${sessionId}`);
    }
  }

  /**
   * Invalidate all sessions for a user
   * @param userId User ID to invalidate sessions for
   */
  invalidateAllUserSessions(userId: string): void {
    const userSessions = this.getUserSessions(userId);
    
    for (const session of userSessions) {
      session.invalidate();
    }
    
    logger.info(`Invalidated ${userSessions.length} sessions for user ${userId}`);
  }

  /**
   * Clean up expired sessions
   */
  cleanupExpiredSessions(): void {
    let count = 0;
    
    for (const [sessionId, session] of this.sessions.entries()) {
      if (!session.isValid()) {
        this.sessions.delete(sessionId);
        count++;
      }
    }
    
    if (count > 0) {
      logger.info(`Cleaned up ${count} expired sessions`);
    }
  }

  /**
   * Get OAuth client for a user
   * @param sessionId Session ID to get client for
   * @param oAuth2ClientFactory Factory function to create OAuth2Client instances
   */
  async getOAuthClientForSession(
    sessionId: string,
    oAuth2ClientFactory: (clientId: string, clientSecret: string, redirectUri: string) => OAuth2Client
  ): Promise<OAuth2Client> {
    // Get session
    const session = this.getSession(sessionId);
    if (!session || !session.isValid()) {
      throw new Error('Invalid or expired session');
    }
    
    // Verify credentials are available in environment
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI;
    
    if (!clientId || !clientSecret || !redirectUri) {
      throw new Error('Missing Google OAuth credentials in environment');
    }
    
    // Create OAuth client
    const oAuth2Client = oAuth2ClientFactory(clientId, clientSecret, redirectUri);
    
    try {
      // Check if token exists and set it on the client
      if (await session.hasToken()) {
        const token = await session.getToken();
        oAuth2Client.setCredentials(token);
      }
      
      return oAuth2Client;
    } catch (error) {
      logger.error('Error setting up OAuth client:', error);
      throw error;
    }
  }
}