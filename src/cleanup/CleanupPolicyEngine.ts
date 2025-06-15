import {
  CleanupPolicy,
  EmailIndex,
  StalenessScore,
  EmailAccessSummary,
  CleanupResults
} from '../types/index.js';
import { DatabaseManager } from '../database/DatabaseManager.js';
import { StalenessScorer } from './StalenessScorer.js';
import { AccessPatternTracker } from './AccessPatternTracker.js';
import { logger } from '../utils/logger.js';

/**
 * Configuration interface for enhanced safety checks
 */
interface SafetyConfig {
  // Domain Protection
  vipDomains: string[];
  trustedDomains: string[];
  whitelistDomains: string[];
  
  // Attachment Safety
  criticalAttachmentTypes: string[];
  legalDocumentTypes: string[];
  financialDocumentTypes: string[];
  contractDocumentTypes: string[];
  
  // Thread/Conversation Safety
  activeThreadDays: number;
  minThreadMessages: number;
  recentReplyDays: number;
  
  // Sender Reputation Safety
  frequentContactThreshold: number;
  importantSenderScore: number;
  minInteractionHistory: number;
  
  // Legal/Compliance Safety
  legalKeywords: string[];
  complianceTerms: string[];
  regulatoryKeywords: string[];
  
  // Unread Email Safety
  unreadRecentDays: number;
  unreadImportanceBoost: number;
  
  // Label-based Safety
  protectedLabels: string[];
  criticalLabels: string[];
  
  // Batch Safety Limits
  maxDeletionsPerHour: number;
  maxDeletionsPerDay: number;
  bulkOperationThreshold: number;
  
  // Size Anomaly Safety
  largeEmailThreshold: number;
  unusualSizeMultiplier: number;
  
  // Recent Activity Safety
  recentAccessDays: number;
  recentForwardDays: number;
  recentModificationDays: number;
  
  // Safety Thresholds
  minStalenessScore: number;
  maxAccessScore: number;
  importanceScoreThreshold: number;
  
  // Monitoring
  enableSafetyMetrics: boolean;
  enableDetailedLogging: boolean;
}

/**
 * Safety check result interface
 */
interface SafetyCheckResult {
  safe: boolean;
  reason: string;
  checkType: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  metadata?: Record<string, any>;
}

/**
 * Safety metrics for monitoring
 */
interface SafetyMetrics {
  totalChecks: number;
  protectedEmails: number;
  checkTypeCounters: Record<string, number>;
  lastUpdated: Date;
}

/**
 * CleanupPolicyEngine manages cleanup policies and determines which emails
 * should be cleaned up based on configurable rules and safety mechanisms.
 */
export class CleanupPolicyEngine {
  private databaseManager: DatabaseManager;
  private stalenessScorer: StalenessScorer;
  private accessTracker: AccessPatternTracker;
  private safetyConfig: SafetyConfig;
  private safetyMetrics: SafetyMetrics;
  private static instance: CleanupPolicyEngine | null = null;

  constructor(
    databaseManager?: DatabaseManager,
    stalenessScorer?: StalenessScorer,
    accessTracker?: AccessPatternTracker,
    safetyConfig?: Partial<SafetyConfig>
  ) {
    this.databaseManager = databaseManager || DatabaseManager.getInstance();
    this.accessTracker = accessTracker || AccessPatternTracker.getInstance();
    this.stalenessScorer = stalenessScorer || new StalenessScorer(this.accessTracker);
    
    // Initialize safety configuration with defaults
    this.safetyConfig = this.initializeSafetyConfig(safetyConfig);
    
    // Initialize safety metrics
    this.safetyMetrics = {
      totalChecks: 0,
      protectedEmails: 0,
      checkTypeCounters: {},
      lastUpdated: new Date()
    };

    logger.info('CleanupPolicyEngine initialized with enhanced safety checks', {
      safetyConfig: {
        vipDomainsCount: this.safetyConfig.vipDomains.length,
        trustedDomainsCount: this.safetyConfig.trustedDomains.length,
        protectedLabelsCount: this.safetyConfig.protectedLabels.length,
        legalKeywordsCount: this.safetyConfig.legalKeywords.length
      }
    });
  }

  set dbManager(dbManager: DatabaseManager) {
    this.databaseManager = dbManager;
  }

  get dbManager(): DatabaseManager {
    return this.databaseManager;
  }

  static getInstance(
    databaseManager?: DatabaseManager,
    stalenessScorer?: StalenessScorer,
    accessTracker?: AccessPatternTracker,
    safetyConfig?: Partial<SafetyConfig>
  ): CleanupPolicyEngine {
    if (!this.instance) {
      this.instance = new CleanupPolicyEngine(databaseManager, stalenessScorer, accessTracker, safetyConfig);
    }
    return this.instance;
  }

