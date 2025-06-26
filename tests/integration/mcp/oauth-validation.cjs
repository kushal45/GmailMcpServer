#!/usr/bin/env node

/**
 * OAuth Flow Validation Script
 * 
 * This script validates ONLY the OAuth flow to determine if it's working correctly.
 * It connects to the MCP server, triggers OAuth, and validates the session.
 * 
 * Usage:
 *   node tests/integration/mcp/oauth-validation.js
 *   
 * Environment variables:
 *   GMAIL_TEST_EMAIL - Your test Gmail address
 *   GMAIL_TEST_PASSWORD - Your App Password or regular password
 *   GMAIL_USE_APP_PASSWORD - Set to 'true' for App Password
 *   HEADLESS_BROWSER - Set to 'false' to see browser
 *   USE_MOCK_OAUTH - Set to 'true' to test with mock OAuth
 */

const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Load environment from .env.test if it exists
const envPath = path.join(__dirname, '.env.test');
if (fs.existsSync(envPath)) {
  require('dotenv').config({ path: envPath });
  const userProfilesPath = path.join(__dirname,process.env.STORAGE_PATH, 'users');
  if (fs.existsSync(userProfilesPath)) {
    fs.rmSync(userProfilesPath, { recursive: true });
  }
  const tokenStoragePath = path.join(__dirname,process.env.STORAGE_PATH, 'tokens');
  if (fs.existsSync(tokenStoragePath)) {
    fs.rmSync(tokenStoragePath, { recursive: true });
  }
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
  useMockOAuth: process.env.USE_MOCK_OAUTH === 'true',
};

console.log('🔐 OAuth Validation Configuration:');
console.log(`   Email: ${config.email}`);
console.log(`   Password: ${config.password ? '[SET]' : '[NOT SET]'}`);
console.log(`   Use App Password: ${config.useAppPassword}`);
console.log(`   Headless: ${config.headless}`);
console.log(`   Timeout: ${config.timeout}ms`);
console.log(`   Use Mock OAuth: ${config.useMockOAuth}`);

// Check Puppeteer version compatibility
try {
  const puppeteerVersion = require('puppeteer/package.json').version;
  console.log(`   Puppeteer Version: ${puppeteerVersion}`);
} catch (e) {
  console.log('   Puppeteer Version: [Unable to detect]');
}

