/*
 * RecipeBox shared domain logic. Two files hold this code:
 *   packages/recipe-core/src/recipe-adjust.js  — the canonical source. Edit this one.
 *   public/recipe-adjust.js  — a generated copy, served to the browser. Never edit it.
 * After changing the source run `npm run build:core` and commit both.
 * See packages/recipe-core/README.md.
 */
/*
 * RecipeBoxAdjust — the AI Recipe Helper's proposal model (ADR 0016).
 *
 * The Helper does not hand back a recipe. It hands back a PROPOSAL: a plain-
 * English summary, its tradeoffs and uncertainties, maybe a clarifying
 * question, and a list of operations over an allowlisted set. Applying a
 * proposal is deterministic code in this file.
 *
 * That shape is the whole design, and it is worth saying why, because the web
 * app does the other thing. Asking a model to "return the complete updated
 * recipe JSON" produces a document that cannot be checked: nothing in it
 * distinguishes the change the cook asked for from drift the model introduced
 * along the way — a rewritten step, a dropped attribution, renumbered ids, a
 * quantity quietly rounded. You can diff two recipes, but you cannot tell
 * which differences were MEANT, and a model asked to declare what it changed
 * can make its declaration and its recipe agree while both are wrong.
 *
 * With operations, three guarantees hold without the model cooperating:
 *
 *   - The diff IS the proposal. Nothing is inferred by comparison.
 *   - The declaration and the change are one object, so they cannot disagree.
 *     `validate`'s added/removed are derived from the operations themselves.
 *   - Anything no operation names is untouched. Attribution, media, ids and
 *     createdAt are safe because no operation can express them — not because
 *     the prompt asks nicely. Recipe text is untrusted (it came from a web
 *     page), so an instruction hidden in an ingredient name has to be unable
 *     to reach them, rather than merely discouraged from trying.
 *
 * A substitution keeps the ingredient's id and changes its name. Written as a
 * removal plus an addition it would break every step that references it.
 *
 * Pure UMD: no DOM, no network, no AI call, no dependencies. The model call
 * itself lives on the server; this file only describes what may come back and
 * what it means.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.RecipeBoxAdjust = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ── Quantities ────────────────────────────────────────────────────────────
  // These two are the validator's own parsing, moved here with it from
  // scripts/recipe-model/quantity.js. They are deliberately NOT shopping-list's
  // amountToNumber: this one returns null for ranges and words ("1-2", "a
  // pinch") so an unparseable amount is skipped rather than guessed at, which
  // is what a validator wants and what the scorer's recorded expectations were
  // measured against.
  const UNICODE_FRACTIONS = { "¼": "1/4", "½": "1/2", "¾": "3/4", "⅓": "1/3", "⅔": "2/3", "⅛": "1/8", "⅜": "3/8", "⅝": "5/8", "⅞": "7/8" };

  const UNIT_ALIASES = {
    cup: ["cup", "cups", "c", "c."],
    tbsp: ["tbsp", "tbsp.", "tablespoon", "tablespoons", "tbs", "tbl", "t"],
    tsp: ["tsp", "tsp.", "teaspoon", "teaspoons"],
    oz: ["oz", "oz.", "ounce", "ounces"],
    lb: ["lb", "lbs", "pound", "pounds"],
    g: ["g", "gram", "grams"],
    kg: ["kg", "kilogram", "kilograms"],
    ml: ["ml", "milliliter", "milliliters", "millilitre", "millilitres"],
    can: ["can", "cans"],
    clove: ["clove", "cloves"],
    box: ["box", "boxes"],
    pinch: ["pinch", "pinches"],
  };
  const UNIT_LOOKUP = {};
  for (const [canon, list] of Object.entries(UNIT_ALIASES)) for (const a of list) UNIT_LOOKUP[a] = canon;

  function normUnit(u) {
    const s = String(u || "").trim().toLowerCase();
    if (!s) return "";
    return UNIT_LOOKUP[s] || s;
  }

  /** Parse "1 1/2", "1/2", "0.5", "½", "1½" → number. Null for words, ranges and blanks. */
  function parseAmount(a) {
    let s = String(a == null ? "" : a).trim();
    if (!s) return null;
    for (const [k, v] of Object.entries(UNICODE_FRACTIONS)) s = s.replace(new RegExp("(\\d)" + k), "$1 " + v).replace(k, v);
    let m = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
    if (m) return +m[1] + +m[2] / +m[3];
    m = s.match(/^(\d+)\/(\d+)$/);
    if (m) return +m[1] / +m[2];
    m = s.match(/^\d+(?:\.\d+)?$/);
    if (m) return +s;
    return null;
  }

  // ── The validator (ADR 0012, ADR 0016 step 6, ADR 0020) ───────────────────
  // Checks that a proposed recipe is internally consistent before it may be
  // OFFERED to the cook — not after they accept it. The cook is never asked to
  // approve a recipe that contradicts itself.
  //
  // It reads two step shapes, because two exist and both are real: the model
  // of the recipe-model investigation, where a reference may carry its own
  // amount, and the shipped Recipe of ADR 0012, where `ingredientRefs` are
  // plain ids and per-step shares live in `ingredientUses`. Normalising them
  // into one list here keeps a single validator rather than one per surface.

  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
  const refId = (r) => (typeof r === "string" ? r : r && r.id);
  const allIngs = (r) => (r.sections || []).flatMap((s) => s.ingredients || []);
  const allSteps = (r) => (r.sections || []).flatMap((s) => s.steps || []);
  const INVARIANT = /\d+\s*°\s*[FC]\b|\d+(?:\s*[–-]\s*\d+)?\s*(?:minutes?|mins?|hours?|hrs?)\b|\d+(?:\s*x\s*\d+)?[- ]inch\b/gi;

  /** Every ingredient a step touches, as objects, from either step shape. */
  function stepRefs(step) {
    const out = [];
    for (const r of step.ingredientRefs || []) out.push(typeof r === "string" ? { id: r } : r);
    for (const u of step.ingredientUses || []) out.push({ id: u.id, amount: u.amount, unit: u.unit, note: u.note });
    return out;
  }

  function validate(base, cand, change = {}) {
    const v = [];
    const add = (code, detail) => v.push({ code, detail });
    const ings = allIngs(cand), steps = allSteps(cand);
    const ids = new Set(ings.map((g) => g.id).concat((cand.preparations || []).map((p) => p.id)));

    // references resolve
    for (const s of steps) for (const r of stepRefs(s)) if (!ids.has(refId(r))) add("REF_UNRESOLVED", `${s.id} → ${refId(r)}`);

    // nothing invented, nothing silently removed
    const baseNames = new Set(allIngs(base).map((g) => norm(g.name)));
    const candNames = new Set(ings.map((g) => norm(g.name)));
    const added = new Set((change.added || []).map(norm)), removed = new Set((change.removed || []).map(norm));
    for (const n of candNames) if (!baseNames.has(n) && !added.has(n)) add("INVENTED_INGREDIENT", n);
    for (const n of baseNames) if (!candNames.has(n) && !removed.has(n)) add("SILENT_REMOVAL", n);

    // portions reconcile against the listed total
    for (const g of ings) {
      const total = parseAmount(g.amount);
      if (total === null) continue;
      let sum = 0, any = false;
      for (const s of steps) for (const r of stepRefs(s)) {
        if (r && r.id === g.id && r.amount != null) {
          const n = parseAmount(r.amount);
          if (n !== null && normUnit(r.unit) === normUnit(g.unit)) { sum += n; any = true; }
        }
      }
      if (any && sum > total + 0.011) add("PORTIONS_EXCEED_TOTAL", `${g.name}: ${sum} > ${total}`);
    }

    // a portion written into the step's wording must agree with the portion on its reference
    const QTY = /(\d+(?:\s+\d+\/\d+)?|\d+\/\d+)\s*(cups?|tablespoons?|tbsp|teaspoons?|tsp|oz|ounces?|lb|g|ml)\b/gi;
    for (const s of steps) {
      const written = [...String(s.text || "").matchAll(QTY)].map((x) => ({ amount: x[1], unit: normUnit(x[2]) }));
      for (const r of stepRefs(s)) {
        if (!r || r.amount == null) continue;
        const sameUnit = written.filter((w) => w.unit === normUnit(r.unit));
        const n = parseAmount(r.amount);
        if (sameUnit.length && !sameUnit.some((w) => Math.abs(parseAmount(w.amount) - n) < 0.011)) add("STEP_TEXT_DISAGREES_WITH_PORTION", `${s.id}: text says ${sameUnit.map((w) => w.amount + " " + w.unit).join(", ")}, reference says ${r.amount} ${r.unit}`);
      }
    }

    // a preparation is consumed only after the step that makes it
    const order = new Map(steps.map((s, i) => [s.id, i]));
    for (const p of cand.preparations || []) {
      const made = order.get(p.producedBy);
      steps.forEach((s, i) => {
        if (stepRefs(s).some((r) => refId(r) === p.id) && (made === undefined || i <= made)) add("PREPARATION_USED_BEFORE_MADE", `${p.name} in ${s.id}`);
      });
    }

    // scaling: amounts scale, times / temperatures / pan sizes do not
    if (change.kind === "scale" && change.factor) {
      const baseById = new Map(allIngs(base).map((g) => [g.id, g]));
      for (const g of ings) {
        const b = baseById.get(g.id), bn = b && parseAmount(b.amount), cn = parseAmount(g.amount);
        if (bn !== null && bn !== undefined && cn !== null && Math.abs(cn - bn * change.factor) > 0.011) add("SCALE_MISMATCH", `${g.name}: ${g.amount} ≠ ${b.amount} × ${change.factor}`);
      }
      const baseSteps = new Map(allSteps(base).map((s) => [s.id, s]));
      for (const s of steps) {
        const b = baseSteps.get(s.id); if (!b) continue;
        const bi = (b.text.match(INVARIANT) || []).join("|"), ci = (s.text.match(INVARIANT) || []).join("|");
        if (bi !== ci) add("SCALED_TIME_TEMPERATURE_OR_PAN", `${s.id}: "${bi}" → "${ci}"`);
      }
    }

    // attribution is never edited by an adjustment (ADR 0020 rule 3)
    if (JSON.stringify(base.source || null) !== JSON.stringify(cand.source || null)) add("SOURCE_CHANGED", "source must be carried forward unchanged");
    return v;
  }

  // ── The proposal ──────────────────────────────────────────────────────────

  /**
   * Every operation a proposal may contain. The allowlist is the security
   * boundary: a request the model cannot express is a change it cannot make,
   * whoever wrote the text it read.
   */
  const OPERATIONS = [
    "set-ingredient-amount",
    "substitute-ingredient",
    "add-ingredient",
    "remove-ingredient",
    "set-step-text",
    "set-step-refs",
    "add-step",
    "remove-step",
    "set-field",
  ];

  /**
   * Fields `set-field` may write.
   *
   * Absent on purpose, each for its own reason:
   *   source      attribution is part of what a recipe IS (ADR 0020), and the
   *               validator rejects a changed one anyway. Two locks.
   *   heroImage   the photograph is the cook's or the source's, not a
   *               consequence of changing the sugar.
   *   macros      a nutrition estimate is measured, not asserted. See
   *               applyProposal: an ingredient change CLEARS it rather than
   *               letting the model restate it, because a calorie count
   *               computed from the old ingredients printed beside the new
   *               ones is a number a cook will act on.
   *   id, createdAt, updatedAt   identity and history are not content.
   */
  const SETTABLE_FIELDS = ["title", "description", "notes", "servings", "prepTime", "cookTime", "totalTime", "category", "tags"];

  // Bounds. A proposal is a few sentences and a handful of changes; anything
  // past these is a runaway generation, not an adjustment, and is refused
  // before it reaches the cook's screen.
  const LIMITS = { operations: 60, summary: 1500, text: 1200, name: 160, note: 400, list: 12, tags: 24, refs: 40 };

  const isStr = (x) => typeof x === "string";
  const trimmed = (x) => (isStr(x) ? x.trim() : "");

  /**
   * The constrained-output schema, as `recipe-schema` is for extraction.
   *
   * One tool, forced. The model fills a typed structure instead of being asked
   * for raw JSON and repaired when it isn't, and the enums mean an operation
   * outside the allowlist usually never reaches us — `readProposal` still
   * assumes it might.
   */
  function proposalTool() {
    const op = {
      type: "object",
      properties: {
        kind: { type: "string", enum: OPERATIONS },
        id: { type: "string", description: "The existing ingredient or step id this operates on." },
        sectionIndex: { type: "integer", description: "Which section an addition goes in. 0 for a single-part recipe." },
        afterId: { type: "string", description: "Place the addition after this existing id. Omit to append." },
        name: { type: "string" },
        amount: { type: "string", description: "As a cook would write it: \"1 1/2\", \"1/2\", \"2\". Never a decimal expansion." },
        unit: { type: "string" },
        text: { type: "string" },
        refs: {
          type: "array",
          description: "Ingredient ids this step uses. An object carries this step's share of a divided ingredient.",
          items: {
            oneOf: [
              { type: "string" },
              { type: "object", properties: { id: { type: "string" }, amount: { type: "string" }, unit: { type: "string" }, note: { type: "string" } }, required: ["id"] },
            ],
          },
        },
        field: { type: "string", enum: SETTABLE_FIELDS },
        value: { description: "The new value for `field`." },
        why: { type: "string", description: "One short clause: why this change, for the cook to read." },
      },
      required: ["kind"],
    };
    return {
      name: "propose_adjustment",
      description:
        "Propose an adjustment to the cook's recipe. You do not change the recipe: you describe changes the cook will " +
        "review and approve or reject. Reference ingredients and steps by the ids given. Ask a question instead of " +
        "proposing operations when the answer would materially change what you would do.",
      input_schema: {
        type: "object",
        properties: {
          summary: { type: "string", description: "Plain English, to the cook, saying what you would change and why. Required." },
          question: { type: "string", description: "A clarifying question. When you ask one, send no operations." },
          tradeoffs: { type: "array", items: { type: "string" }, description: "What the cook gives up or risks. Say so plainly." },
          uncertainties: { type: "array", items: { type: "string" }, description: "What you are not sure of, including anything you cannot guarantee." },
          alternatives: {
            type: "array",
            description: "Other reasonable approaches, for the cook to ask for instead.",
            items: { type: "object", properties: { label: { type: "string" }, summary: { type: "string" } }, required: ["label", "summary"] },
          },
          operations: { type: "array", items: op },
        },
        required: ["summary"],
      },
    };
  }

  /**
   * Ids a proposal may name: everything in the base, plus what it adds itself.
   *
   * Preparations count as referencable things a step can use — "fold in the
   * crumble" points at something an earlier step made, not at a shopping item
   * (ADR 0012). Leaving them out would make a correct proposal unreadable and
   * would hide PREPARATION_USED_BEFORE_MADE behind a shape error.
   */
  function idsFor(base) {
    const ing = new Set(), step = new Set();
    for (const s of base.sections || []) {
      for (const g of s.ingredients || []) ing.add(g.id);
      for (const t of s.steps || []) step.add(t.id);
    }
    for (const p of base.preparations || []) ing.add(p.id);
    return { ing, step };
  }

  /**
   * Parse and shape-check a proposal, before anything is applied.
   *
   * Returns `{ proposal, problems }`. `problems` are structural — an unknown
   * operation, an id that is in no section, a field outside the allowlist, a
   * decimal where a cook writes a fraction. A proposal with problems is not
   * offered: the caller returns it for correction (phase 4's "return it for
   * correction rather than silently saving it"), which is a cheaper and more
   * reliable repair than asking the model to fix prose.
   *
   * A proposal with a question and no operations is valid and complete. That
   * is ADR 0016 step 2, and refusing it would make the Helper guess rather
   * than ask.
   */
  function readProposal(raw, base) {
    const problems = [];
    const bad = (code, detail) => problems.push({ code, detail });

    let input = raw;
    if (isStr(raw)) {
      try { input = JSON.parse(raw); } catch (err) { return { proposal: null, problems: [{ code: "PROPOSAL_UNPARSEABLE", detail: err.message }] }; }
    }
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      return { proposal: null, problems: [{ code: "PROPOSAL_UNPARSEABLE", detail: "not an object" }] };
    }

    const summary = trimmed(input.summary);
    if (!summary) bad("MISSING_SUMMARY", "a proposal has to say what it would do, in plain English");
    if (summary.length > LIMITS.summary) bad("TEXT_TOO_LONG", `summary is ${summary.length} characters`);

    const list = (value, what) => {
      if (value === undefined || value === null) return [];
      if (!Array.isArray(value)) { bad("BAD_SHAPE", `${what} is not a list`); return []; }
      if (value.length > LIMITS.list) bad("TOO_MANY_OPERATIONS", `${what} has ${value.length} entries`);
      return value.slice(0, LIMITS.list).map((x) => trimmed(x)).filter(Boolean).map((x) => x.slice(0, LIMITS.note));
    };

    const alternatives = [];
    if (Array.isArray(input.alternatives)) {
      for (const a of input.alternatives.slice(0, LIMITS.list)) {
        const label = trimmed(a && a.label), summaryText = trimmed(a && a.summary);
        if (label && summaryText) alternatives.push({ label: label.slice(0, LIMITS.name), summary: summaryText.slice(0, LIMITS.note) });
      }
    }

    const rawOps = input.operations === undefined || input.operations === null ? [] : input.operations;
    if (!Array.isArray(rawOps)) {
      return { proposal: null, problems: problems.concat([{ code: "BAD_SHAPE", detail: "operations is not a list" }]) };
    }
    if (rawOps.length > LIMITS.operations) bad("TOO_MANY_OPERATIONS", `${rawOps.length} operations`);

    const { ing, step } = idsFor(base || {});
    // An id added earlier in the same proposal may be referenced later, so the
    // known-id sets grow as the operations are read, in order.
    const knownIng = new Set(ing), knownStep = new Set(step);
    const pendingIng = new Set();   // ids this proposal will create
    const sectionCount = ((base || {}).sections || []).length || 1;

    const operations = [];
    rawOps.slice(0, LIMITS.operations).forEach((o, index) => {
      const where = `operation ${index + 1}`;
      if (!o || typeof o !== "object") { bad("BAD_SHAPE", `${where} is not an object`); return; }
      const kind = trimmed(o.kind);
      if (!OPERATIONS.includes(kind)) { bad("UNKNOWN_OPERATION", `${where}: ${kind || "(none)"}`); return; }

      const op = { kind };
      if (o.why !== undefined) op.why = trimmed(o.why).slice(0, LIMITS.note);

      const needIngredient = () => {
        const id = trimmed(o.id);
        if (!id || !knownIng.has(id)) { bad("UNKNOWN_INGREDIENT_ID", `${where}: ${id || "(none)"}`); return null; }
        return id;
      };
      const needStep = () => {
        const id = trimmed(o.id);
        if (!id || !knownStep.has(id)) { bad("UNKNOWN_STEP_ID", `${where}: ${id || "(none)"}`); return null; }
        return id;
      };
      // A quantity is kept as the cook would write it. "0.3333333" for a third
      // is the float artefact the import corpus already measures, and a number
      // here would arrive as one.
      const readAmount = () => {
        if (o.amount === undefined || o.amount === null || o.amount === "") return undefined;
        if (typeof o.amount === "number") { bad("AMOUNT_NOT_WRITTEN", `${where}: ${o.amount} came as a number`); return undefined; }
        const a = trimmed(o.amount);
        if (/\.\d{3,}/.test(a)) { bad("AMOUNT_NOT_WRITTEN", `${where}: ${a}`); return undefined; }
        return a.slice(0, 32);
      };
      const readSection = () => {
        const n = Number(o.sectionIndex);
        if (!Number.isInteger(n) || n < 0 || n >= sectionCount) {
          if (o.sectionIndex !== undefined && o.sectionIndex !== null) bad("BAD_SECTION_INDEX", `${where}: ${o.sectionIndex}`);
          return 0;
        }
        return n;
      };
      const readRefs = () => {
        if (!Array.isArray(o.refs)) { bad("BAD_SHAPE", `${where}: refs is not a list`); return null; }
        if (o.refs.length > LIMITS.refs) { bad("TOO_MANY_OPERATIONS", `${where}: ${o.refs.length} refs`); return null; }
        const out = [];
        for (const r of o.refs) {
          const id = isStr(r) ? trimmed(r) : trimmed(r && r.id);
          if (!id || !(knownIng.has(id) || pendingIng.has(id))) { bad("UNKNOWN_INGREDIENT_ID", `${where}: ref ${id || "(none)"}`); continue; }
          if (isStr(r)) { out.push({ id }); continue; }
          const ref = { id };
          if (r.amount !== undefined && r.amount !== null && r.amount !== "") {
            if (typeof r.amount === "number") bad("AMOUNT_NOT_WRITTEN", `${where}: ref ${id} amount came as a number`);
            else ref.amount = trimmed(r.amount).slice(0, 32);
          }
          if (r.unit) ref.unit = trimmed(r.unit).slice(0, 32);
          if (r.note) ref.note = trimmed(r.note).slice(0, LIMITS.note);
          out.push(ref);
        }
        return out;
      };
      const readText = () => {
        const t = trimmed(o.text);
        if (!t) { bad("BAD_SHAPE", `${where}: no text`); return null; }
        if (t.length > LIMITS.text) { bad("TEXT_TOO_LONG", `${where}: ${t.length} characters`); return null; }
        return t;
      };
      const readName = () => {
        const n = trimmed(o.name);
        if (!n) { bad("BAD_SHAPE", `${where}: no name`); return null; }
        return n.slice(0, LIMITS.name);
      };

      switch (kind) {
        case "set-ingredient-amount": {
          const id = needIngredient(); if (!id) return;
          op.id = id;
          op.amount = readAmount() ?? "";
          if (o.unit !== undefined) op.unit = trimmed(o.unit).slice(0, 32);
          break;
        }
        case "substitute-ingredient": {
          const id = needIngredient(); if (!id) return;
          const name = readName(); if (!name) return;
          op.id = id; op.name = name;
          const amount = readAmount(); if (amount !== undefined) op.amount = amount;
          if (o.unit !== undefined) op.unit = trimmed(o.unit).slice(0, 32);
          break;
        }
        case "add-ingredient": {
          const name = readName(); if (!name) return;
          op.name = name;
          op.sectionIndex = readSection();
          if (o.afterId) op.afterId = trimmed(o.afterId);
          const amount = readAmount(); if (amount !== undefined) op.amount = amount;
          if (o.unit) op.unit = trimmed(o.unit).slice(0, 32);
          // The id this will get is not known until the proposal is applied,
          // but a later operation has to be able to name it. The model is told
          // to use `new:<name>` for that, and it is resolved on apply.
          pendingIng.add("new:" + name.toLowerCase());
          break;
        }
        case "remove-ingredient": {
          const id = needIngredient(); if (!id) return;
          op.id = id;
          break;
        }
        case "set-step-text": {
          const id = needStep(); if (!id) return;
          const text = readText(); if (!text) return;
          op.id = id; op.text = text;
          break;
        }
        case "set-step-refs": {
          const id = needStep(); if (!id) return;
          const refs = readRefs(); if (!refs) return;
          op.id = id; op.refs = refs;
          break;
        }
        case "add-step": {
          const text = readText(); if (!text) return;
          op.text = text;
          op.sectionIndex = readSection();
          if (o.afterId) op.afterId = trimmed(o.afterId);
          if (o.refs !== undefined) { const refs = readRefs(); if (refs) op.refs = refs; }
          break;
        }
        case "remove-step": {
          const id = needStep(); if (!id) return;
          op.id = id;
          break;
        }
        case "set-field": {
          const field = trimmed(o.field);
          if (!SETTABLE_FIELDS.includes(field)) { bad("FIELD_NOT_SETTABLE", `${where}: ${field || "(none)"}`); return; }
          op.field = field;
          if (field === "servings") {
            const n = Number(o.value);
            if (!Number.isFinite(n) || n <= 0 || n > 1000) { bad("BAD_SHAPE", `${where}: servings ${o.value}`); return; }
            op.value = Math.round(n);
          } else if (field === "tags") {
            if (!Array.isArray(o.value)) { bad("BAD_SHAPE", `${where}: tags is not a list`); return; }
            op.value = o.value.slice(0, LIMITS.tags).map((t) => trimmed(t).slice(0, LIMITS.name)).filter(Boolean);
          } else {
            const value = trimmed(o.value);
            if (!isStr(o.value)) { bad("BAD_SHAPE", `${where}: ${field} is not text`); return; }
            op.value = value.slice(field === "notes" || field === "description" ? LIMITS.text : LIMITS.name);
          }
          break;
        }
        default: return;
      }
      operations.push(op);
    });

    const question = trimmed(input.question).slice(0, LIMITS.text);
    if (!question && operations.length === 0 && problems.length === 0) {
      bad("PROPOSAL_EMPTY", "no operations and no question");
    }

    const proposal = {
      summary: summary.slice(0, LIMITS.summary),
      question,
      tradeoffs: list(input.tradeoffs, "tradeoffs"),
      uncertainties: list(input.uncertainties, "uncertainties"),
      alternatives,
      operations,
    };
    return { proposal: problems.length ? null : proposal, problems, draft: proposal };
  }

  /** The next free `i<n>` / `s<n>`, so an added id can never collide with a live one. */
  function nextId(recipe, prefix) {
    let max = 0;
    for (const s of recipe.sections || []) {
      const rows = prefix === "i" ? s.ingredients || [] : s.steps || [];
      for (const r of rows) {
        const m = /^[a-z]+(\d+)$/.exec(String(r.id || ""));
        if (m) max = Math.max(max, Number(m[1]));
      }
    }
    return prefix + (max + 1);
  }

  const clone = (x) => JSON.parse(JSON.stringify(x));

  function findIngredientAt(recipe, id) {
    for (let si = 0; si < (recipe.sections || []).length; si++) {
      const i = (recipe.sections[si].ingredients || []).findIndex((g) => g.id === id);
      if (i >= 0) return { sectionIndex: si, index: i, ingredient: recipe.sections[si].ingredients[i] };
    }
    return null;
  }
  function findStepAt(recipe, id) {
    for (let si = 0; si < (recipe.sections || []).length; si++) {
      const i = (recipe.sections[si].steps || []).findIndex((t) => t.id === id);
      if (i >= 0) return { sectionIndex: si, index: i, step: recipe.sections[si].steps[i] };
    }
    return null;
  }

  /** Split a ref list into the shipped Recipe's two fields (ADR 0012). */
  function writeRefs(step, refs) {
    step.ingredientRefs = refs.map((r) => r.id);
    const uses = refs.filter((r) => r.amount || r.note).map((r) => {
      const u = { id: r.id };
      if (r.amount) u.amount = r.amount;
      if (r.unit) u.unit = r.unit;
      if (r.note) u.note = r.note;
      return u;
    });
    if (uses.length) step.ingredientUses = uses;
    else delete step.ingredientUses;
  }

  /**
   * Apply a proposal. Deterministic, and the only thing that ever turns a
   * proposal into a recipe.
   *
   * Returns the candidate recipe and the `change` the validator needs —
   * derived from the operations, which is why the two cannot disagree.
   */
  function applyProposal(base, proposal) {
    const recipe = clone(base);
    if (!Array.isArray(recipe.sections) || recipe.sections.length === 0) recipe.sections = [{ ingredients: [], steps: [] }];
    const added = [], removed = [];
    let touchedIngredients = false;
    // `new:<name>` placeholders resolve to the real id once it is assigned.
    const placeholders = new Map();
    const resolve = (id) => placeholders.get(id) || id;

    for (const op of proposal.operations || []) {
      switch (op.kind) {
        case "set-ingredient-amount": {
          const at = findIngredientAt(recipe, op.id); if (!at) break;
          at.ingredient.amount = op.amount;
          if (op.unit !== undefined) at.ingredient.unit = op.unit;
          touchedIngredients = true;
          break;
        }
        case "substitute-ingredient": {
          const at = findIngredientAt(recipe, op.id); if (!at) break;
          removed.push(at.ingredient.name);
          added.push(op.name);
          at.ingredient.name = op.name;
          if (op.amount !== undefined) at.ingredient.amount = op.amount;
          if (op.unit !== undefined) at.ingredient.unit = op.unit;
          // The original line described the ingredient that is no longer here.
          delete at.ingredient.raw;
          delete at.ingredient.weightAmount;
          delete at.ingredient.weightUnit;
          touchedIngredients = true;
          break;
        }
        case "add-ingredient": {
          const si = Math.min(op.sectionIndex || 0, recipe.sections.length - 1);
          const section = recipe.sections[si];
          if (!Array.isArray(section.ingredients)) section.ingredients = [];
          const id = nextId(recipe, "i");
          const ingredient = { id, name: op.name };
          if (op.amount) ingredient.amount = op.amount;
          if (op.unit) ingredient.unit = op.unit;
          const after = op.afterId ? section.ingredients.findIndex((g) => g.id === op.afterId) : -1;
          if (after >= 0) section.ingredients.splice(after + 1, 0, ingredient);
          else section.ingredients.push(ingredient);
          placeholders.set("new:" + op.name.toLowerCase(), id);
          added.push(op.name);
          touchedIngredients = true;
          break;
        }
        case "remove-ingredient": {
          const at = findIngredientAt(recipe, op.id); if (!at) break;
          removed.push(at.ingredient.name);
          recipe.sections[at.sectionIndex].ingredients.splice(at.index, 1);
          // A step may not keep pointing at something that is gone: the
          // validator would call it an unresolved reference, and the cook
          // would see a blank row where an ingredient used to be.
          for (const s of recipe.sections) for (const t of s.steps || []) {
            if (Array.isArray(t.ingredientRefs)) t.ingredientRefs = t.ingredientRefs.filter((r) => r !== op.id);
            if (Array.isArray(t.ingredientUses)) {
              t.ingredientUses = t.ingredientUses.filter((u) => u.id !== op.id);
              if (!t.ingredientUses.length) delete t.ingredientUses;
            }
          }
          touchedIngredients = true;
          break;
        }
        case "set-step-text": {
          const at = findStepAt(recipe, op.id); if (!at) break;
          at.step.text = op.text;
          break;
        }
        case "set-step-refs": {
          const at = findStepAt(recipe, op.id); if (!at) break;
          writeRefs(at.step, (op.refs || []).map((r) => ({ ...r, id: resolve(r.id) })));
          break;
        }
        case "add-step": {
          const si = Math.min(op.sectionIndex || 0, recipe.sections.length - 1);
          const section = recipe.sections[si];
          if (!Array.isArray(section.steps)) section.steps = [];
          const step = { id: nextId(recipe, "s"), text: op.text };
          writeRefs(step, (op.refs || []).map((r) => ({ ...r, id: resolve(r.id) })));
          const after = op.afterId ? section.steps.findIndex((t) => t.id === op.afterId) : -1;
          if (after >= 0) section.steps.splice(after + 1, 0, step);
          else section.steps.push(step);
          break;
        }
        case "remove-step": {
          const at = findStepAt(recipe, op.id); if (!at) break;
          recipe.sections[at.sectionIndex].steps.splice(at.index, 1);
          break;
        }
        case "set-field": {
          recipe[op.field] = Array.isArray(op.value) ? op.value.slice() : op.value;
          break;
        }
        default: break;
      }
    }

    // A macro estimate computed from the old ingredients, printed beside the
    // new ones, is a number a cook will act on. Changing what goes in clears
    // it rather than restating it; the model is not allowed to assert macros,
    // and an estimate is re-measured on request.
    if (touchedIngredients && recipe.macros) delete recipe.macros;

    return { recipe, change: { kind: "edit", added, removed } };
  }

  /** "1/2 cup unsalted butter", skipping what the recipe does not give. */
  function describeIngredient(g) {
    return [g.amount, g.unit, g.name].map((x) => String(x || "").trim()).filter(Boolean).join(" ");
  }

  /**
   * The proposal as rows a review screen draws: what each operation does to
   * which line, before and after. ADR 0016 step 5 — the concrete changes,
   * after the plain-English proposal and never instead of it.
   */
  function describeProposal(base, proposal) {
    const rows = [];
    const { recipe } = applyProposal(base, proposal);
    const stepNumber = (r, id) => {
      let n = 0;
      for (const s of r.sections || []) for (const t of s.steps || []) { n++; if (t.id === id) return n; }
      return null;
    };
    const named = (r, id) => {
      const at = findIngredientAt(r, id);
      if (at) return at.ingredient.name;
      const prep = (r.preparations || []).find((p) => p.id === id);
      return prep ? prep.name : null;
    };
    const names = (r, step) => stepRefs(step).map((x) => named(r, x.id)).filter(Boolean).join(", ");

    for (const op of proposal.operations || []) {
      const why = op.why || "";
      switch (op.kind) {
        case "set-ingredient-amount": {
          const before = findIngredientAt(base, op.id), after = findIngredientAt(recipe, op.id);
          if (before && after) rows.push({ kind: "amount", label: before.ingredient.name, before: describeIngredient(before.ingredient), after: describeIngredient(after.ingredient), why });
          break;
        }
        case "substitute-ingredient": {
          const before = findIngredientAt(base, op.id), after = findIngredientAt(recipe, op.id);
          if (before && after) rows.push({ kind: "substitute", label: "Swap", before: describeIngredient(before.ingredient), after: describeIngredient(after.ingredient), why });
          break;
        }
        case "add-ingredient": {
          rows.push({ kind: "add-ingredient", label: "Add", before: "", after: [op.amount, op.unit, op.name].filter(Boolean).join(" "), why });
          break;
        }
        case "remove-ingredient": {
          const before = findIngredientAt(base, op.id);
          if (before) rows.push({ kind: "remove-ingredient", label: "Remove", before: describeIngredient(before.ingredient), after: "", why });
          break;
        }
        case "set-step-text": {
          const before = findStepAt(base, op.id);
          rows.push({ kind: "step-text", label: "Step " + (stepNumber(base, op.id) || "?"), before: before ? before.step.text : "", after: op.text, why });
          break;
        }
        case "set-step-refs": {
          const before = findStepAt(base, op.id), after = findStepAt(recipe, op.id);
          rows.push({
            kind: "step-refs",
            label: "Step " + (stepNumber(base, op.id) || "?") + " ingredients",
            before: before ? names(base, before.step) : "",
            after: after ? names(recipe, after.step) : "",
            why,
          });
          break;
        }
        case "add-step": {
          rows.push({ kind: "add-step", label: "New step", before: "", after: op.text, why });
          break;
        }
        case "remove-step": {
          const before = findStepAt(base, op.id);
          rows.push({ kind: "remove-step", label: "Remove step " + (stepNumber(base, op.id) || "?"), before: before ? before.step.text : "", after: "", why });
          break;
        }
        case "set-field": {
          const label = op.field === "tags" ? "Tags" : op.field.charAt(0).toUpperCase() + op.field.slice(1);
          const before = base[op.field];
          rows.push({
            kind: "field",
            label,
            before: Array.isArray(before) ? before.join(", ") : String(before == null ? "" : before),
            after: Array.isArray(op.value) ? op.value.join(", ") : String(op.value),
            why,
          });
          break;
        }
        default: break;
      }
    }

    // Said out loud rather than discovered later: the estimate is gone because
    // what the recipe is made of changed.
    if (base.macros && !recipe.macros) {
      rows.push({ kind: "macros-cleared", label: "Nutrition estimate", before: "estimated", after: "cleared — re-estimate after accepting", why: "" });
    }
    return rows;
  }

  /**
   * Apply, then validate (ADR 0016 step 6). The caller offers the proposal
   * only when `violations` is empty; otherwise it returns it for correction.
   */
  function checkProposal(base, proposal) {
    const { recipe, change } = applyProposal(base, proposal);
    return { recipe, change, violations: validate(base, recipe, change) };
  }

  /** True when a proposal only talks — a question, or nothing to change. */
  function isQuestionOnly(proposal) {
    return Boolean(proposal) && (proposal.operations || []).length === 0;
  }

  return {
    OPERATIONS,
    SETTABLE_FIELDS,
    LIMITS,
    proposalTool,
    readProposal,
    applyProposal,
    describeProposal,
    checkProposal,
    isQuestionOnly,
    validate,
    stepRefs,
    parseAmount,
    normUnit,
    describeIngredient,
  };
});
