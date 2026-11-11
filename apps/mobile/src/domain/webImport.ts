// The one place the production import modules are loaded.
//
// Same arrangement as webShoppingList.ts: static imports so the files work
// under both Metro and `node --test`, and one declared interface stating what
// this app uses. These modules are pure by design -- their own headers say "no
// DOM/network/AI" -- which is what makes running them on a phone possible at
// all.
import extractApi from "../../../../public/recipe-extract.js";
import groundingApi from "../../../../public/recipe-grounding.js";

export type WebImport = {
  extractFromHtml: (
    html: string,
    options?: { url?: string },
  ) => { recipe?: unknown; source?: unknown; complete?: boolean; fields?: Record<string, unknown> };
  verifyImport: (recipe: unknown, html: string) => Record<string, unknown>;
};

export const web: WebImport = {
  extractFromHtml: (extractApi as unknown as Pick<WebImport, "extractFromHtml">).extractFromHtml,
  verifyImport: (groundingApi as unknown as Pick<WebImport, "verifyImport">).verifyImport,
};
