import { logger } from "./logger";

const SID = process.env.TWILIO_ACCOUNT_SID;
const TOKEN = process.env.TWILIO_AUTH_TOKEN;
const SERVICE_SID = process.env.TWILIO_VERIFY_SERVICE_SID;

const DEV_FALLBACK_CODE = "000000";

function configured(): boolean {
  return Boolean(SID && TOKEN && SERVICE_SID);
}

function authHeader(): string {
  const encoded = Buffer.from(`${SID}:${TOKEN}`).toString("base64");
  return `Basic ${encoded}`;
}

export async function startVerification(phone: string): Promise<void> {
  if (!configured()) {
    logger.info({ phone, devCode: DEV_FALLBACK_CODE }, "Verify (dev) — Twilio not configured; accept code 000000");
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
    logger.error({ status: res.status, body: text, phone }, "Twilio Verify start failed");
    throw new Error(`Twilio Verify start failed: ${res.status}`);
  }
}

export async function checkVerification(phone: string, code: string): Promise<boolean> {
  if (!configured()) {
    return code === DEV_FALLBACK_CODE;
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
    logger.error({ status: res.status, body: text, phone }, "Twilio Verify check failed");
    throw new Error(`Twilio Verify check failed: ${res.status}`);
  }
  const data = (await res.json().catch(() => null)) as { status?: string; valid?: boolean } | null;
  return data?.status === "approved" || data?.valid === true;
}
