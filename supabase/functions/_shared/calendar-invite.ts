import { SupabaseRest } from "./supabase-rest.ts";

type EventWithCalendar = {
  id: string;
  name?: string;
  graph_calendar_user?: string | null;
  microsoft_graph_event_id?: string | null;
};

type ParticipantForInvite = {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
};

export type CalendarInviteResult = {
  provider: "microsoft_graph";
  status: "queued" | "sent" | "skipped" | "failed";
  external_event_id?: string;
  error_message?: string;
  response?: Record<string, unknown>;
};

function clean(value?: string | null) {
  return (value || "").trim();
}

function displayName(participant: ParticipantForInvite) {
  return `${participant.first_name} ${participant.last_name}`.trim() || participant.email;
}

function graphConfig(event: EventWithCalendar) {
  return {
    tenantId: clean(Deno.env.get("MICROSOFT_TENANT_ID")),
    clientId: clean(Deno.env.get("MICROSOFT_CLIENT_ID")),
    clientSecret: clean(Deno.env.get("MICROSOFT_CLIENT_SECRET")),
    calendarUser: clean(event.graph_calendar_user) || clean(Deno.env.get("MICROSOFT_GRAPH_CALENDAR_USER")) || "konference@animas.lv",
    eventId: clean(event.microsoft_graph_event_id) || clean(Deno.env.get("MICROSOFT_GRAPH_EVENT_ID")),
  };
}

async function graphAccessToken(config: ReturnType<typeof graphConfig>) {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });
  const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || `Microsoft token request failed: ${response.status}`);
  }
  return String(data.access_token);
}

async function graphJson(token: string, url: string, init: RequestInit = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: 'outlook.timezone="FLE Standard Time"',
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(data.error?.message || `Microsoft Graph failed: ${response.status} ${text}`);
  }
  return data as Record<string, unknown>;
}

export async function addParticipantToCalendarInvite(
  event: EventWithCalendar,
  participant: ParticipantForInvite,
): Promise<CalendarInviteResult> {
  const config = graphConfig(event);
  if (!config.tenantId || !config.clientId || !config.clientSecret || !config.calendarUser || !config.eventId) {
    return {
      provider: "microsoft_graph",
      status: "skipped",
      error_message: "Microsoft Graph calendar secrets or eventId are not configured",
    };
  }

  try {
    const token = await graphAccessToken(config);
    const user = encodeURIComponent(config.calendarUser);
    const eventId = encodeURIComponent(config.eventId);
    const eventUrl =
      `https://graph.microsoft.com/v1.0/users/${user}/events/${eventId}?$select=id,attendees,hideAttendees,responseRequested`;
    const current = await graphJson(token, eventUrl);
    const attendees = Array.isArray(current.attendees) ? current.attendees as Record<string, unknown>[] : [];
    const email = participant.email.toLowerCase();
    const alreadyInvited = attendees.some((attendee) => {
      const emailAddress = attendee.emailAddress as { address?: string } | undefined;
      return clean(emailAddress?.address).toLowerCase() === email;
    });

    if (alreadyInvited) {
      return {
        provider: "microsoft_graph",
        status: "skipped",
        external_event_id: config.eventId,
        response: { reason: "already_attendee" },
      };
    }

    const nextAttendees = [
      ...attendees,
      {
        emailAddress: {
          address: participant.email,
          name: displayName(participant),
        },
        type: "required",
      },
    ];

    const updated = await graphJson(token, `https://graph.microsoft.com/v1.0/users/${user}/events/${eventId}`, {
      method: "PATCH",
      body: JSON.stringify({
        attendees: nextAttendees,
        hideAttendees: true,
        responseRequested: true,
      }),
    });

    return {
      provider: "microsoft_graph",
      status: "sent",
      external_event_id: String(updated.id || config.eventId),
      response: {
        changeKey: updated.changeKey,
        iCalUId: updated.iCalUId,
      },
    };
  } catch (error) {
    return {
      provider: "microsoft_graph",
      status: "failed",
      external_event_id: config.eventId,
      error_message: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function logCalendarInvite(
  db: SupabaseRest,
  event: EventWithCalendar,
  participant: ParticipantForInvite,
  result: CalendarInviteResult,
) {
  await db.insert("calendar_invites", [{
    event_id: event.id,
    participant_id: participant.id,
    provider: result.provider,
    status: result.status,
    sent_to: participant.email,
    external_event_id: result.external_event_id || event.microsoft_graph_event_id || Deno.env.get("MICROSOFT_GRAPH_EVENT_ID") || null,
    provider_response: result.response || {},
    error_message: result.error_message || null,
  }]);
}
