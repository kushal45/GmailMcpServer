import { DatabaseManager } from '../database/DatabaseManager.js';
import { EmailFetcher } from '../email/EmailFetcher.js';
import { EmailIndex, SearchCriteria, SavedSearch } from '../types/index.js';
import { logger } from '../utils/logger.js';

export class SearchEngine {
  private databaseManager: DatabaseManager;
  private emailFetcher: EmailFetcher;

  constructor(databaseManager: DatabaseManager, emailFetcher: EmailFetcher) {
    this.databaseManager = databaseManager;
    this.emailFetcher = emailFetcher;
  }

  async search(criteria: SearchCriteria & { limit?: number }): Promise<{ emails: EmailIndex[], total: number }> {
    logger.info('Searching emails', { criteria });

    try {
      // First search in local database
      const dbResults = await this.databaseManager.searchEmails({
        ...criteria,
        limit: criteria.limit || 50
      });

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

  async saveSearch(options: { name: string, criteria: SearchCriteria }): Promise<{ id: string, saved: boolean }> {
    try {
      const id = await this.databaseManager.saveSearch(options.name, options.criteria);
      logger.info('Search saved', { id, name: options.name });
      
      return { id, saved: true };
    } catch (error) {
      logger.error('Error saving search:', error);
      throw error;
    }
  }

  async listSavedSearches(): Promise<{ searches: SavedSearch[] }> {
    try {
      const searches = await this.databaseManager.getSavedSearches();
      return { searches };
    } catch (error) {
      logger.error('Error listing saved searches:', error);
      throw error;
    }
  }

  async executeSavedSearch(searchId: string): Promise<{ emails: EmailIndex[], total: number }> {
    try {
      const searches = await this.databaseManager.getSavedSearches();
      const savedSearch = searches.find(s => s.id === searchId);
      
      if (!savedSearch) {
        throw new Error(`Saved search not found: ${searchId}`);
      }

      return await this.search(savedSearch.criteria);
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