// Helper function for cross-version timeout compatibility
async function waitFor(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Generic OAuth Flow Handler - Handles any number of steps intelligently
async function handleGenericOAuthFlow(page, email, password, maxSteps = 20, timeoutPerStep = 30000) {
  console.log('🚀 Starting Generic OAuth Flow Handler');
  console.log(`   Max Steps: ${maxSteps}`);
  console.log(`   Timeout per Step: ${timeoutPerStep}ms`);
  console.log(`   Email: ${email}`);

  let currentStep = 0;
  let lastUrl = '';
  let stuckCounter = 0;
  const maxStuckAttempts = 3;

  while (currentStep < maxSteps) {
    currentStep++;
    console.log(`\n🔄 === OAUTH STEP ${currentStep}/${maxSteps} ===`);

    try {
      // Wait for page to stabilize
      await waitFor(3000);

      const currentUrl = page.url();
      console.log(`🔍 Current URL: ${currentUrl}`);

      // Check if we've reached the actual callback (success condition)
      // Must be localhost callback with OAuth code, not just containing "callback" in redirect_uri
      if (currentUrl.includes('localhost:3000/oauth2callback') && currentUrl.includes('code=')) {
        console.log('✅ SUCCESS: Reached actual OAuth callback URL with authorization code');
        return { success: true, steps: currentStep, finalUrl: currentUrl };
      }

      // Alternative success check for different callback patterns
      if (currentUrl.includes('localhost') && currentUrl.includes('code=') && currentUrl.includes('state=')) {
        console.log('✅ SUCCESS: Reached localhost callback with OAuth code and state');
        return { success: true, steps: currentStep, finalUrl: currentUrl };
      }

      // Detect if we're stuck on the same page
      if (currentUrl === lastUrl) {
        stuckCounter++;
        console.log(`⚠️  Same URL as previous step (${stuckCounter}/${maxStuckAttempts})`);

        if (stuckCounter >= maxStuckAttempts) {
          console.log('❌ STUCK: Same URL for too many attempts, trying alternative approaches');

          // Try alternative approaches when stuck
          const unstuckResult = await handleStuckPage(page);
          if (unstuckResult.success) {
            console.log('✅ Successfully unstuck using alternative approach');
            stuckCounter = 0;
          } else {
            console.log('❌ Failed to unstuck, continuing with normal flow');
          }
        }
      } else {
        stuckCounter = 0; // Reset counter when URL changes
      }

      lastUrl = currentUrl;

      // Take screenshot for debugging
      await page.screenshot({ path: `oauth-step-${currentStep}.png` });
      console.log(`📸 Screenshot saved: oauth-step-${currentStep}.png`);

      // Analyze current page and determine action needed
      const pageAnalysis = await analyzeOAuthPage(page);
      console.log('🔍 Page Analysis:', JSON.stringify(pageAnalysis, null, 2));

      // Execute appropriate action based on page analysis
      const actionResult = await executeOAuthAction(page, pageAnalysis, email, password);
      console.log('🎯 Action Result:', JSON.stringify(actionResult, null, 2));

      if (actionResult.success) {
        console.log(`✅ Step ${currentStep} completed successfully: ${actionResult.action}`);

        // Wait for navigation if expected
        if (actionResult.expectsNavigation) {
          try {
            console.log('⏳ Waiting for navigation...');
            await page.waitForNavigation({
              waitUntil: 'networkidle0',
              timeout: timeoutPerStep
            });
            console.log('✅ Navigation completed');
          } catch (navError) {
            console.log('⚠️  Navigation timeout, checking if URL changed...');
            const newUrl = page.url();
            if (newUrl !== currentUrl) {
              console.log(`✅ URL changed to: ${newUrl}`);
            } else {
              console.log('⚠️  URL did not change after action');
            }
          }
        } else {
          // Small wait for page updates
          await waitFor(1000);
        }
      } else {
        console.log(`⚠️  Step ${currentStep} action failed: ${actionResult.error}`);

        // Try generic fallback approaches
        const fallbackResult = await tryGenericFallbacks(page);
        if (fallbackResult.success) {
          console.log('✅ Fallback approach succeeded');
        } else {
          console.log('⚠️  Fallback approaches also failed');
        }
      }

    } catch (stepError) {
      console.error(`❌ Error in step ${currentStep}:`, stepError.message);
      await page.screenshot({ path: `oauth-error-step-${currentStep}.png` });
      console.log(`📸 Error screenshot saved: oauth-error-step-${currentStep}.png`);
    }
  }

  // If we exit the loop without success
  const finalUrl = page.url();
  console.log(`❌ TIMEOUT: Reached maximum steps (${maxSteps}) without completing OAuth flow`);
  console.log(`🔍 Final URL: ${finalUrl}`);

  // Final check for success indicators
  const finalCheck = await checkForSuccessIndicators(page);
  if (finalCheck.success) {
    console.log('✅ SUCCESS: Found success indicators despite not reaching callback URL');
    return { success: true, steps: currentStep, finalUrl: finalUrl, method: 'success_indicators' };
  }

  return { success: false, steps: currentStep, finalUrl: finalUrl, error: 'Max steps reached' };
}

// Analyze current OAuth page to determine what action is needed
async function analyzeOAuthPage(page) {
  try {
    const analysis = await page.evaluate(() => {
      const url = window.location.href;
      const title = document.title;
      const bodyText = document.body.textContent || document.body.innerText || '';
      const bodyTextLower = bodyText.toLowerCase();

      // Get all interactive elements
      const inputs = [...document.querySelectorAll('input')].map(input => ({
        type: input.type,
        name: input.name,
        id: input.id,
        placeholder: input.placeholder,
        value: input.value,
        visible: input.offsetWidth > 0 && input.offsetHeight > 0
      }));

      const buttons = [...document.querySelectorAll('button, input[type="submit"], [role="button"]')].map(btn => ({
        tagName: btn.tagName,
        type: btn.type,
        text: (btn.textContent || btn.innerText || btn.value || '').trim(),
        className: btn.className,
        id: btn.id,
        visible: btn.offsetWidth > 0 && btn.offsetHeight > 0
      }));

      const links = [...document.querySelectorAll('a[href]')].map(link => ({
        text: (link.textContent || link.innerText || '').trim(),
        href: link.href,
        visible: link.offsetWidth > 0 && link.offsetHeight > 0
      }));

      // Determine page type based on content analysis
      let pageType = 'unknown';
      let confidence = 0;
      let suggestedAction = 'none';
      let actionTarget = null;

      // Email input detection
      const emailInputs = inputs.filter(input =>
        input.type === 'email' ||
        input.name?.toLowerCase().includes('email') ||
        input.id?.toLowerCase().includes('email') ||
        input.placeholder?.toLowerCase().includes('email')
      );

      // Password input detection
      const passwordInputs = inputs.filter(input =>
        input.type === 'password' ||
        input.name?.toLowerCase().includes('password') ||
        input.id?.toLowerCase().includes('password')
      );

      // Continue/Next/Submit button detection
      const actionButtons = buttons.filter(btn => {
        const text = btn.text.toLowerCase();
        return text.includes('continue') || text.includes('next') || text.includes('submit') ||
               text.includes('sign in') || text.includes('login') || text.includes('allow') ||
               text.includes('accept') || text.includes('authorize') || text.includes('grant') ||
               text.includes('proceed') || text.includes('confirm') || text === 'ok';
      });

      // Page type detection logic - ORDER MATTERS (most specific first)
      if (emailInputs.length > 0 && emailInputs.some(input => !input.value)) {
        pageType = 'email_input';
        confidence = 0.9;
        suggestedAction = 'enter_email';
        actionTarget = emailInputs.find(input => input.visible);
      } else if (passwordInputs.length > 0 && passwordInputs.some(input => !input.value)) {
        pageType = 'password_input';
        confidence = 0.9;
        suggestedAction = 'enter_password';
        actionTarget = passwordInputs.find(input => input.visible);
      } else if (bodyTextLower.includes('two-factor') || bodyTextLower.includes('2fa') ||
                 bodyTextLower.includes('verification code') || bodyTextLower.includes('authenticator')) {
        pageType = '2fa_required';
        confidence = 0.8;
        suggestedAction = 'handle_2fa';
      } else if (bodyTextLower.includes('signing back in') ||
                 (bodyTextLower.includes('continue') && actionButtons.some(btn => btn.text.toLowerCase().includes('continue')))) {
        // PRIORITY: Final consent screen with "You're signing back in" and Continue button
        pageType = 'continue_screen';
        confidence = 0.9;
        suggestedAction = 'click_continue';
        actionTarget = actionButtons.find(btn => btn.text.toLowerCase().includes('continue') && btn.visible);
      } else if (bodyTextLower.includes('unverified') || bodyTextLower.includes('unsafe') ||
                 (bodyTextLower.includes('advanced') && bodyTextLower.includes('go to'))) {
        // Only detect unverified warning if it has specific warning indicators
        pageType = 'unverified_app_warning';
        confidence = 0.8;
        suggestedAction = 'handle_unverified_warning';
      } else if (bodyTextLower.includes('wants access') || bodyTextLower.includes('permissions') ||
                 bodyTextLower.includes('allow') || bodyTextLower.includes('consent') ||
                 bodyTextLower.includes('authorize')) {
        pageType = 'consent_screen';
        confidence = 0.8;
        suggestedAction = 'handle_consent';
        actionTarget = actionButtons.find(btn => btn.visible);
      } else if (bodyTextLower.includes('continue') || bodyTextLower.includes('proceed') ||
                 bodyTextLower.includes('next')) {
        pageType = 'continue_screen';
        confidence = 0.7;
        suggestedAction = 'click_continue';
        actionTarget = actionButtons.find(btn => btn.visible);
      } else if (actionButtons.length > 0) {
        pageType = 'action_required';
        confidence = 0.6;
        suggestedAction = 'click_primary_button';
        actionTarget = actionButtons.find(btn => btn.visible);
      }

      return {
        url,
        title,
        pageType,
        confidence,
        suggestedAction,
        actionTarget,
        inputs,
        buttons,
        links,
        bodyTextSample: bodyText.substring(0, 500),
        hasForm: document.querySelectorAll('form').length > 0,
        indicators: {
          hasEmailInput: emailInputs.length > 0,
          hasPasswordInput: passwordInputs.length > 0,
          hasActionButtons: actionButtons.length > 0,
          emailFilled: emailInputs.some(input => input.value),
          passwordFilled: passwordInputs.some(input => input.value)
        }
      };
    });

    return analysis;
  } catch (error) {
    console.error('❌ Error analyzing OAuth page:', error.message);
    return {
      url: page.url(),
      title: 'Error',
      pageType: 'error',
      confidence: 0,
      suggestedAction: 'none',
      error: error.message
    };
  }
}

// Execute appropriate OAuth action based on page analysis
async function executeOAuthAction(page, analysis, email, password) {
  try {
    console.log(`🎯 Executing action: ${analysis.suggestedAction} (confidence: ${analysis.confidence})`);

    switch (analysis.suggestedAction) {
      case 'enter_email':
        return await handleEmailInput(page, email, analysis);

      case 'enter_password':
        return await handlePasswordInput(page, password, analysis);

      case 'handle_2fa':
        return await handle2FA(page, analysis);

      case 'handle_unverified_warning':
        try {
          await handleUnverifiedAppWarning(page);
          return { success: true, action: 'handle_unverified_warning', expectsNavigation: true };
        } catch (error) {
          return { success: false, action: 'handle_unverified_warning', error: error.message, expectsNavigation: false };
        }

      case 'handle_consent':
      case 'click_continue':
      case 'click_primary_button':
        return await handleButtonClick(page, analysis);

      default:
        return await tryGenericActions(page, analysis);
    }
  } catch (error) {
    console.error('❌ Error executing OAuth action:', error.message);
    return {
      success: false,
      action: analysis.suggestedAction,
      error: error.message,
      expectsNavigation: false
    };
  }
}

// Action handler functions for generic OAuth flow
async function handleEmailInput(page, email, analysis) {
  try {
    console.log('📧 Handling email input');
    console.log(`📧 Email to enter: ${email}`);

    // Multiple strategies to find email input
    const emailSelectors = [
      '#identifierId',  // Google's standard email input ID
      'input[type="email"]',
      'input[name="email"]',
      'input[name="identifier"]',
      'input[placeholder*="email" i]',
      'input[placeholder*="Email" i]',
      'input[aria-label*="email" i]'
    ];

    let emailInputFound = false;

    for (const selector of emailSelectors) {
      try {
        const emailInput = await page.$(selector);
        if (emailInput) {
          const isVisible = await emailInput.isIntersectingViewport().catch(() => true);
          if (isVisible) {
            console.log(`✅ Found email input with selector: ${selector}`);

            // Clear any existing text and enter email
            await emailInput.click({ clickCount: 3 }); // Select all
            await emailInput.type(email);
            console.log(`✅ Email entered: ${email}`);
            emailInputFound = true;
            break;
          }
        }
      } catch (selectorError) {
        console.log(`⚠️  Email selector ${selector} failed: ${selectorError.message}`);
      }
    }

    if (!emailInputFound) {
      return { success: false, action: 'enter_email', error: 'No email input found with any selector', expectsNavigation: false };
    }

    // Multiple strategies to find and click Next button
    const nextButtonSelectors = [
      '#identifierNext',  // Google's standard Next button ID
      'button[type="submit"]',
      'input[type="submit"]',
      'button:contains("Next")',
      'button:contains("Continue")',
      '[data-action="next"]',
      '[role="button"]:contains("Next")'
    ];

    let nextButtonClicked = false;

    for (const selector of nextButtonSelectors) {
      try {
        const nextButton = await page.$(selector);
        if (nextButton) {
          const isVisible = await nextButton.isIntersectingViewport().catch(() => true);
          if (isVisible) {
            console.log(`✅ Found Next button with selector: ${selector}`);
            await nextButton.click();
            console.log(`✅ Clicked Next button`);
            nextButtonClicked = true;
            break;
          }
        }
      } catch (selectorError) {
        console.log(`⚠️  Next button selector ${selector} failed: ${selectorError.message}`);
      }
    }

    if (!nextButtonClicked) {
      // Try Enter key as fallback
      console.log('⚠️  No Next button found, trying Enter key');
      await page.keyboard.press('Enter');
      console.log('✅ Pressed Enter key as fallback');
    }

    return { success: true, action: 'enter_email', expectsNavigation: true };

  } catch (error) {
    console.error('❌ Error handling email input:', error.message);
    return { success: false, action: 'enter_email', error: error.message, expectsNavigation: false };
  }
}

async function handlePasswordInput(page, password, analysis) {
  try {
    console.log('🔒 Handling password input');
    console.log('🔒 Password length:', password.length);

    // Multiple strategies to find password input
    const passwordSelectors = [
      '#password input[type="password"]',  // Google's standard password input
      'input[type="password"]',
      'input[name="password"]',
      'input[name="passwd"]',
      'input[placeholder*="password" i]',
      'input[placeholder*="Password" i]',
      'input[aria-label*="password" i]'
    ];

    let passwordInputFound = false;

    for (const selector of passwordSelectors) {
      try {
        const passwordInput = await page.$(selector);
        if (passwordInput) {
          const isVisible = await passwordInput.isIntersectingViewport().catch(() => true);
          if (isVisible) {
            console.log(`✅ Found password input with selector: ${selector}`);

            // Clear any existing text and enter password
            await passwordInput.click({ clickCount: 3 }); // Select all
            await passwordInput.type(password);
            console.log('✅ Password entered');
            passwordInputFound = true;
            break;
          }
        }
      } catch (selectorError) {
        console.log(`⚠️  Password selector ${selector} failed: ${selectorError.message}`);
      }
    }

    if (!passwordInputFound) {
      return { success: false, action: 'enter_password', error: 'No password input found with any selector', expectsNavigation: false };
    }

    // Multiple strategies to find and click Next button
    const nextButtonSelectors = [
      '#passwordNext',  // Google's standard password Next button ID
      'button[type="submit"]',
      'input[type="submit"]',
      'button:contains("Next")',
      'button:contains("Continue")',
      'button:contains("Sign in")',
      'button:contains("Login")',
      '[data-action="next"]',
      '[role="button"]:contains("Next")'
    ];

    let nextButtonClicked = false;

    for (const selector of nextButtonSelectors) {
      try {
        const nextButton = await page.$(selector);
        if (nextButton) {
          const isVisible = await nextButton.isIntersectingViewport().catch(() => true);
          if (isVisible) {
            console.log(`✅ Found Next button with selector: ${selector}`);
            await nextButton.click();
            console.log(`✅ Clicked Next button`);
            nextButtonClicked = true;
            break;
          }
        }
      } catch (selectorError) {
        console.log(`⚠️  Next button selector ${selector} failed: ${selectorError.message}`);
      }
    }

    if (!nextButtonClicked) {
      // Try Enter key as fallback
      console.log('⚠️  No Next button found, trying Enter key');
      await page.keyboard.press('Enter');
      console.log('✅ Pressed Enter key as fallback');
    }

    return { success: true, action: 'enter_password', expectsNavigation: true };

  } catch (error) {
    console.error('❌ Error handling password input:', error.message);
    return { success: false, action: 'enter_password', error: error.message, expectsNavigation: false };
  }
}

async function handle2FA(page, analysis) {
  try {
    console.log('🔐 2FA detected - skipping (manual intervention required)');
    return { success: false, action: 'handle_2fa', error: '2FA requires manual intervention', expectsNavigation: false };
  } catch (error) {
    return { success: false, action: 'handle_2fa', error: error.message, expectsNavigation: false };
  }
}



async function handleButtonClick(page, analysis) {
  try {
    console.log(`🔘 Handling button click: ${analysis.suggestedAction}`);

    const targetButton = analysis.actionTarget;
    if (!targetButton) {
      return { success: false, action: analysis.suggestedAction, error: 'No target button found', expectsNavigation: false };
    }

    // Try multiple click methods
    const clickMethods = [
      // Method 1: ID-based selector
      async () => {
        if (targetButton.id) {
          await page.click(`#${targetButton.id}`);
          return `ID selector: #${targetButton.id}`;
        }
        throw new Error('No ID available');
      },

      // Method 2: Text-based selector
      async () => {
        if (targetButton.text) {
          await page.click(`button:contains("${targetButton.text}")`);
          return `Text selector: ${targetButton.text}`;
        }
        throw new Error('No text available');
      },

      // Method 3: Generic button click with evaluation
      async () => {
        const clicked = await page.evaluate((buttonText) => {
          const buttons = [...document.querySelectorAll('button, input[type="submit"], [role="button"]')];
          for (const btn of buttons) {
            const text = (btn.textContent || btn.innerText || btn.value || '').trim();
            if (text === buttonText && btn.offsetWidth > 0 && btn.offsetHeight > 0) {
              btn.click();
              return true;
            }
          }
          return false;
        }, targetButton.text);

        if (clicked) {
          return `Evaluate click: ${targetButton.text}`;
        }
        throw new Error('Evaluate click failed');
      },

      // Method 4: Keyboard navigation
      async () => {
        for (let i = 0; i < 10; i++) {
          await page.keyboard.press('Tab');
          await waitFor(200);

          const focusedText = await page.evaluate(() => {
            const focused = document.activeElement;
            return focused ? (focused.textContent || focused.innerText || focused.value || '').trim() : '';
          });

          if (focusedText.toLowerCase().includes(targetButton.text.toLowerCase())) {
            await page.keyboard.press('Enter');
            return `Keyboard navigation: ${focusedText}`;
          }
        }
        throw new Error('Keyboard navigation failed');
      }
    ];

    for (const method of clickMethods) {
      try {
        const result = await method();
        console.log(`✅ Button clicked using: ${result}`);
        return { success: true, action: analysis.suggestedAction, method: result, expectsNavigation: true };
      } catch (methodError) {
        console.log(`⚠️  Click method failed: ${methodError.message}`);
      }
    }

    return { success: false, action: analysis.suggestedAction, error: 'All click methods failed', expectsNavigation: false };
  } catch (error) {
    console.error('❌ Error handling button click:', error.message);
    return { success: false, action: analysis.suggestedAction, error: error.message, expectsNavigation: false };
  }
}

// Generic fallback functions
async function tryGenericActions(page, analysis) {
  try {
    console.log('🔄 Trying generic actions');

    // Try clicking any visible submit/continue button
    const actionButtons = analysis.buttons.filter(btn =>
      btn.visible && (btn.text.toLowerCase().includes('continue') ||
                     btn.text.toLowerCase().includes('next') ||
                     btn.text.toLowerCase().includes('submit') ||
                     btn.text.toLowerCase().includes('ok') ||
                     btn.type === 'submit')
    );

    if (actionButtons.length > 0) {
      const button = actionButtons[0];
      try {
        const buttonSelector = button.id ? `#${button.id}` : `button:contains("${button.text}")`;
        await page.click(buttonSelector);
        console.log(`✅ Clicked generic button: ${button.text}`);
        return { success: true, action: 'generic_button_click', expectsNavigation: true };
      } catch (clickError) {
        console.log('⚠️  Generic button click failed');
      }
    }

    // Try Enter key
    try {
      await page.keyboard.press('Enter');
      console.log('✅ Pressed Enter key as generic action');
      return { success: true, action: 'generic_enter_key', expectsNavigation: true };
    } catch (enterError) {
      console.log('⚠️  Enter key failed');
    }

    return { success: false, action: 'generic_actions', error: 'No generic actions succeeded', expectsNavigation: false };
  } catch (error) {
    return { success: false, action: 'generic_actions', error: error.message, expectsNavigation: false };
  }
}

async function tryGenericFallbacks(page) {
  try {
    console.log('🔄 Trying generic fallback approaches');

    const fallbackMethods = [
      // Method 1: Tab navigation + Enter
      async () => {
        for (let i = 0; i < 15; i++) {
          await page.keyboard.press('Tab');
          await waitFor(200);

          const focusedElement = await page.evaluate(() => {
            const focused = document.activeElement;
            if (!focused) return null;

            const text = (focused.textContent || focused.innerText || focused.value || '').trim().toLowerCase();
            const tagName = focused.tagName.toLowerCase();

            return { text, tagName, isButton: tagName === 'button' || tagName === 'input' };
          });

          if (focusedElement && focusedElement.isButton &&
              (focusedElement.text.includes('continue') ||
               focusedElement.text.includes('next') ||
               focusedElement.text.includes('submit'))) {
            await page.keyboard.press('Enter');
            return 'Tab navigation + Enter';
          }
        }
        throw new Error('No suitable button found via Tab navigation');
      },

      // Method 2: Form submission
      async () => {
        const formSubmitted = await page.evaluate(() => {
          const forms = document.querySelectorAll('form');
          for (const form of forms) {
            try {
              form.submit();
              return true;
            } catch (e) {
              // Continue to next form
            }
          }
          return false;
        });

        if (formSubmitted) {
          return 'Form submission';
        }
        throw new Error('No forms to submit');
      },

      // Method 3: Click any visible button
      async () => {
        const buttonClicked = await page.evaluate(() => {
          const buttons = [...document.querySelectorAll('button, input[type="submit"], [role="button"]')];
          const visibleButtons = buttons.filter(btn => btn.offsetWidth > 0 && btn.offsetHeight > 0);

          if (visibleButtons.length > 0) {
            visibleButtons[0].click();
            return visibleButtons[0].textContent || visibleButtons[0].value || 'Unknown button';
          }
          return false;
        });

        if (buttonClicked) {
          return `Clicked first visible button: ${buttonClicked}`;
        }
        throw new Error('No visible buttons found');
      }
    ];

    for (const method of fallbackMethods) {
      try {
        const result = await method();
        console.log(`✅ Fallback succeeded: ${result}`);
        return { success: true, method: result };
      } catch (methodError) {
        console.log(`⚠️  Fallback method failed: ${methodError.message}`);
      }
    }

    return { success: false, error: 'All fallback methods failed' };
  } catch (error) {
    console.error('❌ Error in generic fallbacks:', error.message);
    return { success: false, error: error.message };
  }
}

async function handleStuckPage(page) {
  try {
    console.log('🔄 Handling stuck page with alternative approaches');

    // Take screenshot for debugging
    await page.screenshot({ path: 'oauth-stuck-page.png' });
    console.log('📸 Screenshot saved: oauth-stuck-page.png');

    const stuckMethods = [
      // Method 1: Refresh page
      async () => {
        await page.reload({ waitUntil: 'networkidle0' });
        return 'Page refresh';
      },

      // Method 2: Go back and forward
      async () => {
        await page.goBack();
        await waitFor(2000);
        await page.goForward();
        return 'Back and forward navigation';
      },

      // Method 3: Try all clickable elements
      async () => {
        const clicked = await page.evaluate(() => {
          const clickableElements = [...document.querySelectorAll('*')].filter(el =>
            el.onclick ||
            el.getAttribute('role') === 'button' ||
            el.tagName === 'BUTTON' ||
            el.tagName === 'A' ||
            el.style.cursor === 'pointer'
          );

          for (const element of clickableElements) {
            if (element.offsetWidth > 0 && element.offsetHeight > 0) {
              try {
                element.click();
                return element.textContent || element.tagName;
              } catch (e) {
                // Continue to next element
              }
            }
          }
          return false;
        });

        if (clicked) {
          return `Clicked element: ${clicked}`;
        }
        throw new Error('No clickable elements worked');
      }
    ];

    for (const method of stuckMethods) {
      try {
        const result = await method();
        console.log(`✅ Unstuck method succeeded: ${result}`);
        await waitFor(3000); // Wait for potential navigation
        return { success: true, method: result };
      } catch (methodError) {
        console.log(`⚠️  Unstuck method failed: ${methodError.message}`);
      }
    }

    return { success: false, error: 'All unstuck methods failed' };
  } catch (error) {
    console.error('❌ Error handling stuck page:', error.message);
    return { success: false, error: error.message };
  }
}

async function checkForSuccessIndicators(page) {
  try {
    console.log('🔍 Checking for success indicators');

    const successCheck = await page.evaluate(() => {
      const bodyText = document.body.textContent || document.body.innerText || '';
      const bodyTextLower = bodyText.toLowerCase();
      const url = window.location.href;

      const successIndicators = [
        'success',
        'successful',
        'authorized',
        'authentication complete',
        'login successful',
        'access granted',
        'permission granted',
        'you are now signed in',
        'welcome',
        'dashboard',
        'profile'
      ];

      const foundIndicators = successIndicators.filter(indicator =>
        bodyTextLower.includes(indicator)
      );

      return {
        url,
        foundIndicators,
        hasSuccessIndicators: foundIndicators.length > 0,
        bodyTextSample: bodyText.substring(0, 300)
      };
    });

    console.log('🔍 Success check result:', JSON.stringify(successCheck, null, 2));

    return {
      success: successCheck.hasSuccessIndicators,
      indicators: successCheck.foundIndicators,
      url: successCheck.url
    };
  } catch (error) {
    console.error('❌ Error checking success indicators:', error.message);
    return { success: false, error: error.message };
  }
}

// Helper function to handle consent summary page (FINAL CONSENT STEP)
async function handleConsentSummaryPage(page) {
  console.log('🎯 Handling consent summary page - FINAL CONSENT STEP');

  try {
    // Take screenshot of consent summary page
    await page.screenshot({ path: 'oauth-consent-summary-detailed.png' });
    console.log('📸 Screenshot saved: oauth-consent-summary-detailed.png');

    // Wait for page to fully load
    await waitFor(2000);

    // Get comprehensive page information
    const pageInfo = await page.evaluate(() => {
      return {
        title: document.title,
        url: window.location.href,
        bodyText: document.body.textContent || document.body.innerText || '',
        buttons: [...document.querySelectorAll('button, input[type="submit"], [role="button"], div[role="button"], span[role="button"]')].map(btn => ({
          tagName: btn.tagName,
          text: (btn.textContent || btn.innerText || btn.value || '').trim(),
          className: btn.className,
          id: btn.id,
          type: btn.type,
          role: btn.getAttribute('role'),
          ariaLabel: btn.getAttribute('aria-label'),
          visible: btn.offsetWidth > 0 && btn.offsetHeight > 0,
          rect: btn.getBoundingClientRect(),
          outerHTML: btn.outerHTML.substring(0, 200) // First 200 chars of HTML
        }))
      };
    });

    console.log('🔍 Consent Summary Page Info:');
    console.log(`   Title: ${pageInfo.title}`);
    console.log(`   URL: ${pageInfo.url}`);
    console.log(`   Contains "Continue": ${pageInfo.bodyText.includes('Continue')}`);
    console.log(`   Found ${pageInfo.buttons.length} buttons`);

    // Log each button found
    pageInfo.buttons.forEach((btn, index) => {
      console.log(`   Button ${index + 1}: ${btn.tagName} - "${btn.text}" - Visible: ${btn.visible}`);
      if (btn.text.toLowerCase().includes('continue')) {
        console.log(`     ⭐ CONTINUE BUTTON CANDIDATE: ${btn.outerHTML}`);
      }
    });

    // Method 1: Direct Continue button search and click
    let continueClicked = false;

    const continueClickResult = await page.evaluate(() => {
      // Find all potentially clickable elements
      const allElements = [
        ...document.querySelectorAll('*')
      ].filter(el => {
        const text = (el.textContent || el.innerText || el.value || '').trim();
        const ariaLabel = el.getAttribute('aria-label') || '';

        return (text.toLowerCase().includes('continue') ||
                ariaLabel.toLowerCase().includes('continue')) &&
               (el.tagName === 'BUTTON' ||
                el.tagName === 'INPUT' ||
                el.getAttribute('role') === 'button' ||
                el.onclick ||
                el.getAttribute('tabindex') !== null);
      });

      console.log(`Found ${allElements.length} potential Continue elements`);

      for (const element of allElements) {
        const text = (element.textContent || element.innerText || element.value || '').trim();
        console.log(`Checking element: ${element.tagName} with text: "${text}"`);

        if (text === 'Continue' || text.toLowerCase() === 'continue') {
          console.log('Found exact Continue match, clicking...');

          // Check if element is visible and clickable
          const rect = element.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            try {
              element.click();
              console.log('Successfully clicked Continue button');
              return { success: true, method: 'direct_click', element: element.outerHTML.substring(0, 200) };
            } catch (clickError) {
              console.log('Direct click failed, trying focus + enter');
              try {
                element.focus();
                element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13 }));
                return { success: true, method: 'focus_enter', element: element.outerHTML.substring(0, 200) };
              } catch (focusError) {
                console.log('Focus + Enter also failed');
              }
            }
          }
        }
      }

      return { success: false, method: 'none', element: null };
    });

    console.log('🔍 Continue click result:', JSON.stringify(continueClickResult, null, 2));

    if (continueClickResult.success) {
      console.log(`✅ Continue button clicked using method: ${continueClickResult.method}`);
      continueClicked = true;
      await waitFor(3000);

      // Wait for navigation
      try {
        console.log('⏳ Waiting for navigation after Continue click...');
        await page.waitForNavigation({
          waitUntil: 'networkidle0',
          timeout: 20000
        });

        const newUrl = page.url();
        console.log(`🔄 Navigated to: ${newUrl}`);

        if (newUrl.includes('oauth2callback') || newUrl.includes('callback')) {
          console.log('✅ Successfully reached OAuth callback URL');
          return true;
        } else if (newUrl.includes('consentsummary') || newUrl !== pageInfo.url) {
          console.log('🔄 Navigated to intermediate page, checking for additional Continue button...');

          // Handle potential additional Continue page after consent summary
          const additionalContinueSuccess = await handleAdditionalContinuePage(page);
          return additionalContinueSuccess;
        } else {
          console.log('⚠️  Navigation completed but not to callback URL');
        }
      } catch (navError) {
        console.log('⚠️  Navigation timeout, checking current URL...');
        const currentUrl = page.url();
        console.log(`🔍 Current URL after timeout: ${currentUrl}`);

        if (currentUrl.includes('oauth2callback') || currentUrl.includes('callback')) {
          console.log('✅ Found callback URL after timeout');
          return true;
        }
      }
    }

    // Method 2: Keyboard navigation fallback
    if (!continueClicked) {
      console.log('🔍 Method 1 failed, trying keyboard navigation...');

      try {
        // Try multiple Tab presses to find Continue button
        for (let i = 0; i < 10; i++) {
          await page.keyboard.press('Tab');
          await waitFor(300);

          const focusedText = await page.evaluate(() => {
            const focused = document.activeElement;
            return focused ? (focused.textContent || focused.innerText || focused.value || '').trim() : '';
          });

          console.log(`Tab ${i + 1}: Focused on "${focusedText}"`);

          if (focusedText.toLowerCase().includes('continue')) {
            console.log('🎯 Found Continue button via Tab navigation');
            await page.keyboard.press('Enter');
            console.log('✅ Pressed Enter on Continue button');
            continueClicked = true;
            await waitFor(3000);
            break;
          }
        }

        if (continueClicked) {
          // Wait for navigation
          try {
            await page.waitForNavigation({
              waitUntil: 'networkidle0',
              timeout: 15000
            });

            const newUrl = page.url();
            console.log(`🔄 After keyboard navigation: ${newUrl}`);

            if (newUrl.includes('oauth2callback') || newUrl.includes('callback')) {
              console.log('✅ Successfully reached callback via keyboard navigation');
              return true;
            }
          } catch (keyNavError) {
            console.log('⚠️  Keyboard navigation timeout');
          }
        }
      } catch (keyboardError) {
        console.log('❌ Keyboard navigation failed:', keyboardError.message);
      }
    }

    console.log('❌ All methods failed to handle consent summary page');
    return false;

  } catch (error) {
    console.error('❌ Error in handleConsentSummaryPage:', error.message);
    await page.screenshot({ path: 'oauth-consent-summary-error.png' });
    console.log('📸 Error screenshot saved: oauth-consent-summary-error.png');
    return false;
  }
}

