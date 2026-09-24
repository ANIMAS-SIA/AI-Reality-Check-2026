// Offline browser regression: every network request is mocked; no real credentials/data.
// npm install --no-save playwright; node tests/admin-mobile.mjs
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.ARC_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.ARC_PLAYWRIGHT_MODULE).href : 'playwright');
const root = resolve(import.meta.dirname, '..');
const out = resolve(root, 'supabase/.temp/admin-mobile');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.ARC_CHROME_PATH ? { executablePath: process.env.ARC_CHROME_PATH } : {}) });
const agenda = [0, 1, 2].map((i) => ({ id: `agenda-${i}`, starts_at: '2026-09-30T06:00:00Z', ends_at: '2026-09-30T06:30:00Z', title: `Programmas punkts ${i + 1} — mākslīgais intelekts uzņēmumu ikdienā`, speaker_name: 'Testa Runātājs', status: i === 0 ? 'now' : 'later', display_order: i, is_break: i === 1 }));
const questions = [{ id: 'question-1', agenda_item_id: 'agenda-0', body: 'Kā ieviest mākslīgo intelektu uzņēmuma ikdienas darbā, saglabājot datu drošību?', is_anonymous: true, vote_count: 12, created_at: new Date().toISOString() }];
const participants = [{ id: 'person-1', first_name: 'Testa', last_name: 'Dalībnieks', email: 'garaks.testetaja.epasts@example.invalid', role: 'Uzņēmuma vadītājs', status: 'approved', access_mode: 'full', consents: { networking: true }, attendance_reconfirmed_at: new Date().toISOString() }];
const polls = [{ id: 'poll-1', agenda_item_id: 'agenda-0', title: 'Kā vērtējat sava uzņēmuma gatavību izmantot MI?', status: 'active', poll_type: 'single_choice', response_count: 32 }];
try {
  for (const width of [360, 390, 768, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    const errors = []; const writes = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname === 'mobile.test') {
        const file = resolve(root, `.${url.pathname.endsWith('/') ? `${url.pathname}index.html` : url.pathname}`);
        if (!file.startsWith(root)) return route.abort();
        const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
        try { return await route.fulfill({ body: await readFile(file), contentType: types[extname(file)] || 'application/octet-stream' }); }
        catch { return route.fulfill({ status: 404 }); }
      }
      if (url.hostname === 'cdn.jsdelivr.net') return route.fulfill({ contentType: 'text/javascript', body: `window.supabase={createClient(){return {auth:{getSession:async()=>({data:{session:{access_token:'offline-test'}}}),signOut:async()=>({})},channel(){return {on(){return this},subscribe(){return this}}}}}};` });
      if (url.pathname.includes('/functions/v1/')) {
        if (route.request().method() === 'POST') writes.push({ path: url.pathname, action: url.searchParams.get('action'), body: route.request().postDataJSON() });
        let data = {};
        if (url.pathname.endsWith('/admin-users')) data = { email: 'test@example.invalid', role: 'superadmin' };
        if (url.pathname.endsWith('/admin-live')) data = { agenda, event: { agenda_mode: 'schedule', is_test: true }, server_time: new Date().toISOString() };
        if (url.pathname.endsWith('/admin-questions')) data = { questions };
        if (url.pathname.endsWith('/admin-registrations')) data = { registrations: participants, participants: 217, arrived: 12, settings: {} };
        if (url.pathname.endsWith('/admin-polls')) data = { polls };
        if (url.pathname.endsWith('/polls')) data = { active: { poll: polls[0], options: [], total_votes: 32 } };
        if (url.pathname.endsWith('/presentation')) data = { state: { mode: 'waiting' } };
        return route.fulfill({ json: data });
      }
      return route.abort();
    });
    await page.goto('https://mobile.test/admin/?event=rehearsal-mobile');
    await page.locator('#adminApp').waitFor({ state: 'visible' });
    await page.locator('#dashAgendaTitle').filter({ hasText: 'Programmas punkts' }).waitFor();
    const noOverflow = async (label) => {
      const size = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, viewport: innerWidth }));
      assert.ok(size.scroll <= size.viewport + 1, `${width}px ${label}: overflow ${size.scroll}`);
    };
    await noOverflow('dashboard');
    await page.screenshot({ path: resolve(out, `dashboard-${width}.png`), fullPage: true });
    if (width <= 860) await page.locator('.admin-bottom-tabs [data-admin-nav="moderation"]').click();
    else await page.locator('.admin-nav [data-admin-nav="moderation"]').click();
    await page.locator('.admin-question-row').waitFor(); await noOverflow('moderation');
    assert.match(await page.locator('.admin-question-agenda').first().textContent(), /Programmas punkts 1/);
    await page.screenshot({ path: resolve(out, `moderation-${width}.png`), fullPage: true });
    if (width <= 860) {
      const tabs = page.locator('.admin-bottom-tabs');
      assert.ok((await tabs.boundingBox()).height >= 56);
      assert.ok((await page.locator('[data-question-action="approved"]').first().boundingBox()).height >= 44);
      await tabs.getByRole('button', { name: 'Vairāk' }).click();
      await page.locator('#adminMobileMore').getByRole('button', { name: 'Dalībnieki', exact: true }).click();
      await page.locator('.admin-participant-row').waitFor(); await noOverflow('participants');
      await page.getByRole('button', { name: 'Filtri', exact: true }).click();
      await page.locator('#participantsStatusFilter').selectOption('approved');
      await page.getByRole('button', { name: 'Rādīt dalībniekus' }).click();
      await page.getByRole('button', { name: 'Atlasīt', exact: true }).click();
      await page.locator('[data-participant-select]').check();
      assert.equal(await page.locator('#participantsSelectedCount').textContent(), '1');
      await page.getByRole('button', { name: 'Beigt atlasi' }).click();
      assert.equal(await page.locator('#participantsSelectedCount').textContent(), '0');
      if (width === 390) await page.screenshot({ path: resolve(out, 'participants-390.png'), fullPage: true });
      await tabs.getByRole('button', { name: 'Vairāk' }).click();
      await page.locator('#adminMobileMore').getByRole('button', { name: 'Programma', exact: true }).click();
      await page.locator('.admin-program-row').first().waitFor(); await noOverflow('program');
      await page.locator('.admin-mobile-agenda-menu summary').first().click();
      await page.getByRole('button', { name: '↓ Uz leju', exact: true }).first().click();
      await page.waitForFunction(() => document.querySelectorAll('.admin-program-row').length === 3);
      assert.ok(writes.some((entry) => entry.action === 'reorder' && entry.body.order[0] === 'agenda-1'));
      await page.locator('[data-edit-agenda]').first().click();
      await page.locator('#agendaTitle').waitFor({ state: 'visible' });
      await noOverflow('program form');
      if (width === 390) await page.screenshot({ path: resolve(out, 'program-form-390.png'), fullPage: true });
      await page.locator('#agendaTitle').fill('Mobilajā labots programmas punkts');
      await page.locator('#programItemForm button[type="submit"]').click();
      await page.locator('#programFormStatus[data-state="success"]').waitFor();
      assert.ok(writes.some((entry) => entry.action === 'upsert-agenda' && entry.body.title === 'Mobilajā labots programmas punkts'));
      await page.getByRole('button', { name: '← Grafiks', exact: true }).click();
      await page.locator('[data-close-modal="programModal"]').click();
      await tabs.locator('[data-admin-nav="polls"]').click();
      await page.locator('.admin-poll-row').waitFor(); await noOverflow('polls');
      assert.match(await page.locator('.admin-poll-agenda').textContent(), /Programmas punkts 1/);
      await page.locator('[data-poll-results]').click();
      await page.waitForFunction(() => document.querySelector('[data-poll-results]'));
      assert.ok(writes.some((entry) => entry.path.endsWith('/presentation') && entry.body.mode === 'poll_results' && entry.body.pollId === 'poll-1'));
      const before = writes.length;
      page.once('dialog', (dialog) => dialog.dismiss());
      await page.locator('[data-poll-close]').click();
      assert.equal(writes.length, before, 'Cancelled close must not send API write');
      await page.locator('#pollsOpenWizard').click();
      assert.equal(Math.round((await page.locator('#pollWizardModal .admin-modal-panel').boundingBox()).width), width);
      await noOverflow('wizard');
      if (width === 390) await page.screenshot({ path: resolve(out, 'wizard-390.png'), fullPage: true });
      await page.locator('#wizardNext').click();
      await page.locator('#wizardTitle').fill('Testa balsojums');
      await page.locator('[data-option-index="0"]').fill('Jā');
      await page.locator('[data-option-index="1"]').fill('Nē');
      await page.locator('#wizardNext').click();
      await page.locator('#wizardNext').click();
      await page.locator('#wizardSubmit').waitFor({ state: 'visible' });
      await noOverflow('wizard preview');
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#pollWizardModal').isVisible(), false);
      await page.setViewportSize({ width: 1280, height: 900 });
      assert.equal(await page.locator('.admin-bottom-tabs').isVisible(), false);
      assert.equal(await page.locator('.admin-sidebar').isVisible(), true);
      await page.waitForFunction(() => document.querySelector('#participantsStatusFilter').closest('dialog') === null);
    } else {
      assert.equal(await page.locator('.admin-bottom-tabs').isVisible(), false);
      assert.equal(await page.locator('.admin-sidebar').isVisible(), true);
    }
    assert.deepEqual(errors, [], 'No uncaught browser errors');
    console.log(`PASS ${width}px layout, navigation and interactions`);
    await page.close();
  }
} finally { await browser.close(); }
