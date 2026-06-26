const assert = require("assert");
const app = require("../server");
const {
  ENTITLEMENT_CONFIG, PLAN_ENTITLEMENTS, REFERRAL_CONFIG, LAUNCH_PHASE,
  chooseSpendBucket, planMonthlyCredits, referralBonusAllowed,
  AI_ACTION_COSTS, aiAssistCost, splitAssistCharge, FREE_WELCOME_ASSISTS,
  publicEntitlementConfig, founderOfferTiers, isFounderEligible, FOUNDER_TIERS,
} = app._test;

// --- Monthly included AI Assists per tier ---
assert.strictEqual(PLAN_ENTITLEMENTS.free.aiMonthlyLimit, 5, "Free recurs at 5 monthly AI Assists");
assert.strictEqual(PLAN_ENTITLEMENTS.plus.aiMonthlyLimit, 250, "Plus gets 250 monthly AI Assists");
assert.strictEqual(PLAN_ENTITLEMENTS.family.aiMonthlyLimit, 600, "Family gets 600 shared monthly AI Assists");
assert.strictEqual(PLAN_ENTITLEMENTS.founder.aiMonthlyLimit, 300, "Founder gets 300 monthly AI Assists");
assert.strictEqual(ENTITLEMENT_CONFIG.tiers.free.monthlyAssists, 5);
assert.strictEqual(ENTITLEMENT_CONFIG.tiers.plus.monthlyAssists, 250);
assert.strictEqual(ENTITLEMENT_CONFIG.tiers.family.monthlyAssists, 600);
assert.strictEqual(ENTITLEMENT_CONFIG.tiers.founder.monthlyAssists, 300);
assert.strictEqual(ENTITLEMENT_CONFIG.familyMemberCap, 4, "Family member cap is 4");

// --- Free welcome grant: 15 one-time, then 5/month ---
assert.strictEqual(FREE_WELCOME_ASSISTS, 15, "Free accounts get 15 welcome AI Assists");
assert.strictEqual(ENTITLEMENT_CONFIG.tiers.free.welcomeAssists, 15);
assert.strictEqual(ENTITLEMENT_CONFIG.freeWelcomeAssists, 15);

// --- Founder is yearly-only forever pricing; no monthly price ---
assert.strictEqual(ENTITLEMENT_CONFIG.tiers.founder.price.yearly, 29.99);
assert.ok(!("monthly" in ENTITLEMENT_CONFIG.tiers.founder.price), "Founder has no monthly price (yearly only)");
assert.strictEqual(ENTITLEMENT_CONFIG.tiers.plus.price.monthly, 4.99);
assert.strictEqual(ENTITLEMENT_CONFIG.tiers.plus.price.yearly, 39.99);
assert.strictEqual(ENTITLEMENT_CONFIG.tiers.family.price.monthly, 7.99);
assert.strictEqual(ENTITLEMENT_CONFIG.tiers.family.price.yearly, 69.99);

// --- Transparency: no "unlimited imports" claim on a paid tier ---
for (const tier of ["plus", "family", "founder"]) {
  const blob = JSON.stringify(ENTITLEMENT_CONFIG.tiers[tier]).toLowerCase();
  assert.ok(!/unlimited\s+import/.test(blob), tier + " must not advertise unlimited imports");
}
// --- No user-facing "credit" wording leaks through the public config ---
assert.ok(!/credit/i.test(JSON.stringify(ENTITLEMENT_CONFIG)), "public entitlement config never says 'credit'");

// --- Beta unlimited during beta, still has a daily abuse cap concept ---
assert.strictEqual(LAUNCH_PHASE, "beta", "default launch phase is beta");
assert.strictEqual(PLAN_ENTITLEMENTS.beta.unlimited, true, "Beta is unlimited during beta");
assert.strictEqual(planMonthlyCredits("beta"), null, "Beta has no monthly cap during beta");
assert.ok(PLAN_ENTITLEMENTS.beta.aiDailyLimit > 0, "Beta still has a daily limit value for abuse protection");

// --- Assist rules: no monthly rollover, purchased + bonus never expire ---
assert.strictEqual(ENTITLEMENT_CONFIG.assistRules.monthlyRollover, false, "Monthly AI Assists do not roll over");
assert.strictEqual(ENTITLEMENT_CONFIG.assistRules.purchasedExpire, false, "Purchased AI Assists never expire");
assert.strictEqual(ENTITLEMENT_CONFIG.assistRules.bonusExpire, false, "Bonus AI Assists do not expire");
assert.deepStrictEqual(ENTITLEMENT_CONFIG.assistRules.spendOrder, ["monthly", "bonus", "purchased"]);

// --- AI Assist packs (placeholder pricing), available to all tiers ---
const packs = Object.fromEntries(ENTITLEMENT_CONFIG.assistPacks.map((p) => [p.assists, p.price]));
assert.strictEqual(packs[25], 1.99);
assert.strictEqual(packs[75], 4.99);
assert.strictEqual(packs[200], 9.99);
assert.strictEqual(packs[500], 19.99);

