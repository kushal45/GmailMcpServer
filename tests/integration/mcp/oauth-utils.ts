import puppeteer from 'puppeteer';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

// Wait helper function
async function waitFor(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Generic OAuth Flow Handler - Handles any number of steps intelligently
export async function handleGenericOAuthFlow(page: any, email: string, password: string, maxSteps = 20, timeoutPerStep = 30000) {
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
async function analyzeOAuthPage(page: any) {
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
      
      const buttons = [...document.querySelectorAll('button, input[type="submit"], [role="button"]')].map(btn => {
        const element = btn as any;
        return {
          tagName: element.tagName,
          type: element.type,
          text: (element.textContent || element.innerText || element.value || '').trim(),
          className: element.className,
          id: element.id,
          visible: element.offsetWidth > 0 && element.offsetHeight > 0
        };
      });
      
      const links = [...document.querySelectorAll('a[href]')].map(link => {
        const element = link as any;
        return {
          text: (element.textContent || element.innerText || '').trim(),
          href: element.href,
          visible: element.offsetWidth > 0 && element.offsetHeight > 0
        };
      });
      
      // Determine page type based on content analysis
      let pageType = 'unknown';
      let confidence = 0;
      let suggestedAction = 'none';
      let actionTarget: any = null;
      
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
async function executeOAuthAction(page: any, analysis: any, email: string, password: string) {
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
async function handleEmailInput(page: any, email: string, analysis: any) {
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

async function handlePasswordInput(page: any, password: string, analysis: any) {
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

async function handle2FA(page: any, analysis: any) {
  try {
    console.log('🔐 2FA detected - skipping (manual intervention required)');
    return { success: false, action: 'handle_2fa', error: '2FA requires manual intervention', expectsNavigation: false };
  } catch (error) {
    return { success: false, action: 'handle_2fa', error: error.message, expectsNavigation: false };
  }
}

// Helper function to handle unverified app warning
async function handleUnverifiedAppWarning(page: any) {
  console.log('🔍 Checking for unverified app warning...');

  try {
    // Wait for page to load
    await waitFor(2000);

    // Check if we're on an unverified app warning page
    const pageContent = await page.content();
    const hasWarning = pageContent.includes('unverified') ||
                      pageContent.includes('unsafe') ||
                      pageContent.includes('Go to') ||
                      pageContent.includes('Advanced');

    if (!hasWarning) {
      console.log('✅ No unverified app warning detected');
      return;
    }

    console.log('⚠️  Detected warning: "Go to Kratos (unsafe)"');

    // Take screenshot for debugging
    await page.screenshot({ path: 'oauth-unverified-warning.png' });
    console.log('📸 Screenshot saved: oauth-unverified-warning.png');

    // Look for Advanced button/link
    const advancedSelectors = [
      'a:contains("Advanced")',
      'button:contains("Advanced")',
      '[href*="Advanced"]',
      'a[href="#"]'
    ];

    let advancedClicked = false;

    for (const selector of advancedSelectors) {
      try {
        const advancedElement = await page.$(selector);
        if (advancedElement) {
          const text = await page.evaluate(el => el.textContent, advancedElement);
          if (text && text.toLowerCase().includes('advanced')) {
            console.log(`✅ Clicking Advanced button: text=${text}`);
            await advancedElement.click();
            advancedClicked = true;
            break;
          }
        }
      } catch (e) {
        // Continue to next selector
      }
    }

    if (!advancedClicked) {
      // Try clicking any link with "Advanced" text
      const clicked = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a, button, [role="button"]'));
        for (const link of links) {
          // Use HTMLElement assertion for innerText
          const text = (link.textContent || (link as HTMLElement).innerText || '') as string;
          if (text.toLowerCase().includes('advanced')) {
            (link as HTMLElement).click();
            return text;
          }
        }
        return false;
      });

      if (clicked) {
        console.log(`✅ Clicked Advanced via evaluate: ${clicked}`);
        advancedClicked = true;
      }
    }

    if (advancedClicked) {
      // Wait for the "Go to" link to appear
      await waitFor(2000);

      // Look for "Go to" or "unsafe" link
      const continueSelectors = [
        'a:contains("Go to")',
        'a:contains("unsafe")',
        'a:contains("Continue")',
        '[href*="unsafe"]'
      ];

      let continueClicked = false;

      for (const selector of continueSelectors) {
        try {
          const continueElement = await page.$(selector);
          if (continueElement) {
            const text = await page.evaluate(el => el.textContent, continueElement);
            if (text && (text.toLowerCase().includes('go to') || text.toLowerCase().includes('unsafe') || text.toLowerCase().includes('continue'))) {
              console.log(`✅ Clicking continue button: text=${text}`);
              await continueElement.click();
              continueClicked = true;
              break;
            }
          }
        } catch (e) {
          // Continue to next selector
        }
      }

      if (!continueClicked) {
        // Try clicking any link with "Go to" or "unsafe" text
        const clicked = await page.evaluate(() => {
          const links = Array.from(document.querySelectorAll('a, button, [role="button"]'));
          for (const link of links) {
            // Use HTMLElement assertion for innerText
            const text = (link.textContent || (link as HTMLElement).innerText || '') as string;
            if (text.toLowerCase().includes('go to') || text.toLowerCase().includes('unsafe') || text.toLowerCase().includes('continue')) {
              (link as HTMLElement).click();
              return text;
            }
          }
          return false;
        });

        if (clicked) {
          console.log(`✅ Clicked continue via evaluate: ${clicked}`);
          continueClicked = true;
        }
      }

      if (continueClicked) {
        console.log('✅ Successfully handled unverified app warning');
        await waitFor(3000); // Wait for navigation
      } else {
        console.log('⚠️  Could not find continue link after clicking Advanced');
      }
    } else {
      console.log('⚠️  Could not find Advanced button');
    }

  } catch (error) {
    console.error('❌ Error handling unverified app warning:', error.message);
    throw error;
  }
}

async function handleButtonClick(page: any, analysis: any) {
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

      // Method 2: Text-based selector (skip due to Puppeteer limitations)
      async () => {
        throw new Error('Text selector not supported in Puppeteer');
      },

      // Method 3: Generic button click with evaluation
      async () => {
        const clicked = await page.evaluate((buttonText) => {
          const buttons = [...document.querySelectorAll('button, input[type="submit"], [role="button"]')];
          for (const btn of buttons) {
            const text = (btn.textContent || (btn as HTMLElement).innerText || (btn as HTMLInputElement).value || '').trim();
            if (text === buttonText && (btn as HTMLElement).offsetWidth > 0 && (btn as HTMLElement).offsetHeight > 0) {
              (btn as HTMLElement).click();
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
            if (!focused) return '';
            const elem = focused as HTMLElement;
            let text = '';
            if ('value' in elem && typeof (elem as any).value === 'string') {
              text = (elem.textContent || (elem as any).innerText || (elem as any).value || '').trim();
            } else {
              text = (elem.textContent || (elem as any).innerText || '').trim();
            }
            return text;
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
async function tryGenericActions(page: any, analysis: any) {
  try {
    console.log('🔄 Trying generic actions');

    // Try clicking any visible submit/continue button
    const actionButtons = analysis.buttons.filter((btn: any) =>
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

async function tryGenericFallbacks(page: any) {
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

            const text = (focused.textContent || (focused as HTMLElement).innerText || (focused as HTMLInputElement).value || '').trim().toLowerCase();
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
          const visibleButtons = buttons.filter(btn => {
            const elem = btn as HTMLElement;
            return elem.offsetWidth > 0 && elem.offsetHeight > 0;
          });

          if (visibleButtons.length > 0) {
            (visibleButtons[0] as HTMLElement).click();
            return visibleButtons[0].textContent || (visibleButtons[0] as any).value || 'Unknown button';
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

async function handleStuckPage(page: any) {
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
          const clickableElements = [...document.querySelectorAll('*')].filter(el => {
            const elem = el as HTMLElement;
            return (typeof elem.onclick === 'function' ||
              elem.getAttribute('role') === 'button' ||
              elem.tagName === 'BUTTON' ||
              elem.tagName === 'A' ||
              (elem.style && elem.style.cursor === 'pointer'));
          });

          for (const element of clickableElements) {
            const elem = element as HTMLElement;
            if (elem.offsetWidth > 0 && elem.offsetHeight > 0) {
              try {
                elem.click();
                return elem.textContent || elem.tagName;
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

async function checkForSuccessIndicators(page: any) {
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

// Robust user context extraction from OAuth callback page
export async function extractUserContextFromCallback(page: any): Promise<{ user_id: string; session_id: string }> {
  console.info("🔍 Attempting user context extraction...");

  // Strategy 1: Look for standard paragraph elements with session/user ID text
  try {
    console.info("📄 Strategy 1 (Paragraph Elements): Searching...");
    const contextFromParagraphs = await page.evaluate(() => {
      const sessionIdText = Array.from(document.querySelectorAll("p")).find(
        (p) => p.textContent?.includes("session ID")
      )?.textContent;
      const userIdText = Array.from(document.querySelectorAll("p")).find(
        (p) => p.textContent?.includes("user ID")
      )?.textContent;

      const session_id = sessionIdText?.split("session ID is ")[1]?.trim();
      const user_id = userIdText?.split("user ID is ")[1]?.trim();

      return { user_id, session_id, sessionIdText, userIdText };
    });

    console.info("📄 Strategy 1 result:", contextFromParagraphs);

    if (contextFromParagraphs.user_id && contextFromParagraphs.session_id) {
      console.info("✅ Strategy 1 (Paragraph Elements): SUCCESS");
      return {
        user_id: contextFromParagraphs.user_id,
        session_id: contextFromParagraphs.session_id
      };
    } else {
      console.info("❌ Strategy 1 (Paragraph Elements): FAILED");
    }
  } catch (error) {
    console.warn("❌ Strategy 1 (Paragraph Elements): FAILED -", error.message);
  }

  // Strategy 2: Look for any element containing session/user ID
  try {
    console.info("🔍 Strategy 2 (Any Elements): Searching...");
    const contextFromAnyElement = await page.evaluate(() => {
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

      let session_id: string | null = null;
      let user_id: string | null = null;

      if (sessionElement?.textContent) {
        const sessionText = sessionElement.textContent;
        session_id = sessionText.match(/session[_\s]?ID[:\s]+([a-zA-Z0-9-]+)/i)?.[1] ||
                    sessionText.match(/sessionId[:\s]+([a-zA-Z0-9-]+)/i)?.[1] ||
                    sessionText.split("session ID is ")[1]?.trim() || null;
      }

      if (userElement?.textContent) {
        const userText = userElement.textContent;
        user_id = userText.match(/user[_\s]?ID[:\s]+([a-zA-Z0-9-]+)/i)?.[1] ||
                 userText.match(/userId[:\s]+([a-zA-Z0-9-]+)/i)?.[1] ||
                 userText.split("user ID is ")[1]?.trim() || null;
      }

      return {
        user_id,
        session_id,
        sessionText: sessionElement?.textContent,
        userText: userElement?.textContent
      };
    });

    console.info("🔍 Strategy 2 result:", contextFromAnyElement);

    if (contextFromAnyElement.user_id && contextFromAnyElement.session_id) {
      console.info("✅ Strategy 2 (Any Elements): SUCCESS");
      return {
        user_id: contextFromAnyElement.user_id,
        session_id: contextFromAnyElement.session_id
      };
    } else {
      console.info("❌ Strategy 2 (Any Elements): FAILED");
    }
  } catch (error) {
    console.warn("❌ Strategy 2 (Any Elements): FAILED -", error.message);
  }

  // Strategy 3: Look for JSON data or script tags
  try {
    console.info("📜 Strategy 3 (Script Tags): Searching...");
    const contextFromJson = await page.evaluate(() => {
      // Look for script tags that might contain user context
      const scripts = Array.from(document.querySelectorAll("script"));
      for (const script of scripts) {
        if (script.textContent) {
          try {
            // Try to find JSON-like data
            const jsonMatch = script.textContent.match(/\{[^}]*(?:user_?id|session_?id)[^}]*\}/gi);
            if (jsonMatch) {
              for (const match of jsonMatch) {
                const parsed = JSON.parse(match);
                if (parsed.user_id && parsed.session_id) {
                  return parsed;
                }
                if (parsed.userId && parsed.sessionId) {
                  return { user_id: parsed.userId, session_id: parsed.sessionId };
                }
              }
            }
          } catch (e) {
            // Continue to next script
          }
        }
      }

      // Look for data attributes
      const elementsWithData = Array.from(document.querySelectorAll("[data-user-id], [data-session-id]"));
      if (elementsWithData.length > 0) {
        const userIdEl = document.querySelector("[data-user-id]");
        const sessionIdEl = document.querySelector("[data-session-id]");

        return {
          user_id: userIdEl?.getAttribute("data-user-id"),
          session_id: sessionIdEl?.getAttribute("data-session-id")
        };
      }

      return null;
    });

    console.info("📜 Strategy 3 result:", contextFromJson);

    if (contextFromJson?.user_id && contextFromJson?.session_id) {
      console.info("✅ Strategy 3 (Script Tags): SUCCESS");
      return {
        user_id: contextFromJson.user_id,
        session_id: contextFromJson.session_id
      };
    } else {
      console.info("❌ Strategy 3 (Script Tags): FAILED");
    }
  } catch (error) {
    console.warn("❌ Strategy 3 (Script Tags): FAILED -", error.message);
  }

  // Strategy 4: Get page content for debugging and try regex extraction
  try {
    console.info("🔍 Strategy 4 (Data Attributes): Searching...");
    const pageContent = await page.evaluate(() => {
      return {
        title: document.title,
        url: window.location.href,
        bodyText: document.body?.textContent?.substring(0, 1000),
        innerHTML: document.body?.innerHTML?.substring(0, 2000)
      };
    });

    console.info("🔍 Strategy 4 page content:", pageContent);

    // Try to extract from body text using regex
    const bodyText = pageContent.bodyText || "";
    const sessionMatch = bodyText.match(/session[_\s]?ID[:\s]+([a-zA-Z0-9-]+)/i);
    const userMatch = bodyText.match(/user[_\s]?ID[:\s]+([a-zA-Z0-9-]+)/i);

    if (sessionMatch && userMatch) {
      console.info("✅ Strategy 4 (Data Attributes): SUCCESS");
      return {
        user_id: userMatch[1],
        session_id: sessionMatch[1]
      };
    } else {
      console.info("❌ Strategy 4 (Data Attributes): FAILED");
    }
  } catch (error) {
    console.warn("❌ Strategy 4 (Data Attributes): FAILED -", error.message);
  }

  // All strategies failed
  console.error("❌ Failed to extract user context from OAuth callback page using all available strategies");
  throw new Error("Failed to extract user_id and session_id from callback page");
}

// Main OAuth automation function that combines everything
export async function performOAuthAuthentication(
  authUrl: string,
  email: string,
  password: string,
  options: {
    headless?: boolean;
    timeout?: number;
    retryAttempts?: number;
    retryDelay?: number;
    captureScreenshots?: boolean;
    useAppPassword?: boolean;
  } = {}
): Promise<{ user_id: string; session_id: string }> {

  const {
    headless = true,
    timeout = 180000,
    retryAttempts = 2,
    retryDelay = 5000,
    captureScreenshots = false,
    useAppPassword = false
  } = options;

  console.info(`🚀 Starting OAuth authentication for ${email}`);
  console.info(`   Headless: ${headless}`);
  console.info(`   Timeout: ${timeout}ms`);
  console.info(`   Retry Attempts: ${retryAttempts}`);
  console.info(`   Use App Password: ${useAppPassword}`);

  let oauthAttempt = 0;

  while (oauthAttempt < retryAttempts) {
    oauthAttempt++;
    console.info(`\n🔐 OAuth attempt ${oauthAttempt}/${retryAttempts} - Starting browser automation...`);
    const attemptStartTime = Date.now();

    try {
      const randomUUID = crypto.randomUUID();
      const newUserDataDir = path.join(
        `${os.tmpdir()}-${randomUUID}`,
        "puppeteer_profile"
      );

      const browser = await puppeteer.launch({
        headless: headless,
        executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        userDataDir: newUserDataDir,
        slowMo: 50,
        args: [
          "--disable-blink-features=AutomationControlled",
          "--disable-infobars",
          "--disable-web-security",
          "--disable-features=VizDisplayCompositor",
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--disable-background-timer-throttling",
          "--disable-backgrounding-occluded-windows",
          "--disable-renderer-backgrounding",
          "--disable-features=TranslateUI",
          "--disable-ipc-flooding-protection",
        ],
      });

      const page = await browser.newPage();

      // Set user agent to avoid detection
      await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

      console.info("🌐 Navigating to OAuth URL:", authUrl);
      await page.goto(authUrl, { waitUntil: "networkidle0" });

      // Use the generic OAuth flow handler
      console.info("🚀 Using Generic OAuth Flow Handler");
      const result = await handleGenericOAuthFlow(page, email, password, 25, 30000);

      if (result.success) {
        console.info(`✅ Generic OAuth flow completed successfully in ${result.steps} steps`);
        console.info(`🔍 Final URL: ${result.finalUrl}`);

        // Wait for the OAuth flow to finish and redirect to callback
        console.info("⏳ Waiting for OAuth callback redirect...");
        await page.waitForFunction(
          'window.location.pathname.includes("/oauth2callback")',
          { timeout: timeout }
        );

        console.info("✅ OAuth callback reached, extracting session data...");

        // Wait for the page to fully load
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Take a screenshot for debugging if enabled
        if (captureScreenshots) {
          await page.screenshot({
            path: 'oauth-callback-page.png',
            fullPage: true
          });
          console.info("📸 Screenshot saved: oauth-callback-page.png");
        }

        // Extract user context with multiple fallback strategies
        const userContext = await extractUserContextFromCallback(page);

        // Validate extracted user context
        if (!userContext.user_id || !userContext.session_id) {
          throw new Error(`Failed to extract valid user context. Got: ${JSON.stringify(userContext)}`);
        }

        console.info("✅ Successfully extracted user context:", userContext);
        await browser.close();

        const attemptDuration = Date.now() - attemptStartTime;
        console.info(`✅ OAuth flow completed successfully in ${attemptDuration}ms`);

        return userContext;

      } else {
        throw new Error(`Generic OAuth flow failed after ${result.steps} steps: ${result.error}`);
      }

    } catch (error) {
      console.error("❌ Error in automated OAuth flow:", error);

      // Provide helpful debugging information
      console.error(`
        OAuth automation failed. This could be due to:
        1. Incorrect email/password credentials
        2. 2FA enabled without App Password
        3. Google security measures blocking automation
        4. Network connectivity issues
        5. Changes in Google's OAuth UI
        6. OAuth callback page format changed

        Debugging tips:
        - Set headless=false to see what's happening
        - Use App Passwords instead of regular passwords
        - Check if your account has 2FA enabled
        - Verify the credentials are correct
        - Check the oauth-error-screenshot.png file if generated
        - Check oauth-callback-page.png for callback page content
      `);

      // Check if we should use a fallback/mock session for testing
      if (process.env.USE_MOCK_OAUTH === 'true' || process.env.SKIP_OAUTH_ON_TIMEOUT === 'true') {
        console.warn("🔄 Using mock OAuth session for testing...");
        const mockUserContext = {
          user_id: `mock_user_${Date.now()}`,
          session_id: `mock_session_${Date.now()}`
        };
        console.info("Mock user context:", mockUserContext);
        return mockUserContext;
      } else {
        // If this is not the last attempt, wait before retrying
        if (oauthAttempt < retryAttempts) {
          console.info(`Waiting ${retryDelay}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          continue;
        } else {
          // On final failure, offer to use mock OAuth
          console.error("❌ All OAuth attempts failed. Consider setting USE_MOCK_OAUTH=true for testing.");
          throw error;
        }
      }
    }
  }

  throw new Error("OAuth authentication failed after all retry attempts");
}
