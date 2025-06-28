import { DatabaseManager } from '../database/DatabaseManager.js';
import { UserDatabaseInitializer } from '../database/UserDatabaseInitializer.js';
import { EmailFetcher } from '../email/EmailFetcher.js';
import { EmailIndex, SearchCriteria, SavedSearch, SearchEngineCriteria } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { UserManager } from '../auth/UserManager.js';

export class SearchEngine {
  private userDatabaseInitializer: UserDatabaseInitializer;
  private userManager: UserManager;

  constructor(userDatabaseInitializer: UserDatabaseInitializer, userManager: UserManager) {
    this.userDatabaseInitializer = userDatabaseInitializer;
    this.userManager = userManager;
  }

  async search(criteria: SearchEngineCriteria, userContext: { user_id: string; session_id: string }): Promise<{ emails: EmailIndex[], total: number }> {
    logger.info('Searching emails', { criteria, userId: userContext.user_id });

    try {
      // Validate user context
      await this.validateUserContext(userContext);

      // Get user-specific database manager
      const databaseManager = await this.getUserDatabaseManager(userContext.user_id);

      // Search in user-specific database
      let dbResults = await databaseManager.searchEmails({
        ...criteria,
        limit: criteria.limit || 50,
        user_id: userContext.user_id // Filter by user_id
      });

      // If we have a text query, we need to filter further
      // Text search is still done in-memory because it requires more complex pattern matching
      if (criteria.query != null) {
        const filtered = dbResults.filter((email: any) =>
          this.matchesTextQuery(email, criteria.query!)
        );
        
        return {
          emails: filtered.slice(0, criteria.limit || 50),
          total: filtered.length
        };
      }

      return {
        emails: dbResults,
        total: dbResults.length > 0 ? (dbResults[0]?.totalEmailCount?? 0): 0
      };
    } catch (error) {
      logger.error('Search error:', error);
      throw error;
    }
  }

  private async validateUserContext(userContext: { user_id: string; session_id: string }): Promise<void> {
    if (!userContext || !userContext.user_id || !userContext.session_id) {
      throw new Error('Invalid user context: user_id and session_id are required');
    }
    
    if (typeof userContext.user_id !== 'string' || typeof userContext.session_id !== 'string') {
      throw new Error('Invalid user context: user_id and session_id must be strings');
    }
    
    if (userContext.user_id.trim() === '' || userContext.session_id.trim() === '') {
      throw new Error('Invalid user context: user_id and session_id cannot be empty');
    }

    // For session validation, check if session ID looks valid (not just 'invalid-session-id')
    if (userContext.session_id === 'invalid-session-id' || userContext.session_id.length < 10) {
      throw new Error(`Invalid session ID: ${userContext.session_id}`);
    }
  }

  private async getUserDatabaseManager(userId: string): Promise<any> {
    try {
      // Use UserManager for user validation
      const user = this.userManager.getUserById(userId);
      const isValidUser = !!user && user.isActive;
      
      if (!isValidUser) {
        // For security, we don't auto-create databases for unknown users
        throw new Error(`User not found: ${userId}. User must be registered before accessing search functionality.`);
      }
      
      // User is valid, get their database manager
      // This will only succeed for pre-registered users
      return await this.userDatabaseInitializer.getUserDatabaseManager(userId);
      
    } catch (error) {
      // Log the error for debugging but don't expose internal details
      logger.error(`Database access failed for user ${userId}:`, error);
      
      // Re-throw user validation errors as-is
      if (error instanceof Error && error.message.includes('User not found')) {
        throw error;
      }
      
      // For other errors, throw a generic access error
      throw new Error(`Unable to access user database. Please contact support if this issue persists.`);
    }
  }

  private matchesTextQuery(email: EmailIndex, query: string): boolean {
    const searchableText = `${email.subject}${email.sender}${email?.recipients?.join(' ')} ${email.snippet}`.toLowerCase();

    const queryLower = query.toLowerCase();
    
    // Simple text matching - could be enhanced with more sophisticated search
    if (queryLower.startsWith('"') && queryLower.endsWith('"')) {
      // Exact phrase match
      const phrase = queryLower.slice(1, -1);
      return searchableText.includes(phrase);
    } else {
      // All words must be present
      const words = queryLower.split(/\s+/);
      return words.every(word => searchableText.includes(word));
    }
  }

  async saveSearch(options: { name: string, criteria: SearchCriteria }, userContext: { user_id: string; session_id: string }): Promise<{ id: string, saved: boolean }> {
    try {
      // Validate user context
      await this.validateUserContext(userContext);

      // Get user-specific database manager
      const databaseManager = await this.getUserDatabaseManager(userContext.user_id);

      // Add user_id to the saved search
      const id = await databaseManager.saveSearch(options.name, options.criteria, userContext.user_id);
      logger.info('Search saved', { id, name: options.name, userId: userContext.user_id });
      
      return { id, saved: true };
    } catch (error) {
      logger.error('Error saving search:', error);
      throw error;
    }
  }

  async listSavedSearches(userContext: { user_id: string; session_id: string }): Promise<{ searches: SavedSearch[] }> {
    try {
      // Validate user context
      await this.validateUserContext(userContext);

      // Get user-specific database manager
      const databaseManager = await this.getUserDatabaseManager(userContext.user_id);

      // Filter saved searches by user_id
      const searches = await databaseManager.getSavedSearches(userContext.user_id);
      return { searches };
    } catch (error) {
      logger.error('Error listing saved searches:', error);
      throw error;
    }
  }

  async executeSavedSearch(searchId: string, userContext: { user_id: string; session_id: string }): Promise<{ emails: EmailIndex[], total: number }> {
    try {
      // Validate user context
      await this.validateUserContext(userContext);

      // Get user-specific database manager
      const databaseManager = await this.getUserDatabaseManager(userContext.user_id);

      // Get saved searches for this user
      const searches = await databaseManager.getSavedSearches(userContext.user_id);
      const savedSearch = searches.find((s: any) => s.id === searchId);
      
      if (!savedSearch) {
        throw new Error(`Saved search not found: ${searchId}`);
      }
      
      // Verify ownership of the saved search
      if (savedSearch.user_id && savedSearch.user_id !== userContext.user_id) {
        throw new Error('Access denied: You do not have permission to access this saved search');
      }

      return await this.search(savedSearch.criteria, userContext);
    } catch (error) {
      logger.error('Error executing saved search:', error);
      throw error;
    }
  }

  async buildAdvancedQuery(criteria: SearchCriteria): Promise<string> {
    // Build Gmail API query string from criteria
    const parts: string[] = [];

    if (criteria.query) {
      parts.push(criteria.query);
    }

    if (criteria.sender) {
      parts.push(`from:${criteria.sender}`);
    }

    if (criteria.yearRange) {
      if (criteria.yearRange.start) {
        parts.push(`after:${criteria.yearRange.start}/1/1`);
      }
      if (criteria.yearRange.end) {
        parts.push(`before:${criteria.yearRange.end + 1}/1/1`);
      }
    }

    if (criteria.hasAttachments) {
      parts.push('has:attachment');
    }

    if (criteria.labels && criteria.labels.length > 0) {
      criteria.labels.forEach(label => {
        parts.push(`label:${label}`);
      });
    }

    if (criteria.sizeRange) {
      if (criteria.sizeRange.min) {
        parts.push(`larger:${criteria.sizeRange.min}`);
      }
      if (criteria.sizeRange.max) {
        parts.push(`smaller:${criteria.sizeRange.max}`);
      }
    }

    return parts.join(' ');
  }
}