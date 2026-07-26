import { logger } from "./logger";
import { maskPhone } from "./otp";

// Env values are trimmed: secrets pasted into a hosting dashboard routinely pick
// up a trailing newline or space, which silently corrupts the Basic auth header
// and comes back from Twilio as a 401.
const SID = process.env.TWILIO_ACCOUNT_SID?.trim() || undefined;
const TOKEN = process.env.TWILIO_AUTH_TOKEN?.trim() || undefined;
const SERVICE_SID = process.env.TWILIO_VERIFY_SERVICE_SID?.trim() || undefined;

const IS_PRODUCTION = process.env.NODE_ENV === "production";

const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Why a Verify call failed, in terms the API layer can turn into a status code.
 *
 * - `config`        our credentials or service SID are wrong — only an operator can fix it
 * - `invalid_phone` Twilio won't accept the number (bad E.164, landline, unreachable)
 * - `unverified`    Twilio trial account; the recipient isn't on the verified-caller list
 * - `blocked`       carrier, geo permissions, opt-out, or Fraud Guard refused delivery
 * - `rate_limited`  too many sends/checks for this number
 * - `network`       the request never reached Twilio
 * - `upstream`      anything else Twilio returned
 */
export type VerifyFailureKind =
  | "config"
  | "invalid_phone"
  | "unverified"
  | "blocked"
  | "rate_limited"
  | "network"
  | "upstream";

export class TwilioVerifyError extends Error {
  readonly name = "TwilioVerifyError";
  readonly kind: VerifyFailureKind;
  /** Twilio's HTTP status, or null when the request never completed. */
  readonly httpStatus: number | null;
  /** Twilio's numeric error code (e.g. 60203), when the body carried one. */
  readonly twilioCode: number | null;
  readonly twilioMessage: string | null;
  /** Operator-facing hint — safe for logs, never for API responses. */
  readonly hint: string;

  constructor(init: {
    kind: VerifyFailureKind;
    httpStatus: number | null;
    twilioCode: number | null;
    twilioMessage: string | null;
    hint: string;
    operation: "start" | "check";
  }) {
    super(
      `Twilio Verify ${init.operation} failed (${init.kind}): ` +
        `http=${init.httpStatus ?? "none"} code=${init.twilioCode ?? "none"} ` +
        `message=${init.twilioMessage ?? "none"}`
    );
    Object.setPrototypeOf(this, new.target.prototype);
    this.kind = init.kind;
    this.httpStatus = init.httpStatus;
    this.twilioCode = init.twilioCode;
    this.twilioMessage = init.twilioMessage;
    this.hint = init.hint;
  }
}

type Classification = { kind: VerifyFailureKind; hint: string };

// Twilio error codes we can act on. Anything unlisted falls through to the
// HTTP-status heuristics below. See https://www.twilio.com/docs/api/errors
const CODE_TABLE: Record<number, Classification> = {
  20003: { kind: "config", hint: "Authentication failed — TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN are wrong, rotated, or belong to a different account." },
  20404: { kind: "config", hint: "Twilio returned 'not found' for the Verify service — TWILIO_VERIFY_SERVICE_SID is wrong or belongs to a different account." },
  20429: { kind: "rate_limited", hint: "Twilio account-level rate limit hit." },
  21211: { kind: "invalid_phone", hint: "Twilio rejected the 'To' number as invalid — check the country code." },
  21608: { kind: "unverified", hint: "Trial account: add this number to Verified Caller IDs in the Twilio console, or upgrade the account." },
  21610: { kind: "blocked", hint: "The recipient replied STOP and is unsubscribed; they must text START to resubscribe." },
  21612: { kind: "blocked", hint: "Twilio cannot route SMS to this number from the account's sending numbers." },
  21614: { kind: "invalid_phone", hint: "The number is not SMS-capable (likely a landline or VoIP)." },
  60200: { kind: "invalid_phone", hint: "Invalid parameter — usually a 'To' number that isn't valid E.164." },
  60202: { kind: "rate_limited", hint: "Max check attempts reached for this verification; a new code must be requested." },
  60203: { kind: "rate_limited", hint: "Max send attempts reached for this number — Twilio blocks further sends for ~10 minutes." },
  60205: { kind: "invalid_phone", hint: "SMS is not supported by this landline number." },
  60212: { kind: "rate_limited", hint: "Too many concurrent verification requests for this number." },
  60223: { kind: "config", hint: "The SMS delivery channel is disabled on this Verify service — enable it in the Twilio console." },
  60410: { kind: "blocked", hint: "Twilio blocked delivery for this number (geo permissions or carrier filtering)." },
  60605: { kind: "blocked", hint: "Fraud Guard blocked this destination. Review Verify Fraud Guard settings in the Twilio console." },
};

