import { createClient } from "npm:@supabase/supabase-js@2";
import { AdminAuthError, adminAuthErrorResponse, authenticateAdmin, logAudit } from "../_shared/auth.ts";
import { errorResponse, handleOptions, jsonResponse, readJson, requiredEnv } from "../_shared/http.ts";
import { SupabaseRest } from "../_shared/supabase-rest.ts";
import { addDays } from "../_shared/tokens.ts";

const BUCKET = "conference-materials";
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MANAGE_ROLES = ["superadmin", "organizer"] as const;

type EventRow = { id: string; slug: string; is_test: boolean };
type MaterialRow = {
  id: string;
  event_id: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  published_at: string | null;
  expires_at: string;
  deleted_at: string | null;
  created_by: string | null;
  created_at: string;
};
type UploadPayload = { fileName?: string; sizeBytes?: number; mimeType?: string };
type FinalizePayload = UploadPayload & { path?: string };

function storageAdmin() {
  return createClient(requiredEnv("SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function getEvent(db: SupabaseRest): Promise<EventRow> {
  const event = (await db.select<EventRow>("events", { slug: `eq.${db.eventSlug}`, limit: 1 }))[0];
  if (!event) throw new Error(`Event not found: ${db.eventSlug}`);
  return event;
}

function safeFileName(value?: string): string {
  const normalized = (value || "").trim().replace(/[\\/\u0000-\u001f]+/g, "-").slice(0, 160);
  return normalized.toLocaleLowerCase().endsWith(".pdf") ? normalized : "ai-reality-check-prezentacijas.pdf";
}

function validateUpload(payload: UploadPayload): string | null {
  const size = Number(payload.sizeBytes);
  if (!Number.isFinite(size) || size <= 0) return "PDF fails ir tukšs.";
  if (size > MAX_FILE_BYTES) return "PDF fails pārsniedz 50 MB ierobežojumu.";
  if (payload.mimeType && payload.mimeType !== "application/pdf") return "Atļauts augšupielādēt tikai PDF failu.";
  if (!(payload.fileName || "").toLocaleLowerCase().endsWith(".pdf")) return "Faila paplašinājumam jābūt .pdf.";
  return null;
}

async function ensureBucket() {
  const storage = storageAdmin().storage;
  const { error: getError } = await storage.getBucket(BUCKET);
  if (!getError) return;
  const { error } = await storage.createBucket(BUCKET, {
    public: false,
    fileSizeLimit: MAX_FILE_BYTES,
    allowedMimeTypes: ["application/pdf"],
  });
  if (error && !/already exists/i.test(error.message)) throw error;
}

async function removeMaterials(db: SupabaseRest, rows: MaterialRow[]): Promise<number> {
  if (!rows.length) return 0;
  const paths = [...new Set(rows.map((row) => row.storage_path))];
  const { error } = await storageAdmin().storage.from(BUCKET).remove(paths);
  if (error) throw error;
  const deletedAt = new Date().toISOString();
  await Promise.all(rows.map((row) => db.update("conference_materials", { deleted_at: deletedAt }, { id: `eq.${row.id}` })));
  return rows.length;
}

async function cleanupExpired(db: SupabaseRest): Promise<number> {
  const rows = await db.select<MaterialRow>("conference_materials", {
    deleted_at: "is.null",
    expires_at: `lte.${new Date().toISOString()}`,
    order: "expires_at.asc",
    limit: 100,
  });
  return await removeMaterials(db, rows);
}

async function currentMaterial(db: SupabaseRest): Promise<MaterialRow | null> {
  return (await db.select<MaterialRow>("conference_materials", {
    deleted_at: "is.null",
    published_at: "not.is.null",
    expires_at: `gt.${new Date().toISOString()}`,
    order: "created_at.desc",
    limit: 1,
  }))[0] || null;
}

function publicMaterial(row: MaterialRow | null) {
  if (!row) return null;
  return {
    id: row.id,
    fileName: row.file_name,
    sizeBytes: row.size_bytes,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

async function createUpload(db: SupabaseRest, request: Request, event: EventRow): Promise<Response> {
  const actor = await authenticateAdmin(request, db, [...MANAGE_ROLES]);
  if (event.is_test) return errorResponse("Mēģinājumā materiālu augšupielāde ir atslēgta.", 400);
  const payload = await readJson<UploadPayload>(request);
  const invalid = validateUpload(payload);
  if (invalid) return errorResponse(invalid, 400);
  await ensureBucket();
  const fileName = safeFileName(payload.fileName);
  const storageName = fileName.toLocaleLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "materials.pdf";
  const path = `${event.id}/${crypto.randomUUID()}-${storageName}`;
  const { data, error } = await storageAdmin().storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data?.token) throw error || new Error("Signed upload URL was not created");
  const pending = (await db.insert<MaterialRow>("conference_materials", [{
    event_id: event.id,
    storage_path: path,
    file_name: fileName,
    mime_type: "application/pdf",
    size_bytes: Number(payload.sizeBytes),
    expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    created_by: actor.userId,
  }]))[0];
  await logAudit(db, actor, "conference_material_upload_started", "conference_materials", pending.id, {
    file_name: fileName,
    size_bytes: Number(payload.sizeBytes),
  });
  return jsonResponse({ upload: { bucket: BUCKET, path, token: data.token, materialId: pending.id } });
}

async function finalizeUpload(db: SupabaseRest, request: Request, event: EventRow): Promise<Response> {
  const actor = await authenticateAdmin(request, db, [...MANAGE_ROLES]);
  const payload = await readJson<FinalizePayload>(request);
  const invalid = validateUpload(payload);
  if (invalid) return errorResponse(invalid, 400);
  const path = (payload.path || "").trim();
  if (!path.startsWith(`${event.id}/`) || path.includes("..")) return errorResponse("Nederīgs Storage ceļš.", 400);
  const pending = (await db.select<MaterialRow>("conference_materials", {
    storage_path: `eq.${path}`,
    published_at: "is.null",
    deleted_at: "is.null",
    limit: 1,
  }))[0];
  if (!pending || pending.created_by !== actor.userId) return errorResponse("Augšupielādes sesija nav atrasta.", 404);

  const objectName = path.slice(event.id.length + 1);
  const { data: objects, error: listError } = await storageAdmin().storage.from(BUCKET).list(event.id, {
    search: objectName,
    limit: 10,
  });
  if (listError) throw listError;
  const object = objects?.find((item) => item.name === objectName);
  if (!object) return errorResponse("Augšupielādētais PDF Storage nav atrasts.", 400);
  const storedSize = Number(object.metadata?.size || payload.sizeBytes);
  const storedMime = String(object.metadata?.mimetype || object.metadata?.contentType || "application/pdf");
  if (storedSize > MAX_FILE_BYTES || storedSize <= 0 || storedMime !== "application/pdf") {
    await storageAdmin().storage.from(BUCKET).remove([path]);
    await db.update("conference_materials", { deleted_at: new Date().toISOString() }, { id: `eq.${pending.id}` });
    return errorResponse("Storage objekts neatbilst PDF prasībām.", 400);
  }

  const publishedAt = new Date();
  const inserted = (await db.update<MaterialRow>("conference_materials", {
    file_name: safeFileName(payload.fileName),
    size_bytes: storedSize,
    published_at: publishedAt.toISOString(),
    expires_at: addDays(publishedAt, 30),
  }, { id: `eq.${pending.id}` }))[0];

  const previous = await db.select<MaterialRow>("conference_materials", {
    deleted_at: "is.null",
    published_at: "not.is.null",
    id: `neq.${inserted.id}`,
    order: "created_at.desc",
    limit: 20,
  });
  await removeMaterials(db, previous);
  await logAudit(db, actor, "conference_material_published", "conference_materials", inserted.id, {
    file_name: inserted.file_name,
    size_bytes: inserted.size_bytes,
    expires_at: inserted.expires_at,
  });
  return jsonResponse({ material: publicMaterial(inserted) }, 201);
}

async function deleteMaterial(db: SupabaseRest, request: Request, materialId: string): Promise<Response> {
  const actor = await authenticateAdmin(request, db, [...MANAGE_ROLES]);
  const row = (await db.select<MaterialRow>("conference_materials", { id: `eq.${materialId}`, deleted_at: "is.null", limit: 1 }))[0];
  if (!row) return errorResponse("Materiāls nav atrasts.", 404);
  await removeMaterials(db, [row]);
  await logAudit(db, actor, "conference_material_deleted", "conference_materials", row.id, { file_name: row.file_name });
  return jsonResponse({ ok: true });
}

async function downloadMaterial(db: SupabaseRest, materialId: string): Promise<Response> {
  const row = (await db.select<MaterialRow>("conference_materials", {
    id: `eq.${materialId}`,
    deleted_at: "is.null",
    expires_at: `gt.${new Date().toISOString()}`,
    limit: 1,
  }))[0];
  if (!row) return errorResponse("Materiāls vairs nav pieejams.", 404);
  const { data, error } = await storageAdmin().storage.from(BUCKET).createSignedUrl(row.storage_path, 90, {
    download: row.file_name,
  });
  if (error || !data?.signedUrl) throw error || new Error("Signed download URL was not created");
  return jsonResponse({ downloadUrl: data.signedUrl, expiresIn: 90 });
}

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  try {
    const db = new SupabaseRest(request);
    await db.assertRehearsalSafe(request);
    const event = await getEvent(db);
    const url = new URL(request.url);
    const action = url.searchParams.get("action") || "current";

    if (request.method === "GET" && action === "current") {
      await cleanupExpired(db).catch((error) => console.error("Material cleanup failed", error));
      return jsonResponse({ material: publicMaterial(await currentMaterial(db)) });
    }
    if (request.method === "GET" && action === "download") {
      await cleanupExpired(db).catch((error) => console.error("Material cleanup failed", error));
      return await downloadMaterial(db, url.searchParams.get("id") || "");
    }
    if (request.method === "GET" && action === "admin") {
      await authenticateAdmin(request, db, [...MANAGE_ROLES]);
      const materials = await db.select<MaterialRow>("conference_materials", { order: "created_at.desc", limit: 20 });
      return jsonResponse({
        current: publicMaterial(await currentMaterial(db)),
        materials: materials.map((row) => ({ ...publicMaterial(row), deletedAt: row.deleted_at })),
      });
    }
    if (request.method === "POST" && action === "cleanup") {
      return jsonResponse({ deleted: await cleanupExpired(db) });
    }
    if (request.method === "POST" && action === "create-upload") return await createUpload(db, request, event);
    if (request.method === "POST" && action === "finalize") return await finalizeUpload(db, request, event);
    if (request.method === "POST" && action === "delete") {
      return await deleteMaterial(db, request, url.searchParams.get("id") || "");
    }
    return errorResponse("Unsupported action", 400);
  } catch (error) {
    if (error instanceof AdminAuthError) return adminAuthErrorResponse(error);
    console.error("Conference materials failed", error);
    return errorResponse("Conference materials failed", 500);
  }
});