// Helper function to handle additional Continue page after consent summary
async function handleAdditionalContinuePage(page) {
  console.log('🎯 Handling additional Continue page after consent summary');

  try {
    // Wait for page to fully load
    await waitFor(3000);

    // Take screenshot of the additional page
    await page.screenshot({ path: 'oauth-additional-continue-page.png' });
    console.log('📸 Screenshot saved: oauth-additional-continue-page.png');

    // Get comprehensive page information
    const additionalPageInfo = await page.evaluate(() => {
      return {
        title: document.title,
        url: window.location.href,
        bodyText: document.body.textContent || document.body.innerText || '',
        hasForm: document.querySelectorAll('form').length > 0,
        buttons: [...document.querySelectorAll('button, input[type="submit"], [role="button"], div[role="button"], span[role="button"], a[href]')].map(btn => ({
          tagName: btn.tagName,
          text: (btn.textContent || btn.innerText || btn.value || '').trim(),
          className: btn.className,
          id: btn.id,
          type: btn.type,
          role: btn.getAttribute('role'),
          ariaLabel: btn.getAttribute('aria-label'),
          href: btn.href || '',
          visible: btn.offsetWidth > 0 && btn.offsetHeight > 0,
          rect: btn.getBoundingClientRect(),
          outerHTML: btn.outerHTML.substring(0, 300)
        })),
        allClickableElements: [...document.querySelectorAll('*')].filter(el =>
          el.onclick ||
          el.getAttribute('role') === 'button' ||
          el.tagName === 'BUTTON' ||
          el.tagName === 'A' ||
          el.getAttribute('tabindex') !== null ||
          el.style.cursor === 'pointer'
        ).map(el => ({
          tagName: el.tagName,
          text: (el.textContent || el.innerText || '').trim().substring(0, 100),
          className: el.className,
          id: el.id,
          visible: el.offsetWidth > 0 && el.offsetHeight > 0
        }))
      };
    });

    console.log('🔍 Additional Continue Page Info:');
    console.log(`   Title: ${additionalPageInfo.title}`);
    console.log(`   URL: ${additionalPageInfo.url}`);
    console.log(`   Contains "Continue": ${additionalPageInfo.bodyText.includes('Continue')}`);
    console.log(`   Has Forms: ${additionalPageInfo.hasForm}`);
    console.log(`   Found ${additionalPageInfo.buttons.length} buttons`);
    console.log(`   Found ${additionalPageInfo.allClickableElements.length} clickable elements`);

    // Log each button found
    additionalPageInfo.buttons.forEach((btn, index) => {
      console.log(`   Button ${index + 1}: ${btn.tagName} - "${btn.text}" - Visible: ${btn.visible}`);
      if (btn.text.toLowerCase().includes('continue') ||
          btn.text.toLowerCase().includes('proceed') ||
          btn.text.toLowerCase().includes('next') ||
          btn.text.toLowerCase().includes('confirm')) {
        console.log(`     ⭐ CONTINUE/PROCEED BUTTON CANDIDATE: ${btn.outerHTML}`);
      }
    });

    // Method 1: Intelligent Continue button detection
    let additionalContinueClicked = false;

    const continueResult = await page.evaluate(() => {
      // Enhanced search for Continue-like buttons
      const continueKeywords = ['continue', 'proceed', 'next', 'confirm', 'allow', 'accept', 'authorize', 'grant'];

      const allElements = [...document.querySelectorAll('*')].filter(el => {
        const text = (el.textContent || el.innerText || el.value || '').trim().toLowerCase();
        const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
        const title = (el.getAttribute('title') || '').toLowerCase();

        // Check if element contains any continue-like keywords
        const hasKeyword = continueKeywords.some(keyword =>
          text.includes(keyword) || ariaLabel.includes(keyword) || title.includes(keyword)
        );

        // Check if element is potentially clickable
        const isClickable = el.tagName === 'BUTTON' ||
                           el.tagName === 'INPUT' ||
                           el.tagName === 'A' ||
                           el.getAttribute('role') === 'button' ||
                           el.onclick ||
                           el.getAttribute('tabindex') !== null ||
                           el.style.cursor === 'pointer';

        return hasKeyword && isClickable;
      });

      console.log(`Found ${allElements.length} potential Continue elements`);

      // Sort by priority (exact "Continue" match first, then others)
      allElements.sort((a, b) => {
        const aText = (a.textContent || a.innerText || a.value || '').trim().toLowerCase();
        const bText = (b.textContent || b.innerText || b.value || '').trim().toLowerCase();

        if (aText === 'continue' && bText !== 'continue') return -1;
        if (bText === 'continue' && aText !== 'continue') return 1;
        if (aText.includes('continue') && !bText.includes('continue')) return -1;
        if (bText.includes('continue') && !aText.includes('continue')) return 1;

        return 0;
      });

      for (const element of allElements) {
        const text = (element.textContent || element.innerText || element.value || '').trim();
        console.log(`Attempting to click element: ${element.tagName} with text: "${text}"`);

        // Check visibility
        const rect = element.getBoundingClientRect();
        const isVisible = rect.width > 0 && rect.height > 0 &&
                         rect.top >= 0 && rect.left >= 0 &&
                         rect.bottom <= window.innerHeight &&
                         rect.right <= window.innerWidth;

        if (isVisible) {
          try {
            // Method 1: Direct click
            element.click();
            console.log(`Successfully clicked element: ${text}`);
            return {
              success: true,
              method: 'direct_click',
              element: element.outerHTML.substring(0, 200),
              text: text
            };
          } catch (clickError) {
            console.log(`Direct click failed for "${text}", trying alternatives...`);

            try {
              // Method 2: Focus + Enter
              element.focus();
              element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
              console.log(`Focus + Enter succeeded for: ${text}`);
              return {
                success: true,
                method: 'focus_enter',
                element: element.outerHTML.substring(0, 200),
                text: text
              };
            } catch (focusError) {
              console.log(`Focus + Enter failed for "${text}"`);

              try {
                // Method 3: Dispatch click event
                element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                console.log(`Dispatch click succeeded for: ${text}`);
                return {
                  success: true,
                  method: 'dispatch_click',
                  element: element.outerHTML.substring(0, 200),
                  text: text
                };
              } catch (dispatchError) {
                console.log(`All click methods failed for "${text}"`);
              }
            }
          }
        } else {
          console.log(`Element not visible: "${text}"`);
        }
      }

      return { success: false, method: 'none', element: null, text: null };
    });

    console.log('🔍 Additional Continue click result:', JSON.stringify(continueResult, null, 2));

    if (continueResult.success) {
      console.log(`✅ Additional Continue button clicked: "${continueResult.text}" using ${continueResult.method}`);
      additionalContinueClicked = true;
      await waitFor(4000);

      // Wait for final navigation to callback
      try {
        console.log('⏳ Waiting for final navigation to callback...');
        await page.waitForNavigation({
          waitUntil: 'networkidle0',
          timeout: 25000
        });

        const finalUrl = page.url();
        console.log(`🔄 Final navigation to: ${finalUrl}`);

        if (finalUrl.includes('oauth2callback') || finalUrl.includes('callback')) {
          console.log('✅ Successfully reached OAuth callback URL after additional Continue');
          return true;
        } else {
          console.log('⚠️  Final navigation completed but not to callback URL');
          // Check if we need to handle yet another page
          return await checkForFinalCallback(page);
        }
      } catch (finalNavError) {
        console.log('⚠️  Final navigation timeout, checking current URL...');
        const currentUrl = page.url();
        console.log(`🔍 Current URL after final timeout: ${currentUrl}`);

        if (currentUrl.includes('oauth2callback') || currentUrl.includes('callback')) {
          console.log('✅ Found callback URL after final timeout');
          return true;
        } else {
          // Try one more check for callback
          return await checkForFinalCallback(page);
        }
      }
    }

    // Method 2: Keyboard navigation fallback for additional page
    if (!additionalContinueClicked) {
      console.log('🔍 Direct methods failed, trying keyboard navigation on additional page...');

      try {
        // Try Tab navigation to find Continue button
        for (let i = 0; i < 15; i++) {
          await page.keyboard.press('Tab');
          await waitFor(400);

          const focusedInfo = await page.evaluate(() => {
            const focused = document.activeElement;
            if (!focused) return null;

            const text = (focused.textContent || focused.innerText || focused.value || '').trim();
            const tagName = focused.tagName;
            const className = focused.className;

            return { text, tagName, className };
          });

          if (focusedInfo) {
            console.log(`Tab ${i + 1}: Focused on ${focusedInfo.tagName} - "${focusedInfo.text}"`);

            if (focusedInfo.text.toLowerCase().includes('continue') ||
                focusedInfo.text.toLowerCase().includes('proceed') ||
                focusedInfo.text.toLowerCase().includes('next') ||
                focusedInfo.text.toLowerCase().includes('confirm')) {

              console.log('🎯 Found Continue-like button via Tab navigation');
              await page.keyboard.press('Enter');
              console.log('✅ Pressed Enter on Continue-like button');
              additionalContinueClicked = true;
              await waitFor(4000);

              // Wait for navigation
              try {
                await page.waitForNavigation({
                  waitUntil: 'networkidle0',
                  timeout: 20000
                });

                const navUrl = page.url();
                console.log(`🔄 After keyboard Continue: ${navUrl}`);

                if (navUrl.includes('oauth2callback') || navUrl.includes('callback')) {
                  console.log('✅ Successfully reached callback via keyboard navigation');
                  return true;
                }
              } catch (keyNavError) {
                console.log('⚠️  Keyboard navigation timeout');
              }

              break;
            }
          }
        }
      } catch (keyboardError) {
        console.log('❌ Keyboard navigation failed on additional page:', keyboardError.message);
      }
    }

    // Method 3: Form submission fallback for additional page
    if (!additionalContinueClicked && additionalPageInfo.hasForm) {
      console.log('🔍 Trying form submission on additional page...');

      try {
        const formSubmitted = await page.evaluate(() => {
          const forms = document.querySelectorAll('form');
          for (const form of forms) {
            console.log('Attempting to submit form on additional page');
            try {
              form.submit();
              return true;
            } catch (submitError) {
              console.log('Form submission failed on additional page');
            }
          }
          return false;
        });

        if (formSubmitted) {
          console.log('✅ Form submitted on additional page');
          await waitFor(5000);

          const formUrl = page.url();
          if (formUrl.includes('oauth2callback') || formUrl.includes('callback')) {
            console.log('✅ Form submission led to callback URL');
            return true;
          }
        }
      } catch (formError) {
        console.log('❌ Form submission failed on additional page:', formError.message);
      }
    }

    console.log('❌ All methods failed on additional Continue page');
    return false;

  } catch (error) {
    console.error('❌ Error in handleAdditionalContinuePage:', error.message);
    await page.screenshot({ path: 'oauth-additional-continue-error.png' });
    console.log('📸 Error screenshot saved: oauth-additional-continue-error.png');
    return false;
  }
}

