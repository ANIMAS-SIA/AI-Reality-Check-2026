// Offline participant UI regression; all requests intercepted, no real data or writes.
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium, devices } = await import(process.env.ARC_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.ARC_PLAYWRIGHT_MODULE).href : 'playwright');
const root = resolve(import.meta.dirname, '..');
const out = resolve(root, 'supabase/.temp/live-program');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.ARC_CHROME_PATH ? { executablePath: process.env.ARC_CHROME_PATH } : {}) });
try {
  for (const width of [320, 360, 390, 430, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    const errors = []; const writes = []; let failedVote = true; let pollMode = 'multiple';
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
        if (url.pathname.endsWith('/polls')) data = pollMode === 'scale'
          ? { activePolls: [{ poll: { id: 'scale-poll', agenda_item_id: 'talk', title: 'Novērtē no 1 līdz 5', poll_type: 'scale' }, options: [1, 2, 3, 4, 5].map((value) => ({ id: `scale-${value}`, label: String(value) })) }], results: [] }
          : { activePolls: [{ poll: { id: 'poll', agenda_item_id: 'talk', title: 'Vai izmantojat MI?', poll_type: 'multiple_choice' }, options: [{ id: 'yes', label: 'Jā' }, { id: 'no', label: 'Nē' }] }], results: [] };
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
    pollMode = 'scale';
    await page.reload();
    await page.locator('[data-agenda-action="polls"]').click();
    const scale = page.locator('[data-role="poll-scale-input"]');
    await scale.waitFor();
    assert.equal(await page.locator('.agenda-poll-card .poll-option').count(), 0, 'Scale poll is not rendered as answer buttons');
    await scale.fill('4');
    assert.equal(await page.locator('[data-role="poll-scale-value"]').textContent(), '5');
    await Promise.all([
      page.waitForResponse((response) => response.url().includes('/functions/v1/polls') && response.request().method() === 'POST'),
      page.locator('[data-role="poll-scale-submit"]').click(),
    ]);
    assert.equal(writes.findLast((write) => write.body.pollId === 'scale-poll').body.optionId, 'scale-5', 'Scale submits the selected value option');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'No horizontal overflow');
    await page.screenshot({ path: resolve(out, `questions-${width}.png`), fullPage: true });
    assert.deepEqual(errors, []);
    console.log(`PASS ${width}px compact program, vote failure/retry, ordering, persistence, draft and submission`);
    await page.close();
  }

  const guestContext = await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 320, height: 700 } });
  const guestPage = await guestContext.newPage();
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
      if (url.pathname.endsWith('/polls')) return route.fulfill({ json: { activePolls: [{ poll: { id: 'guest-poll', agenda_item_id: 'guest-talk', title: 'Viesa balsojums', poll_type: 'yes_no' }, options: [{ id: 'guest-yes', label: 'Jā' }, { id: 'guest-no', label: 'Nē' }] }], results: [] } });
      if (url.pathname.endsWith('/results')) return route.fulfill({ json: { summary: {}, polls: [], maturity: {}, segments: {} } });
      if (url.pathname.endsWith('/participant-pass')) return route.fulfill({ status: 500, json: { error: 'Guest flow must not request a pass' } });
      return route.fulfill({ json: {} });
    }
    return route.abort();
  });
  await guestPage.goto('https://mobile.test/pass/?event=rehearsal-ui');
  await guestPage.locator('[data-guest-access-form]').waitFor();
  const guestGateLayout = await guestPage.evaluate(() => {
    const card = document.querySelector('.portal-access-card').getBoundingClientRect();
    return { viewport: innerWidth, pageWidth: document.documentElement.scrollWidth, cardLeft: card.left, cardRight: card.right };
  });
  assert.ok(guestGateLayout.cardLeft >= 0 && guestGateLayout.cardRight <= guestGateLayout.viewport + 1, 'Guest access card fits the mobile viewport');
  assert.ok(guestGateLayout.pageWidth <= guestGateLayout.viewport + 1, 'Guest access page has no horizontal overflow');
  const enlargedText = await guestPage.addStyleTag({ content: ':root { font-size: 200%; }' });
  assert.ok(await guestPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Guest access remains usable with 200% text');
  await enlargedText.evaluate((style) => style.remove());
  await guestPage.screenshot({ path: resolve(out, 'guest-access-320.png'), fullPage: true });
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
  await guestPage.evaluate(() => localStorage.clear());
  await guestPage.goto('https://mobile.test/live/?event=rehearsal-ui&view=program&poll=guest-poll&agenda=guest-talk');
  await guestPage.locator('[data-guest-access-form]').waitFor();
  await guestPage.locator('[data-guest-access-form] button[type="submit"]').click();
  await guestPage.waitForURL((url) => url.searchParams.get('poll') === 'guest-poll');
  await guestPage.locator('[data-poll-card="guest-poll"]').waitFor({ state: 'visible' });
  console.log('PASS guest access, optional display name and direct poll link');
  await guestContext.close();

  const presentationPage = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  let presentationMode = 'poll_question';
  await presentationPage.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === 'mobile.test') {
      const file = resolve(root, `.${url.pathname.endsWith('/') ? `${url.pathname}index.html` : url.pathname}`);
      const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[extname(file)];
      try { return await route.fulfill({ body: await readFile(file), contentType: type || 'application/octet-stream' }); } catch { return route.fulfill({ status: 404 }); }
    }
    if (url.hostname === 'cdn.jsdelivr.net') return route.fulfill({ contentType: 'text/javascript', body: `window.supabase={createClient(){return {channel(){return {on(){return this},subscribe(){return this}}}}}};` });
    if (url.pathname.endsWith('/presentation')) {
      return route.fulfill({ json: {
        state: { mode: presentationMode, qr_visible: true },
        agenda_item: { id: 'talk', title: 'Testa programmas punkts', starts_at: '2026-09-30T07:00:00Z', ends_at: '2026-09-30T07:45:00Z' },
        question_count: 4,
        poll: presentationMode === 'poll_results'
          ? { poll: { id: 'poll', title: 'Testa balsojuma jautājums?', poll_type: 'word_cloud' }, options: [], text_responses: ['Mākslīgais intelekts palīdz', 'mākslīgais   intelekts palīdz', 'Cilvēks paliek centrā'], total_votes: 3 }
          : { poll: { id: 'poll', agenda_item_id: 'talk', title: 'Testa balsojuma jautājums?' }, options: [], total_votes: 0 },
      } });
    }
    return route.fulfill({ status: 204 });
  });
  await presentationPage.goto('https://mobile.test/present/?event=rehearsal-ui');
  assert.equal(await presentationPage.locator('[data-present-mode="results"]').count(), 0, 'Retired overall results screen is absent');
  await presentationPage.locator('#presentPollQr').waitFor({ state: 'visible' });
  const pollQrBox = await presentationPage.locator('#presentPollQrImg').boundingBox();
  const pollCountBox = await presentationPage.locator('#presentPollQr span').boundingBox();
  assert.ok(pollQrBox.width >= 180, 'Poll QR is large enough to scan');
  assert.ok(pollCountBox.y >= pollQrBox.y + pollQrBox.height, 'Poll response count is below the QR');
  assert.ok(Math.abs((pollCountBox.x + pollCountBox.width / 2) - (pollQrBox.x + pollQrBox.width / 2)) <= 1, 'Poll response count is centered under the QR');
  const pollQrTarget = new URL(new URL(await presentationPage.locator('#presentPollQrImg').getAttribute('src')).searchParams.get('data'));
  assert.equal(pollQrTarget.searchParams.get('poll'), 'poll', 'Poll QR links directly to the active poll');
  assert.equal(pollQrTarget.searchParams.get('agenda'), 'talk', 'Poll QR keeps its agenda context');
  presentationMode = 'agenda';
  await presentationPage.reload();
  await presentationPage.locator('#presentAgendaQr').waitFor({ state: 'visible' });
  const agendaQrBox = await presentationPage.locator('#presentAgendaQrImg').boundingBox();
  const agendaCountBox = await presentationPage.locator('#presentAgendaQr span').boundingBox();
  assert.ok(agendaQrBox.width >= 180, 'Question QR is large enough to scan');
  assert.equal(await presentationPage.locator('#presentAgendaQuestionCount').textContent(), '4', 'Agenda QR shows the current question count');
  assert.ok(agendaCountBox.y >= agendaQrBox.y + agendaQrBox.height, 'Question count is below the QR');
  assert.ok(Math.abs((agendaCountBox.x + agendaCountBox.width / 2) - (agendaQrBox.x + agendaQrBox.width / 2)) <= 1, 'Question count is centered under the QR');
  presentationMode = 'poll_results';
  await presentationPage.reload();
  await presentationPage.locator('.present-word-cloud').waitFor();
  assert.equal(await presentationPage.locator('.present-word-cloud span').count(), 2, 'Each submitted phrase remains one cloud item and matching phrases are grouped');
  assert.equal((await presentationPage.locator('.present-word-cloud span').first().textContent()).trim(), 'Mākslīgais intelekts palīdz');
  assert.ok(await presentationPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Presentation has no horizontal overflow');
  console.log('PASS presentation QR size and whole-phrase word cloud');
  await presentationPage.close();
} finally { await browser.close(); }
