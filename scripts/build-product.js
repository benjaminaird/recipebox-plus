#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const variant = String(process.argv[2] || '').toLowerCase();

if (variant !== 'everplate') {
  console.error('Usage: node scripts/build-product.js everplate');
  process.exit(2);
}

const sourceDir = path.join(root, 'public');
const outputDir = path.join(root, 'dist', variant);
const apiBase = String(process.env.EVERPLATE_API_BASE || 'https://recipebox-kappa.vercel.app').replace(/\/$/, '');

if (!/^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(apiBase) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(apiBase)) {
  throw new Error('EVERPLATE_API_BASE must be an HTTPS origin or a localhost development origin.');
}

fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(path.dirname(outputDir), { recursive: true });
fs.cpSync(sourceDir, outputDir, { recursive: true });

const indexPath = path.join(outputDir, 'index.html');
let index = fs.readFileSync(indexPath, 'utf8');
index = index
  .replace('<html lang="en">', '<html lang="en" data-product="everplate">')
  .replaceAll('RecipeBox', 'EverPlate')
  .replace(/  <link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com\/[^\n]+\n/, '  <link rel="stylesheet" href="/vendor/fonts.css" />\n')
  .replaceAll("'DM Sans', sans-serif", "'Source Sans 3', -apple-system, BlinkMacSystemFont, sans-serif")
  .replaceAll('#234B32', '#274233')
  .replace('<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">', '<link rel="icon" type="image/png" sizes="32x32" href="/brand/everplate/in-app/favicon-32.png">')
  .replace('<link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png">', '')
  .replace('<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">', '<link rel="apple-touch-icon" sizes="180x180" href="/brand/everplate/in-app/apple-touch-icon-180.png">')
  .replace('</style>', `
    html[data-product="everplate"] body { font-family: 'Source Sans 3', -apple-system, BlinkMacSystemFont, sans-serif; }
    html[data-product="everplate"] body.in-app { background-color: #274233; }
    html[data-product="everplate"] :focus-visible { outline: 3px solid #CB9A4E; outline-offset: 2px; }
    html[data-product="everplate"] button,
    html[data-product="everplate"] a,
    html[data-product="everplate"] input:not([type="checkbox"]):not([type="radio"]),
    html[data-product="everplate"] select { min-height: 44px; }
    html[data-product="everplate"] button:disabled { opacity: 0.58; }
    html[data-product="everplate"] .native-keyboard-open { padding-bottom: var(--native-keyboard-height, 0px); }
    @media (prefers-color-scheme: dark) {
      html[data-product="everplate"] { background-color: #0F1412; color-scheme: dark; }
      html[data-product="everplate"] body.in-app { background-color: #0F1412; }
      html[data-product="everplate"] .modal-box { background: #242B26; }
      html[data-product="everplate"] .meal-plan-row { background:#242B26; border-color:#2E3632; }
      html[data-product="everplate"] .meal-plan-title { color:#FAF5F2; }
      html[data-product="everplate"] .meal-plan-meta { color:#8F9491; }
      html[data-product="everplate"] input::placeholder,
      html[data-product="everplate"] textarea::placeholder { color: #8F9491; opacity: 1; }
    }
    @media (prefers-reduced-motion: reduce) {
      html[data-product="everplate"] *, html[data-product="everplate"] *::before, html[data-product="everplate"] *::after {
        scroll-behavior: auto !important; animation-duration: 0.001ms !important; transition-duration: 0.001ms !important;
      }
    }
  </style>`)
  .replace(/  <script src="https:\/\/(?:cdnjs\.cloudflare\.com\/ajax\/libs\/(?:jspdf|pdf\.js)[^\n]+|unpkg\.com\/(?:react|react-dom)[^\n]+|cdn\.jsdelivr\.net\/npm\/heic2any[^\n]+)\n/g, '')
  .replace('<script src="/app.js"></script>', '<script src="/vendor.js"></script>\n  <script src="/native-bridge.js"></script>\n  <script src="/app.js"></script>');
fs.writeFileSync(indexPath, index);

fs.writeFileSync(path.join(outputDir, 'app-config.js'), `window.RECIPEBOX_CONFIG = Object.freeze(${JSON.stringify({
  apiBase,
  product:'everplate',
  native:true,
  deepLinkScheme:'everplate',
  clientId:'everplate-native',
  version:'1.0.0',
}, null, 2)});\n`);

fs.writeFileSync(path.join(outputDir, 'manifest.webmanifest'), JSON.stringify({
  name:'EverPlate',
  short_name:'EverPlate',
  description:'A lifelong home for your recipes, memories, and traditions.',
  id:'/',
  start_url:'/',
  scope:'/',
  display:'standalone',
  background_color:'#274233',
  theme_color:'#274233',
  categories:['food','lifestyle','productivity'],
  lang:'en-US',
  icons:[
    { src:'/brand/everplate/in-app/pwa-icon-192.png', sizes:'192x192', type:'image/png', purpose:'any' },
    { src:'/brand/everplate/in-app/pwa-icon-512.png', sizes:'512x512', type:'image/png', purpose:'any' },
    { src:'/brand/everplate/in-app/pwa-maskable-512.png', sizes:'512x512', type:'image/png', purpose:'maskable' },
  ],
}, null, 2) + '\n');

// Native packages use the operating system's app bundle rather than a PWA
// cache. Remove the copied RecipeBox worker so stale builds cannot ship it.
fs.rmSync(path.join(outputDir, 'sw.js'), { force: true });

console.log(`Built ${variant} web assets at ${path.relative(root, outputDir)} (API: ${apiBase})`);
