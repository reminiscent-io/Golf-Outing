import { TwilioVerifyError, type VerifyFailureKind } from "./twilio";

export type VerifyErrorResponse = {
  status: number;
  body: { error: string; code: VerifyFailureKind };
  retryAfterSeconds?: number;
};

// Twilio blocks further sends to a number for roughly ten minutes once the
// per-number send cap is hit, so that's what we tell the client to wait.
const RATE_LIMIT_RETRY_SECONDS = 600;

/**
 * Turn a Verify failure into an HTTP response.
 *
 * The point is that the caller learns something actionable: a bad phone number
 * is a 400 the user can fix, a missing credential is a 500 only the operator
 * can fix, and a genuine Twilio outage stays a 502. Operator-only detail (which
 * credential, which Twilio code) stays in the logs — the body never carries it.
 */
export function verifyErrorResponse(
  err: unknown,
  operation: "start" | "check"
): VerifyErrorResponse {
  const kind: VerifyFailureKind =
    err instanceof TwilioVerifyError ? err.kind : "upstream";

  switch (kind) {
    case "config":
      return {
        status: 500,
        body: {
          error:
            "Text-message sign-in isn't configured correctly on the server. " +
            "No code was sent — please let the site owner know.",
          code: kind,
        },
      };

    case "invalid_phone":
      return {
        status: 400,
        body: {
          error:
            "That phone number can't receive text messages. " +
            "Check the number and country code, then try again.",
          code: kind,
        },
      };

    case "unverified":
      return {
        status: 400,
        body: {
          error:
            "This number isn't approved to receive codes from this app yet. " +
            "Please let the site owner know.",
          code: kind,
        },
      };

    case "blocked":
      return {
        status: 400,
        body: {
          error:
            "Delivery to this number was blocked by the carrier or by spam protection. " +
            "Try a different number.",
          code: kind,
        },
      };

    case "rate_limited":
      return {
        status: 429,
        body: {
          error:
            operation === "start"
              ? "Too many codes have been requested for this number. Wait about 10 minutes and try again."
              : "Too many incorrect attempts for this code. Request a new one in about 10 minutes.",
          code: kind,
        },
        retryAfterSeconds: RATE_LIMIT_RETRY_SECONDS,
      };

    case "network":
      return {
        status: 504,
        body: {
          error: "Couldn't reach the verification service. Please try again in a moment.",
          code: kind,
        },
      };

    case "upstream":
      return {
        status: 502,
        body: {
          error:
            operation === "start"
              ? "Failed to send verification code"
              : "Verification service unavailable",
          code: kind,
        },
      };
  }
}
