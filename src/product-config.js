const runtimeConfig = (typeof window !== "undefined" && window.RECIPEBOX_CONFIG) || {};
const requestedProduct = runtimeConfig.product === "everplate" ? "everplate" : "recipebox";
const prefersDark = requestedProduct === "everplate"
  && typeof window !== "undefined"
  && typeof window.matchMedia === "function"
  && window.matchMedia("(prefers-color-scheme: dark)").matches;

const recipeBoxColors = {
  cream:"#F8F1E5", cream2:"#F1E6D4", cream3:"#E4D3BC", border:"#D8C7AE",
  paper:"#FFF9EE", paper2:"#FCF2E1",
  dark:"#20140E", mid:"#4A3527", light:"#967966", brown:"#5A3827", brownLight:"#C0A074",
  green:"#234B32", greenMid:"#3E6F4B", greenPale:"#EDF5EA",
  terra:"#B85D32", terraPale:"#FBEEE5",
  gold:"#B88A2B", goldLight:"#D8B35F", goldPale:"#FBF3DC",
  blue:"#2563EB", bluePale:"#EFF6FF",
  red:"#C0392B", redPale:"#FDECEA", white:"#FFFFFF",
};

// EverPlate values are transcribed from the supplied brand board. The legacy
// semantic keys let the shared application mechanics consume either palette
// without product checks scattered through the UI.
const everPlateLightColors = {
  cream:"#FAF7F0", cream2:"#F2EFE7", cream3:"#E0DED6", border:"#E0DED6",
  paper:"#FFFFFF", paper2:"#F2EFE7",
  dark:"#1C1D1B", mid:"#545852", light:"#7A7F7B", brown:"#545852", brownLight:"#6C816E",
  green:"#274233", greenMid:"#6C816E", greenPale:"#E8EDE7",
  terra:"#B4483C", terraPale:"#F8EAE7",
  gold:"#CB9A4E", goldLight:"#D9B877", goldPale:"#F7EEDC",
  blue:"#456B78", bluePale:"#EAF1F2",
  red:"#B4483C", redPale:"#F8EAE7", white:"#FFFFFF",
};

const everPlateDarkColors = {
  cream:"#0F1412", cream2:"#1E221F", cream3:"#242B26", border:"#2E3632",
  paper:"#242B26", paper2:"#1E221F",
  dark:"#FAF5F2", mid:"#B8BEBA", light:"#8F9491", brown:"#B8BEBA", brownLight:"#A6B3A0",
  green:"#3E7A5A", greenMid:"#6C816E", greenPale:"#1C2A22",
  terra:"#D6796D", terraPale:"#321E1B",
  gold:"#CB9A4E", goldLight:"#D9B877", goldPale:"#30291D",
  blue:"#8AAEC8", bluePale:"#1B2630",
  red:"#E08378", redPale:"#321E1B", white:"#FAF5F2",
};

const products = {
  recipebox: {
    id:"recipebox", clientId:"recipebox-web", name:"RecipeBox", shortName:"RecipeBox", slug:"recipebox",
    native:false, darkMode:false, version:"1.1.3",
    bundleId:"com.recipeboxapp.recipebox", androidPackage:"com.recipeboxapp.recipebox", deepLinkScheme:"recipebox",
    analyticsProductId:"recipebox-web", features:{ nativeDialogs:false, nativeShare:false, serviceWorker:true },
    tagline:"Your family recipes, beautifully kept",
    libraryTitle:"Your RecipeBox", libraryNoun:"RecipeBox", libraryLower:"recipe box",
    fonts:{ serif:"'DM Serif Display', serif", sans:"'DM Sans', sans-serif" },
    colors:recipeBoxColors,
    cardColors:["#234B32","#B85D32","#B88A2B","#5A3827","#3E6F4B","#8B6252","#35676B"],
    links:{ support:"/support.html", privacy:"/privacy.html", terms:"/terms.html", deleteAccount:"/delete-account.html" },
    assets:{ monogram:"", wordmark:"" },
  },
  everplate: {
    id:"everplate", clientId:"everplate-native", name:"EverPlate", shortName:"EverPlate", slug:"everplate",
    native:true, darkMode:prefersDark, version:"1.0.0",
    buildNumber:1, versionCode:1,
    bundleId:"com.benjaminaird.everplate", androidPackage:"com.benjaminaird.everplate", deepLinkScheme:"everplate",
    analyticsProductId:"everplate-native", features:{ nativeDialogs:true, nativeShare:true, serviceWorker:false },
    tokens:{
      light:{ primary:"#274233", primaryDark:"#1B2E26", primaryLight:"#6C816E", sage:"#A6B3A0", accent:"#CB9A4E", background:"#FAF7F0", elevated:"#F2EFE7", card:"#FFFFFF", border:"#E0DED6", text:"#1C1D1B", textSecondary:"#545852", textMuted:"#7A7F7B", success:"#3E7A5A", warning:"#C6922E", error:"#B4483C" },
      dark:{ background:"#0F1412", surface:"#1E221F", card:"#242B26", border:"#2E3632", text:"#FAF5F2", textSecondary:"#B8BEBA", textMuted:"#8F9491", accent:"#CB9A4E" },
    },
    tagline:"Your recipes. Organized forever.",
    libraryTitle:"My Recipes", libraryNoun:"EverPlate", libraryLower:"recipe archive",
    fonts:{ serif:"'Lora', Georgia, serif", sans:"'Source Sans 3', -apple-system, BlinkMacSystemFont, sans-serif" },
    colors:prefersDark ? everPlateDarkColors : everPlateLightColors,
    cardColors:["#274233","#6C816E","#CB9A4E","#545852","#3E7A5A","#A6B3A0","#456B78"],
    links:{
      support:"https://recipebox-kappa.vercel.app/support.html",
      privacy:"https://recipebox-kappa.vercel.app/privacy.html",
      terms:"https://recipebox-kappa.vercel.app/terms.html",
      deleteAccount:"https://recipebox-kappa.vercel.app/delete-account.html",
    },
    assets:{ monogram:"/brand/everplate/monogram-placeholder.svg", wordmark:"/brand/everplate/wordmark-placeholder.svg", wordmarkLight:"/brand/everplate/wordmark-light-placeholder.svg" },
  },
};

export const PRODUCT = Object.freeze(products[requestedProduct]);
export const IS_EVERPLATE = PRODUCT.id === "everplate";

export function productText(value) {
  const text = String(value == null ? "" : value);
  if (!IS_EVERPLATE) return text;
  return text
    .replaceAll("RecipeBox+", PRODUCT.name)
    .replaceAll("RecipeBox", PRODUCT.name)
    .replaceAll("recipebox", PRODUCT.slug);
}

export function productFileName(value) {
  return productText(value).replace(/[^a-z0-9._-]+/gi, "-").toLowerCase();
}
