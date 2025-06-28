#!/usr/bin/env node

/**
 * Quick Timeout Test
 * 
 * This script tests if the timeout configuration is working properly.
 * Run this to verify Jest timeout settings before running the full test suite.
 * 
 * Usage:
 *   node tests/integration/mcp/timeout-test.js
 */

const path = require('path');
const fs = require('fs');

// Load environment from .env.test if it exists
const envPath = path.join(__dirname, '.env.test');
if (fs.existsSync(envPath)) {
  require('dotenv').config({ path: envPath });
  console.log('✅ Loaded environment from .env.test');
} else {
  console.log('⚠️  No .env.test file found, using system environment variables');
}

// Check timeout configuration
const testTimeout = parseInt(process.env.TEST_TIMEOUT || '60000');
const browserTimeout = parseInt(process.env.BROWSER_TIMEOUT || '120000');
const oauthRetryAttempts = parseInt(process.env.OAUTH_RETRY_ATTEMPTS || '3');
const oauthRetryDelay = parseInt(process.env.OAUTH_RETRY_DELAY || '5000');

console.log('\n🕐 Timeout Configuration Check:');
console.log(`   Jest Test Timeout: ${testTimeout}ms (${testTimeout/1000}s)`);
console.log(`   Browser Timeout: ${browserTimeout}ms (${browserTimeout/1000}s)`);
console.log(`   OAuth Retry Attempts: ${oauthRetryAttempts}`);
console.log(`   OAuth Retry Delay: ${oauthRetryDelay}ms (${oauthRetryDelay/1000}s)`);

// Calculate total possible OAuth time
const maxOAuthTime = (browserTimeout + oauthRetryDelay) * oauthRetryAttempts;
console.log(`   Maximum OAuth Time: ${maxOAuthTime}ms (${maxOAuthTime/1000}s)`);

// Check if configuration is reasonable
console.log('\n📊 Configuration Analysis:');

if (testTimeout < 120000) {
  console.log('⚠️  TEST_TIMEOUT is less than 2 minutes - may be too short for OAuth flows');
  console.log('   Recommendation: Set TEST_TIMEOUT=300000 (5 minutes)');
}

if (maxOAuthTime > testTimeout) {
  console.log('❌ Maximum OAuth time exceeds test timeout!');
  console.log(`   OAuth could take up to ${maxOAuthTime/1000}s but test timeout is ${testTimeout/1000}s`);
  console.log('   Recommendation: Increase TEST_TIMEOUT or reduce retry settings');
} else {
  console.log('✅ OAuth timeout configuration looks reasonable');
}

if (browserTimeout < 60000) {
  console.log('⚠️  BROWSER_TIMEOUT is less than 1 minute - may be too short');
  console.log('   Recommendation: Set BROWSER_TIMEOUT=120000 (2 minutes)');
}

// Test environment variables
console.log('\n🔧 Environment Variables:');
console.log(`   GMAIL_TEST_EMAIL: ${process.env.GMAIL_TEST_EMAIL || '[NOT SET]'}`);
console.log(`   GMAIL_TEST_PASSWORD: ${process.env.GMAIL_TEST_PASSWORD ? '[SET]' : '[NOT SET]'}`);
console.log(`   GMAIL_USE_APP_PASSWORD: ${process.env.GMAIL_USE_APP_PASSWORD || 'false'}`);
console.log(`   HEADLESS_BROWSER: ${process.env.HEADLESS_BROWSER || 'true'}`);
console.log(`   USE_MOCK_OAUTH: ${process.env.USE_MOCK_OAUTH || 'false'}`);
console.log(`   SKIP_OAUTH_ON_TIMEOUT: ${process.env.SKIP_OAUTH_ON_TIMEOUT || 'false'}`);

// Recommendations
console.log('\n💡 Recommendations:');

if (!process.env.GMAIL_TEST_PASSWORD) {
  console.log('❌ GMAIL_TEST_PASSWORD not set - tests will fail');
  console.log('   Set your Gmail password or App Password in .env.test');
}

if (process.env.GMAIL_USE_APP_PASSWORD !== 'true') {
  console.log('⚠️  Consider using App Passwords for more reliable OAuth');
  console.log('   Set GMAIL_USE_APP_PASSWORD=true in .env.test');
}

if (process.env.HEADLESS_BROWSER !== 'false') {
  console.log('💡 For debugging OAuth issues, try:');
  console.log('   Set HEADLESS_BROWSER=false to see browser interactions');
}

if (testTimeout < 300000) {
  console.log('💡 For OAuth reliability, consider:');
  console.log('   Set TEST_TIMEOUT=300000 (5 minutes) in .env.test');
}

// Quick timeout simulation
console.log('\n⏱️  Testing timeout behavior...');

async function simulateTimeout() {
  const start = Date.now();
  
  try {
    // Simulate a long-running operation
    await new Promise((resolve, reject) => {
      setTimeout(() => {
        const elapsed = Date.now() - start;
        console.log(`   Simulated operation completed in ${elapsed}ms`);
        resolve();
      }, 2000); // 2 second operation
    });
    
    console.log('✅ Timeout simulation completed successfully');
    
  } catch (error) {
    console.log('❌ Timeout simulation failed:', error.message);
  }
}

simulateTimeout().then(() => {
  console.log('\n🎯 Summary:');
  console.log('1. Check the configuration analysis above');
  console.log('2. Adjust timeout values in .env.test if needed');
  console.log('3. Consider using mock OAuth for faster testing');
  console.log('4. Run: npm run test:mcp');
  
  process.exit(0);
}).catch((error) => {
  console.error('Timeout test failed:', error);
  process.exit(1);
});