/**
 * Map a Twilio failure onto a `VerifyFailureKind`. Pure so it can be unit-tested
 * without touching the network.
 */
export function classifyTwilioError(
  httpStatus: number | null,
  twilioCode: number | null
): Classification {
  if (twilioCode != null && CODE_TABLE[twilioCode]) {
    return CODE_TABLE[twilioCode];
  }
  if (httpStatus === 401 || httpStatus === 403) {
    // Twilio always names a code (e.g. 20003) when it rejects credentials. A
    // bare 401/403 means something in between answered instead — an egress
    // proxy, firewall, or host allowlist — so the credentials aren't the story.
    if (twilioCode == null) {
      return {
        kind: "network",
        hint: "Received 401/403 with no Twilio error code, so the request was intercepted before reaching Twilio. Check that verify.twilio.com is allowed by the deployment's outbound network/egress rules.",
      };
    }
    return { kind: "config", hint: "Twilio rejected our credentials — check the account SID/auth token and that the token has not been rotated." };
  }
  if (httpStatus === 404) {
    return { kind: "config", hint: "Twilio returned 404 — the Verify service SID is almost certainly wrong." };
  }
  if (httpStatus === 429) {
    return { kind: "rate_limited", hint: "Twilio rate limit hit." };
  }
  if (httpStatus != null && httpStatus >= 500) {
    return { kind: "upstream", hint: "Twilio returned a server error; retrying later should succeed." };
  }
  return { kind: "upstream", hint: "Unrecognized Twilio failure — see twilioCode and twilioMessage." };
}

function configured(): boolean {
  return Boolean(SID && TOKEN && SERVICE_SID);
}

function authHeader(): string {
  const encoded = Buffer.from(`${SID}:${TOKEN}`).toString("base64");
  return `Basic ${encoded}`;
}

function notConfiguredError(operation: "start" | "check"): TwilioVerifyError {
  const missing = [
    !SID && "TWILIO_ACCOUNT_SID",
    !TOKEN && "TWILIO_AUTH_TOKEN",
    !SERVICE_SID && "TWILIO_VERIFY_SERVICE_SID",
  ].filter(Boolean);
  return new TwilioVerifyError({
    kind: "config",
    httpStatus: null,
    twilioCode: null,
    twilioMessage: null,
    hint: `Twilio Verify is not configured. Missing: ${missing.join(", ")}.`,
    operation,
  });
}

/**
 * Report whether Twilio credentials are present and shaped correctly. Used at
 * boot so a misconfigured deploy is obvious in the logs before anyone tries to
 * sign in. Never returns the secrets themselves.
 */
export function verifyConfigStatus(): {
  configured: boolean;
  missing: string[];
  warnings: string[];
} {
  const missing = [
    !SID && "TWILIO_ACCOUNT_SID",
    !TOKEN && "TWILIO_AUTH_TOKEN",
    !SERVICE_SID && "TWILIO_VERIFY_SERVICE_SID",
  ].filter((v): v is string => Boolean(v));

  const warnings: string[] = [];
  if (SID && !SID.startsWith("AC")) {
    warnings.push(
      "TWILIO_ACCOUNT_SID does not start with 'AC' — an API Key SID (SK…) cannot be used for Basic auth here."
    );
  }
  if (SERVICE_SID && !SERVICE_SID.startsWith("VA")) {
    warnings.push(
      "TWILIO_VERIFY_SERVICE_SID does not start with 'VA' — a Messaging Service SID (MG…) is not a Verify service."
    );
  }
  return { configured: missing.length === 0, missing, warnings };
}

