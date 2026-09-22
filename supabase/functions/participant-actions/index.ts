import { errorResponse, handleOptions, jsonResponse, readJson, requiredEnv } from "../_shared/http.ts";
import { SupabaseRest } from "../_shared/supabase-rest.ts";
import { hashToken } from "../_shared/tokens.ts";
import { sendEmail, logEmail } from "../_shared/email.ts";

type TokenRow = {
  participant_id: string;
  expires_at: string | null;
  revoked_at: string | null;
};

type ParticipantRow = {
  id: string;
  status: string;
  cancelled_at: string | null;
  lunch_opt_out: boolean;
  lunch_opted_out_at: string | null;
  attendance_reconfirmed_at: string | null;
  email: string;
  first_name: string;
};

type RequestPayload = {
  action?: unknown;
  token?: unknown;
};

type ResponsePayload = {
  success: boolean;
  status: string;
  cancelledAt: string | null;
  lunchOptOut: boolean;
  lunchOptedOutAt: string | null;
  attendanceReconfirmedAt: string | null;
};

type ErrorThrow = {
  code: string;
  message: string;
  status: number;
};

const ALLOWED_ACTIONS = ["cancel_registration", "opt_out_lunch", "reconfirm_attendance"];
const CANCELLABLE_STATUSES = ["approved", "reconfirm_required"];
const LUNCH_OPT_OUT_STATUSES = ["approved", "reconfirm_required"];
const RECONFIRMABLE_STATUSES = ["approved", "reconfirm_required"];

async function validateToken(
  token: string,
  db: SupabaseRest,
): Promise<{ participant_id: string } | null> {
  if (!token) return null;

  try {
    const tokenHash = await hashToken(token, requiredEnv("TOKEN_PEPPER"));
    const tokenRows = await db.select<TokenRow>("participant_tokens", {
      token_hash: `eq.${tokenHash}`,
      purpose: "eq.magic_link",
      revoked_at: "is.null",
      limit: 1,
    });

    const tokenRow = tokenRows[0];
    if (!tokenRow) return null;

    if (tokenRow.expires_at && new Date(tokenRow.expires_at).getTime() < Date.now()) {
      return null;
    }

    return { participant_id: tokenRow.participant_id };
  } catch {
    return null;
  }
}

async function getParticipantState(
  db: SupabaseRest,
  participantId: string,
): Promise<ParticipantRow | null> {
  const participants = await db.select<ParticipantRow>("participants", {
    id: `eq.${participantId}`,
    limit: 1,
  });

  return participants[0] ?? null;
}

async function cancelRegistration(
  db: SupabaseRest,
  participantId: string,
): Promise<ParticipantRow> {
  const participant = await getParticipantState(db, participantId);

  if (!participant) {
    throw {
      code: "NOT_FOUND",
      message: "Participant not found",
      status: 404,
    } as ErrorThrow;
  }

  if (participant.status === "cancelled") {
    return participant;
  }

  if (!CANCELLABLE_STATUSES.includes(participant.status)) {
    throw {
      code: "FORBIDDEN",
      message: `Cannot cancel registration with status: ${participant.status}`,
      status: 403,
    } as ErrorThrow;
  }

  const updated = await db.update<ParticipantRow>(
    "participants",
    {
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
    },
    {
      id: `eq.${participantId}`,
      status: `in.(${CANCELLABLE_STATUSES.join(",")})`,
    },
  );

  if (updated.length === 0) {
    const current = await getParticipantState(db, participantId);
    if (!current) {
      throw {
        code: "NOT_FOUND",
        message: "Participant not found",
        status: 404,
      } as ErrorThrow;
    }
    if (current.status === "cancelled") {
      return current;
    }
    throw {
      code: "CONFLICT",
      message: "Registration cancellation failed: status changed",
      status: 409,
    } as ErrorThrow;
  }

  const updatedParticipant = updated[0];
  const emailResult = await sendEmail(updatedParticipant.email, "registration_cancelled", {
    firstName: updatedParticipant.first_name,
  });
  await logEmail(db, participantId, "registration_cancelled", updatedParticipant.email, emailResult);

  return updatedParticipant;
}

async function optOutLunch(
  db: SupabaseRest,
  participantId: string,
): Promise<ParticipantRow> {
  const participant = await getParticipantState(db, participantId);

  if (!participant) {
    throw {
      code: "NOT_FOUND",
      message: "Participant not found",
      status: 404,
    } as ErrorThrow;
  }

  if (participant.lunch_opt_out) {
    return participant;
  }

  if (!LUNCH_OPT_OUT_STATUSES.includes(participant.status)) {
    throw {
      code: "FORBIDDEN",
      message: `Cannot opt out of lunch with status: ${participant.status}`,
      status: 403,
    } as ErrorThrow;
  }

  const updated = await db.update<ParticipantRow>(
    "participants",
    {
      lunch_opt_out: true,
      lunch_opted_out_at: new Date().toISOString(),
    },
    {
      id: `eq.${participantId}`,
      status: `in.(${LUNCH_OPT_OUT_STATUSES.join(",")})`,
    },
  );

  if (updated.length === 0) {
    const current = await getParticipantState(db, participantId);
    if (!current) {
      throw {
        code: "NOT_FOUND",
        message: "Participant not found",
        status: 404,
      } as ErrorThrow;
    }
    if (current.lunch_opt_out) {
      return current;
    }
    throw {
      code: "CONFLICT",
      message: "Lunch opt-out failed: status changed",
      status: 409,
    } as ErrorThrow;
  }

  return updated[0];
}

