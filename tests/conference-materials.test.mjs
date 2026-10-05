import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../supabase/migrations/202610050001_conference_materials.sql', import.meta.url), 'utf8');
const materialFunction = readFileSync(new URL('../supabase/functions/conference-materials/index.ts', import.meta.url), 'utf8');
const registrationsFunction = readFileSync(new URL('../supabase/functions/admin-registrations/index.ts', import.meta.url), 'utf8');
const admin = readFileSync(new URL('../admin/index.html', import.meta.url), 'utf8');
const adminJs = readFileSync(new URL('../admin.js', import.meta.url), 'utf8');

test('conference PDF metadata is private, event-scoped and limited to 30 days', () => {
  assert.match(migration, /create table public\.conference_materials/i);
  assert.match(migration, /event_id uuid not null references public\.events/i);
  assert.match(migration, /published_at timestamptz/i);
  assert.match(materialFunction, /expires_at:\s*addDays\(publishedAt, 30\)/i);
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /revoke all on public\.conference_materials from public, anon, authenticated/i);
  assert.match(materialFunction, /const BUCKET = "conference-materials"/);
  assert.match(materialFunction, /public:\s*false/);
  assert.match(materialFunction, /fileSizeLimit:\s*MAX_FILE_BYTES/);
  assert.match(materialFunction, /allowedMimeTypes:\s*\["application\/pdf"\]/);
});

test('expired and replaced PDFs are physically removed through the Storage API', () => {
  assert.match(materialFunction, /storageAdmin\(\)\.storage\.from\(BUCKET\)\.remove\(paths\)/);
  assert.match(materialFunction, /expires_at:\s*`lte\.\$\{new Date\(\)\.toISOString\(\)\}`/);
  assert.match(migration, /cron\.schedule\([\s\S]*conference-materials\?action=cleanup/i);
  assert.match(migration, /vault\.decrypted_secrets[\s\S]*arc_project_url/i);
  assert.match(migration, /vault\.decrypted_secrets[\s\S]*arc_publishable_key/i);
  assert.match(materialFunction, /conference_materials[\s\S]*expires_at:\s*new Date\(Date\.now\(\) \+ 2 \* 60 \* 60 \* 1000\)/i);
  assert.match(materialFunction, /storage_path:\s*`eq\.\$\{path\}`[\s\S]*published_at:\s*"is\.null"/i);
});

test('public downloads use short-lived signed URLs while uploads require an organizer', () => {
  assert.match(materialFunction, /MANAGE_ROLES = \["superadmin", "organizer"\]/);
  assert.match(materialFunction, /authenticateAdmin\(request, db, \[\.\.\.MANAGE_ROLES\]\)/);
  assert.match(materialFunction, /createSignedUploadUrl\(path\)/);
  assert.match(materialFunction, /createSignedUrl\(row\.storage_path, 90/);
  assert.match(materialFunction, /expires_at:\s*`gt\.\$\{new Date\(\)\.toISOString\(\)\}`/);
});

test('admin upload and existing bulk email flow share a stable personalized materials URL', () => {
  assert.match(admin, /id="conferenceMaterialFile"/);
  assert.match(admin, /id="conferenceMaterialUpload"/);
  assert.match(admin, /\{\{materialsUrl\}\}/);
  assert.match(adminJs, /uploadToSignedUrl/);
  assert.match(adminJs, /conference-materials\?action=finalize/);
  assert.match(adminJs, /"\{\{materialsUrl\}\}"/);
  assert.match(registrationsFunction, /materialsUrl:\s*materialsLink\(passLink\)/);
  assert.match(registrationsFunction, /url\.searchParams\.set\("view", "qa"\)/);
  assert.match(registrationsFunction, /url\.searchParams\.set\("token", token\)/);
});
