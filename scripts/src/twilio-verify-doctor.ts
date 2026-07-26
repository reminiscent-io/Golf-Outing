/**
 * Diagnose Twilio Verify sign-in failures.
 *
 *   pnpm --filter @workspace/scripts run twilio-doctor
 *   pnpm --filter @workspace/scripts run twilio-doctor +15551234567
 *
 * With no phone number it only inspects credentials and the Verify service —
 * no SMS is sent and nothing is charged. Pass a number in E.164 to also send a
 * real code, which is the only way to surface delivery-side failures such as
 * trial-account restrictions, geo permissions, or Fraud Guard blocks.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** Fill in any missing vars from the repo-root .env, the way dev-local.sh does. */
function loadDotEnv(): void {
  let raw: string;
  try {
    raw = readFileSync(path.join(REPO_ROOT, ".env"), "utf8");
  } catch {
    return;
  }
  for (const line of raw.split("\n")) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] != null) continue;
    let value = rawValue.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadDotEnv();

const SID = process.env.TWILIO_ACCOUNT_SID?.trim() ?? "";
const TOKEN = process.env.TWILIO_AUTH_TOKEN?.trim() ?? "";
const SERVICE_SID = process.env.TWILIO_VERIFY_SERVICE_SID?.trim() ?? "";

const ok = (msg: string) => console.log(`  ✓ ${msg}`);
const bad = (msg: string) => console.log(`  ✗ ${msg}`);
const warn = (msg: string) => console.log(`  ! ${msg}`);

function describe(name: string, value: string): void {
  if (!value) {
    bad(`${name} is not set`);
    return;
  }
  const untrimmed = (process.env[name] ?? "") !== value;
  ok(`${name} present (${value.length} chars, starts "${value.slice(0, 4)}")`);
  if (untrimmed) {
    warn(`${name} had surrounding whitespace — that alone breaks Basic auth (Twilio replies 401)`);
  }
}

function authHeader(): string {
  return `Basic ${Buffer.from(`${SID}:${TOKEN}`).toString("base64")}`;
}

type TwilioError = { code?: number; message?: string; more_info?: string };

async function readError(res: Response): Promise<TwilioError & { raw: string }> {
  const raw = await res.text().catch(() => "");
  try {
    return { ...(JSON.parse(raw) as TwilioError), raw };
  } catch {
    return { raw };
  }
}

function explain(status: number, code: number | undefined): string {
  switch (code) {
    case 20003:
      return "Bad credentials. The account SID and auth token don't match (or the token was rotated).";
    case 20404:
      return "The Verify service doesn't exist on this account. TWILIO_VERIFY_SERVICE_SID is wrong or from another account/subaccount.";
    case 20429:
      return "Twilio is rate limiting the account.";
    case 21211:
    case 60200:
      return "Twilio rejected the phone number. It must be full E.164, e.g. +15551234567.";
    case 21608:
      return "Trial account: the destination must be added to Verified Caller IDs in the Twilio console, or the account upgraded.";
    case 21610:
      return "That number replied STOP. It must text START to the sender before it can receive codes again.";
    case 60203:
      return "Max send attempts reached for this number. Twilio blocks further sends for ~10 minutes — this is the usual cause of a sign-in that 'suddenly' stops working while testing.";
    case 60205:
      return "The number is a landline and can't receive SMS.";
    case 60223:
      return "The SMS channel is disabled on this Verify service. Enable SMS in Verify → Services → your service.";
    case 60410:
      return "Delivery blocked. Check Messaging → Geo permissions for the destination country.";
    case 60605:
      return "Fraud Guard blocked this destination. Adjust Verify → Fraud Guard settings.";
    default:
      if (status === 401 || status === 403) {
        return (
          "Twilio rejected our credentials — or, if the response body above isn't Twilio JSON, " +
          "an egress proxy/firewall answered instead and verify.twilio.com needs to be allowlisted."
        );
      }
      if (status === 404) return "Twilio could not find that resource — check the service SID.";
      if (status >= 500) return "Twilio-side outage; retry later.";
      return "See the more_info link above for this error code.";
  }
}

