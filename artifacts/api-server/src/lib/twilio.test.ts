import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyTwilioError, TwilioVerifyError } from "./twilio";
import { verifyErrorResponse } from "./verify-response";
import { maskPhone, normalizePhone } from "./otp";

function twilioError(kind: TwilioVerifyError["kind"]): TwilioVerifyError {
  return new TwilioVerifyError({
    kind,
    httpStatus: 400,
    twilioCode: null,
    twilioMessage: null,
    hint: "test",
    operation: "start",
  });
}

describe("classifyTwilioError", () => {
  it("treats credential and service-SID failures as operator config problems", () => {
    assert.equal(classifyTwilioError(401, 20003).kind, "config");
    assert.equal(classifyTwilioError(404, 20404).kind, "config");
    assert.equal(classifyTwilioError(400, 60223).kind, "config");
  });

  it("treats an unusable destination as an invalid phone", () => {
    assert.equal(classifyTwilioError(400, 60200).kind, "invalid_phone");
    assert.equal(classifyTwilioError(400, 21211).kind, "invalid_phone");
    assert.equal(classifyTwilioError(400, 60205).kind, "invalid_phone");
  });

  it("separates trial-account restrictions from carrier blocks", () => {
    assert.equal(classifyTwilioError(400, 21608).kind, "unverified");
    assert.equal(classifyTwilioError(400, 60410).kind, "blocked");
    assert.equal(classifyTwilioError(400, 60605).kind, "blocked");
    assert.equal(classifyTwilioError(400, 21610).kind, "blocked");
  });

  it("recognizes the per-number send and check caps", () => {
    assert.equal(classifyTwilioError(400, 60203).kind, "rate_limited");
    assert.equal(classifyTwilioError(400, 60202).kind, "rate_limited");
    assert.equal(classifyTwilioError(429, null).kind, "rate_limited");
  });

  it("falls back to HTTP status when the code is unknown or absent", () => {
    assert.equal(classifyTwilioError(500, null).kind, "upstream");
    assert.equal(classifyTwilioError(400, 99999).kind, "upstream");
  });

  it("blames the network, not the credentials, for a 403 carrying no Twilio code", () => {
    // An egress proxy or firewall answering on Twilio's behalf. Twilio itself
    // always includes a code (20003) when it rejects auth.
    assert.equal(classifyTwilioError(403, null).kind, "network");
    assert.equal(classifyTwilioError(401, null).kind, "network");
    assert.equal(classifyTwilioError(401, 20003).kind, "config");
  });
});

describe("verifyErrorResponse", () => {
  it("does not blame the user for a server misconfiguration", () => {
    const res = verifyErrorResponse(twilioError("config"), "start");
    assert.equal(res.status, 500);
    assert.equal(res.body.code, "config");
  });

  it("returns a fixable 400 for a bad phone number", () => {
    assert.equal(verifyErrorResponse(twilioError("invalid_phone"), "start").status, 400);
  });

  it("returns 429 with a Retry-After budget when Twilio caps the number", () => {
    const res = verifyErrorResponse(twilioError("rate_limited"), "start");
    assert.equal(res.status, 429);
    assert.equal(res.retryAfterSeconds, 600);
  });

  it("distinguishes an unreachable Twilio from a Twilio rejection", () => {
    assert.equal(verifyErrorResponse(twilioError("network"), "start").status, 504);
    assert.equal(verifyErrorResponse(twilioError("upstream"), "start").status, 502);
  });

  it("preserves the original 502 wording for unclassified failures", () => {
    assert.equal(
      verifyErrorResponse(twilioError("upstream"), "start").body.error,
      "Failed to send verification code"
    );
    assert.equal(
      verifyErrorResponse(twilioError("upstream"), "check").body.error,
      "Verification service unavailable"
    );
  });

  it("treats a non-Twilio throw as an upstream 502", () => {
    const res = verifyErrorResponse(new Error("boom"), "start");
    assert.equal(res.status, 502);
    assert.equal(res.body.code, "upstream");
  });
});

describe("maskPhone", () => {
  it("keeps the leading country digits and the last four", () => {
    assert.equal(maskPhone("+15551234567"), "+15*****4567");
  });

  it("never echoes a short or empty value in full", () => {
    assert.equal(maskPhone(""), "(none)");
    assert.equal(maskPhone("+1234"), "+****");
  });
});

describe("normalizePhone", () => {
  it("accepts E.164 and strips formatting", () => {
    assert.equal(normalizePhone("+1 (555) 123-4567"), "+15551234567");
  });

  it("does not invent a country code for a bare 10-digit number", () => {
    // The client adds +1 for US numbers; the server must not guess, so a bare
    // 10-digit string stays as-is and Twilio is what rejects it.
    assert.equal(normalizePhone("5551234567"), "+5551234567");
  });

  it("rejects values that cannot be E.164", () => {
    assert.equal(normalizePhone("12345"), null);
    assert.equal(normalizePhone("not a phone"), null);
  });
});
