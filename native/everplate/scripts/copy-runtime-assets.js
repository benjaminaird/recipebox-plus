import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const nativeRoot = path.resolve(here, "..");
const output = path.resolve(nativeRoot, "../../dist/everplate/vendor");
const modules = path.join(nativeRoot, "node_modules");

fs.mkdirSync(output, { recursive:true });
fs.copyFileSync(
  path.join(modules, "pdfjs-dist/legacy/build/pdf.worker.min.mjs"),
  path.join(output, "pdf.worker.min.mjs")
);

const fonts = [
  ["@fontsource/lora/files/lora-latin-400-normal.woff2", "lora-400.woff2"],
  ["@fontsource/lora/files/lora-latin-400-italic.woff2", "lora-400-italic.woff2"],
  ["@fontsource/lora/files/lora-latin-600-normal.woff2", "lora-600.woff2"],
  ["@fontsource/source-sans-3/files/source-sans-3-latin-400-normal.woff2", "source-sans-3-400.woff2"],
  ["@fontsource/source-sans-3/files/source-sans-3-latin-500-normal.woff2", "source-sans-3-500.woff2"],
  ["@fontsource/source-sans-3/files/source-sans-3-latin-600-normal.woff2", "source-sans-3-600.woff2"],
  ["@fontsource/source-sans-3/files/source-sans-3-latin-700-normal.woff2", "source-sans-3-700.woff2"],
];
for (const [source, filename] of fonts) fs.copyFileSync(path.join(modules, source), path.join(output, filename));

fs.writeFileSync(path.join(output, "fonts.css"), `
@font-face{font-family:'Lora';font-style:normal;font-weight:400;font-display:swap;src:url('/vendor/lora-400.woff2') format('woff2')}
@font-face{font-family:'Lora';font-style:italic;font-weight:400;font-display:swap;src:url('/vendor/lora-400-italic.woff2') format('woff2')}
@font-face{font-family:'Lora';font-style:normal;font-weight:600;font-display:swap;src:url('/vendor/lora-600.woff2') format('woff2')}
@font-face{font-family:'Source Sans 3';font-style:normal;font-weight:400;font-display:swap;src:url('/vendor/source-sans-3-400.woff2') format('woff2')}
@font-face{font-family:'Source Sans 3';font-style:normal;font-weight:500;font-display:swap;src:url('/vendor/source-sans-3-500.woff2') format('woff2')}
@font-face{font-family:'Source Sans 3';font-style:normal;font-weight:600;font-display:swap;src:url('/vendor/source-sans-3-600.woff2') format('woff2')}
@font-face{font-family:'Source Sans 3';font-style:normal;font-weight:700;font-display:swap;src:url('/vendor/source-sans-3-700.woff2') format('woff2')}
`);
