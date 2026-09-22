import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { resolveAgenda } from '../supabase/functions/_shared/agenda.ts';
import { SupabaseRest } from '../supabase/functions/_shared/supabase-rest.ts';

const time = (minutes) => new Date(Date.UTC(2026, 8, 30, 6, minutes)).toISOString();
const agenda = [
  { id: 'talk1', starts_at: time(0), ends_at: time(30), status: 'now' },
  { id: 'break', starts_at: time(30), ends_at: time(45), is_break: true, status: 'break' },
  { id: 'cancelled', starts_at: time(45), ends_at: time(60), status: 'cancelled' },
  { id: 'talk2', starts_at: time(45), ends_at: time(60), status: 'later' },
];
test('schedule uses server time, not stale stored now/current; before, during, exact boundary, after', () => {
  const event = { agenda_mode: 'schedule', current_agenda_item_id: 'talk1' };
  assert.equal(resolveAgenda(event, agenda, Date.parse(time(-1))).current, null);
  assert.equal(resolveAgenda(event, agenda, Date.parse(time(-1))).next.id, 'talk1');
  assert.equal(resolveAgenda(event, agenda, Date.parse(time(0))).current.id, 'talk1');
  assert.equal(resolveAgenda(event, agenda, Date.parse(time(30))).current.id, 'break');
  assert.equal(resolveAgenda(event, agenda, Date.parse(time(45))).current.id, 'talk2');
  assert.equal(resolveAgenda(event, agenda, Date.parse(time(60))).current, null);
  assert.equal(resolveAgenda(event, agenda, Date.parse(time(60))).next, null);
});
test('manual early start, overtime, breaks, next and return to schedule', () => {
  for (const minutes of [-10, 50, 10000]) {
    const state = resolveAgenda({ agenda_mode: 'manual', current_agenda_item_id: 'talk1' }, agenda, Date.parse(time(minutes)));
    assert.equal(state.current.id, 'talk1');
    assert.equal(state.next.id, 'break');
    assert.deepEqual(state.agenda.map((item) => item.status), ['now', 'next', 'cancelled', 'later']);
  }
  assert.equal(resolveAgenda({ agenda_mode: 'manual', current_agenda_item_id: 'break' }, agenda, Date.parse(time(80))).current.id, 'break');
  assert.equal(resolveAgenda({ agenda_mode: 'schedule', current_agenda_item_id: 'break' }, agenda, Date.parse(time(50))).current.id, 'talk2');
  assert.equal(resolveAgenda({ agenda_mode: 'manual', current_agenda_item_id: 'cancelled' }, agenda).current, null);
});
test('resolver is pure and gaps do not reactivate a stale speaker', () => {
  const original = structuredClone(agenda);
  const gap = [agenda[0], agenda[3]];
  const resolved = resolveAgenda({}, gap, Date.parse(time(35)));
  assert.equal(resolved.current, null);
  assert.equal(resolved.next.id, 'talk2');
  assert.deepEqual(agenda, original);
});