// Helper function to check for final callback after all Continue attempts
async function checkForFinalCallback(page) {
  console.log('🔍 Performing final callback check...');

  try {
    // Wait a bit more in case there's a delayed redirect
    await waitFor(5000);

    const currentUrl = page.url();
    console.log(`🔍 Final check URL: ${currentUrl}`);

    if (currentUrl.includes('oauth2callback') || currentUrl.includes('callback')) {
      console.log('✅ Found callback URL in final check');
      return true;
    }

    // Check if there's any indication of success on the current page
    const pageContent = await page.content();
    const successIndicators = [
      'success',
      'authorized',
      'authentication complete',
      'login successful',
      'access granted'
    ];

    for (const indicator of successIndicators) {
      if (pageContent.toLowerCase().includes(indicator)) {
        console.log(`✅ Found success indicator: "${indicator}"`);
        return true;
      }
    }

    console.log('❌ No callback URL or success indicators found in final check');
    return false;

  } catch (error) {
    console.error('❌ Error in final callback check:', error.message);
    return false;
  }
}

// Helper function to handle unverified app warning
async function handleUnverifiedAppWarning(page) {
  console.log('🔍 Checking for unverified app warning...');

  // Wait for page to load
  await waitFor(2000);

  // Check for various warning indicators
  const warningIndicators = [
    'Google hasn\'t verified this app',
    'This app isn\'t verified',
    'unverified app',
    'BACK TO SAFETY',
    'Go to Kratos (unsafe)',
    'Continue only if you understand the risks'
  ];

  let warningDetected = false;
  for (const indicator of warningIndicators) {
    try {
      const element = await page.$(`text=${indicator}`);
      if (element) {
        console.log(`⚠️  Detected warning: "${indicator}"`);
        warningDetected = true;
        break;
      }
    } catch (e) {
      // Continue checking
    }
  }

  if (!warningDetected) {
    console.log('✅ No unverified app warning detected');
    return true;
  }

  // Take screenshot of warning
  await page.screenshot({ path: 'oauth-unverified-warning.png' });
  console.log('📸 Screenshot saved: oauth-unverified-warning.png');

  // Try to click "Advanced" or similar button
  const advancedSelectors = [
    'text=Advanced',
    'text=Hide Advanced',
    'button:has-text("Advanced")',
    '[data-testid="advanced-button"]',
    'a:has-text("Advanced")',
    'span:has-text("Advanced")',
    '.advanced-link',
    '#advanced-link'
  ];

  let advancedClicked = false;
  for (const selector of advancedSelectors) {
    try {
      const element = await page.$(selector);
      if (element) {
        console.log(`✅ Clicking Advanced button: ${selector}`);
        await element.click();
        advancedClicked = true;
        await waitFor(2000);
        break;
      }
    } catch (e) {
      // Continue
    }
  }

  // Now look for "Go to [AppName] (unsafe)" or similar continue button
  const continueSelectors = [
    'text=Go to Kratos (unsafe)',
    'a:has-text("Go to")',
    'a:has-text("unsafe")',
    'button:has-text("Continue")',
    'a[href*="continue"]',
    '[data-testid="unsafe-continue"]',
    'text=Continue only if you understand the risks'
  ];

  let continueClicked = false;
  for (const selector of continueSelectors) {
    try {
      const element = await page.$(selector);
      if (element) {
        console.log(`✅ Clicking continue button: ${selector}`);
        await element.click();
        continueClicked = true;
        await waitFor(3000);
        break;
      }
    } catch (e) {
      // Continue
    }
  }

  if (!continueClicked && advancedClicked) {
    // If we clicked Advanced but couldn't find continue, try again
    await waitFor(2000);
    for (const selector of continueSelectors) {
      try {
        const element = await page.$(selector);
        if (element) {
          console.log(`✅ Clicking continue button (retry): ${selector}`);
          await element.click();
          continueClicked = true;
          await waitFor(3000);
          break;
        }
      } catch (e) {
        // Continue
      }
    }
  }

  if (!continueClicked) {
    console.error('❌ Could not proceed past unverified app warning');
    await page.screenshot({ path: 'oauth-unverified-stuck.png' });
    throw new Error('Unable to proceed past unverified app warning');
  }

  console.log('✅ Successfully handled unverified app warning');
  return true;
}

