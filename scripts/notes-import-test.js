const assert = require("assert");
const app = require("../server");

const { extractHelpfulLinks } = app._test;

const html = `
  <html><body>
    <a href="/rib-rub">homemade rib rub recipe</a>
    <a href="https://example.com/bbq-sauce">BBQ sauce tips</a>
    <a href="/about">About us</a>
    <a href="/newsletter">Join the newsletter</a>
    <a href="javascript:void(0)">Recipe print button</a>
  </body></html>
`;

const links = extractHelpfulLinks("https://example.com/ribs", html);

assert.deepStrictEqual(
  links.map((link) => link.text),
  ["homemade rib rub recipe", "BBQ sauce tips"]
);
assert.deepStrictEqual(
  links.map((link) => link.url),
  ["https://example.com/rib-rub", "https://example.com/bbq-sauce"]
);

console.log("notes-import-test: ok");
