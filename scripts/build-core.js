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
 * require its siblings and nothing else. A bare specifier would load fine on a
 * developer's machine with node_modules present and then fail in CI, in the
 * browser, and on a phone. */
function assertNoExternalRequires(name, source) {
  const bad = [];
  for (const m of source.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)) {
    if (!m[1].startsWith("./")) bad.push(m[1]);
  }
  if (bad.length) {
    throw new Error(
      `${name}.js requires ${bad.map((b) => `"${b}"`).join(", ")} from outside the package. ` +
        `recipe-core must stay dependency-free: see packages/recipe-core/README.md.`,
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
  assertNoExternalRequires(name, source.toString("utf8"));

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
