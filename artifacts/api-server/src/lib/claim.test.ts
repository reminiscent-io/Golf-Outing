import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isClaimableByPhone,
  isClaimableByCode,
  canClaim,
  generateClaimCode,
  publicPlayer,
  type ClaimRow,
} from "./claim";

const open: ClaimRow = { userId: null, invitedPhone: null, claimCode: null };
const tagged: ClaimRow = { userId: null, invitedPhone: "+15551230001", claimCode: null };
const coded: ClaimRow = { userId: null, invitedPhone: null, claimCode: "SECRET" };
const claimed: ClaimRow = { userId: 7, invitedPhone: "+15551230001", claimCode: "SECRET" };

describe("isClaimableByPhone", () => {
  it("allows an open (untagged) unclaimed row for anyone", () => {
    assert.equal(isClaimableByPhone(open, "+15559999999"), true);
  });
  it("allows a tagged row only for the matching phone", () => {
    assert.equal(isClaimableByPhone(tagged, "+15551230001"), true);
    assert.equal(isClaimableByPhone(tagged, "+15559999999"), false);
  });
  it("never allows an already-claimed row", () => {
    assert.equal(isClaimableByPhone(claimed, "+15551230001"), false);
  });
});

describe("isClaimableByCode", () => {
  it("allows when the code matches an unclaimed coded row", () => {
    assert.equal(isClaimableByCode(coded, "SECRET"), true);
  });
  it("rejects a wrong, missing, or null code", () => {
    assert.equal(isClaimableByCode(coded, "WRONG"), false);
    assert.equal(isClaimableByCode(coded, null), false);
    assert.equal(isClaimableByCode(coded, undefined), false);
    assert.equal(isClaimableByCode(coded, ""), false); // empty string is falsy — rejected
    assert.equal(isClaimableByCode(open, "SECRET"), false); // row has no code
  });
  it("never allows an already-claimed row even with the right code", () => {
    assert.equal(isClaimableByCode(claimed, "SECRET"), false);
  });
});

describe("canClaim", () => {
  it("is true for an open row for any caller (permissive default)", () => {
    assert.equal(canClaim(open, { callerPhone: "+15559999999" }), true);
  });
  it("is true when phone OR code authorizes", () => {
    assert.equal(canClaim(tagged, { callerPhone: "+15551230001" }), true);
    assert.equal(canClaim(coded, { callerPhone: "+15559999999", code: "SECRET" }), true);
  });
  it("is false when neither authorizes", () => {
    assert.equal(canClaim(tagged, { callerPhone: "+15559999999", code: "WRONG" }), false);
  });
});

describe("generateClaimCode", () => {
  it("returns a url-safe token and is unique per call", () => {
    const a = generateClaimCode();
    const b = generateClaimCode();
    assert.match(a, /^[A-Za-z0-9_-]{16,}$/);
    assert.notEqual(a, b);
  });
});

describe("publicPlayer", () => {
  it("strips invitedPhone and claimCode, keeps everything else", () => {
    const row = { id: 1, name: "Dave", invitedPhone: "+1555", claimCode: "x", userId: null };
    const pub = publicPlayer(row);
    assert.equal("invitedPhone" in pub, false);
    assert.equal("claimCode" in pub, false);
    assert.equal(pub.id, 1);
    assert.equal(pub.name, "Dave");
  });
});