globalThis.Deno = { env: { get: (key) => ({ SUPABASE_URL: 'https://db.invalid', SUPABASE_SERVICE_ROLE_KEY: 'test-only' })[key] } };
test('every scoped REST read/write intersects caller filters with selected event', async () => {
  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, options) => {
    const url = new URL(input);
    requests.push({ url, ...options });
    return Response.json(url.pathname.endsWith('/events') && url.searchParams.get('select') === 'id,slug,is_test'
      ? [{ id: 'test-event', slug: 'rehearsal-test', is_test: true }] : []);
  };
  try {
    const db = new SupabaseRest(new Request('https://api.invalid/admin-questions?event=rehearsal-test'));
    await db.select('questions', { event_id: 'eq.production', and: '(status.eq.pending)', id: 'eq.production-question' });
    assert.equal(requests.at(-1).url.searchParams.get('and'), '(event_id.eq.test-event,and(status.eq.pending))');
    await db.update('participants', { first_name: 'Test' }, { id: 'eq.production-person' });
    assert.equal(requests.at(-1).url.searchParams.get('and'), '(event_id.eq.test-event)');
    await db.delete('polls', { id: 'eq.production-poll' });
    assert.equal(requests.at(-1).url.searchParams.get('and'), '(event_id.eq.test-event)');
    await assert.rejects(db.insert('questions', [{ event_id: 'production' }]), /Cross-event/);
    await assert.rejects(db.insert('questions', [{ event_id: 'test-event', agenda_item_id: 'production-talk' }]), /Cross-event/);
    await db.insert('admin_audit_logs', [{ action: 'test' }]);
    assert.equal(JSON.parse(requests.at(-1).body)[0].event_id, 'test-event');
  } finally { globalThis.fetch = originalFetch; }
});
test('child records and votes cannot escape event through parent IDs', async () => {
  const originalFetch = globalThis.fetch;
  let last;
  globalThis.fetch = async (input, options) => {
    const url = new URL(input); last = { url, ...options };
    if (url.pathname.endsWith('/events')) return Response.json([{ id: 'event', slug: 'rehearsal-test', is_test: true }]);
    if (url.pathname.endsWith('/polls')) return Response.json(url.searchParams.has('id') ? [] : [{ id: 'test-poll' }]);
    return Response.json([]);
  };
  try {
    const db = new SupabaseRest(new Request('https://api.invalid/polls?event=rehearsal-test'));
    await db.delete('poll_votes', { poll_id: 'eq.production-poll' });
    assert.equal(last.url.searchParams.get('and'), '(event_id.eq.event)');
    await assert.rejects(db.insert('poll_votes', [{ poll_id: 'production-poll', option_id: 'production-option' }]), /Cross-event/);
    for (const route of ['registrations', 'wallet', 'participant-actions', 'admin-users', 'admin-registrations?action=approve']) {
      await assert.rejects(db.assertRehearsalSafe(new Request(`https://api.invalid/${route}${route.includes('?') ? '&' : '?'}event=rehearsal-test`, { method: 'POST' })), /Mēģinājumā/);
    }
    await db.assertRehearsalSafe(new Request('https://api.invalid/admin-live?event=rehearsal-test', { method: 'POST' }));
  } finally { globalThis.fetch = originalFetch; }
});
test('frontend keeps explicit event context on API, QR/navigation links and storage, not external APIs', async () => {
  const calls = [];
  const context = { URL, URLSearchParams, location: new URL('https://site.invalid/admin/?event=rehearsal-test'), document: { addEventListener() {} }, window: { fetch: (...args) => { calls.push(args); } } };
  vm.runInNewContext(readFileSync(new URL('../config.js', import.meta.url), 'utf8'), context);
  await context.window.arcFetch(`${context.window.ARC_API_BASE}/questions?status=pending`);
  assert.equal(new URL(calls.at(-1)[0]).searchParams.get('event'), 'rehearsal-test');
  assert.equal(new URL(context.window.arcEventUrl('../pass/?token=x')).searchParams.get('token'), 'x');
  assert.equal(new URL(context.window.arcEventUrl('../pass/?token=x')).searchParams.get('event'), 'rehearsal-test');
  assert.equal(context.window.arcStorageKey('token'), 'token:rehearsal-test');
  await context.window.arcFetch('https://other.invalid/lookup');
  assert.equal(calls.at(-1)[0], 'https://other.invalid/lookup');
});

test('preview without a rehearsal fails closed for production writes; production hostname remains usable', async () => {
  for (const hostname of ['preview.vercel.app', 'localhost', 'konference.animas.lv']) {
    const calls = [];
    const context = { URL, URLSearchParams, location: new URL(`https://${hostname}/admin/`), document: { addEventListener() {} }, window: { fetch: (...args) => { calls.push(args); } } };
    vm.runInNewContext(readFileSync(new URL('../config.js', import.meta.url), 'utf8'), context);
    const send = () => context.window.arcFetch(`${context.window.ARC_API_BASE}/admin-live?action=set-current`, { method: 'POST' });
    if (hostname === 'konference.animas.lv') await send();
    else {
      await assert.rejects(send(), /Priekšskatījumā/);
      assert.equal(calls.length, 0);
      await context.window.arcFetch(`${context.window.ARC_API_BASE}/admin-rehearsal?action=create`, { method: 'POST' });
      assert.equal(calls.length, 1);
    }
  }
});
