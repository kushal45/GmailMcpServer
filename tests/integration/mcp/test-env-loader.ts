import * as dotenv from 'dotenv';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Test Environment Configuration Interface
 */
export interface TestEnvironmentConfig {
  // User credentials
  primaryUser: {
    email: string;
    password: string;
    displayName: string;
  };
  secondaryUser: {
    email: string;
    displayName: string;
  };
  
  // OAuth settings
  oauth: {
    useAppPassword: boolean;
    headless: boolean;
    timeout: number;
    retryAttempts: number;
    retryDelay: number;
  };
  
  // Test behavior
  test: {
    timeout: number;
    enableCleanup: boolean;
    preserveTestData: boolean;
    verboseLogging: boolean;
    captureScreenshots: boolean;
    preserveBrowserSession: boolean;
  };
  
  // Email testing
  email: {
    maxTestEmails: number;
    batchSize: number;
  };
  
  // Storage paths
  storage: {
    dataPath: string;
    archivePath: string;
  };
  
  // Server settings
  server: {
    port: number;
    cacheSize: number;
    sessionTimeoutHours: number;
  };
}

/**
 * Load test environment configuration
 */
export function loadTestEnvironment(): TestEnvironmentConfig {
  // Load test-specific environment file
  const testEnvPath = path.join(__dirname, '.env.test');
  const result = dotenv.config({ path: testEnvPath });
  
  if (result.error) {
    console.warn(`Warning: Could not load test environment file from ${testEnvPath}`);
    console.warn('Using default values and system environment variables');
  } else {
    console.info(`✅ Loaded test environment from: ${testEnvPath}`);
  }
  
  // Parse and validate environment variables
  const config: TestEnvironmentConfig = {
    primaryUser: {
      email: process.env.GMAIL_TEST_EMAIL || 'test-primary@gmail.com',
      password: process.env.GMAIL_TEST_PASSWORD || '',
      displayName: process.env.GMAIL_TEST_DISPLAY_NAME || 'Primary Test User',
    },
    secondaryUser: {
      email: process.env.GMAIL_TEST_EMAIL_2 || 'test-secondary@gmail.com',
      displayName: process.env.GMAIL_TEST_DISPLAY_NAME_2 || 'Secondary Test User',
    },
    oauth: {
      useAppPassword: process.env.GMAIL_USE_APP_PASSWORD === 'true',
      headless: process.env.HEADLESS_BROWSER !== 'false',
      timeout: parseInt(process.env.BROWSER_TIMEOUT || '120000'),
      retryAttempts: parseInt(process.env.OAUTH_RETRY_ATTEMPTS || '3'),
      retryDelay: parseInt(process.env.OAUTH_RETRY_DELAY || '5000'),
    },
    test: {
      timeout: parseInt(process.env.TEST_TIMEOUT || '120000'),
      enableCleanup: process.env.ENABLE_TEST_CLEANUP !== 'false',
      preserveTestData: process.env.PRESERVE_TEST_DATA === 'true',
      verboseLogging: process.env.VERBOSE_TEST_LOGGING === 'true',
      captureScreenshots: process.env.CAPTURE_SCREENSHOTS === 'true',
      preserveBrowserSession: process.env.PRESERVE_BROWSER_SESSION === 'true',
    },
    email: {
      maxTestEmails: parseInt(process.env.MAX_TEST_EMAILS || '100'),
      batchSize: parseInt(process.env.TEST_EMAIL_BATCH_SIZE || '5'),
    },
    storage: {
      dataPath: process.env.STORAGE_PATH || './tests/data',
      archivePath: process.env.ARCHIVE_PATH || './tests/archives',
    },
    server: {
      port: parseInt(process.env.MCP_SERVER_PORT || '3001'),
      cacheSize: parseInt(process.env.CACHE_SIZE || '100'),
      sessionTimeoutHours: parseInt(process.env.SESSION_TIMEOUT_HOURS || '1'),
    },
  };
  
  return config;
}

/**
 * Validate test environment configuration
 */
export function validateTestEnvironment(config: TestEnvironmentConfig): void {
  const errors: string[] = [];
  
  // Validate required credentials
  if (!config.primaryUser.password) {
    errors.push('GMAIL_TEST_PASSWORD is required for automated OAuth testing');
  }
  
  if (!config.primaryUser.email.includes('@')) {
    errors.push('GMAIL_TEST_EMAIL must be a valid email address');
  }
  
  if (!config.secondaryUser.email.includes('@')) {
    errors.push('GMAIL_TEST_EMAIL_2 must be a valid email address');
  }
  
  // Validate numeric values
  if (config.oauth.timeout < 30000) {
    errors.push('BROWSER_TIMEOUT should be at least 30000ms (30 seconds)');
  }
  
  if (config.test.timeout < 30000) {
    errors.push('TEST_TIMEOUT should be at least 30000ms (30 seconds)');
  }
  
  if (errors.length > 0) {
    const errorMessage = `
❌ Test Environment Configuration Errors:

${errors.map(error => `  • ${error}`).join('\n')}

Please check your test environment configuration in:
  ${path.join(__dirname, '.env.test')}

See docs/TESTING_SETUP.md for detailed setup instructions.
    `;
    
    console.error(errorMessage);
    throw new Error('Invalid test environment configuration');
  }
  
  console.info('✅ Test environment configuration validated successfully');
}

/**
 * Display test environment summary
 */
export function displayTestEnvironmentSummary(config: TestEnvironmentConfig): void {
  console.info(`
🧪 Test Environment Configuration Summary:
  
👤 Primary User:    ${config.primaryUser.email} (${config.primaryUser.displayName})
👤 Secondary User:  ${config.secondaryUser.email} (${config.secondaryUser.displayName})

🔐 OAuth Settings:
  • Method:         ${config.oauth.useAppPassword ? 'App Password' : 'Regular Password'}
  • Browser:        ${config.oauth.headless ? 'Headless' : 'Visible'}
  • Timeout:        ${config.oauth.timeout}ms
  • Retry Attempts: ${config.oauth.retryAttempts}

🧪 Test Settings:
  • Timeout:        ${config.test.timeout}ms
  • Cleanup:        ${config.test.enableCleanup ? 'Enabled' : 'Disabled'}
  • Verbose Logs:   ${config.test.verboseLogging ? 'Enabled' : 'Disabled'}
  • Screenshots:    ${config.test.captureScreenshots ? 'Enabled' : 'Disabled'}

📧 Email Testing:
  • Max Emails:     ${config.email.maxTestEmails}
  • Batch Size:     ${config.email.batchSize}

💾 Storage:
  • Data Path:      ${config.storage.dataPath}
  • Archive Path:   ${config.storage.archivePath}

🖥️  Server:
  • Port:           ${config.server.port}
  • Cache Size:     ${config.server.cacheSize}
  • Session Timeout: ${config.server.sessionTimeoutHours}h
  `);
}

/**
 * Initialize test environment
 * Call this at the beginning of your test suite
 */
export function initializeTestEnvironment(): TestEnvironmentConfig {
  console.info('🚀 Initializing test environment...');
  
  const config = loadTestEnvironment();
  validateTestEnvironment(config);
  
  if (config.test.verboseLogging) {
    displayTestEnvironmentSummary(config);
  }
  
  return config;
}
