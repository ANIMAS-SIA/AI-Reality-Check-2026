// Results dashboard regression; all API calls are intercepted and no real data is used.
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(process.env.ARC_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.ARC_PLAYWRIGHT_MODULE).href : 'playwright');
const root = resolve(import.meta.dirname, '..');
const out = resolve(root, 'supabase/.temp/results-mobile');
await mkdir(out, { recursive: true });

const levelCounts = [3, 18, 14, 19, 76, 11, 8, 7, 3, 8];
const fixture = {
  summary: {
    participant_count: 170,
    represented_companies: 93,
    maturity_score: 49,
    using_ai_percent: 88,
    not_using_ai_percent: 2,
  },
  maturity: {
    answered_count: 167,
    average: 4.9,
    median: 5,
    by_level: levelCounts.map((count, index) => ({ level: index + 1, count })),
    by_phase: [
      { label: 'Eksperimenti', count: 109 },
      { label: 'Ieviešana', count: 26 },
      { label: 'Izpēte', count: 21 },
      { label: 'Līderis', count: 11 },
    ],
  },
  polls: [{
    poll: { title: 'Kurā stadijā jūsu uzņēmums pašlaik ir ar MI ieviešanu?' },
    total_votes: 154,
    options: [
      { label: 'Vēl neizmantojam', percent: 50 },
      { label: 'Testējam atsevišķus risinājumus', percent: 34 },
      { label: 'MI ir ikdienas procesos', percent: 16 },
    ],
  }],
  company_segments: {
    industries: [{ label: 'IT pakalpojumi', count: 18 }, { label: 'Ražošana', count: 12 }],
    sizes: [{ label: 'Mazs', count: 31 }, { label: 'Vidējs', count: 22 }],
    regions: [{ label: 'Rīga', count: 54 }, { label: 'Vidzeme', count: 11 }],
  },
  company_financials: {
    company_count: 93,
    eligible_company_count: 88,
    enriched_company_count: 88,
    financial_company_count: 79,
    turnover_company_count: 78,
    profit_company_count: 77,
    asset_company_count: 76,
    equity_company_count: 76,
    employee_company_count: 72,
    salary_company_count: 65,
    data_year: 2025,
    total_turnover: 1850400000,
    median_turnover: 3800000,
    total_profit: 142300000,
    total_assets: 2470000000,
    total_equity: 980000000,
    total_employees: 12450,
    weighted_avg_salary: 2380,
    profitable_percent: 81,
    privacy_minimum: 3,
  },
};

const browser = await chromium.launch({ headless: true, ...(process.env.ARC_CHROME_PATH ? { executablePath: process.env.ARC_CHROME_PATH } : {}) });
try {
  for (const width of [320, 390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname === 'mobile.test') {
        const file = resolve(root, `.${url.pathname.endsWith('/') ? `${url.pathname}index.html` : url.pathname}`);
        const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[extname(file)];
        try { return await route.fulfill({ body: await readFile(file), contentType: type || 'application/octet-stream' }); } catch { return route.fulfill({ status: 404 }); }
      }
      if (url.pathname.endsWith('/functions/v1/results')) return route.fulfill({ json: fixture });
      return route.abort();
    });

    await page.goto('https://mobile.test/rezultati/');
    await page.locator('#resultsScoreValue').filter({ hasText: '49' }).waitFor();
    assert.match(await page.locator('#resultsScoreNote').textContent(), /4,9|4\.9/);
    assert.equal(await page.locator('.results-tile').nth(0).locator('strong').textContent(), '88%');
    assert.equal(await page.locator('.results-tile').nth(1).locator('strong').textContent(), '2%');
    assert.equal(await page.locator('.results-tile').count(), 2);
    assert.match(await page.locator('#resultsMaturity').textContent(), /Kur atrodas konferences dalībnieki/);
    assert.match(await page.locator('#resultsCompanyMetrics').textContent(), /1,9 mljrd\. €/);
    assert.match(await page.locator('#resultsCompanyMeta').textContent(), /88 uzņēmumi/);
    assert.match(await page.locator('#resultsCompanyMeta').textContent(), /5 ierakstiem/);
    assert.equal(await page.locator('a[href*="networking"], [data-live-tab="networking"]').count(), 0);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${width}px results page has no horizontal overflow`);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: resolve(out, `results-${width}.png`), fullPage: true });
    console.log(`PASS ${width}px results hierarchy, Company360 metrics and overflow`);
    await page.close();
  }
} finally {
  await browser.close();
}
