// Stored example pages, for the import review screen.
//
// These are **test fixtures**, hand-written and clearly marked as such in
// their own comments. Nothing here was fetched from anywhere, and none of it
// is presented to the cook as a real page from a real site.
//
// They exist because the review screen's job starts when the HTML arrives, and
// fetching the HTML is the one part of the import pipeline that still needs a
// server endpoint (see docs/native-import-contract.md). Running the REAL
// extractor over a stored page proves the screen against real output rather
// than against a hand-made object that would drift from it.
//
// The same two files are used by test/import-review.test.ts, from disk.

export type SampleImport = {
  id: string;
  label: string;
  url: string;
  html: string;
};

export const SAMPLE_IMPORTS: readonly SampleImport[] = [
  {
    id: "complete",
    label: "Well marked up",
    url: "https://example.com/lemon-thyme-roast-chicken",
    html: `<!doctype html>
<!-- TEST FIXTURE. Not a real page and not fetched from anywhere: a
     hand-written stand-in for a well-marked-up recipe site, used to exercise
     the real deterministic extractor offline. -->
<html lang="en">
<head>
  <title>Lemon and Thyme Roast Chicken — Example Kitchen</title>
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Recipe",
    "name": "Lemon and Thyme Roast Chicken",
    "author": { "@type": "Person", "name": "A Cook" },
    "description": "A plain roast chicken, done properly.",
    "recipeYield": "4 servings",
    "prepTime": "PT20M",
    "cookTime": "PT1H15M",
    "totalTime": "PT1H35M",
    "recipeIngredient": [
      "1.8 kg whole chicken",
      "1 tbsp flaky sea salt",
      "1 lemon, halved",
      "6 thyme sprigs",
      "30 g butter, softened",
      "400 g new potatoes"
    ],
    "recipeInstructions": [
      { "@type": "HowToStep", "text": "Heat the oven to 200C fan." },
      { "@type": "HowToStep", "text": "Salt the chicken all over and put the lemon and thyme inside." },
      { "@type": "HowToStep", "text": "Rub the butter over the breast and roast for 1 hour 15 minutes." },
      { "@type": "HowToStep", "text": "Rest for 15 minutes before carving." }
    ]
  }
  </script>
</head>
<body><h1>Lemon and Thyme Roast Chicken</h1></body>
</html>
`,
  },
  {
    id: "partial",
    label: "Poorly marked up",
    url: "https://example.com/nans-tomato-soup",
    html: `<!doctype html>
<!-- TEST FIXTURE. Not a real page. A deliberately poor one: microdata rather
     than JSON-LD, no yield, no times, vague amounts, and a distinctive
     ingredient mentioned in the prose that is missing from the marked-up
     list. It exists to exercise the uncertain path. -->
<html lang="en">
<head><title>Nan's Tomato Soup</title></head>
<body>
  <div itemscope itemtype="https://schema.org/Recipe">
    <h1 itemprop="name">Nan's Tomato Soup</h1>
    <p>She always finished it with a spoonful of harissa, which is the whole point.</p>
    <ul>
      <li itemprop="recipeIngredient">a tin of plum tomatoes</li>
      <li itemprop="recipeIngredient">1 onion</li>
      <li itemprop="recipeIngredient">some stock</li>
      <li itemprop="recipeIngredient">olive oil</li>
    </ul>
    <div itemprop="recipeInstructions">
      <p>Soften the onion in the oil.</p>
      <p>Add the tomatoes and the stock and simmer until it tastes like something.</p>
    </div>
  </div>
</body>
</html>
`,
  },
];