  /**
   * Initialize safety configuration with defaults and user overrides
   */
  private initializeSafetyConfig(userConfig?: Partial<SafetyConfig>): SafetyConfig {
    const defaultConfig: SafetyConfig = {
      // Domain Protection
      vipDomains: [
        'board-of-directors.com',
        'executives.com',
        'ceo.com',
        'legal-counsel.com'
      ],
      trustedDomains: [
        'company.com',
        'organization.org',
        'trusted-partner.com',
        'bank.com',
        'government.gov'
      ],
      whitelistDomains: [
        'important.org',
        'critical-vendor.com',
        'key-client.com',
        'healthcare-provider.com'
      ],
      
      // Attachment Safety
      criticalAttachmentTypes: [
        '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
        '.contract', '.agreement', '.legal', '.invoice', '.receipt'
      ],
      legalDocumentTypes: [
        '.contract', '.agreement', '.nda', '.legal', '.court',
        '.lawsuit', '.settlement', '.compliance', '.audit'
      ],
      financialDocumentTypes: [
        '.invoice', '.receipt', '.statement', '.tax', '.financial',
        '.budget', '.expense', '.payment', '.bank', '.accounting'
      ],
      contractDocumentTypes: [
        '.contract', '.agreement', '.terms', '.conditions',
        '.proposal', '.quote', '.estimate', '.sow', '.msa'
      ],
      
      // Thread/Conversation Safety
      activeThreadDays: 30,
      minThreadMessages: 3,
      recentReplyDays: 7,
      
      // Sender Reputation Safety
      frequentContactThreshold: 10,
      importantSenderScore: 0.8,
      minInteractionHistory: 5,
      
      // Legal/Compliance Safety
      legalKeywords: [
        'legal', 'lawsuit', 'litigation', 'compliance', 'audit',
        'regulation', 'policy', 'contract', 'agreement', 'confidential',
        'proprietary', 'copyright', 'trademark', 'patent', 'settlement',
        'court', 'subpoena', 'deposition', 'discovery', 'evidence'
      ],
      complianceTerms: [
        'gdpr', 'hipaa', 'sox', 'pci', 'ferpa', 'ccpa', 'privacy',
        'data protection', 'security', 'breach', 'incident', 'report',
        'mandatory', 'required', 'regulation', 'compliance'
      ],
      regulatoryKeywords: [
        'sec', 'fda', 'epa', 'osha', 'ftc', 'cftc', 'finra',
        'regulatory', 'inspection', 'violation', 'penalty', 'fine'
      ],
      
      // Unread Email Safety
      unreadRecentDays: 14,
      unreadImportanceBoost: 0.3,
      
      // Label-based Safety
      protectedLabels: [
        'IMPORTANT', 'STARRED', 'VIP', 'URGENT', 'PRIORITY',
        'LEGAL', 'CONFIDENTIAL', 'BOARD', 'EXECUTIVE'
      ],
      criticalLabels: [
        'LEGAL', 'CONFIDENTIAL', 'CLASSIFIED', 'TOP_SECRET',
        'PRIVILEGED', 'ATTORNEY_CLIENT', 'WORK_PRODUCT'
      ],
      
      // Batch Safety Limits
      maxDeletionsPerHour: 100,
      maxDeletionsPerDay: 1000,
      bulkOperationThreshold: 50,
      
      // Size Anomaly Safety
      largeEmailThreshold: 25 * 1024 * 1024, // 25MB
      unusualSizeMultiplier: 3.0,
      
      // Recent Activity Safety
      recentAccessDays: 7,
      recentForwardDays: 14,
      recentModificationDays: 30,
      
      // Safety Thresholds
      minStalenessScore: 0.3,
      maxAccessScore: 0.5,
      importanceScoreThreshold: 6.0,
      
      // Monitoring
      enableSafetyMetrics: true,
      enableDetailedLogging: true
    };

    // Merge user config with defaults
    return {
      ...defaultConfig,
      ...userConfig,
      // Ensure arrays are properly merged
      vipDomains: [...defaultConfig.vipDomains, ...(userConfig?.vipDomains || [])],
      trustedDomains: [...defaultConfig.trustedDomains, ...(userConfig?.trustedDomains || [])],
      whitelistDomains: [...defaultConfig.whitelistDomains, ...(userConfig?.whitelistDomains || [])],
      criticalAttachmentTypes: [...defaultConfig.criticalAttachmentTypes, ...(userConfig?.criticalAttachmentTypes || [])],
      legalDocumentTypes: [...defaultConfig.legalDocumentTypes, ...(userConfig?.legalDocumentTypes || [])],
      financialDocumentTypes: [...defaultConfig.financialDocumentTypes, ...(userConfig?.financialDocumentTypes || [])],
      contractDocumentTypes: [...defaultConfig.contractDocumentTypes, ...(userConfig?.contractDocumentTypes || [])],
      legalKeywords: [...defaultConfig.legalKeywords, ...(userConfig?.legalKeywords || [])],
      complianceTerms: [...defaultConfig.complianceTerms, ...(userConfig?.complianceTerms || [])],
      regulatoryKeywords: [...defaultConfig.regulatoryKeywords, ...(userConfig?.regulatoryKeywords || [])],
      protectedLabels: [...defaultConfig.protectedLabels, ...(userConfig?.protectedLabels || [])],
      criticalLabels: [...defaultConfig.criticalLabels, ...(userConfig?.criticalLabels || [])]
    };
  }

  /**
   * Create a new cleanup policy
   */
  async createPolicy(policy: Omit<CleanupPolicy, 'id' | 'created_at' | 'updated_at'>): Promise<string> {
    try {
      // Validate policy before creation
      const validation = this.validatePolicy(policy);
      if (!validation.valid) {
        throw new Error(`Invalid policy: ${validation.errors.join(', ')}`);
      }

      const policyId = await this.databaseManager.createCleanupPolicy(policy);
      
      logger.info('Cleanup policy created', {
        policy_id: policyId,
        name: policy.name,
        enabled: policy.enabled,
        priority: policy.priority
      });

      return policyId;
    } catch (error) {
      logger.error('Failed to create cleanup policy:', error);
      throw error;
    }
  }

  /**
   * Update an existing cleanup policy
   */
  async updatePolicy(policyId: string, updates: Partial<CleanupPolicy>): Promise<void> {
    try {
      // Validate updates if provided
      if (Object.keys(updates).length > 0) {
        const existingPolicy = await this.databaseManager.getCleanupPolicy(policyId);
        if (!existingPolicy) {
          throw new Error(`Policy not found: ${policyId}`);
        }

        const updatedPolicy = { ...existingPolicy, ...updates };
        const validation = this.validatePolicy(updatedPolicy);
        if (!validation.valid) {
          throw new Error(`Invalid policy updates: ${validation.errors.join(', ')}`);
        }
      }

      await this.databaseManager.updateCleanupPolicy(policyId, updates);
      
      logger.info('Cleanup policy updated', {
        policy_id: policyId,
        updates: Object.keys(updates)
      });
    } catch (error) {
      logger.error('Failed to update cleanup policy:', error);
      throw error;
    }
  }

  /**
   * Delete a cleanup policy
   */
  async deletePolicy(policyId: string): Promise<void> {
    try {
      await this.databaseManager.deleteCleanupPolicy(policyId);
      
      logger.info('Cleanup policy deleted', { policy_id: policyId });
    } catch (error) {
      logger.error('Failed to delete cleanup policy:', error);
      throw error;
    }
  }

