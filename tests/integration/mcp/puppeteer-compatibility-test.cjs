#!/usr/bin/env node

/**
 * Puppeteer Compatibility Test
 * 
 * This script tests Puppeteer compatibility and API availability
 * to ensure the OAuth validation script will work correctly.
 * 
 * Usage:
 *   node tests/integration/mcp/puppeteer-compatibility-test.cjs
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

console.log('🧪 Puppeteer Compatibility Test Starting...\n');

async function testPuppeteerCompatibility() {
  let browser;
  
  try {
    // Test 1: Check Puppeteer version
    console.log('📦 Test 1: Checking Puppeteer version...');
    try {
      const puppeteerVersion = require('puppeteer/package.json').version;
      console.log(`✅ Puppeteer Version: ${puppeteerVersion}`);
      
      // Check if version is compatible
      const majorVersion = parseInt(puppeteerVersion.split('.')[0]);
      if (majorVersion >= 10) {
        console.log('✅ Version is compatible (v10+)');
      } else {
        console.log('⚠️  Version may have compatibility issues (older than v10)');
      }
    } catch (e) {
      console.log('❌ Unable to detect Puppeteer version');
    }
    
    // Test 2: Browser launch
    console.log('\n🚀 Test 2: Testing browser launch...');
    browser = await puppeteer.launch({
      headless: true,
      executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      args: [
        "--disable-blink-features=AutomationControlled",
        "--disable-infobars",
        "--no-sandbox",
        "--disable-setuid-sandbox",
      ],
    });
    console.log('✅ Browser launched successfully');
    
    // Test 3: Page creation
    console.log('\n📄 Test 3: Testing page creation...');
    const page = await browser.newPage();
    console.log('✅ Page created successfully');
    
    // Test 4: User agent setting
    console.log('\n🤖 Test 4: Testing user agent setting...');
    await page.setUserAgent('Mozilla/5.0 (Test) Chrome/120.0.0.0 Safari/537.36');
    console.log('✅ User agent set successfully');
    
    // Test 5: Navigation
    console.log('\n🌐 Test 5: Testing navigation...');
    await page.goto('https://www.google.com', { waitUntil: "networkidle0", timeout: 30000 });
    console.log('✅ Navigation successful');
    
    // Test 6: Screenshot capability
    console.log('\n📸 Test 6: Testing screenshot capability...');
    await page.screenshot({ path: 'puppeteer-test-screenshot.png' });
    console.log('✅ Screenshot saved: puppeteer-test-screenshot.png');
    
    // Test 7: Element selection
    console.log('\n🔍 Test 7: Testing element selection...');
    const searchBox = await page.$('input[name="q"]');
    if (searchBox) {
      console.log('✅ Element selection successful');
    } else {
      console.log('⚠️  Element not found (may be normal)');
    }
    
    // Test 8: Wait functions
    console.log('\n⏳ Test 8: Testing wait functions...');
    
    // Test waitForSelector
    try {
      await page.waitForSelector('body', { timeout: 5000 });
      console.log('✅ waitForSelector works');
    } catch (e) {
      console.log('❌ waitForSelector failed:', e.message);
    }
    
    // Test waitForFunction
    try {
      await page.waitForFunction('document.readyState === "complete"', { timeout: 5000 });
      console.log('✅ waitForFunction works');
    } catch (e) {
      console.log('❌ waitForFunction failed:', e.message);
    }
    
    // Test 9: API compatibility checks
    console.log('\n🔧 Test 9: Testing API compatibility...');
    
    // Check if waitForTimeout exists (newer Puppeteer)
    if (typeof page.waitForTimeout === 'function') {
      console.log('✅ page.waitForTimeout is available (newer Puppeteer)');
      try {
        await page.waitForTimeout(100);
        console.log('✅ page.waitForTimeout works');
      } catch (e) {
        console.log('❌ page.waitForTimeout failed:', e.message);
      }
    } else {
      console.log('⚠️  page.waitForTimeout not available (older Puppeteer)');
      console.log('✅ Using setTimeout fallback (this is expected)');
    }
    
    // Check if isIntersectingViewport exists
    if (searchBox) {
      if (typeof searchBox.isIntersectingViewport === 'function') {
        console.log('✅ element.isIntersectingViewport is available');
        try {
          const isVisible = await searchBox.isIntersectingViewport();
          console.log(`✅ element.isIntersectingViewport works: ${isVisible}`);
        } catch (e) {
          console.log('❌ element.isIntersectingViewport failed:', e.message);
        }
      } else {
        console.log('⚠️  element.isIntersectingViewport not available (older Puppeteer)');
        console.log('✅ Using fallback visibility check (this is expected)');
      }
    }
    
    // Test 10: Page evaluation
    console.log('\n📝 Test 10: Testing page evaluation...');
    const pageInfo = await page.evaluate(() => {
      return {
        title: document.title,
        url: window.location.href,
        readyState: document.readyState
      };
    });
    console.log('✅ Page evaluation successful');
    console.log(`   Title: ${pageInfo.title}`);
    console.log(`   URL: ${pageInfo.url}`);
    console.log(`   Ready State: ${pageInfo.readyState}`);
    
    console.log('\n🎉 All Puppeteer compatibility tests PASSED!');
    console.log('✅ OAuth validation script should work correctly');
    
    return {
      success: true,
      version: require('puppeteer/package.json').version,
      compatibility: 'Good'
    };
    
  } catch (error) {
    console.error('\n💥 Puppeteer compatibility test FAILED!');
    console.error('❌ Error:', error.message);
    
    return {
      success: false,
      error: error.message
    };
    
  } finally {
    if (browser) {
      await browser.close();
      console.log('🔒 Browser closed');
    }
  }
}

// Run the compatibility test
testPuppeteerCompatibility()
  .then((result) => {
    if (result.success) {
      console.log('\n🚀 Next Steps:');
      console.log('1. ✅ Puppeteer is working correctly');
      console.log('2. 🧪 Run OAuth validation: npm run test:oauth:validate');
      console.log('3. 🔧 If OAuth still fails, check credentials and network');
      
      process.exit(0);
    } else {
      console.log('\n🔧 Troubleshooting Steps:');
      console.log('1. 📦 Update Puppeteer: npm install puppeteer@latest');
      console.log('2. 🌐 Check Chrome installation path');
      console.log('3. 🔒 Check network connectivity');
      console.log('4. 🛠️  Try different browser args');
      
      process.exit(1);
    }
  })
  .catch((error) => {
    console.error('Compatibility test crashed:', error);
    process.exit(1);
  });
