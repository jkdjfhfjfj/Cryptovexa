import type { Request } from "express";
import { q, record, transaction, uid } from "./platform";

export const ADMIN_SECURITY_ALERT_EMAIL = "ceeejaaay50@gmail.com";

export type AdminAccessEvent =
  | "page_access"
  | "location_shared"
  | "login_failed"
  | "twofa_challenge"
  | "twofa_failed"
  | "login_success"
  | "admin_setup";

export type AdminGeo = {
  latitude: number;
  longitude: number;
  accuracy: number;
};

const eventLabels: Record<AdminAccessEvent, string> = {
  page_access: "Admin login page opened",
  location_shared: "Device location shared",
  login_failed: "Admin sign-in failed",
  twofa_challenge: "Password accepted; authenticator code required",
  twofa_failed: "Authenticator verification failed",
  login_success: "Admin sign-in succeeded",
  admin_setup: "First administrator created",
};

const alertEveryTime = new Set<AdminAccessEvent>(["login_success", "admin_setup", "location_shared"]);

export function normalizeAdminGeo(value: unknown): AdminGeo | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.latitude !== "number" || typeof row.longitude !== "number" || typeof row.accuracy !== "number") return null;
  const latitude = Number(row.latitude);
  const longitude = Number(row.longitude);
  const accuracy = Number(row.accuracy);
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    !Number.isFinite(accuracy) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180 ||
    accuracy < 0 ||
    accuracy > 100_000
  ) return null;
  return {
    latitude: Number(latitude.toFixed(6)),
    longitude: Number(longitude.toFixed(6)),
    accuracy: Math.round(accuracy),
  };
}

function safeReferrerOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}

function emailHint(value: string | null, reveal: boolean): string | null {
  const email = String(value ?? "").trim().slice(0, 254);
  if (!email) return null;
  if (reveal) return email;
  const at = email.lastIndexOf("@");
  if (at < 1) return "unrecognized account";
  return `${email[0]}***${email.slice(at)}`;
}

export async function recordAdminAccess(
  req: Request,
  event: AdminAccessEvent,
  email: string | null = null,
  geoValue?: unknown,
  userId: string | null = null,
): Promise<string> {
  const id = uid();
  const geo = normalizeAdminGeo(geoValue);
  const ip = String(req.ip || req.socket.remoteAddress || "unknown").slice(0, 128);
  const userAgent = String(req.get("user-agent") ?? "").slice(0, 500) || null;
  const referrerOrigin = safeReferrerOrigin(req.get("referer"));
  const recordedAt = new Date().toISOString();
  const visibleEmail = emailHint(email, event === "login_success" || event === "admin_setup");
  const locationSummary = geo
    ? `${geo.latitude}, ${geo.longitude} (browser-reported, ±${geo.accuracy} m)`
    : "Precise location not shared";
  const eventData = {
    event,
    event_label: eventLabels[event],
    email: visibleEmail,
    ip,
    user_agent: userAgent,
    referrer_origin: referrerOrigin,
    geo,
    location_summary: locationSummary,
    recorded_at: recordedAt,
  };

  await record("admin_access", eventData, userId, id);
  if (process.env.NODE_ENV === "development") return id;

  const notification = {
    ...eventData,
    event_id: id,
    title: `Admin security alert: ${eventLabels[event]}`,
    username: "Security monitor",
  };
  await transaction(async (c) => {
    const throttleKey = `admin-access-alert:${event}:${ip}`;
    if (!alertEveryTime.has(event)) {
      await q("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [throttleKey], c);
      const [recent] = await q(
        `SELECT id FROM email_logs
         WHERE "to"=$1 AND template='admin_security_alert'
           AND data->>'event'=$2 AND data->>'ip'=$3
           AND created_at>now()-interval '5 minutes'
         ORDER BY created_at DESC LIMIT 1`,
        [ADMIN_SECURITY_ALERT_EMAIL, event, ip],
        c,
      );
      if (recent) return;
    }
    await q(
      `INSERT INTO email_logs(id,"to",template,data)
       VALUES($1,$2,'admin_security_alert',$3::jsonb)`,
      [uid(), ADMIN_SECURITY_ALERT_EMAIL, JSON.stringify(notification)],
      c,
    );
  });

  return id;
}
