#!/usr/bin/env node
/*
 * Copy packages/recipe-core/src/*.js into public/, where the browser loads them
 * as <script src> tags.
 *
 * Why a copy and not a path change: Vercel serves public/ as the static root and
 * nothing builds on deploy, so the files the browser fetches have to physically
 * exist in public/ and be committed — exactly the arrangement public/app.js is
 * already in. The copy is byte-for-byte, so the deployed web app runs the same
 * code the package holds, and `--check` makes a hand-edit of the generated copy
 * a build failure rather than a drift nobody notices.
 *
 * Dependency-free and Node-only: the CI job that exercises these modules runs
 * with no npm install.
 */
const fs = require("fs");
const path = require("path");

// Explicit rather than a glob: adding a module to the shared package is a
// decision about what the browser downloads on every visit, so it is made here
// and in public/index.html together.
const MODULES = [
  "shopping-list",
  "recipe-tags",
  "nutrition",
  "recipe-extract",
  "recipe-grounding",
  "recipe-schema",
  "recipe-normalize",
  "recipe-library",
];

const root = path.join(__dirname, "..");
const srcDir = path.join(root, "packages", "recipe-core", "src");
const outDir = path.join(root, "public");
const check = process.argv.includes("--check");

/* The dependency-free contract, enforced structurally: a module in here may
 * require a named sibling and nothing else. A bare specifier would load fine on
 * a developer's machine with node_modules present and then fail in CI, in the
 * browser, and on a phone.
 *
 * The specifier is resolved before it is judged, because a leading "./" proves
 * nothing: "./../../node_modules/x" starts with it and leaves the package. Only
 * a path that lands on one of the modules listed above is allowed. */
const SIBLINGS = new Set(MODULES.flatMap((m) => [`./${m}`, `./${m}.js`]));

/* Prose in these files talks about "require()-able in Node" and "captured
 * during import (recipe.macros)". Scanning raw text therefore reports comments
 * as violations, and a guard that cries wolf gets deleted — so matches on a
 * comment line are skipped. Full comment stripping is not worth it here: these
 * modules keep their prose in block comments and `//` lines, and a `require`
 * that matters is never written on one. */
// Is the match at `index` inside a comment on its own line?
//
// Only asked so that prose does not get reported as code: these files talk
// about "the import pipeline" and are "require()-able in Node", and a guard
// that cries wolf gets deleted. It judges the text BEFORE the match on that
// line, which is why a comment opened and CLOSED before the match is not a
// comment at all — `/**/require("../../node_modules/evil")` is code, and an
// earlier version of this function waved it through because the prefix began
// "/*".
function isCommentLine(source, index) {
  const start = source.lastIndexOf("\n", index) + 1;
  const prefix = source.slice(start, index);
  const trimmed = prefix.trimStart();
  if (trimmed.startsWith("//")) return true;
  // A continuation line of a block comment, as long as it has not ended.
  if (trimmed.startsWith("*") && !trimmed.includes("*/")) return true;
  // A block comment opened earlier on this line and still open at the match.
  return prefix.lastIndexOf("/*") > prefix.lastIndexOf("*/");
}

function assertSelfContained(name, source) {
  const bad = [];

  for (const m of source.matchAll(/require\s*\(([^)]*)\)/g)) {
    if (isCommentLine(source, m.index)) continue;
    const arg = m[1].trim();
    const literal = arg.match(/^["']([^"']+)["']$/);
    if (!literal) {
      // A computed specifier cannot be checked, so it cannot be allowed.
      bad.push(`require(${arg.slice(0, 40)}) — not a literal`);
      continue;
    }
    const spec = literal[1];
    const landsInside =
      path.resolve(srcDir, spec).startsWith(srcDir + path.sep) && SIBLINGS.has(spec);
    if (!landsInside) bad.push(`"${spec}"`);
  }

  /* These modules are UMD and load in a browser through a plain <script src>
   * tag, where ESM syntax is a hard failure rather than a style question. The
   * pattern is line-anchored, because these files are full of prose about "the
   * import pipeline" and "macros captured during import (recipe.macros)" — a
   * looser match reports a comment as a violation, and a guard that cries wolf
   * gets deleted. A dynamic `import()` is left to the browser, which fails on
   * it immediately and unmissably.
   *
   * The line anchor is also the limit of this check. A block comment whose
   * continuation lines do not begin with "*" would still be read as code, and
   * no amount of regex fixes that — only tracking comment state would.
   * docs/import-fetch-security.md weighs a parser against this, and why the
   * job that proves this package needs no dependencies cannot import one. */
  for (const m of source.matchAll(/^\s*(import|export)\s/gm)) {
    bad.push(`a top-level \`${m[1]}\` — this package is CommonJS/UMD, not ESM`);
  }

  if (bad.length) {
    throw new Error(
      `${name}.js reaches outside the package: ${[...new Set(bad)].join(", ")}.\n` +
        `recipe-core must stay dependency-free and loadable as a <script> tag — ` +
        `see packages/recipe-core/README.md.`,
    );
  }
}

const drifted = [];
let copied = 0;

for (const name of MODULES) {
  const from = path.join(srcDir, `${name}.js`);
  const to = path.join(outDir, `${name}.js`);
  if (!fs.existsSync(from)) {
    console.error(`missing canonical source: packages/recipe-core/src/${name}.js`);
    process.exit(1);
  }
  const source = fs.readFileSync(from);
  assertSelfContained(name, source.toString("utf8"));

  const existing = fs.existsSync(to) ? fs.readFileSync(to) : null;
  const same = existing && existing.equals(source);

  if (check) {
    if (!same) drifted.push(name);
    continue;
  }
  if (!same) {
    fs.writeFileSync(to, source);
    copied++;
  }
}

if (check) {
  if (drifted.length) {
    console.error(
      `public/ is out of date with packages/recipe-core/src:\n` +
        drifted.map((n) => `  public/${n}.js`).join("\n") +
        `\n\nRun \`npm run build:core\` and commit the result. If you edited the copy in\n` +
        `public/ by hand, move the change to packages/recipe-core/src/ instead.`,
    );
    process.exit(1);
  }
  console.log(`recipe-core: all ${MODULES.length} modules in public/ match their source.`);
} else {
  console.log(
    copied
      ? `recipe-core: copied ${copied} of ${MODULES.length} module(s) into public/.`
      : `recipe-core: public/ already matches all ${MODULES.length} modules.`,
  );
}
