import puppeteer from 'puppeteer-core';
import fs from 'fs';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE_URL = 'http://localhost:5174';

interface RouteResult {
  route: string;
  name: string;
  status: 'PASS' | 'WARN' | 'FAIL';
  title?: string;
  pageErrors: string[];
  consoleErrors: string[];
  failedRequests: { url: string; status: number; statusText: string }[];
  buttonsCount?: number;
  notes?: string;
}

const results: RouteResult[] = [];

async function runComprehensiveTest() {
  console.log('🚀 Starting Comprehensive CMS Frontend & API End-to-End Test...\n');

  const browser = await puppeteer.launch({
    executablePath: EDGE_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
    defaultViewport: { width: 1440, height: 900 },
  });

  const page = await browser.newPage();

  let currentPageErrors: string[] = [];
  let currentConsoleErrors: string[] = [];
  let currentFailedRequests: { url: string; status: number; statusText: string }[] = [];

  page.on('pageerror', (err) => {
    currentPageErrors.push(err.message);
  });

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (!text.includes('Tracking Prevention') && !text.includes('favicon.ico')) {
        currentConsoleErrors.push(text);
      }
    }
  });

  page.on('response', (res) => {
    const status = res.status();
    const url = res.url();
    if (status >= 400 && !url.includes('favicon.ico')) {
      currentFailedRequests.push({
        url,
        status,
        statusText: res.statusText(),
      });
    }
  });

  function resetTracker() {
    currentPageErrors = [];
    currentConsoleErrors = [];
    currentFailedRequests = [];
  }

  try {
    // 1. LOGIN
    console.log('🔑 [Auth] Testing Login...');
    resetTracker();
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle2', timeout: 25000 });

    await page.waitForSelector('#email', { timeout: 10000 });
    await page.type('#email', 'demo@example.com');
    await page.type('#password', 'Demo@123');

    const submitBtn = await page.$('button[type="submit"]');
    if (submitBtn) await submitBtn.click();

    await page.waitForFunction(
      () => window.location.pathname.startsWith('/dashboard') || window.location.pathname.startsWith('/onboarding'),
      { timeout: 15000 }
    );
    console.log('✅ Logged in successfully. Current URL:', page.url());

    // 2. EXTRACT OR CREATE PROJECT
    await page.goto(`${BASE_URL}/dashboard`, { waitUntil: 'networkidle2', timeout: 20000 });
    await new Promise((r) => setTimeout(r, 1500));

    const authData = await page.evaluate(async () => {
      const storage = localStorage.getItem('cms-auth-storage') || localStorage.getItem('auth-storage');
      let token = '';
      let curProj: any = null;
      if (storage) {
        try {
          const parsed = JSON.parse(storage);
          token = parsed.state?.accessToken;
          curProj = parsed.state?.currentProject;
        } catch (e) {}
      }

      let projects: any[] = [];
      try {
        const res = await fetch('/api/v1/projects', {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const data = await res.json();
        projects = data.data?.projects || data.data || [];
      } catch (e) {}

      if ((!projects || projects.length === 0) && curProj) {
        projects = [curProj];
      }

      if (!projects || projects.length === 0) {
        try {
          const createRes = await fetch('/api/v1/projects', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({
              name: 'Demo Website',
              slug: 'demo-website-' + Date.now(),
              description: 'Automated test project for launch readiness',
            }),
          });
          const created = await createRes.json();
          if (created.data?.project) {
            projects = [created.data.project];
          }
        } catch (e) {}
      }

      return { token, projects };
    });

    let projectId = '';
    if (authData.projects && authData.projects.length > 0) {
      projectId = authData.projects[0]._id || authData.projects[0].id;
      console.log(`🎯 Active Project identified: ${authData.projects[0].name} (ID: ${projectId})\n`);
    } else {
      console.log('⚠️ Could not resolve project. Project-specific routes will be skipped.\n');
    }

    // LIST OF ALL CMS ROUTES TO TEST
    const routesToTest = [
      { name: 'Dashboard / Projects Hub', path: '/dashboard' },
      { name: 'Onboarding Wizard', path: '/onboarding' },
      { name: 'Billing & Usage', path: '/dashboard/billing' },
      { name: 'Pricing & Plans', path: '/dashboard/pricing' },
      { name: 'Support Page', path: '/dashboard/support' },

      // Project routes
      ...(projectId
        ? [
            { name: 'Project Overview & API Playground', path: `/dashboard/project/${projectId}` },
            { name: 'Content Types List', path: `/dashboard/project/${projectId}/content-types` },
            { name: 'Content Type Builder (New)', path: `/dashboard/project/${projectId}/content-types/new` },
            { name: 'Dynamic Content (Header)', path: `/dashboard/project/${projectId}/content/header` },
            { name: 'Dynamic Content (Blog)', path: `/dashboard/project/${projectId}/content/blog` },
            { name: 'Dynamic Content Editor (Blog New)', path: `/dashboard/project/${projectId}/content/blog/new` },
            { name: 'Media Library', path: `/dashboard/project/${projectId}/media` },
            { name: 'SEO Dashboard', path: `/dashboard/project/${projectId}/seo` },
            { name: 'SEO Site Audit', path: `/dashboard/project/${projectId}/seo/audit` },
            { name: 'SEO Keyword Tracker', path: `/dashboard/project/${projectId}/seo/keywords` },
            { name: 'SEO Sitemap Config', path: `/dashboard/project/${projectId}/seo/sitemap` },
            { name: 'SEO Robots.txt Editor', path: `/dashboard/project/${projectId}/seo/robots` },
            { name: 'SEO Schema Builder', path: `/dashboard/project/${projectId}/seo/schema` },
            { name: 'RAG Bot List', path: `/dashboard/project/${projectId}/rag-bots` },
            { name: 'RAG Bot Builder (New)', path: `/dashboard/project/${projectId}/rag-bots/new` },
            { name: 'API Keys Management', path: `/dashboard/project/${projectId}/api-keys` },
            { name: 'Webhooks Management', path: `/dashboard/project/${projectId}/webhooks` },
            { name: 'Webhook Execution Logs', path: `/dashboard/project/${projectId}/webhooks/logs` },
            { name: 'Workflows List', path: `/dashboard/project/${projectId}/workflows` },
            { name: 'Workflow Builder (ReactFlow)', path: `/dashboard/project/${projectId}/workflows/new` },
            { name: 'Content Calendar', path: `/dashboard/project/${projectId}/calendar` },
            { name: 'Content Scheduling', path: `/dashboard/project/${projectId}/schedules` },
            { name: 'Localization & Languages', path: `/dashboard/project/${projectId}/locales` },
            { name: 'Import & Export Hub', path: `/dashboard/project/${projectId}/import-export` },
            { name: 'Database Backups', path: `/dashboard/project/${projectId}/backup` },
            { name: 'Content Archive', path: `/dashboard/project/${projectId}/archive` },
            { name: 'Trash & Soft-Deletes', path: `/dashboard/project/${projectId}/trash` },
            { name: 'Team Members', path: `/dashboard/project/${projectId}/team` },
            { name: 'Roles & RBAC Permissions', path: `/dashboard/project/${projectId}/team/roles` },
            { name: 'Email Notification Templates', path: `/dashboard/project/${projectId}/email-templates` },
            { name: 'Project Settings', path: `/dashboard/project/${projectId}/settings` },
          ]
        : []),

      // Super Admin Routes
      { name: 'Super Admin: System Overview', path: '/admin/system' },
      { name: 'Super Admin: Platform Error Logs', path: '/admin/system/errors' },
      { name: 'Super Admin: Coupon Engine', path: '/admin/system/coupons' },
      { name: 'Super Admin: Tenants Management', path: '/admin/system/tenants' },
      { name: 'Super Admin: Platform Users', path: '/admin/system/users' },
      { name: 'Super Admin: Global Audit Trail', path: '/admin/system/audit' },
    ];

    // TEST EACH ROUTE
    for (const r of routesToTest) {
      process.stdout.write(`Testing [${r.name}] (${r.path})... `);
      resetTracker();

      try {
        await page.goto(`${BASE_URL}${r.path}`, { waitUntil: 'networkidle2', timeout: 15000 });
        await new Promise((resolve) => setTimeout(resolve, 800));

        const pageInfo = await page.evaluate(() => {
          const h1 = document.querySelector('h1');
          const h2 = document.querySelector('h2');
          const title = h1?.innerText.trim() || h2?.innerText.trim() || document.title || '';
          const buttons = Array.from(document.querySelectorAll('button')).map((b) => ({
            text: b.innerText.trim(),
            disabled: b.disabled,
          }));
          return { title, buttonsCount: buttons.length };
        });

        // Interactive button test on Project Overview
        let extraNotes = '';
        if (r.path === `/dashboard/project/${projectId}`) {
          try {
            await page.evaluate(() => {
              const buttons = Array.from(document.querySelectorAll('button'));
              const testBtn = buttons.find((b) => b.innerText.includes('Test'));
              if (testBtn) testBtn.click();
            });
            await new Promise((resolve) => setTimeout(resolve, 1000));
            extraNotes += 'Triggered live API test; ';
          } catch (e) {}
        }

        const isFail = currentPageErrors.length > 0 || currentFailedRequests.some((req) => req.status >= 500);
        const isWarn = !isFail && (currentConsoleErrors.length > 0 || currentFailedRequests.length > 0);

        const status = isFail ? 'FAIL' : isWarn ? 'WARN' : 'PASS';

        results.push({
          route: r.path,
          name: r.name,
          status,
          title: pageInfo.title,
          buttonsCount: pageInfo.buttonsCount,
          pageErrors: [...currentPageErrors],
          consoleErrors: [...currentConsoleErrors],
          failedRequests: [...currentFailedRequests],
          notes: extraNotes || undefined,
        });

        if (status === 'PASS') {
          console.log(`✅ PASS (Buttons: ${pageInfo.buttonsCount})`);
        } else if (status === 'WARN') {
          console.log(`⚠️ WARN (Failed APIs: ${currentFailedRequests.length}, Console errs: ${currentConsoleErrors.length})`);
        } else {
          console.log(`❌ FAIL (Page errs: ${currentPageErrors.length}, 500s: ${currentFailedRequests.filter((f) => f.status >= 500).length})`);
        }
      } catch (err: any) {
        console.log(`❌ CRASH: ${err.message}`);
        results.push({
          route: r.path,
          name: r.name,
          status: 'FAIL',
          pageErrors: [err.message],
          consoleErrors: [...currentConsoleErrors],
          failedRequests: [...currentFailedRequests],
        });
      }
    }

    // WRITE REPORT TO ARTIFACT
    const reportPath = 'C:\\Users\\Rohit\\.gemini\\antigravity-ide\\brain\\76dc6492-f236-471d-abe0-063e1e1db0fd\\frontend_api_test_report.json';
    fs.writeFileSync(reportPath, JSON.stringify(results, null, 2), 'utf8');

    // SUMMARY METRICS
    const total = results.length;
    const passed = results.filter((r) => r.status === 'PASS').length;
    const warned = results.filter((r) => r.status === 'WARN').length;
    const failed = results.filter((r) => r.status === 'FAIL').length;

    console.log('\n======================================================');
    console.log(`TOTAL ROUTES TESTED: ${total}`);
    console.log(`✅ PASSED: ${passed}`);
    console.log(`⚠️ WARNINGS: ${warned}`);
    console.log(`❌ FAILED: ${failed}`);
    console.log('======================================================\n');
  } catch (err) {
    console.error('Fatal test error:', err);
  } finally {
    await browser.close();
  }
}

runComprehensiveTest();
