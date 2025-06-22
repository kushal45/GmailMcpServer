import { DatabaseManager } from '../database/DatabaseManager.js';
import { EmailFetcher } from '../email/EmailFetcher.js';
import { EmailIndex, SearchCriteria, SavedSearch, SearchEngineCriteria } from '../types/index.js';
import { logger } from '../utils/logger.js';

export class SearchEngine {
  private databaseManager: DatabaseManager;
  private emailFetcher: EmailFetcher;

  constructor(databaseManager: DatabaseManager, emailFetcher: EmailFetcher) {
    this.databaseManager = databaseManager;
    this.emailFetcher = emailFetcher;
  }

  async search(criteria: SearchEngineCriteria, userContext: { user_id: string; session_id: string }): Promise<{ emails: EmailIndex[], total: number }> {
    logger.info('Searching emails', { criteria, userId: userContext.user_id });

    try {
      // First search in local database with user context
      let dbResults = await this.databaseManager.searchEmails({
        ...criteria,
        limit: criteria.limit || 50,
        user_id: userContext.user_id // Filter by user_id
      });

      // Filter by labels if specified
      if (criteria.labels && criteria.labels.length > 0) {
        dbResults = dbResults.filter(email =>
          Array.isArray(email.labels) && criteria.labels!.every(label => email.labels!.includes(label))
        );
      }

      // Filter by hasAttachments if specified
      if (typeof criteria.hasAttachments === 'boolean') {
        dbResults = dbResults.filter(email => email.hasAttachments === criteria.hasAttachments);
      }

      // If we have a text query, we need to filter further
      if (criteria.query) {
        const filtered = dbResults.filter(email => 
          this.matchesTextQuery(email, criteria.query!)
        );
        
        return {
          emails: filtered.slice(0, criteria.limit || 50),
          total: filtered.length
        };
      }

      return {
        emails: dbResults,
        total: dbResults.length
      };
    } catch (error) {
      logger.error('Search error:', error);
      throw error;
    }
  }

  private matchesTextQuery(email: EmailIndex, query: string): boolean {
    const searchableText = `
      ${email.subject} 
      ${email.sender} 
      ${email?.recipients?.join(' ')} 
      ${email.snippet}
    `.toLowerCase();

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
      // Add user_id to the saved search
      const id = await this.databaseManager.saveSearch(options.name, options.criteria, userContext.user_id);
      logger.info('Search saved', { id, name: options.name, userId: userContext.user_id });
      
      return { id, saved: true };
    } catch (error) {
      logger.error('Error saving search:', error);
      throw error;
    }
  }

  async listSavedSearches(userContext: { user_id: string; session_id: string }): Promise<{ searches: SavedSearch[] }> {
    try {
      // Filter saved searches by user_id
      const searches = await this.databaseManager.getSavedSearches(userContext.user_id);
      return { searches };
    } catch (error) {
      logger.error('Error listing saved searches:', error);
      throw error;
    }
  }

  async executeSavedSearch(searchId: string, userContext: { user_id: string; session_id: string }): Promise<{ emails: EmailIndex[], total: number }> {
    try {
      // Get saved searches for this user
      const searches = await this.databaseManager.getSavedSearches(userContext.user_id);
      const savedSearch = searches.find(s => s.id === searchId);
      
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