// --- Central AI Assist cost map ---
assert.strictEqual(aiAssistCost("import"), 1, "import costs 1 AI Assist");
assert.strictEqual(aiAssistCost("chat-editor"), 1, "chat editor costs 1");
assert.strictEqual(aiAssistCost("nutrition"), 1, "nutrition costs 1");
assert.strictEqual(aiAssistCost("shopping-optimize"), 1, "shopping optimize costs 1");
assert.strictEqual(aiAssistCost("adjust"), 2, "adjust costs 2");
assert.strictEqual(aiAssistCost("pantry"), 2, "Pantry Chef costs 2");
assert.strictEqual(aiAssistCost("meal-plan"), 4, "weekly meal plan costs 4");
assert.strictEqual(aiAssistCost("repair"), 0, "internal repair pass costs 0");
assert.strictEqual(aiAssistCost("general-ai"), 1, "unknown billable call costs 1 (conservative)");
assert.strictEqual(AI_ACTION_COSTS.import, 1, "cost map is the single source of truth");

// --- Spend order: monthly before bonus before purchased ---
assert.strictEqual(chooseSpendBucket({ monthlyRemaining: 5, bonus: 10, purchased: 10 }), "monthly", "spends monthly first");
assert.strictEqual(chooseSpendBucket({ monthlyRemaining: 0, bonus: 3, purchased: 10 }), "bonus", "then bonus");
assert.strictEqual(chooseSpendBucket({ monthlyRemaining: 0, bonus: 0, purchased: 4 }), "purchased", "then purchased");
assert.strictEqual(chooseSpendBucket({ monthlyRemaining: 0, bonus: 0, purchased: 0 }), null, "null when out of AI Assists");

// --- Multi-assist split across buckets (monthly -> bonus -> purchased) ---
assert.deepStrictEqual(
  splitAssistCharge(4, { monthlyRemaining: 10, bonus: 5, purchased: 5 }),
  { monthly: 4, bonus: 0, purchased: 0, shortfall: 0, covered: true },
  "a 4-assist action draws entirely from monthly when it can",
);
assert.deepStrictEqual(
  splitAssistCharge(4, { monthlyRemaining: 1, bonus: 1, purchased: 10 }),
  { monthly: 1, bonus: 1, purchased: 2, shortfall: 0, covered: true },
  "spills monthly -> bonus -> purchased in order",
);
assert.deepStrictEqual(
  splitAssistCharge(4, { monthlyRemaining: 1, bonus: 1, purchased: 0 }),
  { monthly: 1, bonus: 1, purchased: 0, shortfall: 2, covered: false },
  "reports a shortfall when balances can't cover the cost",
);
assert.deepStrictEqual(
  splitAssistCharge(0, { monthlyRemaining: 5 }),
  { monthly: 0, bonus: 0, purchased: 0, shortfall: 0, covered: true },
  "a zero-cost action charges nothing",
);

// --- Referral: 25 each, capped at 10/month ---
assert.strictEqual(REFERRAL_CONFIG.bonusAssists, 25, "Referral grants 25 AI Assists each side");
assert.strictEqual(REFERRAL_CONFIG.monthlyCap, 10, "Referral cap is 10/month");
assert.strictEqual(REFERRAL_CONFIG.triggersOn, "paid_conversion", "Referral triggers on paid conversion");
assert.strictEqual(referralBonusAllowed(0), true, "first referral allowed");
assert.strictEqual(referralBonusAllowed(9), true, "10th referral allowed");
assert.strictEqual(referralBonusAllowed(10), false, "11th referral blocked by cap");

// --- Hidden Founder tiers: beta-only, never public ---
assert.strictEqual(ENTITLEMENT_CONFIG.tiers.founder.hidden, true, "Founder is hidden from the public");
assert.strictEqual(ENTITLEMENT_CONFIG.tiers.founder_family.hidden, true, "Founder Family is hidden from the public");
assert.strictEqual(ENTITLEMENT_CONFIG.tiers.founder_family.price.yearly, 49.99, "Founder Family is $49.99/yr");
assert.strictEqual(ENTITLEMENT_CONFIG.tiers.founder_family.monthlyAssists, 700, "Founder Family gets 700 shared AI Assists");
assert.strictEqual(ENTITLEMENT_CONFIG.tiers.founder_family.memberCap, 4);
assert.strictEqual(PLAN_ENTITLEMENTS.founder_family.aiMonthlyLimit, 700, "enforcement limit for Founder Family is 700");
assert.deepStrictEqual(FOUNDER_TIERS, ["founder", "founder_family"]);

// Public config strips BOTH founder tiers, keeps the public ones.
const pub = publicEntitlementConfig();
assert.ok(!pub.tiers.founder, "public config hides Founder");
assert.ok(!pub.tiers.founder_family, "public config hides Founder Family");
assert.ok(pub.tiers.free && pub.tiers.plus && pub.tiers.family, "public config keeps Free/Plus/Family");
// And the public config still never says "credit" or "unlimited import".
assert.ok(!/credit/i.test(JSON.stringify(pub)), "public config never says 'credit'");

// founderOfferTiers exposes both founder options (for the beta thank-you screen).
const offers = founderOfferTiers();
assert.deepStrictEqual(offers.map((o) => o.id), ["founder", "founder_family"]);
assert.ok(offers.every((o) => o.price && o.price.yearly), "each founder option has yearly pricing");

// Eligibility: beta users (or anyone flagged founderEligible) only.
assert.strictEqual(isFounderEligible("beta", {}), true, "beta users are eligible");
assert.strictEqual(isFounderEligible("free", {}), false, "a plain free user off the street is NOT eligible");
assert.strictEqual(isFounderEligible("free", { founderEligible: true }), true, "a converted beta tester stays eligible");
assert.strictEqual(isFounderEligible("plus", {}), false, "a public Plus user is not eligible");

// --- Ads ready but off ---
assert.strictEqual(ENTITLEMENT_CONFIG.adsEnabled, false, "No ads at launch");

console.log("entitlements-test: ok");