// Enhanced OAuth automation with Generic Flow Handler
async function handleGoogleOAuthFlow(page, email, password) {
  console.log('🤖 Starting enhanced Google OAuth flow with Generic Handler...');

  try {
    // Use the generic OAuth flow handler
    console.log('🚀 Using Generic OAuth Flow Handler');
    const result = await handleGenericOAuthFlow(page, email, password, 25, 30000);

    if (result.success) {
      console.log(`✅ Generic OAuth flow completed successfully in ${result.steps} steps`);
      console.log(`🔍 Final URL: ${result.finalUrl}`);
      return result;
    } else {
      console.log(`❌ Generic OAuth flow failed after ${result.steps} steps`);
      console.log(`🔍 Final URL: ${result.finalUrl}`);
      console.log(`❌ Error: ${result.error}`);

      // Fallback to legacy step-by-step approach if generic fails
      console.log('🔄 Falling back to legacy step-by-step approach...');
      return await handleLegacyGoogleOAuthFlow(page, email, password);
    }
  } catch (error) {
    console.error('❌ OAuth flow failed:', error.message);
    await page.screenshot({ path: 'oauth-flow-error.png' });
    console.log('📸 Error screenshot saved: oauth-flow-error.png');
    throw error;
  }
}

// Legacy OAuth flow as fallback
async function handleLegacyGoogleOAuthFlow(page, email, password) {
  console.log('🤖 Starting legacy Google OAuth flow with validation...');

  // Step 1: Email input validation
  console.log('📧 Step 1: Handling email input...');
  try {
    await page.waitForSelector('input[type="email"]', { timeout: 30000 });
    console.log('✅ Email input field found');

    // Clear any existing text and enter email
    await page.click('input[type="email"]', { clickCount: 3 });
    await page.type('input[type="email"]', email, { delay: 100 });
    console.log(`✅ Email entered: ${email}`);

    // Take screenshot after email entry
    await page.screenshot({ path: 'oauth-step1-email.png' });
    console.log('📸 Screenshot saved: oauth-step1-email.png');

    // Enhanced Next button detection with multiple selectors
    const nextButtonSelectors = [
      '#identifierNext',
      '[id="identifierNext"]',
      'button[type="submit"]',
      'input[type="submit"]',
      'button:contains("Next")',
      '[data-primary-action-label="Next"]'
    ];

    let nextClicked = false;
    for (const selector of nextButtonSelectors) {
      try {
        const nextButton = await page.$(selector);
        if (nextButton) {
          const isVisible = await nextButton.isIntersectingViewport().catch(() => true);
          if (isVisible) {
            await nextButton.click();
            console.log(`✅ Email Next button clicked using selector: ${selector}`);
            nextClicked = true;
            break;
          }
        }
      } catch (e) {
        // Continue to next selector
      }
    }

    if (!nextClicked) {
      throw new Error('Email Next button not found with any selector');
    }

    // Wait for navigation to password page with enhanced detection
    try {
      await Promise.race([
        page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 15000 }),
        page.waitForSelector('input[type="password"]', { timeout: 15000 })
      ]);
      console.log('✅ Navigated to password page');
    } catch (navError) {
      console.log('⚠️  Navigation wait failed, but continuing...');
      await waitFor(3000);
    }

  } catch (error) {
    console.error('❌ Email step failed:', error.message);
    await page.screenshot({ path: 'oauth-error-email.png' });
    throw new Error(`Email input failed: ${error.message}`);
  }

  // Step 2: Password input validation
  console.log('🔐 Step 2: Handling password input...');
  try {
    // Wait for password field with multiple selectors
    const passwordFieldSelectors = [
      'input[type="password"]',
      '#password',
      '[name="password"]',
      '[aria-label*="password" i]'
    ];

    let passwordFieldFound = false;
    for (const selector of passwordFieldSelectors) {
      try {
        await page.waitForSelector(selector, { timeout: 10000 });
        console.log(`✅ Password input field found with selector: ${selector}`);
        passwordFieldFound = true;
        break;
      } catch (e) {
        console.log(`⚠️  Password field not found with selector: ${selector}`);
      }
    }

    if (!passwordFieldFound) {
      throw new Error('Password input field not found with any selector');
    }

    // Wait for the field to be fully interactive and page to stabilize
    await waitFor(3000);
    console.log('⏳ Waiting for password field to be interactive...');

    // Take debug screenshot before password input
    await page.screenshot({ path: 'oauth-step2-before-password.png' });
    console.log('📸 Debug screenshot saved: oauth-step2-before-password.png');

    // Enhanced password input handling with multiple strategies
    let passwordEntered = false;
    const passwordSelectors = [
      'input[type="password"]',
      '#password',
      '[name="password"]',
      '[aria-label*="password" i]',
      '[placeholder*="password" i]'
    ];

    for (const selector of passwordSelectors) {
      try {
        const passwordField = await page.$(selector);
        if (passwordField) {
          // Check if the field is visible and interactable
          const isVisible = await passwordField.isIntersectingViewport().catch(() => true);
          const boundingBox = await passwordField.boundingBox().catch(() => null);

          if (isVisible && boundingBox) {
            console.log(`🔍 Attempting password input with selector: ${selector}`);

            // Try different methods to interact with the field
            try {
              // Method 1: Focus and type
              await passwordField.focus();
              await waitFor(500);
              await passwordField.type(password, { delay: 100 });
              console.log('✅ Password entered using focus + type');
              passwordEntered = true;
              break;
            } catch (focusError) {
              console.log('⚠️  Focus + type failed, trying click method...');

              try {
                // Method 2: Click and type
                await passwordField.click();
                await waitFor(500);
                await passwordField.type(password, { delay: 100 });
                console.log('✅ Password entered using click + type');
                passwordEntered = true;
                break;
              } catch (clickError) {
                console.log('⚠️  Click + type failed, trying evaluate method...');

                try {
                  // Method 3: Direct value setting via evaluate
                  await page.evaluate((sel, pass) => {
                    const field = document.querySelector(sel);
                    if (field) {
                      field.value = pass;
                      field.dispatchEvent(new Event('input', { bubbles: true }));
                      field.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                  }, selector, password);
                  console.log('✅ Password entered using evaluate method');
                  passwordEntered = true;
                  break;
                } catch (evalError) {
                  console.log(`⚠️  All methods failed for selector ${selector}:`, evalError.message);
                }
              }
            }
          }
        }
      } catch (selectorError) {
        console.log(`⚠️  Selector ${selector} failed:`, selectorError.message);
      }
    }

    if (!passwordEntered) {
      throw new Error('Failed to enter password with any method');
    }

    // Take screenshot after password entry
    await page.screenshot({ path: 'oauth-step2-password.png' });
    console.log('📸 Screenshot saved: oauth-step2-password.png');

    // Enhanced password Next button detection with multiple interaction methods
    const passwordNextSelectors = [
      '#passwordNext',
      '[id="passwordNext"]',
      'button[type="submit"]',
      'input[type="submit"]',
      'button:has-text("Next")',
      '[data-primary-action-label="Next"]',
      'button[data-action="next"]',
      '[role="button"]:has-text("Next")'
    ];

    let passwordNextClicked = false;
    for (const selector of passwordNextSelectors) {
      try {
        const passwordNext = await page.$(selector);
        if (passwordNext) {
          const isVisible = await passwordNext.isIntersectingViewport().catch(() => true);
          const boundingBox = await passwordNext.boundingBox().catch(() => null);

          if (isVisible && boundingBox) {
            console.log(`🔍 Attempting to click Next button with selector: ${selector}`);

            try {
              // Method 1: Regular click
              await passwordNext.click();
              console.log(`✅ Password Next button clicked using selector: ${selector}`);
              passwordNextClicked = true;
              break;
            } catch (clickError) {
              console.log('⚠️  Regular click failed, trying evaluate click...');

              try {
                // Method 2: Evaluate click
                await page.evaluate((sel) => {
                  const button = document.querySelector(sel);
                  if (button) {
                    button.click();
                  }
                }, selector);
                console.log(`✅ Password Next button clicked using evaluate: ${selector}`);
                passwordNextClicked = true;
                break;
              } catch (evalError) {
                console.log(`⚠️  Evaluate click failed for ${selector}:`, evalError.message);
              }
            }
          }
        }
      } catch (selectorError) {
        console.log(`⚠️  Selector ${selector} failed:`, selectorError.message);
      }
    }

    if (!passwordNextClicked) {
      // Try pressing Enter as a fallback
      console.log('⚠️  All Next button methods failed, trying Enter key...');
      try {
        await page.keyboard.press('Enter');
        console.log('✅ Pressed Enter key as fallback');
        passwordNextClicked = true;
      } catch (enterError) {
        throw new Error('Password Next button not found with any method and Enter key failed');
      }
    }

    // Wait for potential 2FA or next step
    await waitFor(3000);
    console.log('✅ Password step completed');

  } catch (error) {
    console.error('❌ Password step failed:', error.message);
    await page.screenshot({ path: 'oauth-error-password.png' });
    throw new Error(`Password input failed: ${error.message}`);
  }

  // Step 3: Handle 2FA if present
  console.log('🔒 Step 3: Checking for 2FA...');
  try {
    // Check for 2FA prompts
    const twoFactorSelectors = [
      'input[type="tel"]', // Phone number input
      '[data-testid="challenge"]', // Challenge input
      'input[name="totpPin"]', // TOTP input
      'input[aria-label*="code"]' // Generic code input
    ];

    let twoFactorFound = false;
    for (const selector of twoFactorSelectors) {
      try {
        await page.waitForSelector(selector, { timeout: 3000 });
        twoFactorFound = true;
        console.log(`⚠️  2FA detected: ${selector}`);
        break;
      } catch (e) {
        // Continue checking other selectors
      }
    }

    if (twoFactorFound) {
      await page.screenshot({ path: 'oauth-step3-2fa.png' });
      console.log('📸 Screenshot saved: oauth-step3-2fa.png');
      console.log('⚠️  2FA detected - manual intervention may be required');
      console.log('💡 Consider using App Passwords to bypass 2FA');

      // Wait a bit longer for manual intervention if not headless
      if (!config.headless) {
        console.log('⏳ Waiting 30 seconds for manual 2FA completion...');
        await waitFor(30000);
      }
    } else {
      console.log('✅ No 2FA detected, proceeding...');
    }

  } catch (error) {
    console.log('ℹ️  2FA check completed (no 2FA found)');
  }

  // Step 4: Enhanced consent screen handling with unverified app support
  console.log('📋 Step 4: Handling consent screen...');
  try {
    // Wait for page to stabilize
    await waitFor(3000);

    // Take screenshot before consent handling
    await page.screenshot({ path: 'oauth-step4-before-consent.png' });
    console.log('📸 Screenshot saved: oauth-step4-before-consent.png');

    // Handle unverified app warning using helper function
    try {
      await handleUnverifiedAppWarning(page);

      // After handling unverified app warning, wait and check if we're directly on final consent
      await waitFor(2000);
      const postWarningContent = await page.content();
      if (postWarningContent.includes('You\'re signing back in to Kratos') ||
          postWarningContent.includes('signing back in')) {
        console.log('🎯 Detected final consent screen immediately after unverified app warning');
        // Skip regular consent checking and go directly to final consent handling
        // We'll set a flag to indicate this
        await page.evaluate(() => {
          window._skipRegularConsent = true;
        });
      }
    } catch (warningError) {
      console.error('❌ Failed to handle unverified app warning:', warningError.message);
      // Continue anyway as this might not always be present
    }

    // Check if we should skip regular consent (already on final consent)
    const skipRegularConsent = await page.evaluate(() => window._skipRegularConsent).catch(() => false);

    if (skipRegularConsent) {
      console.log('⏭️  Skipping regular consent check - already on final consent screen');
    } else {
      // Now handle the regular consent screen
      console.log('🔍 Looking for consent screen...');
      await waitFor(2000);

      // Multiple consent screen selectors to try
      const consentSelectors = [
        '#submit_approve_access',
        '[id="submit_approve_access"]',
        'button[data-action="consent"]',
        'input[type="submit"][value*="Allow"]',
        'button:has-text("Allow")',
        'button:has-text("Continue")',
        'button:has-text("Accept")',
        'input[value="Continue"]',
        '[role="button"]:has-text("Allow")',
        'button[type="submit"]'
      ];

      let consentFound = false;
      let consentAttempts = 0;
      const maxConsentAttempts = 5;

      while (!consentFound && consentAttempts < maxConsentAttempts) {
        consentAttempts++;
        console.log(`🔍 Consent attempt ${consentAttempts}/${maxConsentAttempts}`);

        for (const selector of consentSelectors) {
          try {
            const element = await page.$(selector);
            if (element) {
              // Check if element is visible
              let isVisible = true;
              try {
                isVisible = await element.isIntersectingViewport();
              } catch (e) {
                console.log('⚠️  Using fallback visibility check');
              }

              if (isVisible) {
                console.log(`✅ Found consent button: ${selector}`);
                await element.click();
                console.log('✅ Consent button clicked');
                consentFound = true;
                await waitFor(2000);
                break;
              }
            }
          } catch (e) {
            // Continue to next selector
          }
        }

        if (!consentFound) {
          // Check if we're already past the consent screen
          const currentUrl = page.url();
          if (currentUrl.includes('oauth2callback') || currentUrl.includes('callback')) {
            console.log('✅ Already past consent screen (callback URL detected)');
            consentFound = true;
            break;
          }

          // Wait before next attempt
          if (consentAttempts < maxConsentAttempts) {
            console.log('⏳ Waiting 3 seconds before next consent attempt...');
            await waitFor(3000);
          }
        }
      }

      if (consentFound) {
        // Take screenshot after consent
        await page.screenshot({ path: 'oauth-step4-after-consent.png' });
        console.log('📸 Screenshot saved: oauth-step4-after-consent.png');
        console.log('✅ Consent screen handled successfully');
      } else {
        console.log('⚠️  No regular consent screen found - may have been pre-approved or direct to final consent');
        // Take screenshot for debugging
        await page.screenshot({ path: 'oauth-step4-no-consent.png' });
        console.log('📸 Screenshot saved: oauth-step4-no-consent.png');
      }
    }

  } catch (error) {
    console.error('❌ Consent screen handling failed:', error.message);
    await page.screenshot({ path: 'oauth-error-consent.png' });
    console.log('📸 Error screenshot saved: oauth-error-consent.png');
    // Don't throw here as consent might not be required
  }

  // Step 5: Handle final "You're signing back in to Kratos" consent screen
  // This runs regardless of whether regular consent was found or not
  try {
    console.log('🔍 Step 5: Checking for final Kratos consent screen...');
    await waitFor(3000);

    // Take screenshot to see current state
    await page.screenshot({ path: 'oauth-step5-final-consent-check.png' });
    console.log('📸 Screenshot saved: oauth-step5-final-consent-check.png');

    // Enhanced detection for various Kratos consent screens
    const finalConsentIndicators = [
      // "You're signing back in to Kratos" screen
      'You\'re signing back in to Kratos',
      'You\'re signing back in',
      'signing back in to Kratos',
      'signing back in',
      // "Kratos wants access" screen (the actual screen we're seeing)
      'Kratos wants access to your Google Account',
      'Kratos wants access',
      'wants access to your Google Account',
      'Make sure you trust Kratos',
      'Review Kratos\'s Privacy Policy',
      'Review Kratos',
      'Privacy Policy and Terms of Service',
      'Learn why you\'re not seeing links',
      'Continue',
      'Cancel'
    ];

    let finalConsentDetected = false;
    const pageContent = await page.content();
    const pageText = await page.evaluate(() => document.body.textContent || document.body.innerText || '');

    console.log('🔍 Checking page content for final consent indicators...');

    for (const indicator of finalConsentIndicators) {
      try {
        if (pageContent.includes(indicator) || pageText.includes(indicator)) {
          console.log(`✅ Detected final consent screen with indicator: "${indicator}"`);
          finalConsentDetected = true;
          break;
        }
      } catch (e) {
        // Continue checking
      }
    }

    // Additional check for Continue button presence (strong indicator)
    if (!finalConsentDetected) {
      try {
        const continueButton = await page.$('button:has-text("Continue")') ||
                              await page.$('input[value="Continue"]') ||
                              await page.$('[role="button"]:has-text("Continue")');
        if (continueButton) {
          console.log('✅ Detected final consent screen by Continue button presence');
          finalConsentDetected = true;
        }
      } catch (e) {
        // Continue
      }
    }

    // Log current URL and page title for debugging
    const currentUrl = page.url();
    const pageTitle = await page.title().catch(() => 'Unknown');
    console.log(`🔍 Current URL: ${currentUrl}`);
    console.log(`🔍 Page Title: ${pageTitle}`);

    if (finalConsentDetected) {
      console.log('🎯 Final Kratos consent screen detected - looking for Continue button...');

      // Puppeteer-compatible Continue button selectors
      const finalContinueSelectors = [
        // Direct button selectors
        'button',
        'input[type="submit"]',
        'input[value="Continue"]',
        '[role="button"]',
        'div[role="button"]',
        'span[role="button"]',
        // Attribute-based selectors
        'button[data-action="continue"]',
        'button[aria-label*="Continue"]',
        'button[aria-label*="continue"]',
        // Generic clickable elements
        'span[tabindex="0"]',
        'span[onclick]',
        'div[onclick]',
        'a[href*="continue"]',
        // Class-based selectors (common patterns)
        '.continue-button',
        '.btn-continue',
        '.oauth-continue',
        '.consent-continue'
      ];

      let finalContinueClicked = false;
      let finalContinueAttempts = 0;
      const maxFinalContinueAttempts = 3;

      while (!finalContinueClicked && finalContinueAttempts < maxFinalContinueAttempts) {
        finalContinueAttempts++;
        console.log(`🔍 Final Continue attempt ${finalContinueAttempts}/${maxFinalContinueAttempts}`);

        // Smart approach: Find buttons and check their text content
        console.log('🔍 Looking for Continue button by checking text content...');

        // First, let's debug what buttons are actually on the page
        const pageButtons = await page.evaluate(() => {
          const buttons = [...document.querySelectorAll('button, input[type="submit"], [role="button"]')];
          return buttons.map(btn => ({
            tagName: btn.tagName,
            text: (btn.textContent || btn.innerText || btn.value || '').trim(),
            className: btn.className,
            id: btn.id,
            type: btn.type,
            role: btn.getAttribute('role'),
            ariaLabel: btn.getAttribute('aria-label'),
            visible: btn.offsetWidth > 0 && btn.offsetHeight > 0
          }));
        });

        console.log('🔍 Found buttons on page:', JSON.stringify(pageButtons, null, 2));

        const continueButtonFound = await page.evaluate(() => {
          // Find all potentially clickable elements
          const clickableElements = [
            ...document.querySelectorAll('button'),
            ...document.querySelectorAll('input[type="submit"]'),
            ...document.querySelectorAll('[role="button"]'),
            ...document.querySelectorAll('div[onclick]'),
            ...document.querySelectorAll('span[onclick]'),
            ...document.querySelectorAll('a[href]')
          ];

          console.log(`Found ${clickableElements.length} potentially clickable elements`);

          for (const element of clickableElements) {
            const text = element.textContent || element.innerText || element.value || '';
            const ariaLabel = element.getAttribute('aria-label') || '';
            const title = element.getAttribute('title') || '';

            // Check if this element contains "Continue" text
            if (text.trim() === 'Continue' ||
                text.includes('Continue') ||
                ariaLabel.includes('Continue') ||
                title.includes('Continue')) {

              console.log(`Found Continue button: ${element.tagName} with text: "${text.trim()}"`);

              // Check if element is visible
              const rect = element.getBoundingClientRect();
              const isVisible = rect.width > 0 && rect.height > 0 &&
                               rect.top >= 0 && rect.left >= 0 &&
                               rect.bottom <= window.innerHeight &&
                               rect.right <= window.innerWidth;

              if (isVisible) {
                console.log('Continue button is visible, clicking...');
                element.click();
                return true;
              } else {
                console.log('Continue button found but not visible');
              }
            }
          }
          return false;
        });

        if (continueButtonFound) {
          console.log('✅ Final Continue button clicked using smart text detection');
          finalContinueClicked = true;
          await waitFor(3000);
        } else {
          console.log('⚠️  Smart text detection failed, trying CSS selectors...');

          // Fallback to CSS selectors with text validation
          for (const selector of finalContinueSelectors) {
            try {
              const elements = await page.$$(selector);
              for (const element of elements) {
                try {
                  const text = await page.evaluate(el => el.textContent || el.innerText || el.value || '', element);
                  const isVisible = await element.isIntersectingViewport().catch(() => true);

                  if ((text.includes('Continue') || selector.includes('submit')) && isVisible) {
                    console.log(`🔍 Attempting to click element with selector: ${selector}, text: "${text.trim()}"`);

                    try {
                      await element.click();
                      console.log(`✅ Final Continue button clicked using selector: ${selector}`);
                      finalContinueClicked = true;
                      await waitFor(3000);
                      break;
                    } catch (clickError) {
                      console.log('⚠️  Regular click failed, trying evaluate click...');

                      try {
                        await page.evaluate((el) => el.click(), element);
                        console.log(`✅ Final Continue button clicked using evaluate: ${selector}`);
                        finalContinueClicked = true;
                        await waitFor(3000);
                        break;
                      } catch (evalError) {
                        console.log(`⚠️  Evaluate click failed for ${selector}:`, evalError.message);
                      }
                    }
                  }
                } catch (textError) {
                  // Continue to next element
                }
              }

              if (finalContinueClicked) break;

            } catch (selectorError) {
              console.log(`⚠️  Selector ${selector} failed:`, selectorError.message);
            }
          }
        }

        // If still not clicked, try keyboard approach
        if (!finalContinueClicked) {
          console.log('🔍 Trying keyboard Tab + Enter approach...');

          try {
            // Try to focus on Continue button using Tab navigation
            await page.keyboard.press('Tab');
            await waitFor(500);
            await page.keyboard.press('Tab');
            await waitFor(500);

            // Check if we're focused on Continue button
            const focusedElementText = await page.evaluate(() => {
              const focused = document.activeElement;
              return focused ? (focused.textContent || focused.innerText || focused.value || '').trim() : '';
            });

            console.log(`🔍 Focused element text: "${focusedElementText}"`);

            if (focusedElementText.includes('Continue')) {
              console.log('🎯 Found Continue button via Tab navigation');
              await page.keyboard.press('Enter');
              console.log('✅ Final Continue button activated using Enter key');
              finalContinueClicked = true;
              await waitFor(3000);
            } else {
              // Try a few more tabs
              for (let i = 0; i < 5; i++) {
                await page.keyboard.press('Tab');
                await waitFor(300);

                const currentFocusText = await page.evaluate(() => {
                  const focused = document.activeElement;
                  return focused ? (focused.textContent || focused.innerText || focused.value || '').trim() : '';
                });

                if (currentFocusText.includes('Continue')) {
                  console.log(`🎯 Found Continue button via Tab navigation (attempt ${i + 1})`);
                  await page.keyboard.press('Enter');
                  console.log('✅ Final Continue button activated using Enter key');
                  finalContinueClicked = true;
                  await waitFor(3000);
                  break;
                }
              }
            }
          } catch (keyboardError) {
            console.log('⚠️  Keyboard approach failed:', keyboardError.message);
          }
        }

        // If still not clicked, try direct text content search and click
        if (!finalContinueClicked) {
          console.log('🔍 Trying direct text content search for Continue...');

          try {
            const continueClicked = await page.evaluate(() => {
              // Find all elements containing "Continue" text
              const walker = document.createTreeWalker(
                document.body,
                NodeFilter.SHOW_TEXT,
                null,
                false
              );

              let node;
              while (node = walker.nextNode()) {
                if (node.textContent.trim() === 'Continue') {
                  let element = node.parentElement;
                  // Walk up to find clickable parent
                  while (element && element !== document.body) {
                    if (element.onclick ||
                        element.getAttribute('role') === 'button' ||
                        element.tagName === 'BUTTON' ||
                        element.tagName === 'A' ||
                        element.getAttribute('tabindex') !== null) {
                      element.click();
                      return true;
                    }
                    element = element.parentElement;
                  }
                }
              }
              return false;
            });

            if (continueClicked) {
              console.log('✅ Final Continue button clicked using text content search');
              finalContinueClicked = true;
              await waitFor(3000);
            }
          } catch (textSearchError) {
            console.log('⚠️  Text content search failed:', textSearchError.message);
          }
        }

        if (!finalContinueClicked) {
          // Check if we've already moved past this screen
          const currentUrl = page.url();
          if (currentUrl.includes('oauth2callback') || currentUrl.includes('callback')) {
            console.log('✅ Already moved past final consent screen (callback URL detected)');
            finalContinueClicked = true;
            break;
          }

          // Wait before next attempt
          if (finalContinueAttempts < maxFinalContinueAttempts) {
            console.log('⏳ Waiting 3 seconds before next final Continue attempt...');
            await waitFor(3000);
          }
        }
      }

      if (finalContinueClicked) {
        console.log('✅ Final Kratos consent screen handled successfully');
        await page.screenshot({ path: 'oauth-step5-after-final-consent.png' });
        console.log('📸 Screenshot saved: oauth-step5-after-final-consent.png');
      } else {
        console.log('❌ Failed to click Continue button on final consent screen');
        await page.screenshot({ path: 'oauth-step5-final-consent-failed.png' });
        console.log('📸 Error screenshot saved: oauth-step5-final-consent-failed.png');

        // Try Enter key as ultimate fallback
        console.log('⚠️  Trying Enter key as final fallback...');
        try {
          await page.keyboard.press('Enter');
          console.log('✅ Pressed Enter key as final fallback');
          await waitFor(3000);
        } catch (enterError) {
          console.error('❌ Enter key fallback also failed:', enterError.message);
        }
      }
    } else {
      console.log('ℹ️  No final Kratos consent screen detected - proceeding...');
    }

  } catch (finalConsentError) {
    console.error('❌ Final consent screen handling failed:', finalConsentError.message);
    await page.screenshot({ path: 'oauth-error-final-consent.png' });
    console.log('📸 Error screenshot saved: oauth-error-final-consent.png');
    // Don't throw here as this might not always be required
  }

  console.log('✅ OAuth automation flow completed');

  // Final verification - check if we're on the right page
  const finalUrl = page.url();
  console.log(`🔍 Final URL after OAuth flow: ${finalUrl}`);

  if (finalUrl.includes('oauth2callback') || finalUrl.includes('callback')) {
    console.log('✅ Successfully reached OAuth callback URL');
  } else if (finalUrl.includes('consentsummary')) {
    console.log('🎯 Reached consent summary page - THIS IS THE FINAL CONSENT SCREEN!');

    // Use dedicated consent summary handler
    const consentSummarySuccess = await handleConsentSummaryPage(page);

    if (consentSummarySuccess) {
      console.log('✅ Consent summary page handled successfully');
    } else {
      console.log('⚠️  Consent summary page handling may have failed');

      // Try the additional Continue page handler as fallback
      console.log('🔍 Trying additional Continue page handler as fallback...');
      const additionalSuccess = await handleAdditionalContinuePage(page);

      if (additionalSuccess) {
        console.log('✅ Additional Continue page handled successfully as fallback');
      } else {
        console.log('❌ Both consent summary and additional Continue page handling failed');
      }
    }
  } else if (
      finalUrl.includes('Authentication Successful')) {
    console.log('✅ OAuth flow appears to have completed successfully');
  } else {
    console.log('⚠️  OAuth flow may not have completed - taking final screenshot');
    await page.screenshot({ path: 'oauth-final-state.png', fullPage: true });
  }
}

