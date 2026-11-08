#!/usr/bin/env node
"use strict";
// Isolated preview check for the existing web app. Starts server.js locally with a
// scrubbed environment (no database, no AI, email or API keys), refuses to continue
// if the server reports a database connection, then runs the existing smoke and
// security smoke tests against it and, when Playwright is installed, loads the UI
// in a headless browser. It never talks to Vercel, Neon or any production service,
// and it fails if any tracked file changed while it ran.
//
//   node scripts/web-preview-check.js
//
// Optional env:
//   WEB_CHECK_CDN_DIR   node_modules dir holding react@18, react-dom@18, jspdf, pdfjs-dist,
//                       heic2any; the page's CDN scripts are served from there (for
//                       sandboxes without CDN access). CI loads the real CDNs instead.
//   WEB_CHECK_SCREENSHOT  path to save a screenshot of the home screen.

const { spawn, execFileSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const ROOT = path.join(__dirname, "..");
const PORT = String(4100 + Math.floor(Math.random() * 500));
const BASE = `http://127.0.0.1:${PORT}`;

const gitStatus = () => { try { return execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: ROOT }).toString(); } catch { return null; } };
const before = gitStatus();

// Only what node needs to run, plus proxy settings so a sandboxed browser can reach CDNs.
const KEEP = ["PATH", "HOME", "TMPDIR", "LANG", "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY", "https_proxy", "http_proxy", "no_proxy", "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE"];
const env = { NODE_ENV: "test", PORT };
for (const k of KEEP) if (process.env[k]) env[k] = process.env[k];

const failures = [];
const server = spawn(process.execPath, ["server.js"], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
let log = "";
server.stdout.on("data", (d) => (log += d));
server.stderr.on("data", (d) => (log += d));
const stop = () => { try { server.kill(); } catch {} };
process.on("exit", stop);

async function waitForHealth() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(BASE + "/api/health"); if (r.ok) return r.json(); } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("server did not become healthy:\n" + log);
}

function runScript(name) {
  try {
    execFileSync(process.execPath, [path.join("scripts", name)], { cwd: ROOT, env: { ...env, BASE_URL: BASE }, stdio: "pipe" });
    console.log(`  ok   ${name}`);
  } catch (e) {
    failures.push(name);
    console.log(`  FAIL ${name}\n${String(e.stdout || "")}${String(e.stderr || "")}`.slice(0, 2000));
  }
}

const CDN_MAP = {
  "https://unpkg.com/react@18/umd/react.production.min.js": "react/umd/react.production.min.js",
  "https://unpkg.com/react-dom@18/umd/react-dom.production.min.js": "react-dom/umd/react-dom.production.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js": "jspdf/dist/jspdf.umd.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js": "pdfjs-dist/build/pdf.min.js",
  "https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js": "heic2any/dist/heic2any.min.js",
};

async function browserCheck() {
  let chromium;
  try { ({ chromium } = require("playwright")); } catch { console.log("  skip browser check (playwright not installed)"); return; }
  const launch = process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY, bypass: "127.0.0.1,localhost" } } : {};
  const browser = await chromium.launch(launch);
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const cdnDir = process.env.WEB_CHECK_CDN_DIR;
    if (cdnDir) {
      await page.route(/^https:\/\/(unpkg\.com|cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net)\//, (route) => {
        const local = CDN_MAP[route.request().url()];
        if (!local) return route.abort();
        route.fulfill({ status: 200, contentType: "application/javascript", body: fs.readFileSync(path.join(cdnDir, local)) });
      });
    }
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    await page.waitForTimeout(2500);
    const rendered = await page.evaluate(() => {
      const root = document.getElementById("root") || document.body;
      return { children: root.children.length, text: (root.innerText || "").trim().length, title: document.title };
    });
    if (process.env.WEB_CHECK_SCREENSHOT) await page.screenshot({ path: process.env.WEB_CHECK_SCREENSHOT });
    if (rendered.title !== "RecipeBox") failures.push(`browser: title is "${rendered.title}"`);
    if (!rendered.children || rendered.text < 20) failures.push("browser: the app did not render any content");
    if (errors.length) failures.push("browser: page errors: " + errors.slice(0, 3).join(" | "));
    console.log(failures.some((f) => f.startsWith("browser")) ? "  FAIL browser render" : `  ok   browser render (title "${rendered.title}", ${rendered.text} characters of UI text, no page errors)`);
  } finally {
    await browser.close();
  }
}

(async () => {
  console.log(`web-preview-check: isolated server on ${BASE}`);
  const health = await waitForHealth();
  if (health.database !== false) {
    console.error("REFUSING: the isolated server reports a database connection. Nothing was run.");
    process.exit(1);
  }
  console.log("  ok   health: no database, no credentials");
  runScript("smoke-test.js");
  runScript("security-smoke-test.js");
  await browserCheck();
  stop();
  const after = gitStatus();
  if (before !== null && after !== before) failures.push("tracked files changed during the check:\n" + after);
  if (failures.length) { console.error("\nweb-preview-check: FAILED\n  " + failures.join("\n  ")); process.exit(1); }
  console.log("web-preview-check: ok");
})().catch((e) => { console.error(e); process.exit(1); });