async function reconfirmAttendance(
  db: SupabaseRest,
  participantId: string,
): Promise<ParticipantRow> {
  const participant = await getParticipantState(db, participantId);

  if (!participant) {
    throw {
      code: "NOT_FOUND",
      message: "Participant not found",
      status: 404,
    } as ErrorThrow;
  }

  if (participant.attendance_reconfirmed_at) {
    return participant;
  }

  if (!RECONFIRMABLE_STATUSES.includes(participant.status)) {
    throw {
      code: "FORBIDDEN",
      message: `Cannot reconfirm attendance with status: ${participant.status}`,
      status: 403,
    } as ErrorThrow;
  }

  const updated = await db.update<ParticipantRow>(
    "participants",
    {
      attendance_reconfirmed_at: new Date().toISOString(),
    },
    {
      id: `eq.${participantId}`,
      status: `in.(${RECONFIRMABLE_STATUSES.join(",")})`,
    },
  );

  if (updated.length === 0) {
    const current = await getParticipantState(db, participantId);
    if (!current) {
      throw {
        code: "NOT_FOUND",
        message: "Participant not found",
        status: 404,
      } as ErrorThrow;
    }
    if (current.attendance_reconfirmed_at) {
      return current;
    }
    throw {
      code: "CONFLICT",
      message: "Attendance reconfirmation failed: status changed",
      status: 409,
    } as ErrorThrow;
  }

  return updated[0];
}

function formatResponse(participant: ParticipantRow): ResponsePayload {
  return {
    success: true,
    status: participant.status,
    cancelledAt: participant.cancelled_at,
    lunchOptOut: participant.lunch_opt_out,
    lunchOptedOutAt: participant.lunch_opted_out_at,
    attendanceReconfirmedAt: participant.attendance_reconfirmed_at,
  };
}

function validateRequestPayload(payload: unknown): {
  action: string;
  token: string;
} {
  if (!payload || typeof payload !== "object") {
    throw {
      code: "BAD_REQUEST",
      message: "Request body must be a JSON object",
      status: 400,
    } as ErrorThrow;
  }

  const { action, token } = payload as RequestPayload;

  if (typeof action !== "string") {
    throw {
      code: "BAD_REQUEST",
      message: "action must be a string",
      status: 400,
    } as ErrorThrow;
  }

  if (typeof token !== "string") {
    throw {
      code: "BAD_REQUEST",
      message: "token must be a string",
      status: 400,
    } as ErrorThrow;
  }

  const trimmedToken = token.trim();
  if (!trimmedToken) {
    throw {
      code: "BAD_REQUEST",
      message: "token cannot be empty",
      status: 400,
    } as ErrorThrow;
  }

  if (!ALLOWED_ACTIONS.includes(action)) {
    throw {
      code: "BAD_REQUEST",
      message: "Invalid action",
      status: 400,
    } as ErrorThrow;
  }

  return { action, token: trimmedToken };
}

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  if (request.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  try {
    const payload = await readJson<unknown>(request);
    const { action, token } = validateRequestPayload(payload);

    const db = new SupabaseRest(request);
    await db.assertRehearsalSafe(request);
    const tokenResult = await validateToken(token, db);

    if (!tokenResult) {
      return errorResponse("Invalid or expired token", 401);
    }

    const participantId = tokenResult.participant_id;

    let updatedParticipant: ParticipantRow;

    if (action === "cancel_registration") {
      updatedParticipant = await cancelRegistration(db, participantId);
    } else if (action === "opt_out_lunch") {
      updatedParticipant = await optOutLunch(db, participantId);
    } else if (action === "reconfirm_attendance") {
      updatedParticipant = await reconfirmAttendance(db, participantId);
    } else {
      return errorResponse("Invalid action", 400);
    }

    const response = formatResponse(updatedParticipant);
    return jsonResponse(response);
  } catch (error) {
    const err = error as unknown;

    if (
      err !== null &&
      typeof err === "object" &&
      "status" in err &&
      typeof (err as { status?: unknown }).status === "number"
    ) {
      const typedErr = err as ErrorThrow;
      return errorResponse(typedErr.message || "Action failed", typedErr.status);
    }

    if (error instanceof Error && error.message.includes("Invalid JSON")) {
      return errorResponse("Invalid JSON in request body", 400);
    }

    return errorResponse("Action failed", 500);
  }
});
