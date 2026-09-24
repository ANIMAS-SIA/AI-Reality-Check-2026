// Offline participant UI regression; all requests intercepted, no real data or writes.
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.ARC_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.ARC_PLAYWRIGHT_MODULE).href : 'playwright');
const root = resolve(import.meta.dirname, '..');
const out = resolve(root, 'supabase/.temp/live-program');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.ARC_CHROME_PATH ? { executablePath: process.env.ARC_CHROME_PATH } : {}) });
try {
  for (const width of [360, 390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    const errors = []; const writes = []; let failedVote = true;
    const questions = [
      { id: 'q1', agenda_item_id: 'talk', body: 'Kā ieviest MI droši?', vote_count: 4, is_anonymous: true, status: 'approved' },
      { id: 'q2', agenda_item_id: 'talk', body: 'Vai pieejami praktiski piemēri?', vote_count: 4, is_anonymous: true, status: 'approved' },
    ];
    const agenda = [
      { id: 'break', time: '09:00', starts_at: '2026-09-30T06:00:00Z', ends_at: '2026-09-30T06:30:00Z', title: 'Reģistrācija un kafija', description: 'Ieeja un tikšanās', status: 'done', is_break: true },
      { id: 'talk', time: '10:00', starts_at: '2026-09-30T07:00:00Z', ends_at: '2026-09-30T07:45:00Z', title: 'No stratēģijas līdz vērtībai: mākslīgais intelekts valsts pārvaldē', speaker_name: 'Testa Runātājs', status: 'now', is_break: false },
    ];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname === 'mobile.test') {
        const file = resolve(root, `.${url.pathname.endsWith('/') ? `${url.pathname}index.html` : url.pathname}`);
        const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[extname(file)];
        try { return await route.fulfill({ body: await readFile(file), contentType: type || 'application/octet-stream' }); } catch { return route.fulfill({ status: 404 }); }
      }
      if (url.hostname === 'cdn.jsdelivr.net') return route.fulfill({ contentType: 'text/javascript', body: `window.supabase={createClient(){return {channel(){return {on(){return this},subscribe(){return this}}}}}};` });
      if (url.pathname.includes('/functions/v1/')) {
        let data = {};
        const body = route.request().method() === 'POST' ? route.request().postDataJSON() : null;
        if (body) writes.push({ action: url.searchParams.get('action'), body });
        if (url.pathname.endsWith('/participant-pass')) data = { participant: { id: 'tester', firstName: 'Testa', lastName: 'Dalībnieks', access: 'Pilnā pieeja', status: 'approved' } };
        if (url.pathname.endsWith('/live-state')) data = { agenda };
        if (url.pathname.endsWith('/questions')) {
          data = { questions };
          if (url.searchParams.get('action') === 'vote') {
            if (failedVote) { failedVote = false; return route.fulfill({ status: 503, json: { error: 'Testa savienojuma kļūda' } }); }
            questions.find((q) => q.id === body.questionId).vote_count++;
            data = { ok: true };
          } else if (body) data = { question: { id: 'new-question' } };
        }
        if (url.pathname.endsWith('/polls')) data = { activePolls: [{ poll: { id: 'poll', agenda_item_id: 'talk', title: 'Vai izmantojat MI?', poll_type: 'multiple_choice' }, options: [{ id: 'yes', label: 'Jā' }, { id: 'no', label: 'Nē' }] }], results: [] };
        return route.fulfill({ json: data });
      }
      return route.abort();
    });
    await page.goto('https://mobile.test/live/?event=rehearsal-ui&token=test-only');
    await page.locator('[data-agenda-action="questions"]').click();
    await page.locator('[data-question-vote="q2"]').waitFor();
    const before = await page.locator('[data-role="question-input"]').boundingBox();
    assert.ok(before.height <= 50, 'Question input starts compact');
    await page.locator('[data-question-vote="q2"]').click();
    await page.waitForFunction(() => !document.querySelector('[data-question-vote="q2"]').disabled);
    assert.equal(await page.locator('[data-question-vote="q2"]').getAttribute('aria-pressed'), 'false', 'Failed vote is not remembered');
    await page.locator('[data-question-vote="q2"]').click();
    await page.waitForFunction(() => document.querySelector('.question-card [data-question-vote]')?.dataset.questionVote === 'q2');
    assert.equal(await page.locator('[data-question-vote="q2"]').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('[data-question-vote="q2"]').isDisabled(), true);
    assert.equal(await page.locator('[data-question-vote="q2"] strong').textContent(), '5');
    await page.locator('[data-role="question-input"]').fill('Mans vēl neiesniegtais jautājums');
    await page.locator('[data-agenda-action="polls"]').click();
    await page.locator('[data-option-id="yes"]').waitFor();
    await page.locator('[data-option-id="yes"]').click();
    await Promise.all([
      page.waitForResponse((response) => response.url().includes('/functions/v1/polls') && response.request().method() === 'POST'),
      page.waitForResponse((response) => response.url().includes('/functions/v1/polls') && response.request().method() === 'GET'),
      page.locator('[data-role="poll-option-submit"]').click(),
    ]);
    assert.deepEqual(writes.findLast((write) => write.body.pollId === 'poll').body.optionIds, ['yes'], 'Multiple choice submits one selected option as an array');
    await page.locator('[data-option-id="yes"]').click();
    await page.locator('[data-option-id="no"]').click();
    await Promise.all([
      page.waitForResponse((response) => response.url().includes('/functions/v1/polls') && response.request().method() === 'POST'),
      page.waitForResponse((response) => response.url().includes('/functions/v1/polls') && response.request().method() === 'GET'),
      page.locator('[data-role="poll-option-submit"]').click(),
    ]);
    assert.deepEqual(writes.findLast((write) => write.body.pollId === 'poll').body.optionIds, ['yes', 'no'], 'Multiple choice submits several selected options as an array');
    await page.locator('[data-agenda-action="questions"]').click();
    assert.equal(await page.locator('[data-role="question-input"]').inputValue(), 'Mans vēl neiesniegtais jautājums');
    await page.locator('[data-role="question-submit"]').click();
    await page.waitForFunction(() => document.querySelector('[data-role="question-input"]').value === '');
    assert.ok(writes.some((write) => write.body.agendaItemId === 'talk' && write.body.body === 'Mans vēl neiesniegtais jautājums'));
    await page.reload();
    await page.locator('[data-agenda-action="questions"]').click();
    await page.locator('[data-question-vote="q2"]').waitFor();
    assert.equal(await page.locator('[data-question-vote="q2"]').isDisabled(), true, 'Supported state survives reload');
    assert.equal(await page.locator('[data-agenda-item="break"] .agenda-action').count(), 0);
    assert.equal(await page.locator('.vote-btn svg').count(), 2);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'No horizontal overflow');
    await page.screenshot({ path: resolve(out, `questions-${width}.png`), fullPage: true });
    assert.deepEqual(errors, []);
    console.log(`PASS ${width}px compact program, vote failure/retry, ordering, persistence, draft and submission`);
    await page.close();
  }

  const guestPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const guestWrites = [];
  await guestPage.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === 'mobile.test') {
      const file = resolve(root, `.${url.pathname.endsWith('/') ? `${url.pathname}index.html` : url.pathname}`);
      const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[extname(file)];
      try { return await route.fulfill({ body: await readFile(file), contentType: type || 'application/octet-stream' }); } catch { return route.fulfill({ status: 404 }); }
    }
    if (url.hostname === 'cdn.jsdelivr.net') return route.fulfill({ contentType: 'text/javascript', body: `window.supabase={createClient(){return {channel(){return {on(){return this},subscribe(){return this}}}}}};` });
    if (url.pathname.includes('/functions/v1/')) {
      const body = route.request().method() === 'POST' ? route.request().postDataJSON() : null;
      if (body) guestWrites.push({ path: url.pathname, body });
      if (url.pathname.endsWith('/live-state')) return route.fulfill({ json: { agenda: [{ id: 'guest-talk', starts_at: '2026-09-30T07:00:00Z', ends_at: '2026-09-30T07:45:00Z', title: 'Viesu jautājumi', status: 'now', is_break: false }] } });
      if (url.pathname.endsWith('/questions')) return route.fulfill({ json: body ? { question: { id: 'guest-question' }, anonymousSessionId: 'guest-session' } : { questions: [] } });
      if (url.pathname.endsWith('/polls')) return route.fulfill({ json: { activePolls: [], results: [] } });
      if (url.pathname.endsWith('/results')) return route.fulfill({ json: { summary: {}, polls: [], maturity: {}, segments: {} } });
      if (url.pathname.endsWith('/participant-pass')) return route.fulfill({ status: 500, json: { error: 'Guest flow must not request a pass' } });
      return route.fulfill({ json: {} });
    }
    return route.abort();
  });
  await guestPage.goto('https://mobile.test/pass/?event=rehearsal-ui');
  await guestPage.locator('[data-guest-access-form]').waitFor();
  assert.match(await guestPage.locator('.portal-access-help').textContent(), /AI Pass/);
  await guestPage.locator('[name="guestName"]').fill('Anna');
  await guestPage.locator('[data-guest-access-form] button[type="submit"]').click();
  await guestPage.waitForURL(/\/live\//);
  await guestPage.locator('#passAccess').filter({ hasText: 'Anonīma pieeja' }).waitFor();
  assert.equal(await guestPage.locator('[data-live-tab="networking"]').isHidden(), true);
  await guestPage.locator('[data-agenda-action="questions"]').click();
  assert.equal(await guestPage.locator('[data-role="question-anon"]').isChecked(), false);
  await guestPage.locator('[data-role="question-input"]').fill('Anonīma dalībnieka jautājums');
  await guestPage.locator('[data-role="question-submit"]').click();
  await guestPage.waitForFunction(() => document.querySelector('[data-role="question-input"]')?.value === '');
  const guestQuestion = guestWrites.find((write) => write.path.endsWith('/questions'))?.body;
  assert.equal(guestQuestion.guestName, 'Anna');
  assert.equal(guestQuestion.isAnonymous, false);
  console.log('PASS guest access without token and optional display name');
  await guestPage.close();
} finally { await browser.close(); }
