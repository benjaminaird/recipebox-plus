/*
 * Tests for the Family/household foundation (M1) pure helpers. Offline — the
 * DB-backed endpoints reuse these for role + cap + invite enforcement.
 */
const assert = require("assert");
const app = require("../server");
const {
  FAMILY_MEMBER_CAP, HOUSEHOLD_ROLES, normalizeHouseholdRole, generateInviteCode,
  canAddHouseholdMember, canInviteToHousehold, isHouseholdOwner, inviteIsUsable,
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

console.log("household-test: ok");