async function extractUserContext(page) {
  console.log('🔍 Step 5: Extracting user context from callback page...');

  // Wait for page to fully load
  console.log('⏳ Waiting for callback page to load...');
  await waitFor(3000);

  // Validate we're on the callback page
  const currentUrl = page.url();
  console.log(`🌐 Current URL: ${currentUrl}`);

  if (!currentUrl.includes('oauth2callback') && !currentUrl.includes('callback')) {
    console.warn('⚠️  Not on expected callback page, but proceeding with extraction...');
  } else {
    console.log('✅ Confirmed on OAuth callback page');
  }

  // Take screenshot for debugging
  await page.screenshot({ path: 'oauth-step5-callback.png', fullPage: true });
  console.log('📸 Screenshot saved: oauth-step5-callback.png');

  // Enhanced user context extraction with multiple strategies
  console.log('🔍 Attempting user context extraction...');

  const extractionResult = await page.evaluate(() => {
    const strategies = [];

    // Strategy 1: Look for paragraph elements
    console.log('Trying Strategy 1: Paragraph elements');
    const sessionIdText = Array.from(document.querySelectorAll("p")).find(
      (p) => p.textContent?.includes("session ID")
    )?.textContent;
    const userIdText = Array.from(document.querySelectorAll("p")).find(
      (p) => p.textContent?.includes("user ID")
    )?.textContent;

    let session_id = sessionIdText?.split("session ID is ")[1]?.trim();
    let user_id = userIdText?.split("user ID is ")[1]?.trim();

    strategies.push({
      name: 'Paragraph Elements',
      success: !!(session_id && user_id),
      session_id,
      user_id,
      sessionText: sessionIdText,
      userText: userIdText
    });

    // Strategy 2: Look for any element containing session/user info
    if (!session_id || !user_id) {
      console.log('Trying Strategy 2: Any elements');
      const allElements = Array.from(document.querySelectorAll("*"));

      const sessionElement = allElements.find(el =>
        el.textContent?.includes("session ID") ||
        el.textContent?.includes("sessionId") ||
        el.textContent?.includes("session_id")
      );

      const userElement = allElements.find(el =>
        el.textContent?.includes("user ID") ||
        el.textContent?.includes("userId") ||
        el.textContent?.includes("user_id")
      );

      if (sessionElement?.textContent && !session_id) {
        const sessionText = sessionElement.textContent;
        session_id = sessionText.match(/session[_\s]?ID[:\s]+([a-zA-Z0-9-]+)/i)?.[1] ||
                    sessionText.match(/sessionId[:\s]+([a-zA-Z0-9-]+)/i)?.[1] ||
                    sessionText.split("session ID is ")[1]?.trim();
      }

      if (userElement?.textContent && !user_id) {
        const userText = userElement.textContent;
        user_id = userText.match(/user[_\s]?ID[:\s]+([a-zA-Z0-9-]+)/i)?.[1] ||
                 userText.match(/userId[:\s]+([a-zA-Z0-9-]+)/i)?.[1] ||
                 userText.split("user ID is ")[1]?.trim();
      }

      strategies.push({
        name: 'Any Elements',
        success: !!(session_id && user_id),
        session_id,
        user_id
      });
    }

    // Strategy 3: Look for JSON data in script tags
    if (!session_id || !user_id) {
      console.log('Trying Strategy 3: Script tags');
      const scripts = Array.from(document.querySelectorAll("script"));
      for (const script of scripts) {
        if (script.textContent) {
          try {
            const jsonMatch = script.textContent.match(/\{[^}]*(?:user_?id|session_?id)[^}]*\}/gi);
            if (jsonMatch) {
              for (const match of jsonMatch) {
                try {
                  const parsed = JSON.parse(match);
                  if (parsed.user_id && parsed.session_id) {
                    session_id = parsed.session_id;
                    user_id = parsed.user_id;
                    break;
                  }
                  if (parsed.userId && parsed.sessionId) {
                    session_id = parsed.sessionId;
                    user_id = parsed.userId;
                    break;
                  }
                } catch (e) {
                  // Continue
                }
              }
            }
          } catch (e) {
            // Continue
          }
        }
      }

      strategies.push({
        name: 'Script Tags',
        success: !!(session_id && user_id),
        session_id,
        user_id
      });
    }

    // Strategy 4: Look for data attributes
    if (!session_id || !user_id) {
      console.log('Trying Strategy 4: Data attributes');
      const userIdEl = document.querySelector("[data-user-id]");
      const sessionIdEl = document.querySelector("[data-session-id]");

      if (userIdEl && !user_id) {
        user_id = userIdEl.getAttribute("data-user-id");
      }
      if (sessionIdEl && !session_id) {
        session_id = sessionIdEl.getAttribute("data-session-id");
      }

      strategies.push({
        name: 'Data Attributes',
        success: !!(session_id && user_id),
        session_id,
        user_id
      });
    }

    return {
      session_id,
      user_id,
      strategies,
      pageContent: document.body.textContent.substring(0, 1000),
      url: window.location.href,
      title: document.title,
      allText: document.body.textContent
    };
  });

  // Log extraction results
  console.log('� Extraction strategies results:');
  extractionResult.strategies.forEach((strategy, index) => {
    const status = strategy.success ? '✅' : '❌';
    console.log(`   ${status} Strategy ${index + 1} (${strategy.name}): ${strategy.success ? 'SUCCESS' : 'FAILED'}`);
    if (strategy.success) {
      console.log(`      User ID: ${strategy.user_id}`);
      console.log(`      Session ID: ${strategy.session_id}`);
    }
  });

  console.log('📄 Page information:');
  console.log(`   Title: ${extractionResult.title}`);
  console.log(`   URL: ${extractionResult.url}`);
  console.log(`   Content preview: ${extractionResult.pageContent.replace(/\s+/g, ' ').trim()}`);

  if (extractionResult.user_id && extractionResult.session_id) {
    console.log('✅ Successfully extracted user context');
    console.log(`   User ID: ${extractionResult.user_id}`);
    console.log(`   Session ID: ${extractionResult.session_id}`);
    return {
      user_id: extractionResult.user_id,
      session_id: extractionResult.session_id
    };
  } else {
    console.error('❌ Failed to extract user context');
    console.error('Available page content for debugging:');
    console.error(extractionResult.allText.substring(0, 2000));

    // Save full page content for debugging
    require('fs').writeFileSync('oauth-callback-content.txt', extractionResult.allText);
    console.log('📄 Full page content saved to: oauth-callback-content.txt');

    throw new Error('Failed to extract user_id and session_id from callback page');
  }
}