async function main(): Promise<void> {
  const phone = process.argv[2];

  console.log("\nTwilio Verify doctor\n");

  console.log("1. Credentials");
  describe("TWILIO_ACCOUNT_SID", SID);
  describe("TWILIO_AUTH_TOKEN", TOKEN);
  describe("TWILIO_VERIFY_SERVICE_SID", SERVICE_SID);
  if (SID && !SID.startsWith("AC")) {
    bad("TWILIO_ACCOUNT_SID must start with 'AC'. An API Key SID (SK…) can't be used for Basic auth here.");
  }
  if (SERVICE_SID && !SERVICE_SID.startsWith("VA")) {
    bad("TWILIO_VERIFY_SERVICE_SID must start with 'VA'. A Messaging Service SID (MG…) is not a Verify service.");
  }
  if (!SID || !TOKEN || !SERVICE_SID) {
    console.log(
      "\nStop: with any of these unset the API server skips OTP sends in dev and refuses to boot in production.\n"
    );
    process.exit(1);
  }

  console.log("\n2. Verify service reachable (no SMS sent)");
  const serviceRes = await fetch(`https://verify.twilio.com/v2/Services/${SERVICE_SID}`, {
    headers: { Authorization: authHeader() },
    signal: AbortSignal.timeout(10_000),
  }).catch((err: unknown) => {
    bad(`Could not reach verify.twilio.com: ${err instanceof Error ? err.message : String(err)}`);
    console.log("     Outbound HTTPS from this environment is probably blocked.\n");
    process.exit(1);
  });

  if (!serviceRes.ok) {
    const err = await readError(serviceRes);
    bad(`HTTP ${serviceRes.status} — code ${err.code ?? "?"}: ${err.message ?? err.raw}`);
    if (err.more_info) console.log(`     ${err.more_info}`);
    console.log(`\n  Diagnosis: ${explain(serviceRes.status, err.code)}\n`);
    process.exit(1);
  }

  const service = (await serviceRes.json()) as { friendly_name?: string; code_length?: number };
  ok(`service "${service.friendly_name ?? SERVICE_SID}" reachable, code length ${service.code_length ?? "?"}`);
  if (service.code_length != null && service.code_length !== 6) {
    warn(
      `the app validates a 6-digit code but this service issues ${service.code_length} digits — verification will always fail`
    );
  }

  if (!phone) {
    console.log("\nCredentials and service are healthy. Pass a phone number to test an actual send:");
    console.log("  pnpm --filter @workspace/scripts run twilio-doctor +15551234567\n");
    return;
  }

  console.log(`\n3. Sending a real code to ${phone}`);
  if (!/^\+\d{8,15}$/.test(phone)) {
    bad(`"${phone}" is not E.164. Use a leading + and country code, e.g. +15551234567.`);
    process.exit(1);
  }

  const sendRes = await fetch(`https://verify.twilio.com/v2/Services/${SERVICE_SID}/Verifications`, {
    method: "POST",
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: phone, Channel: "sms" }).toString(),
    signal: AbortSignal.timeout(10_000),
  });

  if (!sendRes.ok) {
    const err = await readError(sendRes);
    bad(`HTTP ${sendRes.status} — code ${err.code ?? "?"}: ${err.message ?? err.raw}`);
    if (err.more_info) console.log(`     ${err.more_info}`);
    console.log(`\n  Diagnosis: ${explain(sendRes.status, err.code)}`);
    console.log("  This is exactly the failure the API server reports on POST /api/auth/request-otp.\n");
    process.exit(1);
  }

  const sent = (await sendRes.json()) as { status?: string; channel?: string };
  ok(`Twilio accepted the send (status "${sent.status}", channel "${sent.channel}")`);
  console.log(
    "\nTwilio accepted it, so the API is fine. If no SMS arrives, the failure is downstream:" +
      "\n  Twilio console → Monitor → Logs → Messaging shows the carrier-level result.\n"
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