  /**
   * Get all active cleanup policies
   */
  async getActivePolicies(): Promise<CleanupPolicy[]> {
    try {
      return await this.databaseManager.getActivePolicies();
    } catch (error) {
      logger.error('Failed to get active policies:', error);
      throw error;
    }
  }

  /**
   * Get all cleanup policies (active and inactive)
   */
  async getAllPolicies(): Promise<CleanupPolicy[]> {
    try {
      return await this.databaseManager.getAllPolicies();
    } catch (error) {
      logger.error('Failed to get all policies:', error);
      throw error;
    }
  }

  /**
   * Get a specific cleanup policy
   */
  async getPolicy(policyId: string): Promise<CleanupPolicy | null> {
    try {
      return await this.databaseManager.getCleanupPolicy(policyId);
    } catch (error) {
      logger.error('Failed to get cleanup policy:', error);
      throw error;
    }
  }

  /**
   * Evaluate emails against all active policies and determine cleanup candidates
   */
  async evaluateEmailsForCleanup(emails: EmailIndex[]): Promise<{
    cleanup_candidates: Array<{
      email: EmailIndex;
      policy: CleanupPolicy;
      staleness_score: StalenessScore;
      recommended_action: 'archive' | 'delete';
    }>;
    protected_emails: Array<{
      email: EmailIndex;
      reason: string;
    }>;
    evaluation_summary: {
      total_emails: number;
      candidates_count: number;
      protected_count: number;
      policies_applied: number;
    };
  }> {
    try {
      const activePolicies = await this.getActivePolicies();
      const cleanupCandidates: Array<{
        email: EmailIndex;
        policy: CleanupPolicy;
        staleness_score: StalenessScore;
        recommended_action: 'archive' | 'delete';
      }> = [];
      const protectedEmails: Array<{
        email: EmailIndex;
        reason: string;
      }> = [];

      // Process emails in batches to avoid memory issues
      const batchSize = 100;
      for (let i = 0; i < emails.length; i += batchSize) {
        const batch = emails.slice(i, i + batchSize);
        
        for (const email of batch) {
          const evaluation = await this.evaluateSingleEmail(email, activePolicies);
          
          if (evaluation.should_cleanup && evaluation.applicable_policy) {
            cleanupCandidates.push({
              email,
              policy: evaluation.applicable_policy,
              staleness_score: evaluation.staleness_score,
              recommended_action: evaluation.recommended_action
            });
          } else {
            protectedEmails.push({
              email,
              reason: evaluation.protection_reason
            });
          }
        }

        // Log progress for large batches
        if (emails.length > 1000) {
          logger.debug('Evaluated email batch for cleanup', {
            batch_end: Math.min(i + batchSize, emails.length),
            total_emails: emails.length,
            candidates_so_far: cleanupCandidates.length
          });
        }
      }

      return {
        cleanup_candidates: cleanupCandidates,
        protected_emails: protectedEmails,
        evaluation_summary: {
          total_emails: emails.length,
          candidates_count: cleanupCandidates.length,
          protected_count: protectedEmails.length,
          policies_applied: activePolicies.length
        }
      };
    } catch (error) {
      logger.error('Failed to evaluate emails for cleanup:', error);
      throw error;
    }
  }

  /**
   * Evaluate a single email against policies
   */
  private async evaluateSingleEmail(email: EmailIndex, policies: CleanupPolicy[]): Promise<{
    should_cleanup: boolean;
    applicable_policy?: CleanupPolicy;
    staleness_score: StalenessScore;
    recommended_action: 'archive' | 'delete';
    protection_reason: string;
  }> {
    logger.debug('Evaluating email for cleanup', {
      email_id: email.id,
      email_date: email.date,
      email_category: email.category,
      email_importance_score: email.importanceScore,
      policies_count: policies.length
    });

    // Calculate staleness score
    const stalenessScore = await this.stalenessScorer.calculateStaleness(email);

    // Check age-based protection first (more specific than general high importance check)
    // Use configurable recent email protection days (default 7 days)
    if (email.date) {
      const daysSinceReceived = (Date.now() - email.date.getTime()) / (1000 * 60 * 60 * 24);
      const recentEmailProtectionDays = this.safetyConfig.recentAccessDays ?? 7;
      
      
      logger.debug('Email age check', {
        email_id: email.id,
        days_since_received: daysSinceReceived,
        protection_threshold: recentEmailProtectionDays
      });
      
      if (daysSinceReceived < recentEmailProtectionDays) {
        logger.debug('Email protected - too recent', {
          email_id: email.id,
          days_since_received: daysSinceReceived,
          protection_threshold: recentEmailProtectionDays
        });
        return {
          should_cleanup: false,
          staleness_score: stalenessScore,
          recommended_action: 'archive',
          protection_reason: `Email too recent (less than ${recentEmailProtectionDays} days)`
        };
      }
    }

    // Check for policy-specific preserve_important safety settings first (before policy matching)
    const sortedPolicies = policies.sort((a, b) => b.priority - a.priority);
    
    for (const policy of sortedPolicies) {
      // Check preserve_important safety setting even if email doesn't match policy criteria
      if (policy.safety.preserve_important &&
          (email.category === 'high' || email.importanceLevel === 'high' || email.importanceScore && email.importanceScore > 5)) {
        return {
          should_cleanup: false,
          staleness_score: stalenessScore,
          recommended_action: 'archive',
          protection_reason: 'Policy configured to preserve important emails'
        };
      }
    }

    // Find applicable policy (highest priority first)
    for (const policy of sortedPolicies) {
      if (this.emailMatchesPolicy(email, policy, stalenessScore)) {
        // Check other policy-specific safety settings
        const policySafetyCheck = this.applyPolicySafetyChecks(email, policy, stalenessScore);
        if (!policySafetyCheck.safe) {
          return {
            should_cleanup: false,
            staleness_score: stalenessScore,
            recommended_action: 'archive',
            protection_reason: policySafetyCheck.reason
          };
        }

        return {
          should_cleanup: true,
          applicable_policy: policy,
          staleness_score: stalenessScore,
          recommended_action: policy.action.type,
          protection_reason: ''
        };
      }
    }

    return {
      should_cleanup: false,
      staleness_score: stalenessScore,
      recommended_action: 'archive',
      protection_reason: 'No applicable policy found'
    };
  }