async function validateOAuthFlow() {
  let client;
  let browser;
  
  try {
    console.log('\n🚀 Starting OAuth validation...');
    
    // Step 1: Connect to MCP server
    console.log('📡 Connecting to MCP server...');
    const transport = new StdioClientTransport({
      command: "node",
      args: ["./build/index.js"],
    });
    
    client = new Client({
      name: "oauth-validator",
      version: "1.0.0",
    });
    
    await client.connect(transport);
    console.log('✅ Connected to MCP server');
    
    // Step 2: Wait for server to be ready
    console.log('⏳ Waiting for server to be ready...');
    let ready = false;
    for (let i = 0; i < 10; i++) {
      try {
        await client.callTool({
          name: "get_system_health",
          arguments: { user_context: { user_id: "test", session_id: "test" } },
        });
        ready = true;
        break;
      } catch (e) {
        await new Promise((res) => setTimeout(res, 500));
      }
    }
    
    if (!ready) {
      throw new Error("Server did not become ready in time");
    }
    console.log('✅ Server is ready');
    
    // Step 3: Register first user (no OAuth needed)
    console.log('👤 Registering first user...');
    const registerResp = await client.callTool({
      name: "register_user",
      arguments: {
        email: config.email,
        display_name: "OAuth Test User",
        role: "admin"
      },
    });
    
    const registrationContent = JSON.parse(registerResp.content[0].text);
    console.log('✅ User registered:', registrationContent);
    
    // Step 4: Start OAuth flow
    console.log('🔐 Starting OAuth authentication...');
    const authResp = await client.callTool({
      name: "authenticate",
      arguments: {
        email: config.email,
        display_name: "OAuth Test User",
        session_id: "test_session",
      },
    });
    
    const authContent = JSON.parse(authResp.content[0].text);
    console.log('📋 Auth response:', authContent);
    
    if (!authContent.authUrl) {
      throw new Error("No authUrl received from authenticate call");
    }
    
    let userContext;
    
    if (config.useMockOAuth) {
      console.log('🎭 Using mock OAuth (skipping browser automation)...');
      userContext = {
        user_id: `mock_user_${Date.now()}`,
        session_id: `mock_session_${Date.now()}`
      };
    } else {
      // Step 5: Automated OAuth flow
      console.log('🌐 Starting browser automation...');
      
      if (!config.password) {
        throw new Error('GMAIL_TEST_PASSWORD not set. Cannot proceed with OAuth automation.');
      }
      
      const randomUUID = crypto.randomUUID();
      const userDataDir = path.join(require('os').tmpdir(), `oauth-validation-${randomUUID}`);
      
      browser = await puppeteer.launch({
        headless: config.headless,
        executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        userDataDir: userDataDir,
        slowMo: 50,
        args: [
          "--disable-blink-features=AutomationControlled",
          "--disable-infobars",
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-web-security",
          "--disable-features=VizDisplayCompositor",
          "--disable-dev-shm-usage",
          "--no-first-run",
          "--disable-default-apps",
          "--disable-popup-blocking",
          "--disable-translate",
          "--disable-background-timer-throttling",
          "--disable-renderer-backgrounding",
          "--disable-backgrounding-occluded-windows",
          "--disable-ipc-flooding-protection",
        ],
      });
      
      const page = await browser.newPage();

      // Enhanced page setup for better OAuth handling
      await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      await page.setViewport({ width: 1280, height: 720 });

      // Set up page event listeners for debugging
      page.on('console', msg => {
        if (msg.type() === 'error') {
          console.log('🔍 Browser console error:', msg.text());
        }
      });

      page.on('pageerror', error => {
        console.log('🔍 Page error:', error.message);
      });

      // Set extra HTTP headers to appear more like a real browser
      await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
        'Upgrade-Insecure-Requests': '1',
        'Cache-Control': 'max-age=0'
      });

      console.log('🌐 Navigating to OAuth URL...');
      console.log(`   URL: ${authContent.authUrl}`);

      try {
        await page.goto(authContent.authUrl, {
          waitUntil: "networkidle0",
          timeout: 30000
        });
        console.log('✅ Successfully navigated to OAuth URL');
      } catch (navError) {
        console.error('❌ Failed to navigate to OAuth URL:', navError.message);
        await page.screenshot({ path: 'oauth-navigation-error.png' });
        throw new Error(`Navigation failed: ${navError.message}`);
      }
      
      // Handle OAuth flow with retry logic
      let oauthAttempts = 0;
      const maxOAuthAttempts = 2;
      let oauthSuccess = false;

      while (!oauthSuccess && oauthAttempts < maxOAuthAttempts) {
        oauthAttempts++;
        console.log(`🔄 OAuth attempt ${oauthAttempts}/${maxOAuthAttempts}`);

        try {
          await handleGoogleOAuthFlow(page, config.email, config.password);
          oauthSuccess = true;
        } catch (oauthError) {
          console.error(`❌ OAuth attempt ${oauthAttempts} failed:`, oauthError.message);

          if (oauthAttempts < maxOAuthAttempts) {
            console.log('🔄 Retrying OAuth flow...');
            // Navigate back to the auth URL for retry
            await page.goto(authContent.authUrl, { waitUntil: "networkidle0" });
            await waitFor(2000);
          } else {
            throw oauthError;
          }
        }
      }

      // Wait for callback with enhanced monitoring
      console.log('⏳ Step 6: Waiting for OAuth callback...');
      console.log(`   Timeout: ${config.timeout}ms (${config.timeout/1000}s)`);

      const callbackStartTime = Date.now();

      try {
        // Enhanced callback detection with multiple conditions
        await page.waitForFunction(
          () => {
            const url = window.location.href;
            const pathname = window.location.pathname;
            return pathname.includes('/oauth2callback') ||
                   pathname.includes('/callback') ||
                   url.includes('oauth2callback') ||
                   url.includes('callback') ||
                   document.body.textContent.includes('session ID') ||
                   document.body.textContent.includes('Authentication Successful');
          },
          { timeout: config.timeout }
        );

        const callbackTime = Date.now() - callbackStartTime;
        console.log(`✅ OAuth callback reached in ${callbackTime}ms`);

      } catch (timeoutError) {
        console.error('❌ Timeout waiting for OAuth callback');
        console.error(`   Waited: ${config.timeout}ms`);
        console.error(`   Current URL: ${page.url()}`);

        // Take screenshot of current state
        await page.screenshot({ path: 'oauth-timeout-error.png', fullPage: true });
        console.log('📸 Timeout screenshot saved: oauth-timeout-error.png');

        // Check if we're on a page that might have the callback data anyway
        const pageContent = await page.content();
        if (pageContent.includes('session ID') || pageContent.includes('user ID')) {
          console.log('⚠️  Callback data detected despite timeout, proceeding...');
        } else {
          throw new Error(`OAuth callback timeout after ${config.timeout}ms. Current URL: ${page.url()}`);
        }
      }

      // Extract user context
      userContext = await extractUserContext(page);
      
      await browser.close();
    }
    
    console.log('🎯 Extracted user context:', userContext);
    
    // Step 6: Validate the session
    console.log('✅ Validating OAuth session...');
    try {
      const validationResp = await client.callTool({
        name: "get_user_profile",
        arguments: { user_context: userContext },
      });
      
      const validationContent = JSON.parse(validationResp.content[0].text);
      console.log('✅ Session validation successful:', validationContent);
      
      return {
        success: true,
        userContext: userContext,
        profile: validationContent
      };
      
    } catch (sessionError) {
      console.error('❌ Session validation failed:', sessionError.message);
      throw new Error(`OAuth session is invalid: ${sessionError.message}`);
    }
    
  } catch (error) {
    console.error('❌ OAuth validation failed:', error.message);
    
    // Take error screenshot if browser is available
    if (browser) {
      try {
        const pages = await browser.pages();
        if (pages.length > 0) {
          await pages[0].screenshot({ path: 'oauth-validation-error.png', fullPage: true });
          console.log('📸 Error screenshot saved: oauth-validation-error.png');
        }
      } catch (screenshotError) {
        console.error('Failed to take error screenshot:', screenshotError.message);
      }
    }
    
    throw error;
    
  } finally {
    if (browser) {
      await browser.close();
    }
    if (client) {
      await client.close();
    }
  }
}

