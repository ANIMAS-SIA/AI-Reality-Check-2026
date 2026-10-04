import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const parserSource = readFileSync(new URL('../qa-csv.js', import.meta.url), 'utf8');
const parserContext = { globalThis: {} };
vm.runInNewContext(parserSource, parserContext);
const { parseAnswerCsv } = parserContext.globalThis.ARC_QA_CSV;

const firstId = '11111111-1111-4111-8111-111111111111';
const secondId = '22222222-2222-4222-8222-222222222222';

test('Q&A CSV parser supports Excel delimiters, quotes and multiline answers', () => {
  const comma = parseAnswerCsv(`question_id,question,answer\n${firstId},"Vai, ar komatu?","Jā, droši."\n${secondId},Otrs,"Divas\nrindas"`);
  assert.equal(comma.errors.length, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(comma.rows)), [
    { questionId: firstId, answer: 'Jā, droši.' },
    { questionId: secondId, answer: 'Divas\nrindas' },
  ]);

  const semicolon = parseAnswerCsv(`question_id;atbilde\n${firstId};Atbilde no Excel`);
  assert.equal(semicolon.errors.length, 0);
  assert.equal(semicolon.rows[0].answer, 'Atbilde no Excel');
});

test('Q&A CSV parser rejects ambiguous or incomplete imports', () => {
  assert.match(parseAnswerCsv('question,answer\nKas?,Jā').errors[0], /question_id/);
  assert.match(parseAnswerCsv(`question_id,answer\n${firstId},`).errors[0], /nav atbildes/);
  assert.match(parseAnswerCsv(`question_id,answer\n${firstId},Viena\n${firstId},Otra`).errors[0], /atkārtojas/);
});

test('question answer storage and bulk update are event-scoped and transactional', () => {
  const migration = readFileSync(new URL('../supabase/migrations/202610040001_question_answers.sql', import.meta.url), 'utf8');
  assert.match(migration, /add column if not exists answer_body text/i);
  assert.match(migration, /question\.event_id = p_event_id/i);
  assert.match(migration, /updated_count <> requested_count[\s\S]*raise exception/i);
  assert.match(migration, /revoke all on function public\.bulk_answer_questions[\s\S]*from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.bulk_answer_questions[\s\S]*to service_role/i);
});

test('public question response omits participant and anonymous session identifiers', () => {
  const source = readFileSync(new URL('../supabase/functions/questions/index.ts', import.meta.url), 'utf8');
  const select = source.match(/select:\s*"([^"]+)"/)?.[1] || '';
  assert.match(select, /answer_body/);
  assert.match(select, /agenda_items\(title,speaker_name\)/);
  assert.doesNotMatch(select, /participant_id|anonymous_session_id/);
});

test('AI Pass and admin expose the complete answer workflow', () => {
  const pass = readFileSync(new URL('../pass/index.html', import.meta.url), 'utf8');
  const admin = readFileSync(new URL('../admin/index.html', import.meta.url), 'utf8');
  const adminJs = readFileSync(new URL('../admin.js', import.meta.url), 'utf8');
  assert.match(pass, /id="qaAnswers"/);
  assert.match(pass, /id="passQaSearch"/);
  assert.match(pass, /id="passQaAgenda"/);
  assert.match(admin, /id="answersImportModal"/);
  assert.match(admin, /id="moderationExportQuestions"/);
  assert.match(adminJs, /action=answer/);
  assert.match(adminJs, /action=bulk-answer/);
  assert.match(adminJs, /agenda_item_id/);
});

test('admin CSV export is scoped by agenda item and includes speaker context', () => {
  const source = readFileSync(new URL('../supabase/functions/admin-questions/index.ts', import.meta.url), 'utf8');
  assert.match(source, /agenda_item_id = `eq\.\$\{agendaItemId\}`/);
  assert.match(source, /agenda_items\(title,speaker_name\)/);
  assert.match(source, /"programmas_punkts", "speaker"/);
});