  /**
   * Check if an email matches a policy's criteria
   */
  private emailMatchesPolicy(email: EmailIndex, policy: CleanupPolicy, stalenessScore: StalenessScore): boolean {
    const criteria = policy.criteria;

    // Check age criteria
    if (criteria.age_days_min) {
      if (!email.date) return false;
      
      const daysSinceReceived = (Date.now() - email.date.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceReceived < criteria.age_days_min) return false;
    }

    // Check importance level criteria
    if (criteria.importance_level_max) {
      const levels = ['low', 'medium', 'high'];
      const emailLevel = email.category || 'medium';
      const maxLevelIndex = levels.indexOf(criteria.importance_level_max);
      const emailLevelIndex = levels.indexOf(emailLevel);
      
      if (emailLevelIndex > maxLevelIndex) return false;
    }

    // Check size criteria
    if (criteria.size_threshold_min && email.size) {
      if (email.size < criteria.size_threshold_min) return false;
    }

    // Check spam score criteria
    if (criteria.spam_score_min && email.spam_score !== undefined) {
      if (email.spam_score < criteria.spam_score_min) return false;
    }

    // Check promotional score criteria
    if (criteria.promotional_score_min && email.promotional_score !== undefined) {
      if (email.promotional_score < criteria.promotional_score_min) return false;
    }

    // Check access score criteria
    if (criteria.access_score_max !== undefined) {
      if (stalenessScore.factors.access_score > criteria.access_score_max) return false;
    }

    // Check no access days criteria
    if (criteria.no_access_days) {
      // This is handled in the access score calculation
      // If access score is low, it means recent access, so email doesn't match
      if (stalenessScore.factors.access_score < 0.5) return false;
    }

    return true;
  }

 

