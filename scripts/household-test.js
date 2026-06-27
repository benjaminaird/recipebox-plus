/*
 * Tests for the Family/household foundation (M1) pure helpers. Offline — the
 * DB-backed endpoints reuse these for role + cap + invite enforcement.
 */
const assert = require("assert");
const app = require("../server");
const {
  FAMILY_MEMBER_CAP, HOUSEHOLD_ROLES, normalizeHouseholdRole, generateInviteCode,
  canAddHouseholdMember, canInviteToHousehold, isHouseholdOwner, inviteIsUsable,
  normalizeRecipeForDb, sanitizeMealPlan,
} = app._test;

// --- Roles ---
assert.deepStrictEqual(HOUSEHOLD_ROLES, ["owner", "adult", "member"]);
assert.strictEqual(normalizeHouseholdRole("OWNER"), "owner");
assert.strictEqual(normalizeHouseholdRole("Adult"), "adult");
assert.strictEqual(normalizeHouseholdRole("guest"), "member", "unknown role -> member");
assert.strictEqual(normalizeHouseholdRole(undefined), "member");

// --- Permissions: owner + adult can invite; only owner manages ---
assert.strictEqual(canInviteToHousehold("owner"), true);
assert.strictEqual(canInviteToHousehold("adult"), true);
assert.strictEqual(canInviteToHousehold("member"), false, "members cannot invite");
assert.strictEqual(isHouseholdOwner("owner"), true);
assert.strictEqual(isHouseholdOwner("adult"), false);

// --- Member cap (4) ---
assert.strictEqual(FAMILY_MEMBER_CAP, 4);
assert.strictEqual(canAddHouseholdMember(0), true);
assert.strictEqual(canAddHouseholdMember(3), true, "4th member allowed");
assert.strictEqual(canAddHouseholdMember(4), false, "5th member blocked");
assert.strictEqual(canAddHouseholdMember(2, 2), false, "respects a custom cap");

// --- Invite codes: unambiguous, formatted, unique-ish ---
const code = generateInviteCode();
assert.ok(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code), "code is XXXX-XXXX from an unambiguous alphabet: " + code);
assert.ok(!/[OIL01]/.test(code), "no confusable chars (O/I/L/0/1)");
const codes = new Set(Array.from({ length: 200 }, () => generateInviteCode()));
assert.ok(codes.size > 190, "codes are well-distributed (no obvious collisions)");

// --- Invite usability: unused + unexpired ---
const future = new Date(Date.now() + 86400000).toISOString();
const past = new Date(Date.now() - 1000).toISOString();
assert.strictEqual(inviteIsUsable({ expires_at: future, accepted_by: null }), true, "fresh invite is usable");
assert.strictEqual(inviteIsUsable({ expires_at: past, accepted_by: null }), false, "expired invite is not usable");
assert.strictEqual(inviteIsUsable({ expires_at: future, accepted_by: "u1" }), false, "already-accepted invite is not usable");
assert.strictEqual(inviteIsUsable({ expires_at: future, accepted_at: new Date().toISOString() }), false, "accepted_at also blocks reuse");
assert.strictEqual(inviteIsUsable(null), false);

// --- Shared library (M2): transient share annotations must never persist ---
// A recipe carrying another member's read-only annotations must be stored without
// them (so it can't be written into the wrong user's row with a false owner).
const stored = normalizeRecipeForDb({
  id: "r1", title: "Shared Soup", shared: true,
  householdShared: true, ownerId: "someone-else", ownerName: "Pat",
  sections: [],
});
assert.strictEqual(stored.json.householdShared, undefined, "householdShared is stripped before storage");
assert.strictEqual(stored.json.ownerId, undefined, "ownerId is stripped");
assert.strictEqual(stored.json.ownerName, undefined, "ownerName is stripped");
assert.strictEqual(stored.json.shared, true, "the owner's own 'shared' flag is kept");
assert.strictEqual(stored.json.title, "Shared Soup", "real recipe fields are preserved");

// --- Shared meal plan (M2 slice 2): only allowed recipe ids survive ---
// A member can plan their own recipes + recipes shared to the household, but a
// private recipe owned by another member must be stripped server-side.
const allowed = new Set(["own1", "own2", "shared1"]);
const cleaned = sanitizeMealPlan({
  Mon: ["own1", "private-of-someone-else", "shared1"],
  Tue: ["own2"],
  Wed: [],                       // empty day dropped
  Bad: "not-an-array",           // non-array dropped
  Thu: ["own1", 42, null, "x"],  // non-strings + disallowed dropped
}, allowed);
assert.deepStrictEqual(cleaned.Mon, ["own1", "shared1"], "private recipe of another member is stripped from the shared plan");
assert.deepStrictEqual(cleaned.Tue, ["own2"]);
assert.strictEqual("Wed" in cleaned, false, "empty days are dropped");
assert.strictEqual("Bad" in cleaned, false, "non-array day values are dropped");
assert.deepStrictEqual(cleaned.Thu, ["own1"], "only allowed string ids survive");
assert.deepStrictEqual(sanitizeMealPlan(null, allowed), {}, "non-object plan -> {}");
assert.deepStrictEqual(sanitizeMealPlan([1, 2], allowed), {}, "array plan -> {}");
assert.deepStrictEqual(sanitizeMealPlan({ Mon: ["anything"] }, new Set()), {}, "no allowed ids -> everything stripped");

console.log("household-test: ok");