async function postForm(
  url: string,
  body: URLSearchParams,
  operation: "start" | "check"
): Promise<Response> {
  try {
    return await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": authHeader(),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (cause) {
    // DNS failure, TLS failure, blocked egress, or our own timeout.
    throw new TwilioVerifyError({
      kind: "network",
      httpStatus: null,
      twilioCode: null,
      twilioMessage: cause instanceof Error ? cause.message : String(cause),
      hint: `Could not reach verify.twilio.com within ${REQUEST_TIMEOUT_MS}ms — check outbound network access from the deployment.`,
      operation,
    });
  }
}

async function toVerifyError(
  res: Response,
  operation: "start" | "check"
): Promise<TwilioVerifyError> {
  const text = await res.text().catch(() => "");
  let twilioCode: number | null = null;
  let twilioMessage: string | null = null;
  try {
    const parsed = JSON.parse(text) as { code?: number; message?: string };
    twilioCode = typeof parsed.code === "number" ? parsed.code : null;
    twilioMessage = typeof parsed.message === "string" ? parsed.message : null;
  } catch {
    twilioMessage = text.slice(0, 300) || null;
  }
  const { kind, hint } = classifyTwilioError(res.status, twilioCode);
  return new TwilioVerifyError({
    kind,
    httpStatus: res.status,
    twilioCode,
    twilioMessage,
    hint,
    operation,
  });
}

function logFailure(err: TwilioVerifyError, phone: string, operation: "start" | "check"): void {
  logger.error(
    {
      operation,
      kind: err.kind,
      httpStatus: err.httpStatus,
      twilioCode: err.twilioCode,
      twilioMessage: err.twilioMessage,
      hint: err.hint,
      phone: maskPhone(phone),
    },
    `Twilio Verify ${operation} failed`
  );
}

export async function startVerification(phone: string): Promise<void> {
  if (!configured()) {
    if (IS_PRODUCTION) {
      // Fail closed in production — never silently skip real OTP delivery
      throw notConfiguredError("start");
    }
    logger.info({ phone: maskPhone(phone) }, "Verify (dev) — Twilio not configured; OTP step skipped");
    return;
  }
  const url = `https://verify.twilio.com/v2/Services/${SERVICE_SID}/Verifications`;
  const body = new URLSearchParams({ To: phone, Channel: "sms" });
  const res = await postForm(url, body, "start").catch((err: TwilioVerifyError) => {
    logFailure(err, phone, "start");
    throw err;
  });
  if (!res.ok) {
    const err = await toVerifyError(res, "start");
    logFailure(err, phone, "start");
    throw err;
  }
}

export async function checkVerification(phone: string, code: string): Promise<boolean> {
  if (!configured()) {
    if (IS_PRODUCTION) {
      // Fail closed in production — never accept a magic code
      throw notConfiguredError("check");
    }
    // Dev-only convenience: reject everything, forcing the caller to handle failure
    // (no magic bypass code accepted)
    logger.warn({ phone: maskPhone(phone) }, "Verify (dev) — Twilio not configured; rejecting all codes");
    return false;
  }
  const url = `https://verify.twilio.com/v2/Services/${SERVICE_SID}/VerificationCheck`;
  const body = new URLSearchParams({ To: phone, Code: code });
  const res = await postForm(url, body, "check").catch((err: TwilioVerifyError) => {
    logFailure(err, phone, "check");
    throw err;
  });
  if (!res.ok) {
    if (res.status === 404) return false; // no pending verification for this phone
    const err = await toVerifyError(res, "check");
    logFailure(err, phone, "check");
    throw err;
  }
  const data = (await res.json().catch(() => null)) as { status?: string; valid?: boolean } | null;
  return data?.status === "approved" || data?.valid === true;
}
