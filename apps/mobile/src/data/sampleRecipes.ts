// Sample library for development.
//
// These are real, cookable recipes written in the product's own shape so the
// native screens are exercised against representative data rather than lorem
// ipsum: multiple sections, ingredients with and without units, metric
// alternates, optional items, and — the part that matters for Cook Mode —
// steps whose `ingredientRefs` actually resolve (ADR 0012).
//
// Attribution follows ADR 0020 and is deliberately varied: a cookbook, a
// family card and a website, so Recipe Detail is tested against each.
//
// Nothing here is user data and nothing is fetched. Seeded once into SQLite.
import type { Recipe } from "./types";

const DAY = 86_400_000;
const now = Date.UTC(2026, 10, 9);

export const SAMPLE_RECIPES: Recipe[] = [
  {
    id: "lemon-posset",
    title: "Lemon Posset",
    description:
      "Three ingredients and no setting agent — the cream thickens on the acid alone. Make it the morning before.",
    servings: 4,
    prepTime: "10 min",
    cookTime: "5 min",
    totalTime: "3 hr 15 min",
    category: "Desserts",
    tags: ["Make ahead", "Gluten free", "Five ingredients"],
    notes: "Strain before pouring; a little zest left in the cream turns it grainy once chilled.",
    macros: { calories: 420, protein: 3, carbs: 34, fat: 31 },
    createdAt: now - 2 * DAY,
    updatedAt: now - 2 * DAY,
    source: {
      kind: "cookbook",
      reference: "Nigel Slater, The Kitchen Diaries, p. 212",
      author: "Nigel Slater",
      originalTitle: "Lemon posset",
      method: "manual",
      capturedAt: now - 2 * DAY,
    },
    sections: [
      {
        ingredients: [
          { id: "i1", amount: "600", unit: "ml", name: "double cream", raw: "600ml double cream" },
          { id: "i2", amount: "150", unit: "g", name: "caster sugar", raw: "150g caster sugar" },
          { id: "i3", amount: "2", name: "unwaxed lemons", raw: "2 unwaxed lemons, zest and juice" },
          { id: "i4", amount: "1", unit: "tbsp", name: "shortbread crumbs", optional: true, raw: "shortbread crumbs, to serve (optional)" },
        ],
        steps: [
          { id: "s1", text: "Pare the zest from the lemons in wide strips, then juice them. You want about 90ml of juice.", ingredientRefs: ["i3"] },
          { id: "s2", text: "Put the cream, sugar and lemon zest in a wide pan. Bring slowly to a simmer, stirring until the sugar dissolves, then let it bubble gently for 3 minutes.", ingredientRefs: ["i1", "i2", "i3"] },
          { id: "s3", text: "Take off the heat and stir in the lemon juice. It will thicken almost at once.", ingredientRefs: ["i3"] },
          { id: "s4", text: "Strain through a fine sieve into four glasses. Chill at least 3 hours, until set.", ingredientRefs: [] },
          { id: "s5", text: "Serve cold, with shortbread crumbs over the top if you have them.", ingredientRefs: ["i4"] },
        ],
      },
    ],
  },

  {
    id: "millionaires-shortbread",
    title: "Millionaire's Shortbread",
    description:
      "Three distinct layers, each with its own method. The caramel is the part that rewards attention.",
    servings: 16,
    prepTime: "30 min",
    cookTime: "45 min",
    totalTime: "4 hr",
    category: "Baked Goods",
    tags: ["Make ahead", "Crowd pleaser"],
    notes: "Score the chocolate before it sets hard, or the squares shatter when you cut them.",
    macros: { calories: 385, protein: 4, carbs: 45, fat: 22 },
    createdAt: now - 5 * DAY,
    updatedAt: now - 5 * DAY,
    source: {
      kind: "website",
      url: "https://www.bbcgoodfood.com/recipes/millionaires-shortbread",
      siteName: "BBC Good Food",
      domain: "bbcgoodfood.com",
      originalTitle: "Millionaire's shortbread",
      method: "link",
      capturedAt: now - 5 * DAY,
    },
    sections: [
      {
        name: "Shortbread base",
        ingredients: [
          { id: "i1", amount: "250", unit: "g", name: "plain flour", raw: "250g plain flour" },
          { id: "i2", amount: "75", unit: "g", name: "caster sugar", raw: "75g caster sugar" },
          { id: "i3", amount: "175", unit: "g", name: "unsalted butter", weightAmount: "175", weightUnit: "g", raw: "175g cold unsalted butter, cubed" },
          { id: "i4", amount: "1/4", unit: "tsp", name: "fine sea salt", raw: "1/4 tsp fine sea salt" },
        ],
        steps: [
          { id: "s1", text: "Heat the oven to 180C fan. Line a 20cm square tin with baking parchment.", ingredientRefs: [] },
          { id: "s2", text: "Rub the butter into the flour, sugar and salt until it looks like coarse breadcrumbs, then press it together into a dough.", ingredientRefs: ["i1", "i2", "i3", "i4"] },
          { id: "s3", text: "Press evenly into the tin and prick all over with a fork. Bake 20–25 minutes, until pale gold. Cool completely in the tin.", ingredientRefs: [] },
        ],
      },
      {
        name: "Caramel",
        ingredients: [
          { id: "i5", amount: "150", unit: "g", name: "unsalted butter", raw: "150g unsalted butter" },
          { id: "i6", amount: "100", unit: "g", name: "light muscovado sugar", raw: "100g light muscovado sugar" },
          { id: "i7", amount: "397", unit: "g", name: "sweetened condensed milk", raw: "1 x 397g tin sweetened condensed milk" },
          { id: "i8", amount: "2", unit: "tbsp", name: "golden syrup", raw: "2 tbsp golden syrup" },
        ],
        steps: [
          { id: "s4", text: "Put the butter, muscovado sugar, condensed milk and golden syrup in a heavy pan over low heat. Stir until the sugar has dissolved.", ingredientRefs: ["i5", "i6", "i7", "i8"] },
          { id: "s5", text: "Raise the heat a little and boil, stirring constantly, for 8–10 minutes. It is ready when it has darkened a shade and pulls away from the base as you stir.", ingredientRefs: [] },
          { id: "s6", text: "Pour over the cooled shortbread and level the top. Chill 1 hour until firm.", ingredientRefs: [] },
        ],
      },
      {
        name: "Chocolate top",
        ingredients: [
          { id: "i9", amount: "200", unit: "g", name: "dark chocolate", raw: "200g dark chocolate (54% cocoa solids)" },
          { id: "i10", amount: "50", unit: "g", name: "milk chocolate", raw: "50g milk chocolate" },
          { id: "i11", name: "flaky sea salt", optional: true, raw: "flaky sea salt, to finish (optional)" },
        ],
        steps: [
          { id: "s7", text: "Melt the dark and milk chocolate together in a bowl set over barely simmering water. Stir until smooth.", ingredientRefs: ["i9", "i10"] },
          { id: "s8", text: "Pour over the set caramel and tilt the tin to level it. Scatter with sea salt if using.", ingredientRefs: ["i11"] },
          { id: "s9", text: "Leave at room temperature until almost set, then score into 16 squares. Chill to finish, and cut along the scores.", ingredientRefs: [] },
        ],
      },
    ],
  },

  {
    id: "weeknight-tarka-dal",
    title: "Weeknight Tarka Dal",
    description: "Forty minutes, mostly unattended. The tarka at the end is what makes it taste like more work than it was.",
    servings: 4,
    prepTime: "10 min",
    cookTime: "35 min",
    totalTime: "45 min",
    category: "Entrées",
    tags: ["Vegetarian", "One pot", "Weeknight", "Freezes well"],
    macros: { calories: 310, protein: 15, carbs: 42, fat: 9, fiber: 11 },
    createdAt: now - 1 * DAY,
    updatedAt: now - 1 * DAY,
    source: {
      kind: "family",
      reference: "Priya's card, copied out 2019",
      method: "photo",
      capturedAt: now - 1 * DAY,
    },
    sections: [
      {
        name: "Dal",
        ingredients: [
          { id: "i1", amount: "250", unit: "g", name: "red lentils", raw: "250g red lentils, rinsed" },
          { id: "i2", amount: "1", unit: "litre", name: "water", raw: "1 litre water" },
          { id: "i3", amount: "1/2", unit: "tsp", name: "ground turmeric", raw: "1/2 tsp ground turmeric" },
          { id: "i4", amount: "1", unit: "tsp", name: "fine salt", raw: "1 tsp fine salt, plus more to taste" },
        ],
        steps: [
          { id: "s1", text: "Put the lentils, water and turmeric in a large pan. Bring to the boil and skim off the foam that rises.", ingredientRefs: ["i1", "i2", "i3"] },
          { id: "s2", text: "Lower to a simmer, part-cover, and cook 25–30 minutes, stirring now and then, until the lentils collapse into a loose purée. Season with the salt.", ingredientRefs: ["i4"] },
        ],
      },
      {
        name: "Tarka",
        ingredients: [
          { id: "i5", amount: "3", unit: "tbsp", name: "ghee", raw: "3 tbsp ghee or neutral oil" },
          { id: "i6", amount: "1", unit: "tsp", name: "cumin seeds", raw: "1 tsp cumin seeds" },
          { id: "i7", amount: "4", name: "garlic cloves", raw: "4 garlic cloves, thinly sliced" },
          { id: "i8", amount: "2", name: "dried red chillies", raw: "2 dried red chillies" },
          { id: "i9", amount: "1/2", unit: "tsp", name: "Kashmiri chilli powder", raw: "1/2 tsp Kashmiri chilli powder" },
          { id: "i10", name: "coriander", raw: "a handful of coriander, chopped" },
        ],
        steps: [
          { id: "s3", text: "Heat the ghee in a small pan until it shimmers. Add the cumin seeds and let them sizzle for 20 seconds.", ingredientRefs: ["i5", "i6"] },
          { id: "s4", text: "Add the garlic and dried chillies. Fry until the garlic is pale gold — watch it, it turns bitter the moment it browns.", ingredientRefs: ["i7", "i8"] },
          { id: "s5", text: "Off the heat, stir in the chilli powder, then pour the whole lot over the dal. Stir once, leaving streaks. Finish with coriander.", ingredientRefs: ["i9", "i10"] },
        ],
      },
    ],
  },

  {
    id: "buttermilk-pancakes",
    title: "Buttermilk Pancakes",
    description: "Thick, tangy and reliable. The batter wants to rest, so start it before you make the coffee.",
    servings: 4,
    prepTime: "10 min",
    cookTime: "15 min",
    totalTime: "40 min",
    category: "Breakfast",
    tags: ["Weekend", "Kid friendly"],
    notes: "Resting the batter 20 minutes is the difference between flat and fluffy. Don't beat out the lumps.",
    macros: { calories: 290, protein: 9, carbs: 38, fat: 11 },
    createdAt: now - 9 * DAY,
    updatedAt: now - 9 * DAY,
    source: {
      kind: "website",
      url: "https://www.seriouseats.com/light-and-fluffy-buttermilk-pancakes",
      siteName: "Serious Eats",
      domain: "seriouseats.com",
      author: "J. Kenji López-Alt",
      originalTitle: "Light and Fluffy Buttermilk Pancakes",
      method: "link",
      capturedAt: now - 9 * DAY,
    },
    sections: [
      {
        ingredients: [
          { id: "i1", amount: "250", unit: "g", name: "plain flour", raw: "250g plain flour" },
          { id: "i2", amount: "2", unit: "tsp", name: "baking powder", raw: "2 tsp baking powder" },
          { id: "i3", amount: "1/2", unit: "tsp", name: "bicarbonate of soda", raw: "1/2 tsp bicarbonate of soda" },
          { id: "i4", amount: "2", unit: "tbsp", name: "caster sugar", raw: "2 tbsp caster sugar" },
          { id: "i5", amount: "1/2", unit: "tsp", name: "fine salt", raw: "1/2 tsp fine salt" },
          { id: "i6", amount: "500", unit: "ml", name: "buttermilk", raw: "500ml buttermilk" },
          { id: "i7", amount: "2", name: "eggs", raw: "2 large eggs" },
          { id: "i8", amount: "50", unit: "g", name: "butter", weightAmount: "50", weightUnit: "g", raw: "50g butter, melted and cooled, plus more for the pan" },
        ],
        steps: [
          { id: "s1", text: "Whisk the flour, baking powder, bicarbonate of soda, sugar and salt in a large bowl.", ingredientRefs: ["i1", "i2", "i3", "i4", "i5"] },
          { id: "s2", text: "In a jug, beat the buttermilk, eggs and melted butter together.", ingredientRefs: ["i6", "i7", "i8"] },
          { id: "s3", text: "Pour the wet into the dry and fold just until no dry flour remains. The batter should be lumpy. Rest 20 minutes.", ingredientRefs: [] },
          { id: "s4", text: "Heat a little butter in a non-stick pan over medium-low. Ladle in the batter and cook until bubbles break the surface and the edges look dry, about 3 minutes.", ingredientRefs: ["i8"] },
          { id: "s5", text: "Flip and cook 2 minutes more. Keep warm in a low oven while you do the rest.", ingredientRefs: [] },
        ],
      },
    ],
  },

  {
    id: "roast-chicken-lemon-thyme",
    title: "Roast Chicken with Lemon and Thyme",
    description: "The Sunday default. Dry-brining the night before is the only step that really matters.",
    servings: 4,
    prepTime: "15 min",
    cookTime: "1 hr 20 min",
    totalTime: "1 hr 35 min",
    category: "Entrées",
    tags: ["Sunday", "Leftovers"],
    notes: "Rest it 20 minutes under loose foil. Carving it hot costs you most of the juice.",
    macros: { calories: 540, protein: 48, carbs: 6, fat: 36 },
    createdAt: now - 16 * DAY,
    updatedAt: now - 16 * DAY,
    source: {
      kind: "family",
      reference: "Mum, over the phone",
      method: "manual",
      capturedAt: now - 16 * DAY,
    },
    sections: [
      {
        ingredients: [
          { id: "i1", amount: "1.8", unit: "kg", name: "whole chicken", raw: "1.8kg whole chicken" },
          { id: "i2", amount: "1", unit: "tbsp", name: "flaky sea salt", raw: "1 tbsp flaky sea salt" },
          { id: "i3", amount: "1", name: "lemon", raw: "1 lemon, halved" },
          { id: "i4", amount: "6", name: "thyme sprigs", raw: "6 thyme sprigs" },
          { id: "i5", amount: "1", name: "garlic bulb", raw: "1 garlic bulb, halved across" },
          { id: "i6", amount: "30", unit: "g", name: "butter", raw: "30g softened butter" },
          { id: "i7", amount: "400", unit: "g", name: "new potatoes", raw: "400g new potatoes, halved" },
        ],
        steps: [
          { id: "s1", text: "The night before, pat the chicken dry and rub it all over with the salt. Leave uncovered in the fridge.", ingredientRefs: ["i1", "i2"] },
          { id: "s2", text: "Take it out an hour before cooking. Heat the oven to 200C fan.", ingredientRefs: [] },
          { id: "s3", text: "Put the lemon halves, thyme and garlic in the cavity. Rub the butter over the breast.", ingredientRefs: ["i3", "i4", "i5", "i6"] },
          { id: "s4", text: "Scatter the potatoes around the bird in the tin. Roast 1 hour 20 minutes, basting once, until the thigh juices run clear.", ingredientRefs: ["i7"] },
          { id: "s5", text: "Rest 20 minutes under loose foil before carving.", ingredientRefs: [] },
        ],
      },
    ],
  },

  {
    id: "tomato-white-bean-soup",
    title: "Tomato and White Bean Soup",
    description: "Storecupboard, start to finish. Better on the second day.",
    servings: 4,
    prepTime: "10 min",
    cookTime: "25 min",
    totalTime: "35 min",
    category: "Soups",
    tags: ["Vegetarian", "Storecupboard", "Freezes well", "Weeknight"],
    macros: { calories: 265, protein: 11, carbs: 36, fat: 8, fiber: 9 },
    createdAt: now - 22 * DAY,
    updatedAt: now - 22 * DAY,
    source: {
      kind: "website",
      url: "https://cooking.nytimes.com/recipes/1020049-tomato-and-white-bean-soup",
      siteName: "NYT Cooking",
      domain: "cooking.nytimes.com",
      author: "Melissa Clark",
      originalTitle: "Tomato and White Bean Soup",
      method: "link",
      capturedAt: now - 22 * DAY,
    },
    sections: [
      {
        ingredients: [
          { id: "i1", amount: "3", unit: "tbsp", name: "olive oil", raw: "3 tbsp olive oil" },
          { id: "i2", amount: "1", name: "onion", raw: "1 large onion, chopped" },
          { id: "i3", amount: "3", name: "garlic cloves", raw: "3 garlic cloves, sliced" },
          { id: "i4", amount: "1", unit: "tbsp", name: "tomato purée", raw: "1 tbsp tomato purée" },
          { id: "i5", amount: "400", unit: "g", name: "tinned chopped tomatoes", raw: "1 x 400g tin chopped tomatoes" },
          { id: "i6", amount: "2", unit: "x 400g", name: "tinned cannellini beans", raw: "2 x 400g tins cannellini beans, drained" },
          { id: "i7", amount: "750", unit: "ml", name: "vegetable stock", raw: "750ml vegetable stock" },
          { id: "i8", amount: "1", name: "parmesan rind", optional: true, raw: "1 parmesan rind (optional)" },
          { id: "i9", name: "basil", raw: "a handful of basil" },
        ],
        steps: [
          { id: "s1", text: "Warm the oil in a deep pan. Cook the onion gently with a pinch of salt for 8 minutes, until soft but not coloured.", ingredientRefs: ["i1", "i2"] },
          { id: "s2", text: "Add the garlic and tomato purée and cook 2 minutes more, stirring, until the purée darkens.", ingredientRefs: ["i3", "i4"] },
          { id: "s3", text: "Tip in the tomatoes, beans and stock, and drop in the parmesan rind if you have one. Simmer 15 minutes.", ingredientRefs: ["i5", "i6", "i7", "i8"] },
          { id: "s4", text: "Crush some of the beans against the side of the pan to thicken it. Fish out the rind. Tear in the basil to serve.", ingredientRefs: ["i9"] },
        ],
      },
    ],
  },

  {
    id: "brown-butter-chocolate-chip-cookies",
    title: "Brown Butter Chocolate Chip Cookies",
    description:
      "Half the butter is browned for depth and half stays pale for lift, so the two halves are not interchangeable.",
    servings: 18,
    prepTime: "25 min",
    cookTime: "12 min",
    totalTime: "1 hr 40 min",
    category: "Baked Goods",
    tags: ["Make ahead", "Crowd pleaser"],
    notes:
      "The butter is divided on purpose: browning all of it gives a flat, greasy cookie. Chill the dough or they spread.",
    macros: { calories: 265, protein: 3, carbs: 32, fat: 14 },
    createdAt: now,
    updatedAt: now,
    source: {
      kind: "family",
      reference: "Aunt Marjorie's card, copied out 1998",
      method: "photo",
      capturedAt: now,
    },
    sections: [
      {
        ingredients: [
          // Totals stay whole here. The split lives on the steps that use them.
          { id: "i1", amount: "230", unit: "g", name: "unsalted butter", raw: "230g unsalted butter, divided" },
          { id: "i2", amount: "200", unit: "g", name: "dark chocolate", raw: "200g dark chocolate, chopped, divided" },
          { id: "i3", amount: "280", unit: "g", name: "plain flour", raw: "280g plain flour" },
          { id: "i4", amount: "200", unit: "g", name: "light brown sugar", raw: "200g light brown sugar" },
          { id: "i5", amount: "100", unit: "g", name: "caster sugar", raw: "100g caster sugar" },
          { id: "i6", amount: "2", name: "large eggs", raw: "2 large eggs" },
          { id: "i7", amount: "1", unit: "tsp", name: "bicarbonate of soda", raw: "1 tsp bicarbonate of soda" },
          { id: "i8", amount: "2", unit: "tsp", name: "vanilla extract", raw: "2 tsp vanilla extract" },
          { id: "i9", amount: "1", unit: "tsp", name: "flaky sea salt", raw: "1 tsp flaky sea salt, for the dough and the tops" },
        ],
        steps: [
          {
            id: "s1",
            text: "Brown half the butter in a light-coloured pan over a medium heat, swirling, until the milk solids are hazelnut brown and it smells nutty. Pour it into a bowl, scraping the pan.",
            ingredientUses: [{ id: "i1", amount: "115", unit: "g" }],
          },
          {
            id: "s2",
            text: "Cut the remaining butter into the hot browned butter and stir until it melts. This drops the temperature and keeps the dough from going oily.",
            ingredientUses: [{ id: "i1", amount: "115", unit: "g" }],
          },
          {
            id: "s3",
            text: "Whisk in both sugars, then the eggs and vanilla, and keep whisking for a minute until glossy.",
            ingredientRefs: ["i4", "i5", "i6", "i8"],
          },
          {
            id: "s4",
            text: "Fold in the flour, the bicarbonate of soda and a pinch of the flaky salt, stopping while a little flour still shows.",
            ingredientRefs: ["i3", "i7", "i9"],
          },
          {
            id: "s5",
            text: "Stir most of the chocolate through the dough, then chill it for at least an hour.",
            ingredientUses: [{ id: "i2", amount: "150", unit: "g" }],
          },
          {
            id: "s6",
            text: "Scoop onto lined trays, press the rest of the chocolate onto the tops and bake at 180C for 11-12 minutes, until the edges are set and the middles still look underdone. Finish with the remaining flaky salt.",
            ingredientRefs: ["i9"],
            ingredientUses: [{ id: "i2", amount: "50", unit: "g" }],
          },
        ],
      },
    ],
  },
];
