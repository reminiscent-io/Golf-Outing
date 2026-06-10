import { logger } from "./logger";

const SID = process.env.TWILIO_ACCOUNT_SID;
const TOKEN = process.env.TWILIO_AUTH_TOKEN;
const SERVICE_SID = process.env.TWILIO_VERIFY_SERVICE_SID;

const IS_PRODUCTION = process.env.NODE_ENV === "production";

function configured(): boolean {
  return Boolean(SID && TOKEN && SERVICE_SID);
}

function authHeader(): string {
  const encoded = Buffer.from(`${SID}:${TOKEN}`).toString("base64");
  return `Basic ${encoded}`;
}

function assertConfigured(): void {
  if (!configured()) {
    throw new Error(
      "Twilio Verify is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_VERIFY_SERVICE_SID."
    );
  }
}

export async function startVerification(phone: string): Promise<void> {
  if (!configured()) {
    if (IS_PRODUCTION) {
      // Fail closed in production — never silently skip real OTP delivery
      assertConfigured();
    }
    logger.info({ phone }, "Verify (dev) — Twilio not configured; OTP step skipped");
    return;
  }
  const url = `https://verify.twilio.com/v2/Services/${SERVICE_SID}/Verifications`;
  const body = new URLSearchParams({ To: phone, Channel: "sms" });
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": authHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    logger.error({ status: res.status, phone }, "Twilio Verify start failed");
    throw new Error(`Twilio Verify start failed: ${res.status} — ${text}`);
  }
}

export async function checkVerification(phone: string, code: string): Promise<boolean> {
  if (!configured()) {
    if (IS_PRODUCTION) {
      // Fail closed in production — never accept a magic code
      assertConfigured();
    }
    // Dev-only convenience: reject everything, forcing the caller to handle failure
    // (no magic bypass code accepted)
    logger.warn({ phone }, "Verify (dev) — Twilio not configured; rejecting all codes");
    return false;
  }
  const url = `https://verify.twilio.com/v2/Services/${SERVICE_SID}/VerificationCheck`;
  const body = new URLSearchParams({ To: phone, Code: code });
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": authHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
  if (!res.ok) {
    if (res.status === 404) return false; // no pending verification for this phone
    const text = await res.text().catch(() => "");
    logger.error({ status: res.status, phone }, "Twilio Verify check failed");
    throw new Error(`Twilio Verify check failed: ${res.status} — ${text}`);
  }
  const data = (await res.json().catch(() => null)) as { status?: string; valid?: boolean } | null;
  return data?.status === "approved" || data?.valid === true;
}
