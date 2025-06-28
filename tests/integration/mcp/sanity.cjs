const path = require('path');
const os = require('os');
const puppeteer = require('puppeteer');


const newUserDataDir = path.join(os.tmpdir(), 'puppeteer_profile'); // Or a more permanent location

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    userDataDir: newUserDataDir,
    slowMo: 100,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      // ... other args
    ],
  });
  const page = await browser.newPage();
  await page.goto('https://www.google.com'); // Or your target URL

  // Perform your automation here
  // ...

  // await browser.close(); // Close when done
})();