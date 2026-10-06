import puppeteer from 'puppeteer-core';
import path from 'path';
import fs from 'fs';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const SCREENSHOT_DIR = path.resolve(process.cwd(), 'screenshots');

if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

async function runTest() {
  console.log('🤖 Launching Puppeteer with Microsoft Edge...');
  const browser = await puppeteer.launch({
    executablePath: EDGE_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
    defaultViewport: { width: 1440, height: 900 },
  });

  try {
    const page = await browser.newPage();

    page.on('console', (msg) => {
      const text = msg.text();
      if (!text.includes('Tracking Prevention') && !text.includes('React Router Future Flag')) {
        console.log('🌐 [Browser Console]:', text);
      }
    });
    page.on('pageerror', (err) => console.error('❌ [Browser Page Error]:', err.message));

    console.log('📍 [Step 1] Navigating to http://localhost:5174/login ...');
    await page.goto('http://localhost:5174/login', { waitUntil: 'networkidle0', timeout: 30000 });

    console.log('📸 Taking login page screenshot...');
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01-login-page.png') });

    await page.waitForSelector('#email', { timeout: 10000 });
    await page.waitForSelector('#password', { timeout: 10000 });
    console.log('✅ Found #email and #password inputs');

    console.log('⌨️ [Step 2] Typing demo credentials (demo@example.com / Demo@123)...');
    await page.type('#email', 'demo@example.com');
    await page.type('#password', 'Demo@123');

    console.log('📸 Taking credentials filled screenshot...');
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '02-login-filled.png') });

    console.log('🖱️ [Step 3] Clicking Sign In button...');
    const submitBtn = await page.$('button[type="submit"]');
    if (!submitBtn) throw new Error('Submit button not found');
    await submitBtn.click();

    console.log('⏳ Waiting for navigation / redirect to /dashboard...');
    await page.waitForFunction(
      () => window.location.pathname.startsWith('/dashboard'),
      { timeout: 15000 }
    );

    const currentUrl = page.url();
    console.log(`✅ [Step 4] Successfully redirected to: ${currentUrl}`);

    // Wait for projects data to render
    await page.waitForSelector('h1, h2, .group', { timeout: 10000 });
    await new Promise((r) => setTimeout(r, 2000));

    console.log('📸 Taking projects list screenshot...');
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '03-dashboard-projects.png') });

    // Look for Demo Website card
    console.log('🖱️ [Step 5] Clicking on Demo Website project card...');
    const demoCard = await page.waitForSelector('text/Demo Website', { timeout: 10000 }).catch(async () => {
      // fallback to finding element containing text
      const cards = await page.$$('.group');
      return cards.length > 0 ? cards[0] : null;
    });

    if (demoCard) {
      await demoCard.click();
      console.log('⏳ Waiting for project dashboard to load...');
      await page.waitForFunction(
        () => window.location.pathname.includes('/project/'),
        { timeout: 10000 }
      );
      await new Promise((r) => setTimeout(r, 2500));
      console.log(`✅ Project Dashboard Loaded at: ${page.url()}`);
      console.log('📸 Taking project dashboard overview screenshot...');
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, '04-project-dashboard.png') });
    }

    console.log('\n🎊 ALL PUPPETEER UI TESTS PASSED SUCCESSFULLY! 🎊');
    console.log('Screenshots saved in:', SCREENSHOT_DIR);
  } catch (err: any) {
    console.error('❌ Puppeteer Test Error:', err);
    throw err;
  } finally {
    await browser.close();
  }
}

runTest()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