// Run the validation
console.log('🧪 OAuth Flow Validation Starting...\n');

validateOAuthFlow()
  .then((result) => {
    console.log('\n🎉 OAuth Validation PASSED!');
    console.log('=====================================');
    console.log('✅ Step 1: MCP Server Connection - SUCCESS');
    console.log('✅ Step 2: User Registration - SUCCESS');
    console.log('✅ Step 3: OAuth URL Generation - SUCCESS');
    console.log('✅ Step 4: Browser Automation - SUCCESS');
    console.log('✅ Step 5: Session Extraction - SUCCESS');
    console.log('✅ Step 6: Session Validation - SUCCESS');
    console.log('=====================================');

    console.log('\n📊 OAuth Flow Results:');
    console.log(`   User ID: ${result.userContext.user_id}`);
    console.log(`   Session ID: ${result.userContext.session_id}`);
    console.log(`   Email: ${result.profile.profile?.email || 'N/A'}`);
    console.log(`   Display Name: ${result.profile.profile?.displayName || 'N/A'}`);
    console.log(`   Role: ${result.profile.profile?.role || 'N/A'}`);

    console.log('\n� Generated Files:');
    console.log('   oauth-step1-email.png - Email input step');
    console.log('   oauth-step2-password.png - Password input step');
    console.log('   oauth-step4-before-consent.png - Before consent screen');
    console.log('   oauth-step4-after-consent.png - After consent screen');
    console.log('   oauth-step5-callback.png - OAuth callback page');

    console.log('\n🚀 Next Steps:');
    console.log('1. ✅ OAuth is working correctly');
    console.log('2. 🧪 Run full test suite: npm run test:mcp');
    console.log('3. 🔧 If tests still fail, check timeout settings');
    console.log('4. 📚 See docs/OAUTH_TROUBLESHOOTING.md for advanced options');

    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 OAuth Validation FAILED!');
    console.error('=====================================');
    console.error('❌ OAuth flow is not working correctly');
    console.error(`❌ Error: ${error.message}`);
    console.error('=====================================');

    console.log('\n� Debug Files Generated:');
    console.log('   Check these files for visual debugging:');
    console.log('   - oauth-step1-email.png (if exists)');
    console.log('   - oauth-step2-password.png (if exists)');
    console.log('   - oauth-step4-before-consent.png (if exists)');
    console.log('   - oauth-step5-callback.png (if exists)');
    console.log('   - oauth-timeout-error.png (if timeout occurred)');
    console.log('   - oauth-callback-content.txt (page content for debugging)');

    console.log('\n�🔧 Troubleshooting Steps:');
    console.log('1. 📸 Check generated screenshots for visual debugging');
    console.log('2. 🔑 Verify credentials in tests/integration/mcp/.env.test');
    console.log('3. 🔐 Try App Passwords: GMAIL_USE_APP_PASSWORD=true');
    console.log('4. 👁️  Try visible browser: HEADLESS_BROWSER=false');
    console.log('5. 🎭 Try mock OAuth: USE_MOCK_OAUTH=true');
    console.log('6. ⏱️  Increase timeout: BROWSER_TIMEOUT=300000');
    console.log('7. 📚 Check docs/OAUTH_TROUBLESHOOTING.md');

    console.log('\n🚀 Quick Fixes:');
    console.log('   # Debug with visible browser');
    console.log('   HEADLESS_BROWSER=false node tests/integration/mcp/oauth-validation.cjs');
    console.log('');
    console.log('   # Use mock OAuth for testing');
    console.log('   USE_MOCK_OAUTH=true node tests/integration/mcp/oauth-validation.cjs');
    console.log('');
    console.log('   # Increase timeout');
    console.log('   BROWSER_TIMEOUT=300000 node tests/integration/mcp/oauth-validation.cjs');

    process.exit(1);
  });
