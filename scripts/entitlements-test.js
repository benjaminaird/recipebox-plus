const assert = require("assert");
const app = require("../server");
const {
  ENTITLEMENT_CONFIG, PLAN_ENTITLEMENTS, REFERRAL_CONFIG, LAUNCH_PHASE,
  chooseSpendBucket, planMonthlyCredits, referralBonusAllowed,
} = app._test;

// --- Monthly included credits per tier ---
assert.strictEqual(PLAN_ENTITLEMENTS.free.aiMonthlyLimit, 10, "Free gets 10 monthly credits");
assert.strictEqual(PLAN_ENTITLEMENTS.plus.aiMonthlyLimit, 100, "Plus gets 100 monthly credits");
assert.strictEqual(PLAN_ENTITLEMENTS.family.aiMonthlyLimit, 250, "Family gets 250 shared monthly credits");
assert.strictEqual(PLAN_ENTITLEMENTS.founder.aiMonthlyLimit, 150, "Founder gets 150 monthly credits");
assert.strictEqual(ENTITLEMENT_CONFIG.tiers.free.monthlyCredits, 10);
assert.strictEqual(ENTITLEMENT_CONFIG.tiers.plus.monthlyCredits, 100);
assert.strictEqual(ENTITLEMENT_CONFIG.tiers.family.monthlyCredits, 250);
assert.strictEqual(ENTITLEMENT_CONFIG.tiers.founder.monthlyCredits, 150);
assert.strictEqual(ENTITLEMENT_CONFIG.familyMemberCap, 4, "Family member cap is 4");

// --- Beta unlimited during beta, still has a daily abuse cap concept ---
assert.strictEqual(LAUNCH_PHASE, "beta", "default launch phase is beta");
assert.strictEqual(PLAN_ENTITLEMENTS.beta.unlimited, true, "Beta is unlimited during beta");
assert.strictEqual(planMonthlyCredits("beta"), null, "Beta has no monthly cap during beta");
assert.ok(PLAN_ENTITLEMENTS.beta.aiDailyLimit > 0, "Beta still has a daily limit value for abuse protection");

// --- Credit rules: no monthly rollover, purchased + bonus never expire ---
assert.strictEqual(ENTITLEMENT_CONFIG.creditRules.monthlyRollover, false, "Monthly credits do not roll over");
assert.strictEqual(ENTITLEMENT_CONFIG.creditRules.purchasedExpire, false, "Purchased credits never expire");
assert.strictEqual(ENTITLEMENT_CONFIG.creditRules.bonusExpire, false, "Bonus credits do not expire");
assert.deepStrictEqual(ENTITLEMENT_CONFIG.creditRules.spendOrder, ["monthly", "bonus", "purchased"]);

// --- Credit packs (placeholder pricing) ---
const packs = Object.fromEntries(ENTITLEMENT_CONFIG.creditPacks.map((p) => [p.credits, p.price]));
assert.strictEqual(packs[25], 1.99);
assert.strictEqual(packs[75], 4.99);
assert.strictEqual(packs[200], 9.99);
assert.strictEqual(packs[500], 19.99);

// --- Ads ready but off ---
assert.strictEqual(ENTITLEMENT_CONFIG.adsEnabled, false, "No ads at launch");
assert.ok("adsEnabled" in ENTITLEMENT_CONFIG, "ads-ready config flag exists");

// --- Spend order: monthly before bonus before purchased ---
assert.strictEqual(chooseSpendBucket({ monthlyRemaining: 5, bonus: 10, purchased: 10 }), "monthly", "spends monthly first");
assert.strictEqual(chooseSpendBucket({ monthlyRemaining: 0, bonus: 3, purchased: 10 }), "bonus", "then bonus");
assert.strictEqual(chooseSpendBucket({ monthlyRemaining: 0, bonus: 0, purchased: 4 }), "purchased", "then purchased");
assert.strictEqual(chooseSpendBucket({ monthlyRemaining: 0, bonus: 0, purchased: 0 }), null, "null when out of credits");

// --- Referral: 25 each, capped at 10/month ---
assert.strictEqual(REFERRAL_CONFIG.bonusCredits, 25, "Referral grants 25 credits each side");
assert.strictEqual(REFERRAL_CONFIG.monthlyCap, 10, "Referral cap is 10/month");
assert.strictEqual(REFERRAL_CONFIG.triggersOn, "paid_conversion", "Referral triggers on paid conversion");
assert.strictEqual(referralBonusAllowed(0), true, "first referral allowed");
assert.strictEqual(referralBonusAllowed(9), true, "10th referral allowed");
assert.strictEqual(referralBonusAllowed(10), false, "11th referral blocked by cap");

console.log("entitlements-test: ok");
