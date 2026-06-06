import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { groupConnections, type CoPlayerRow } from "./connections";

function row(p: Partial<CoPlayerRow>): CoPlayerRow {
  return {
    playerId: 1, roundId: 1, tripId: 10, userId: null,
    name: "Dave", userFullName: null, invitedPhone: null, hasInvite: false,
    ...p,
  };
}

describe("groupConnections", () => {
  it("returns empty arrays for no rows", () => {
    assert.deepEqual(groupConnections([]), { accounts: [], pending: [] });
  });

  it("groups an account across rounds and counts distinct shared rounds", () => {
    const out = groupConnections([
      row({ playerId: 2, roundId: 100, userId: 5, userFullName: "Mike Real" }),
      row({ playerId: 2, roundId: 101, userId: 5, userFullName: "Mike Real" }),
    ]);
    assert.equal(out.accounts.length, 1);
    assert.equal(out.accounts[0]!.userId, 5);
    assert.equal(out.accounts[0]!.name, "Mike Real");
    assert.equal(out.accounts[0]!.sharedRounds, 2);
    assert.equal(out.pending.length, 0);
  });

  it("merges pending rows that share a phone across trips", () => {
    const out = groupConnections([
      row({ playerId: 3, roundId: 100, tripId: 10, invitedPhone: "+1555", name: "Dave" }),
      row({ playerId: 4, roundId: 200, tripId: 11, invitedPhone: "+1555", name: "Dave T" }),
    ]);
    assert.equal(out.pending.length, 1);
    assert.equal(out.pending[0]!.sharedRounds, 2);
    assert.deepEqual([...out.pending[0]!.playerIds].sort((a, b) => a - b), [3, 4]);
    assert.equal(out.pending[0]!.hasPhone, true);
    assert.equal(out.pending[0]!.tripId, 10); // representative (min-playerId) row's trip
  });

  it("does NOT merge same-named pending across different trips without a phone", () => {
    const out = groupConnections([
      row({ playerId: 3, roundId: 100, tripId: 10, name: "Dave" }),
      row({ playerId: 4, roundId: 200, tripId: 11, name: "Dave" }),
    ]);
    assert.equal(out.pending.length, 2);
  });

  it("flags hasInvite when a claim code exists and never leaks a phone", () => {
    const out = groupConnections([
      row({ playerId: 3, invitedPhone: "+1555", hasInvite: true }),
    ]);
    assert.equal(out.pending[0]!.hasInvite, true);
    assert.equal(JSON.stringify(out).includes("+1555"), false);
  });

  it("sorts accounts by sharedRounds descending", () => {
    const out = groupConnections([
      row({ playerId: 2, roundId: 1, userId: 5, userFullName: "One" }),
      row({ playerId: 3, roundId: 2, userId: 6, userFullName: "Two" }),
      row({ playerId: 3, roundId: 3, userId: 6, userFullName: "Two" }),
    ]);
    assert.deepEqual(out.accounts.map(a => a.userId), [6, 5]);
  });

  it("anchors a phone group's name/tripId to the min-playerId row, regardless of input order", () => {
    // Higher-playerId row arrives FIRST; representative must still be the min-playerId row.
    const out = groupConnections([
      row({ playerId: 4, roundId: 200, tripId: 11, invitedPhone: "+1555", name: "Dave T" }),
      row({ playerId: 3, roundId: 100, tripId: 10, invitedPhone: "+1555", name: "Dave" }),
    ]);
    assert.equal(out.pending.length, 1);
    assert.equal(out.pending[0]!.id, "pending:3");
    assert.equal(out.pending[0]!.name, "Dave");
    assert.equal(out.pending[0]!.tripId, 10);
  });

  it("keeps solo (tripId null, no phone) placeholders distinct even with the same name", () => {
    const out = groupConnections([
      row({ playerId: 3, roundId: 100, tripId: null, name: "Alice" }),
      row({ playerId: 4, roundId: 200, tripId: null, name: "Alice" }),
    ]);
    assert.equal(out.pending.length, 2);
  });
});