  /**
   * Apply comprehensive policy-specific safety checks using SafetyConfig system
   * Implements production-ready safety measures with detailed logging and metrics
   */
  private applyPolicySafetyChecks(
    email: EmailIndex,
    policy: CleanupPolicy,
    stalenessScore: StalenessScore
  ): SafetyCheckResult {
    try {
      // Update safety metrics
      this.safetyMetrics.totalChecks++;
      
      if (this.safetyConfig.enableDetailedLogging) {
        logger.debug('Starting comprehensive safety checks', {
          email_id: email.id,
          policy_id: policy.id,
          staleness_score: stalenessScore.total_score,
          sender: email.sender?.[0] || 'unknown'
        });
      }

      // 1. BATCH SAFETY LIMITS (Check first for performance)
      const batchCheck = this.checkBatchSafetyLimits();
      if (!batchCheck.safe) {
        this.updateSafetyMetrics('batch_limits', batchCheck);
        return batchCheck;
      }

      // 2. DOMAIN-BASED PROTECTION (Most common, check early)
      const domainCheck = this.checkDomainProtection(email);
      if (!domainCheck.safe) {
        this.updateSafetyMetrics('domain_protection', domainCheck);
        return domainCheck;
      }

      // 3. VIP/EXECUTIVE PROTECTION
      const vipCheck = this.checkVipProtection(email);
      if (!vipCheck.safe) {
        this.updateSafetyMetrics('vip_protection', vipCheck);
        return vipCheck;
      }

      // 4. LABEL-BASED SAFETY
      const labelCheck = this.checkLabelSafety(email);
      if (!labelCheck.safe) {
        this.updateSafetyMetrics('label_safety', labelCheck);
        return labelCheck;
      }

      // 5. LEGAL/COMPLIANCE PROTECTION
      const legalCheck = this.checkLegalCompliance(email);
      if (!legalCheck.safe) {
        this.updateSafetyMetrics('legal_compliance', legalCheck);
        return legalCheck;
      }

      // 6. ATTACHMENT SAFETY
      const attachmentCheck = this.checkAttachmentSafety(email);
      if (!attachmentCheck.safe) {
        this.updateSafetyMetrics('attachment_safety', attachmentCheck);
        return attachmentCheck;
      }

      // 7. SENDER REPUTATION
      const senderCheck = this.checkSenderReputation(email);
      if (!senderCheck.safe) {
        this.updateSafetyMetrics('sender_reputation', senderCheck);
        return senderCheck;
      }

      // 8. THREAD/CONVERSATION SAFETY
      const threadCheck = this.checkThreadSafety(email);
      if (!threadCheck.safe) {
        this.updateSafetyMetrics('thread_safety', threadCheck);
        return threadCheck;
      }

      // 9. UNREAD EMAIL PROTECTION
      const unreadCheck = this.checkUnreadProtection(email);
      if (!unreadCheck.safe) {
        this.updateSafetyMetrics('unread_protection', unreadCheck);
        return unreadCheck;
      }

      // 10. SIZE ANOMALY PROTECTION
      const sizeCheck = this.checkSizeAnomalyProtection(email);
      if (!sizeCheck.safe) {
        this.updateSafetyMetrics('size_anomaly', sizeCheck);
        return sizeCheck;
      }

      // 11. STALENESS AND ACCESS SCORE CHECKS (Using config values)
      const stalenessCheck = this.checkStalenessThresholds(email, stalenessScore);
      if (!stalenessCheck.safe) {
        this.updateSafetyMetrics('staleness_threshold', stalenessCheck);
        return stalenessCheck;
      }

      // All safety checks passed
      if (this.safetyConfig.enableDetailedLogging) {
        logger.debug('All safety checks passed', {
          email_id: email.id,
          policy_id: policy.id,
          total_checks_performed: 11
        });
      }

      return {
        safe: true,
        reason: 'All safety checks passed',
        checkType: 'comprehensive_safety',
        severity: 'low',
        metadata: {
          checks_performed: 11,
          staleness_score: stalenessScore.total_score,
          access_score: stalenessScore.factors.access_score
        }
      };

    } catch (error) {
      logger.error('Error during safety checks', {
        email_id: email.id,
        policy_id: policy.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      return {
        safe: false,
        reason: 'Safety check error - protecting email by default',
        checkType: 'error_protection',
        severity: 'critical',
        metadata: { error: error instanceof Error ? error.message : 'Unknown error' }
      };
    }
  }

  /**
   * Check batch safety limits to prevent excessive deletions
   */
  private checkBatchSafetyLimits(): SafetyCheckResult {
    // This would typically check against a rate limiter or deletion counter
    // For now, we'll implement a basic check based on the current session
    const currentHour = new Date().getHours();
    const deletionsThisHour = this.safetyMetrics.checkTypeCounters['deletions_this_hour'] || 0;

    if (deletionsThisHour >= this.safetyConfig.maxDeletionsPerHour) {
      return {
        safe: false,
        reason: `Batch safety limit reached: ${deletionsThisHour}/${this.safetyConfig.maxDeletionsPerHour} deletions this hour`,
        checkType: 'batch_limits',
        severity: 'high',
        metadata: {
          deletions_this_hour: deletionsThisHour,
          limit: this.safetyConfig.maxDeletionsPerHour
        }
      };
    }

    return {
      safe: true,
      reason: 'Within batch safety limits',
      checkType: 'batch_limits',
      severity: 'low'
    };
  }

  /**
   * Check domain-based protection using SafetyConfig
   */
  private checkDomainProtection(email: EmailIndex): SafetyCheckResult {
    const emailDomain = this.extractEmailDomain(email.sender?.[0] || '');
    
    if (!emailDomain) {
      return {
        safe: true,
        reason: 'No domain to check',
        checkType: 'domain_protection',
        severity: 'low'
      };
    }

    // Check VIP domains (highest priority)
    if (this.safetyConfig.vipDomains.includes(emailDomain)) {
      return {
        safe: false,
        reason: `Email from VIP domain: ${emailDomain}`,
        checkType: 'domain_protection',
        severity: 'critical',
        metadata: { domain: emailDomain, domain_type: 'vip' }
      };
    }

    // Check trusted domains
    if (this.safetyConfig.trustedDomains.includes(emailDomain)) {
      return {
        safe: false,
        reason: `Email from trusted domain: ${emailDomain}`,
        checkType: 'domain_protection',
        severity: 'high',
        metadata: { domain: emailDomain, domain_type: 'trusted' }
      };
    }

    // Check whitelist domains
    if (this.safetyConfig.whitelistDomains.includes(emailDomain)) {
      return {
        safe: false,
        reason: `Email from whitelisted domain: ${emailDomain}`,
        checkType: 'domain_protection',
        severity: 'medium',
        metadata: { domain: emailDomain, domain_type: 'whitelist' }
      };
    }

    return {
      safe: true,
      reason: 'Domain not in protected lists',
      checkType: 'domain_protection',
      severity: 'low',
      metadata: { domain: emailDomain }
    };
  }

  /**
   * Check VIP/Executive protection
   */
  private checkVipProtection(email: EmailIndex): SafetyCheckResult {
    const sender = email.sender?.[0] || '';
    const emailDomain = this.extractEmailDomain(sender);

    // Check if sender is from VIP domain
    if (emailDomain && this.safetyConfig.vipDomains.includes(emailDomain)) {
      return {
        safe: false,
        reason: `Email from VIP/Executive domain: ${emailDomain}`,
        checkType: 'vip_protection',
        severity: 'critical',
        metadata: { sender, domain: emailDomain }
      };
    }

    // Check if email contains executive-related keywords in subject or sender
    const subject = email.subject?.toLowerCase() || '';
    const executiveKeywords = ['ceo', 'cto', 'cfo', 'president', 'director', 'executive', 'board'];
    
    const hasExecutiveKeyword = executiveKeywords.some(keyword =>
      subject.includes(keyword) || sender.toLowerCase().includes(keyword)
    );

    if (hasExecutiveKeyword) {
      return {
        safe: false,
        reason: 'Email contains executive-related keywords',
        checkType: 'vip_protection',
        severity: 'high',
        metadata: { sender, subject_keywords: true }
      };
    }

    return {
      safe: true,
      reason: 'No VIP/Executive indicators found',
      checkType: 'vip_protection',
      severity: 'low'
    };
  }

  /**
   * Check label-based safety using SafetyConfig
   */
  private checkLabelSafety(email: EmailIndex): SafetyCheckResult {
    const labels = email.labels || [];
    
    // Check critical labels first
    const criticalLabelFound = labels.find(label =>
      this.safetyConfig.criticalLabels.some(critical =>
        label.toUpperCase().includes(critical.toUpperCase())
      )
    );

    if (criticalLabelFound) {
      return {
        safe: false,
        reason: `Email has critical label: ${criticalLabelFound}`,
        checkType: 'label_safety',
        severity: 'critical',
        metadata: { labels, critical_label: criticalLabelFound }
      };
    }

    // Check protected labels
    const protectedLabelFound = labels.find(label =>
      this.safetyConfig.protectedLabels.some(protectedLabel =>
        label.toUpperCase().includes(protectedLabel.toUpperCase())
      )
    );

    if (protectedLabelFound) {
      return {
        safe: false,
        reason: `Email has protected label: ${protectedLabelFound}`,
        checkType: 'label_safety',
        severity: 'high',
        metadata: { labels, protected_label: protectedLabelFound }
      };
    }

    return {
      safe: true,
      reason: 'No protected labels found',
      checkType: 'label_safety',
      severity: 'low',
      metadata: { labels_count: labels.length }
    };
  }

  /**
   * Check legal/compliance protection using SafetyConfig
   */
  private checkLegalCompliance(email: EmailIndex): SafetyCheckResult {
    const subject = email.subject?.toLowerCase() || '';
    const snippet = email.snippet?.toLowerCase() || '';
    const content = `${subject} ${snippet}`;

    // Check legal keywords
    const legalKeywordFound = this.safetyConfig.legalKeywords.find(keyword =>
      content.includes(keyword.toLowerCase())
    );

    if (legalKeywordFound) {
      return {
        safe: false,
        reason: `Email contains legal keyword: ${legalKeywordFound}`,
        checkType: 'legal_compliance',
        severity: 'critical',
        metadata: { keyword: legalKeywordFound, found_in: 'content' }
      };
    }

    // Check compliance terms
    const complianceTermFound = this.safetyConfig.complianceTerms.find(term =>
      content.includes(term.toLowerCase())
    );

    if (complianceTermFound) {
      return {
        safe: false,
        reason: `Email contains compliance term: ${complianceTermFound}`,
        checkType: 'legal_compliance',
        severity: 'high',
        metadata: { term: complianceTermFound, found_in: 'content' }
      };
    }

    // Check regulatory keywords
    const regulatoryKeywordFound = this.safetyConfig.regulatoryKeywords.find(keyword =>
      content.includes(keyword.toLowerCase())
    );

    if (regulatoryKeywordFound) {
      return {
        safe: false,
        reason: `Email contains regulatory keyword: ${regulatoryKeywordFound}`,
        checkType: 'legal_compliance',
        severity: 'high',
        metadata: { keyword: regulatoryKeywordFound, found_in: 'content' }
      };
    }

    return {
      safe: true,
      reason: 'No legal/compliance keywords found',
      checkType: 'legal_compliance',
      severity: 'low'
    };
  }

  /**
   * Check attachment safety using SafetyConfig
   */
  private checkAttachmentSafety(email: EmailIndex): SafetyCheckResult {
    const hasAttachments = email.hasAttachments || false;
    
    if (!hasAttachments) {
      return {
        safe: true,
        reason: 'No attachments to check',
        checkType: 'attachment_safety',
        severity: 'low'
      };
    }

    // Since EmailIndex only indicates presence of attachments, not details,
    // we apply conservative safety measures for emails with attachments
    // This would typically require fetching attachment details from Gmail API
    
    // For now, we'll apply medium safety for any email with attachments
    // as they could potentially contain critical documents
    return {
      safe: false,
      reason: 'Email contains attachments - requires manual review for safety',
      checkType: 'attachment_safety',
      severity: 'medium',
      metadata: {
        has_attachments: true,
        note: 'Attachment details not available in EmailIndex - conservative protection applied'
      }
    };
  }

  /**
   * Check sender reputation using SafetyConfig
   */
  private checkSenderReputation(email: EmailIndex): SafetyCheckResult {
    const sender = email.sender?.[0] || '';
    
    if (!sender) {
      return {
        safe: true,
        reason: 'No sender to check',
        checkType: 'sender_reputation',
        severity: 'low'
      };
    }

    // This would typically query a database for sender interaction history
    // For now, we'll simulate based on email properties
    const isFrequentContact = this.isFrequentContact(sender);
    const hasHighImportanceScore = (email.importanceScore || 0) >= this.safetyConfig.importantSenderScore;

    if (isFrequentContact) {
      return {
        safe: false,
        reason: `Email from frequent contact: ${sender}`,
        checkType: 'sender_reputation',
        severity: 'medium',
        metadata: { sender, reputation_type: 'frequent_contact' }
      };
    }

    if (hasHighImportanceScore) {
      return {
        safe: false,
        reason: `Email from important sender (high importance score): ${sender}`,
        checkType: 'sender_reputation',
        severity: 'medium',
        metadata: { sender, importance_score: email.importanceScore }
      };
    }

    return {
      safe: true,
      reason: 'Sender not identified as important',
      checkType: 'sender_reputation',
      severity: 'low',
      metadata: { sender }
    };
  }

  /**
   * Check thread/conversation safety using SafetyConfig
   */
  private checkThreadSafety(email: EmailIndex): SafetyCheckResult {
    // Check if email is part of an active thread
    if (email.threadId) {
      const daysSinceEmail = email.date ?
        (Date.now() - email.date.getTime()) / (1000 * 60 * 60 * 24) : 0;

      if (daysSinceEmail <= this.safetyConfig.activeThreadDays) {
        return {
          safe: false,
          reason: `Email in active thread (${Math.round(daysSinceEmail)} days old)`,
          checkType: 'thread_safety',
          severity: 'medium',
          metadata: { thread_id: email.threadId, days_since_email: daysSinceEmail }
        };
      }
    }

    // Check for recent reply indicators
    const subject = email.subject?.toLowerCase() || '';
    const hasReplyIndicators = subject.includes('re:') || subject.includes('fwd:');
    
    if (hasReplyIndicators && email.date) {
      const daysSinceEmail = (Date.now() - email.date.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceEmail <= this.safetyConfig.recentReplyDays) {
        return {
          safe: false,
          reason: `Recent reply/forward email (${Math.round(daysSinceEmail)} days old)`,
          checkType: 'thread_safety',
          severity: 'medium',
          metadata: { days_since_email: daysSinceEmail, reply_type: hasReplyIndicators }
        };
      }
    }

    return {
      safe: true,
      reason: 'No active thread concerns',
      checkType: 'thread_safety',
      severity: 'low'
    };
  }

  /**
   * Check unread email protection using SafetyConfig
   */
  private checkUnreadProtection(email: EmailIndex): SafetyCheckResult {
    const isUnread = email.labels?.includes('UNREAD') || false;
    
    if (!isUnread) {
      return {
        safe: true,
        reason: 'Email is read',
        checkType: 'unread_protection',
        severity: 'low'
      };
    }

    if (email.date) {
      const daysSinceReceived = (Date.now() - email.date.getTime()) / (1000 * 60 * 60 * 24);
      
      if (daysSinceReceived <= this.safetyConfig.unreadRecentDays) {
        return {
          safe: false,
          reason: `Recent unread email (${Math.round(daysSinceReceived)} days old)`,
          checkType: 'unread_protection',
          severity: 'high',
          metadata: { days_since_received: daysSinceReceived, unread: true }
        };
      }
    }

    // Apply importance boost for unread emails
    const adjustedImportanceScore = (email.importanceScore || 0) + this.safetyConfig.unreadImportanceBoost;
    if (adjustedImportanceScore >= this.safetyConfig.importanceScoreThreshold) {
      return {
        safe: false,
        reason: `Unread email with boosted importance score: ${adjustedImportanceScore}`,
        checkType: 'unread_protection',
        severity: 'medium',
        metadata: {
          original_score: email.importanceScore,
          boosted_score: adjustedImportanceScore,
          unread: true
        }
      };
    }

    return {
      safe: true,
      reason: 'Unread email passed safety checks',
      checkType: 'unread_protection',
      severity: 'low',
      metadata: { unread: true }
    };
  }

  /**
   * Check size anomaly protection using SafetyConfig
   */
  private checkSizeAnomalyProtection(email: EmailIndex): SafetyCheckResult {
    const emailSize = email.size || 0;
    
    if (emailSize >= this.safetyConfig.largeEmailThreshold) {
      return {
        safe: false,
        reason: `Large email size: ${Math.round(emailSize / 1024 / 1024)}MB`,
        checkType: 'size_anomaly',
        severity: 'medium',
        metadata: {
          size_bytes: emailSize,
          size_mb: Math.round(emailSize / 1024 / 1024),
          threshold_mb: Math.round(this.safetyConfig.largeEmailThreshold / 1024 / 1024)
        }
      };
    }

    // Check for unusual size patterns (this would typically use historical data)
    // For now, we'll use a simple heuristic
    const averageEmailSize = 50000; // 50KB estimated average
    const unusualSize = emailSize > (averageEmailSize * this.safetyConfig.unusualSizeMultiplier);
    
    if (unusualSize) {
      return {
        safe: false,
        reason: `Unusually large email: ${Math.round(emailSize / 1024)}KB (${this.safetyConfig.unusualSizeMultiplier}x average)`,
        checkType: 'size_anomaly',
        severity: 'low',
        metadata: {
          size_bytes: emailSize,
          size_kb: Math.round(emailSize / 1024),
          multiplier: this.safetyConfig.unusualSizeMultiplier
        }
      };
    }

    return {
      safe: true,
      reason: 'Email size within normal range',
      checkType: 'size_anomaly',
      severity: 'low',
      metadata: { size_kb: Math.round(emailSize / 1024) }
    };
  }

  /**
   * Check staleness and access score thresholds using SafetyConfig
   */
  private checkStalenessThresholds(email: EmailIndex, stalenessScore: StalenessScore): SafetyCheckResult {
    // Check staleness score threshold using config
    if (stalenessScore.total_score < this.safetyConfig.minStalenessScore) {
      return {
        safe: false,
        reason: `Low staleness score: ${stalenessScore.total_score} < ${this.safetyConfig.minStalenessScore}`,
        checkType: 'staleness_threshold',
        severity: 'medium',
        metadata: {
          staleness_score: stalenessScore.total_score,
          threshold: this.safetyConfig.minStalenessScore
        }
      };
    }

    // Check access score threshold using config
    if (stalenessScore.factors.access_score < this.safetyConfig.maxAccessScore) {
      return {
        safe: false,
        reason: `Recent access detected: ${stalenessScore.factors.access_score} < ${this.safetyConfig.maxAccessScore}`,
        checkType: 'staleness_threshold',
        severity: 'medium',
        metadata: {
          access_score: stalenessScore.factors.access_score,
          threshold: this.safetyConfig.maxAccessScore
        }
      };
    }

    return {
      safe: true,
      reason: 'Staleness and access thresholds met',
      checkType: 'staleness_threshold',
      severity: 'low',
      metadata: {
        staleness_score: stalenessScore.total_score,
        access_score: stalenessScore.factors.access_score
      }
    };
  }

  /**
   * Update safety metrics for tracking
   */
  private updateSafetyMetrics(checkType: string, result: SafetyCheckResult): void {
    if (!this.safetyConfig.enableSafetyMetrics) return;

    this.safetyMetrics.protectedEmails++;
    this.safetyMetrics.checkTypeCounters[checkType] = (this.safetyMetrics.checkTypeCounters[checkType] || 0) + 1;
    this.safetyMetrics.lastUpdated = new Date();

    if (this.safetyConfig.enableDetailedLogging) {
      logger.info('Safety check triggered protection', {
        check_type: checkType,
        severity: result.severity,
        reason: result.reason,
        total_protected: this.safetyMetrics.protectedEmails,
        total_checks: this.safetyMetrics.totalChecks
      });
    }
  }

  /**
   * Extract domain from email address
   */
  private extractEmailDomain(email: string): string {
    const match = email.match(/@([^@]+)$/);
    return match ? match[1].toLowerCase() : '';
  }

  /**
   * Check if sender is a frequent contact (simplified implementation)
   */
  private isFrequentContact(sender: string): boolean {
    // This would typically query interaction history from database
    // For now, we'll use a simple heuristic based on domain type
    const domain = this.extractEmailDomain(sender);
    const commonDomains = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com'];
    
    // If it's not a common consumer domain, it might be a business contact
    return !commonDomains.includes(domain) && domain.length > 0;
  }

  /**
   * Get current safety metrics
   */
  public getSafetyMetrics(): SafetyMetrics {
    return { ...this.safetyMetrics };
  }

  /**
   * Reset safety metrics
   */
  public resetSafetyMetrics(): void {
    this.safetyMetrics = {
      totalChecks: 0,
      protectedEmails: 0,
      checkTypeCounters: {},
      lastUpdated: new Date()
    };
    
    logger.info('Safety metrics reset');
  }

  /**
   * Update safety configuration
   */
  public updateSafetyConfig(updates: Partial<SafetyConfig>): void {
    this.safetyConfig = { ...this.safetyConfig, ...updates };
    
    logger.info('Safety configuration updated', {
      updated_fields: Object.keys(updates),
      vip_domains_count: this.safetyConfig.vipDomains.length,
      trusted_domains_count: this.safetyConfig.trustedDomains.length
    });
  }

  /**
   * Validate a cleanup policy
   */
  validatePolicy(policy: Partial<CleanupPolicy>): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check required fields
    if (!policy.name || policy.name.trim().length === 0) {
      errors.push('Policy name is required');
    }

    if (policy.priority !== undefined && (policy.priority < 0 || policy.priority > 100)) {
      errors.push('Policy priority must be between 0 and 100');
    }

    // Validate criteria
    if (policy.criteria) {
      if (policy.criteria.age_days_min !== undefined && policy.criteria.age_days_min < 0) {
        errors.push('Age minimum days must be positive');
      }

      if (policy.criteria.size_threshold_min !== undefined && policy.criteria.size_threshold_min < 0) {
        errors.push('Size threshold must be positive');
      }

      if (policy.criteria.spam_score_min !== undefined && 
          (policy.criteria.spam_score_min < 0 || policy.criteria.spam_score_min > 1)) {
        errors.push('Spam score must be between 0 and 1');
      }

      if (policy.criteria.promotional_score_min !== undefined && 
          (policy.criteria.promotional_score_min < 0 || policy.criteria.promotional_score_min > 1)) {
        errors.push('Promotional score must be between 0 and 1');
      }

      if (policy.criteria.access_score_max !== undefined && 
          (policy.criteria.access_score_max < 0 || policy.criteria.access_score_max > 1)) {
        errors.push('Access score must be between 0 and 1');
      }

      if (policy.criteria.no_access_days !== undefined && policy.criteria.no_access_days < 0) {
        errors.push('No access days must be positive');
      }
    }

    // Validate action
    if (policy.action) {
      if (!['archive', 'delete'].includes(policy.action.type)) {
        errors.push('Action type must be either "archive" or "delete"');
      }

      if (policy.action.method && !['gmail', 'export'].includes(policy.action.method)) {
        errors.push('Action method must be either "gmail" or "export"');
      }

      if (policy.action.export_format && !['mbox', 'json'].includes(policy.action.export_format)) {
        errors.push('Export format must be either "mbox" or "json"');
      }
    }

    // Validate safety settings
    if (policy.safety) {
      if (policy.safety.max_emails_per_run !== undefined && policy.safety.max_emails_per_run < 1) {
        errors.push('Max emails per run must be at least 1');
      }
    }

    // Validate schedule
    if (policy.schedule) {
      if (!['continuous', 'daily', 'weekly', 'monthly'].includes(policy.schedule.frequency)) {
        errors.push('Schedule frequency must be one of: continuous, daily, weekly, monthly');
      }

      if (policy.schedule.time && !/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(policy.schedule.time)) {
        errors.push('Schedule time must be in HH:MM format');
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Get emails that are eligible for cleanup based on a specific policy
   */
  async getEmailsForPolicy(policy: CleanupPolicy, limit?: number): Promise<EmailIndex[]> {
    try {
      return await this.databaseManager.getEmailsForCleanup(policy, limit);
    } catch (error) {
      logger.error('Failed to get emails for policy:', error);
      throw error;
    }
  }

  /**
   * Generate cleanup policy recommendations based on email analysis
   */
  async generatePolicyRecommendations(): Promise<{
    recommended_policies: Array<{
      name: string;
      description: string;
      criteria: CleanupPolicy['criteria'];
      estimated_cleanup_count: number;
      estimated_storage_freed: number;
    }>;
    analysis_summary: {
      total_emails: number;
      spam_emails: number;
      promotional_emails: number;
      old_emails: number;
      large_emails: number;
    };
  }> {
    try {
      // Analyze current email dataset
      const allEmails = await this.databaseManager.searchEmails({ archived: false, limit: 10000 });
      
      const analysis = {
        total_emails: allEmails.length,
        spam_emails: allEmails.filter(e => e.spam_score && e.spam_score > 0.7).length,
        promotional_emails: allEmails.filter(e => e.promotional_score && e.promotional_score > 0.6).length,
        old_emails: allEmails.filter(e => {
          if (!e.date) return false;
          const daysSince = (Date.now() - e.date.getTime()) / (1000 * 60 * 60 * 24);
          return daysSince > 365;
        }).length,
        large_emails: allEmails.filter(e => e.size && e.size > 10485760).length // > 10MB
      };

      const recommendations: Array<{
        name: string;
        description: string;
        criteria: CleanupPolicy['criteria'];
        estimated_cleanup_count: number;
        estimated_storage_freed: number;
      }> = [];

      // Recommend spam cleanup policy
      if (analysis.spam_emails > 10) {
        recommendations.push({
          name: 'Spam Email Cleanup',
          description: 'Remove emails identified as spam or junk',
          criteria: {
            age_days_min: 30,
            importance_level_max: 'low',
            spam_score_min: 0.7
          },
          estimated_cleanup_count: analysis.spam_emails,
          estimated_storage_freed: analysis.spam_emails * 50000 // Estimate 50KB per spam email
        });
      }

      // Recommend promotional email cleanup
      if (analysis.promotional_emails > 20) {
        recommendations.push({
          name: 'Promotional Email Cleanup',
          description: 'Archive old promotional and marketing emails',
          criteria: {
            age_days_min: 90,
            importance_level_max: 'medium',
            promotional_score_min: 0.6
          },
          estimated_cleanup_count: Math.floor(analysis.promotional_emails * 0.8),
          estimated_storage_freed: Math.floor(analysis.promotional_emails * 0.8) * 75000 // Estimate 75KB per promo email
        });
      }

      // Recommend old email cleanup
      if (analysis.old_emails > 50) {
        recommendations.push({
          name: 'Old Email Archive',
          description: 'Archive emails older than 1 year with low importance',
          criteria: {
            age_days_min: 365,
            importance_level_max: 'medium',
            no_access_days: 180
          },
          estimated_cleanup_count: Math.floor(analysis.old_emails * 0.6),
          estimated_storage_freed: Math.floor(analysis.old_emails * 0.6) * 100000 // Estimate 100KB per old email
        });
      }

      // Recommend large email cleanup
      if (analysis.large_emails > 5) {
        recommendations.push({
          name: 'Large Email Cleanup',
          description: 'Archive large emails with attachments that are not frequently accessed',
          criteria: {
            age_days_min: 180,
            importance_level_max: 'medium',
            size_threshold_min: 10485760, // 10MB
            no_access_days: 90
          },
          estimated_cleanup_count: Math.floor(analysis.large_emails * 0.7),
          estimated_storage_freed: Math.floor(analysis.large_emails * 0.7) * 15000000 // Estimate 15MB per large email
        });
      }

      return {
        recommended_policies: recommendations,
        analysis_summary: analysis
      };
    } catch (error) {
      logger.error('Failed to generate policy recommendations:', error);
      throw error;
    }
  }
}