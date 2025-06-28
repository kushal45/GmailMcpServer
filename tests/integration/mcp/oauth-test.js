#!/usr/bin/env node

/**
 * Standalone OAuth Flow Test
 * 
 * This script tests the OAuth flow independently to help diagnose issues.
 * Run this before running the full test suite to verify OAuth works.
 * 
 * Usage:
 *   node tests/integration/mcp/oauth-test.js
 * 
 * Environment variables:
 *   GMAIL_TEST_EMAIL - Your test Gmail address
 *   GMAIL_TEST_PASSWORD - Your App Password or regular password
 *   GMAIL_USE_APP_PASSWORD - Set to 'true' for App Password
 *   HEADLESS_BROWSER - Set to 'false' to see browser
 */

const puppeteer = require('puppeteer');
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

// Configuration
const config = {
  email: process.env.GMAIL_TEST_EMAIL || 'test@gmail.com',
  password: process.env.GMAIL_TEST_PASSWORD || '',
  useAppPassword: process.env.GMAIL_USE_APP_PASSWORD === 'true',
  headless: process.env.HEADLESS_BROWSER !== 'false',
  timeout: parseInt(process.env.BROWSER_TIMEOUT || '120000'),
};

console.log('🧪 OAuth Flow Test Configuration:');
console.log(`   Email: ${config.email}`);
console.log(`   Password: ${config.password ? '[SET]' : '[NOT SET]'}`);
console.log(`   Use App Password: ${config.useAppPassword}`);
console.log(`   Headless: ${config.headless}`);
console.log(`   Timeout: ${config.timeout}ms`);

if (!config.password) {
  console.error('❌ GMAIL_TEST_PASSWORD not set. Please configure your test environment.');
  process.exit(1);
}

async function testOAuthFlow() {
  let browser;
  
  try {
    console.log('\n🚀 Starting OAuth flow test...');
    
    // Launch browser
    console.log('📱 Launching browser...');
    browser = await puppeteer.launch({
      headless: config.headless,
      executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      slowMo: 100,
      args: [
        "--disable-blink-features=AutomationControlled",
        "--disable-infobars",
        "--no-sandbox",
        "--disable-setuid-sandbox",
      ],
    });
    
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // Navigate to a test OAuth URL (you'll need to replace this with your actual OAuth URL)
    const testOAuthUrl = 'https://accounts.google.com/oauth/authorize?client_id=test&redirect_uri=http://localhost:3000/oauth2callback&response_type=code&scope=https://www.googleapis.com/auth/gmail.readonly';
    
    console.log('🌐 Navigating to OAuth URL...');
    await page.goto(testOAuthUrl, { waitUntil: "networkidle0" });
    
    // Take initial screenshot
    await page.screenshot({ path: 'oauth-test-start.png', fullPage: true });
    console.log('📸 Screenshot saved: oauth-test-start.png');
    
    // Test email input
    console.log('📧 Testing email input...');
    try {
      await page.waitForSelector('input[type="email"]', { timeout: 30000 });
      await page.type('input[type="email"]', config.email, { delay: 100 });
      console.log('✅ Email input successful');
      
      await page.screenshot({ path: 'oauth-test-email.png', fullPage: true });
      console.log('📸 Screenshot saved: oauth-test-email.png');
      
      // Click Next
      await page.click('#identifierNext, [id="identifierNext"]');
      console.log('✅ Email Next button clicked');
      
    } catch (error) {
      console.error('❌ Email input failed:', error.message);
      await page.screenshot({ path: 'oauth-test-email-error.png', fullPage: true });
      throw error;
    }
    
    // Test password input
    console.log('🔐 Testing password input...');
    try {
      await page.waitForSelector('input[type="password"]', { timeout: 30000 });
      await page.type('input[type="password"]', config.password, { delay: 100 });
      console.log('✅ Password input successful');
      
      await page.screenshot({ path: 'oauth-test-password.png', fullPage: true });
      console.log('📸 Screenshot saved: oauth-test-password.png');
      
      // Click Next
      await page.click('#passwordNext, [id="passwordNext"]');
      console.log('✅ Password Next button clicked');
      
    } catch (error) {
      console.error('❌ Password input failed:', error.message);
      await page.screenshot({ path: 'oauth-test-password-error.png', fullPage: true });
      throw error;
    }
    
    // Wait for potential consent screen or redirect
    console.log('⏳ Waiting for OAuth flow completion...');
    await page.waitForTimeout(5000);
    
    // Take final screenshot
    await page.screenshot({ path: 'oauth-test-final.png', fullPage: true });
    console.log('📸 Screenshot saved: oauth-test-final.png');
    
    // Get current URL and page content
    const currentUrl = page.url();
    const pageTitle = await page.title();
    const pageContent = await page.evaluate(() => document.body.textContent.substring(0, 500));
    
    console.log('\n📊 OAuth Flow Results:');
    console.log(`   Final URL: ${currentUrl}`);
    console.log(`   Page Title: ${pageTitle}`);
    console.log(`   Page Content Preview: ${pageContent.replace(/\s+/g, ' ').trim()}`);
    
    // Check if we reached a callback or success page
    if (currentUrl.includes('oauth2callback') || currentUrl.includes('callback')) {
      console.log('✅ OAuth flow appears to have completed successfully');
      
      // Try to extract session information
      const sessionInfo = await page.evaluate(() => {
        const text = document.body.textContent;
        const sessionMatch = text.match(/session[_\s]?ID[:\s]+([a-zA-Z0-9-]+)/i);
        const userMatch = text.match(/user[_\s]?ID[:\s]+([a-zA-Z0-9-]+)/i);
        
        return {
          sessionId: sessionMatch ? sessionMatch[1] : null,
          userId: userMatch ? userMatch[1] : null,
          fullText: text.substring(0, 1000)
        };
      });
      
      console.log('🔍 Session extraction results:', sessionInfo);
      
      if (sessionInfo.sessionId && sessionInfo.userId) {
        console.log('✅ Session information successfully extracted');
      } else {
        console.log('⚠️  Session information not found in expected format');
      }
      
    } else {
      console.log('⚠️  OAuth flow may not have completed - check screenshots');
    }
    
  } catch (error) {
    console.error('❌ OAuth flow test failed:', error.message);
    
    if (browser) {
      try {
        const page = (await browser.pages())[0];
        if (page) {
          await page.screenshot({ path: 'oauth-test-error.png', fullPage: true });
          console.log('📸 Error screenshot saved: oauth-test-error.png');
        }
      } catch (screenshotError) {
        console.error('Failed to take error screenshot:', screenshotError.message);
      }
    }
    
    throw error;
    
  } finally {
    if (browser) {
      await browser.close();
      console.log('🔒 Browser closed');
    }
  }
}

// Run the test
testOAuthFlow()
  .then(() => {
    console.log('\n🎉 OAuth flow test completed successfully!');
    console.log('\nNext steps:');
    console.log('1. Check the generated screenshots');
    console.log('2. Verify session extraction works');
    console.log('3. Run the full test suite: npm run test:mcp');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 OAuth flow test failed!');
    console.error('Error:', error.message);
    console.log('\nTroubleshooting:');
    console.log('1. Check generated screenshots for visual debugging');
    console.log('2. Verify your credentials are correct');
    console.log('3. Try using App Passwords instead of regular passwords');
    console.log('4. Check docs/OAUTH_TROUBLESHOOTING.md for detailed help');
    process.exit(1);
  });
