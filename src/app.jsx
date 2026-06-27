    const { useState, useEffect, useRef, useCallback } = React;

    const C = {
      cream:"#F8F1E5", cream2:"#F1E6D4", cream3:"#E4D3BC", border:"#D8C7AE",
      paper:"#FFF9EE", paper2:"#FCF2E1",
      dark:"#20140E", mid:"#4A3527", light:"#967966", brown:"#5A3827", brownLight:"#C0A074",
      green:"#234B32", greenMid:"#3E6F4B", greenPale:"#EDF5EA",
      terra:"#B85D32", terraPale:"#FBEEE5",
      gold:"#B88A2B", goldLight:"#D8B35F", goldPale:"#FBF3DC",
      blue:"#2563EB", bluePale:"#EFF6FF",
      red:"#C0392B", redPale:"#FDECEA", white:"#FFFFFF",
    };
    const BRAND_GRADIENT = `linear-gradient(135deg, ${C.green} 0%, ${C.brown} 100%)`;
    const SERIF = "'DM Serif Display', serif";
    const SANS = "'DM Sans', sans-serif";
    const APP_VERSION = "1.1.0";
    const API_BASE = String((window.RECIPEBOX_CONFIG && window.RECIPEBOX_CONFIG.apiBase) || window.RECIPEBOX_API_BASE || "").replace(/\/$/, "");
    function apiUrl(url) {
      if (!url || !String(url).startsWith("/api/")) return url;
      return API_BASE + url;
    }
    function apiFetch(url, options = {}) {
      return fetch(apiUrl(url), { credentials:"include", ...options });
    }
    const NAV_CLEARANCE = "calc(110px + env(safe-area-inset-bottom))";
    const PANTRY_NAV_OFFSET = "calc(100dvh - 86px - env(safe-area-inset-bottom))";
    const safePad = (top, right, bottom, left = right) => `calc(env(safe-area-inset-top) + ${top}px) ${right}px ${bottom}px ${left}px`;
    const S = {
      page: { minHeight:"100vh", width:"100%", maxWidth:"100%", overflowX:"hidden", background:C.cream },
      brandHeader: { background:BRAND_GRADIENT, boxShadow:"0 12px 34px rgba(32,20,14,0.18)" },
      card: { background:C.paper, border:"1px solid "+C.border, borderRadius:14, boxShadow:"0 8px 24px rgba(90,56,39,0.08)" },
      cardSoft: { background:C.paper2, border:"1px solid "+C.border, borderRadius:12, boxShadow:"0 4px 16px rgba(90,56,39,0.06)" },
      primaryBtn: { background:C.green, color:C.white, border:"none", borderRadius:10, fontWeight:800, cursor:"pointer", fontFamily:SANS },
      goldBtn: { background:C.gold, color:C.dark, border:"none", borderRadius:10, fontWeight:800, cursor:"pointer", fontFamily:SANS },
      ghostBtn: { background:C.paper, color:C.brown, border:"1px solid "+C.border, borderRadius:10, fontWeight:800, cursor:"pointer", fontFamily:SANS },
      input: { border:"1.5px solid "+C.border, borderRadius:10, background:C.paper, outline:"none", fontFamily:SANS },
      eyebrow: { fontSize:"0.68em", letterSpacing:2.4, textTransform:"uppercase", fontWeight:800, color:C.brownLight },
    };
    const CARD_COLORS = ["#234B32","#B85D32","#B88A2B","#5A3827","#3E6F4B","#8B6252","#35676B"];
    const CATEGORIES = ["Breakfast","Appetizers","Entrées","Sides","Condiments & Sauces","Beverages","Desserts"];
    const APP_CONTROL_CATEGORIES = ["All","Methodology","AI Instruction","Import Rule","Recipe Normalization","Meal Planning","Pantry Logic","Image Handling","User Experience","Safety / Guardrail","Legal / Copyright","Product Strategy","WhatsNext Sync"];
    const APP_CONTROL_FEATURES = ["Import","Manual Recipe Entry","AI Adjust","AI Chat Editor","Pantry Chef","Meal Planner","Shopping List","Cook Mode","PDF Export","Recipe Detail","Library","Settings"];
    const APP_CONTROL_SCOPE_TYPES = ["Global","Feature","Account","Recipe Category"];
    const CATEGORY_IMAGES = {
      "Favorites": "https://images.unsplash.com/photo-1495521821757-a1efb6729352?auto=format&fit=crop&w=800&q=80",
      "Breakfast": "https://images.unsplash.com/photo-1533089860892-a7c6f0a88666?auto=format&fit=crop&w=800&q=80",
      "Appetizers": "https://images.unsplash.com/photo-1567620832903-9fc6debc209f?auto=format&fit=crop&w=800&q=80",
      "Entrées": "https://images.unsplash.com/photo-1621996346565-e3dbc646d9a9?auto=format&fit=crop&w=800&q=80",
      "Sides": "https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=800&q=80",
      "Condiments & Sauces": "https://images.unsplash.com/photo-1604909052743-94e838986d24?auto=format&fit=crop&w=800&q=80",
      "Beverages": "https://images.unsplash.com/photo-1497534446932-c925b458314e?auto=format&fit=crop&w=800&q=80",
      "Desserts": "https://images.unsplash.com/photo-1519915028121-7d3463d20b13?auto=format&fit=crop&w=800&q=80"
    };
    const DAYS = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
    const MAIN_TABS = ["library","plan","shopping","pantry","settings"];

    const uid = () => Math.random().toString(36).slice(2, 9);
    const cardColor = (t) => CARD_COLORS[(t?.charCodeAt(0) || 0) % CARD_COLORS.length];

    function hasHorizontalScrollParent(node, stopAt) {
      let el = node;
      while (el && el !== stopAt) {
        if (el.nodeType === 1) {
          const style = window.getComputedStyle(el);
          if ((style.overflowX === "auto" || style.overflowX === "scroll") && el.scrollWidth > el.clientWidth + 4) return true;
        }
        el = el.parentElement;
      }
      return false;
    }

    function Icon({ name, size = 22, strokeWidth = 2, className = "", style = {}, title }) {
      const common = {
        width:size,
        height:size,
        viewBox:"0 0 24 24",
        fill:"none",
        stroke:"currentColor",
        strokeWidth,
        strokeLinecap:"round",
        strokeLinejoin:"round",
        className,
        style,
        "aria-hidden":title ? undefined : "true",
        role:title ? "img" : undefined,
      };
      const icons = {
        recipeBox:<svg {...common}>{title ? <title>{title}</title> : null}<path d="M4.5 9.5h15v8.25a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2V9.5Z" /><path d="M7 9.5V6.75A1.75 1.75 0 0 1 8.75 5h6.5A1.75 1.75 0 0 1 17 6.75V9.5" /><path d="M8 9.5v-2h8v2" /><path d="M9.25 13.25h5.5" /><path d="M9.25 16h3.5" /></svg>,
        recipeCard:<svg {...common}>{title ? <title>{title}</title> : null}<rect x="5" y="3.75" width="14" height="16.5" rx="2" /><path d="M8.25 8h7.5" /><path d="M8.25 11.25h7.5" /><path d="M8.25 14.5h4.75" /><path d="M16 18l1.25 1.25L20 16.5" /></svg>,
        library:<svg {...common}>{title ? <title>{title}</title> : null}<path d="M4.5 5.5h6.25a2 2 0 0 1 2 2v12a2.5 2.5 0 0 0-2.5-2.5H4.5V5.5Z" /><path d="M19.5 5.5h-6.25a2 2 0 0 0-2 2v12a2.5 2.5 0 0 1 2.5-2.5h5.75V5.5Z" /><path d="M7.5 8.75h2.25" /><path d="M14.25 8.75h2.25" /></svg>,
        addRecipe:<svg {...common}>{title ? <title>{title}</title> : null}<rect x="5" y="3.75" width="14" height="16.5" rx="2" /><path d="M8.25 8h5.5" /><path d="M8.25 11.25h4" /><path d="M15.75 14v5" /><path d="M13.25 16.5h5" /></svg>,
        import:<svg {...common}>{title ? <title>{title}</title> : null}<path d="M12 3.75v10" /><path d="m8.5 10.25 3.5 3.5 3.5-3.5" /><path d="M5 14.5v3.25a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V14.5" /></svg>,
        search:<svg {...common}>{title ? <title>{title}</title> : null}<circle cx="10.75" cy="10.75" r="5.75" /><path d="m15.25 15.25 4.25 4.25" /></svg>,
        pantry:<svg {...common}>{title ? <title>{title}</title> : null}<path d="M5 20V6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5V20" /><path d="M4 20h16" /><path d="M8 8h3" /><path d="M13 8h3" /><path d="M8 12h8" /><path d="M8 16h3" /><path d="M14 16h2" /></svg>,
        chef:<svg {...common}>{title ? <title>{title}</title> : null}<path d="M7.75 10.5a3.5 3.5 0 0 1 6.5-2.25 2.75 2.75 0 1 1 1.5 5.05" /><path d="M8 13.25h8v4.25A2.5 2.5 0 0 1 13.5 20h-3A2.5 2.5 0 0 1 8 17.5v-4.25Z" /><path d="M10.25 16h3.5" /></svg>,
        mealPlan:<svg {...common}>{title ? <title>{title}</title> : null}<rect x="4.5" y="5.5" width="15" height="14" rx="2" /><path d="M8 3.75v3.5" /><path d="M16 3.75v3.5" /><path d="M4.5 9h15" /><path d="M8 12.5h2.25" /><path d="M13.75 12.5H16" /><path d="M8 16h2.25" /></svg>,
        shoppingList:<svg {...common}>{title ? <title>{title}</title> : null}<path d="M7 6.5h13l-1.5 8.25a2 2 0 0 1-2 1.65H9.25a2 2 0 0 1-1.95-1.55L5.75 4.75H3.5" /><circle cx="9.5" cy="20" r="1" /><circle cx="17" cy="20" r="1" /><path d="M10 10h5.5" /><path d="M10 13h4" /></svg>,
        timer:<svg {...common}>{title ? <title>{title}</title> : null}<circle cx="12" cy="13" r="7" /><path d="M12 13V9" /><path d="M12 13h3" /><path d="M9 3.75h6" /><path d="M12 3.75V6" /></svg>,
        settings:<svg {...common}>{title ? <title>{title}</title> : null}<circle cx="12" cy="12" r="3" /><path d="M19.25 13.5a7.9 7.9 0 0 0 .05-3l-2.05-.45a5.8 5.8 0 0 0-.65-1.55l1.12-1.78a8.1 8.1 0 0 0-2.12-2.12L13.82 5.7a5.8 5.8 0 0 0-1.57-.65L11.8 3h-3l-.45 2.05a5.8 5.8 0 0 0-1.55.65L5.02 4.58A8.1 8.1 0 0 0 2.9 6.7l1.12 1.78a5.8 5.8 0 0 0-.65 1.57L1.32 10.5a7.9 7.9 0 0 0 0 3l2.05.45c.15.55.37 1.08.65 1.57L2.9 17.3a8.1 8.1 0 0 0 2.12 2.12L6.8 18.3c.49.28 1.02.5 1.55.65L8.8 21h3l.45-2.05a5.8 5.8 0 0 0 1.57-.65l1.78 1.12a8.1 8.1 0 0 0 2.12-2.12l-1.12-1.78c.28-.49.5-1.02.65-1.57l2-.45Z" /></svg>,
        camera:<svg {...common}>{title ? <title>{title}</title> : null}<path d="M8.5 6.5 10 4.75h4l1.5 1.75H18a2 2 0 0 1 2 2v8.75a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8.5a2 2 0 0 1 2-2h2.5Z" /><circle cx="12" cy="13" r="3.25" /></svg>,
        uploadPhoto:<svg {...common}>{title ? <title>{title}</title> : null}<rect x="4" y="5" width="16" height="14" rx="2" /><path d="M8 14.5 10.5 12l2 2 2.75-3.25L20 15.5" /><circle cx="8.5" cy="9" r="1" /><path d="M12 3.5v4" /><path d="m9.75 5.75 2.25-2.25 2.25 2.25" /></svg>,
        pdf:<svg {...common}>{title ? <title>{title}</title> : null}<path d="M7 3.75h7l3 3v13.5H7a2 2 0 0 1-2-2V5.75a2 2 0 0 1 2-2Z" /><path d="M14 3.75V7h3" /><path d="M8 13h8" /><path d="M8 16h5" /><path d="M8 10h2.5" /></svg>,
        share:<svg {...common}>{title ? <title>{title}</title> : null}<path d="M12 14.5V4" /><path d="m8.25 7 3.75-3.75L15.75 7" /><path d="M7 11H5.5A1.5 1.5 0 0 0 4 12.5v6A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5v-6A1.5 1.5 0 0 0 18.5 11H17" /></svg>,
        website:<svg {...common}>{title ? <title>{title}</title> : null}<circle cx="12" cy="12" r="8" /><path d="M4 12h16" /><path d="M12 4a12 12 0 0 1 0 16" /><path d="M12 4a12 12 0 0 0 0 16" /></svg>,
        youtube:<svg {...common}>{title ? <title>{title}</title> : null}<rect x="3.75" y="6.5" width="16.5" height="11" rx="3" /><path d="m10.5 9.75 4.5 2.25-4.5 2.25v-4.5Z" /></svg>,
        textPaste:<svg {...common}>{title ? <title>{title}</title> : null}<path d="M9 4.5h6l1 2h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-10a2 2 0 0 1 2-2h2l1-2Z" /><path d="M9 6.5h6" /><path d="M8 11h8" /><path d="M8 14h8" /><path d="M8 17h5" /></svg>,
        edit:<svg {...common}>{title ? <title>{title}</title> : null}<path d="M4.5 19.5h4.25L19 9.25a2.1 2.1 0 0 0-3-3L5.75 16.5 4.5 19.5Z" /><path d="m14.5 7.75 1.75 1.75" /></svg>,
        favorite:<svg {...common}>{title ? <title>{title}</title> : null}<path d="M12 19.5 5.75 13.6a4.25 4.25 0 0 1-.3-5.85 3.8 3.8 0 0 1 5.55 0L12 8.8l1-1.05a3.8 3.8 0 0 1 5.55 0 4.25 4.25 0 0 1-.3 5.85L12 19.5Z" /></svg>,
        star:<svg {...common}>{title ? <title>{title}</title> : null}<path d="m12 3.75 2.35 4.75 5.25.75-3.8 3.7.9 5.25L12 15.75 7.3 18.2l.9-5.25-3.8-3.7 5.25-.75L12 3.75Z" /></svg>,
        recent:<svg {...common}>{title ? <title>{title}</title> : null}<circle cx="12" cy="12" r="8" /><path d="M12 7.75v4.75l3 1.75" /></svg>,
        check:<svg {...common}>{title ? <title>{title}</title> : null}<path d="m5 12.5 4.25 4.25L19.5 6.5" /></svg>,
        close:<svg {...common}>{title ? <title>{title}</title> : null}<path d="M6 6l12 12" /><path d="M18 6 6 18" /></svg>,
        trash:<svg {...common}>{title ? <title>{title}</title> : null}<path d="M5 7h14" /><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7" /><path d="M7 7l.75 12A2 2 0 0 0 9.75 21h4.5a2 2 0 0 0 2-2L17 7" /><path d="M10 11v5" /><path d="M14 11v5" /></svg>,
        plus:<svg {...common}>{title ? <title>{title}</title> : null}<path d="M12 5v14" /><path d="M5 12h14" /></svg>,
        play:<svg {...common}>{title ? <title>{title}</title> : null}<path d="M8 5.75v12.5L18 12 8 5.75Z" /></svg>,
        pause:<svg {...common}>{title ? <title>{title}</title> : null}<path d="M8.5 5.5v13" /><path d="M15.5 5.5v13" /></svg>,
        bell:<svg {...common}>{title ? <title>{title}</title> : null}<path d="M18 15.5H6l1.25-1.75V10a4.75 4.75 0 0 1 9.5 0v3.75L18 15.5Z" /><path d="M10 18.25a2.25 2.25 0 0 0 4 0" /></svg>,
        spark:<svg {...common}>{title ? <title>{title}</title> : null}<path d="M12 3.5 13.75 9 19 12l-5.25 3L12 20.5 10.25 15 5 12l5.25-3L12 3.5Z" /><path d="M18.5 4.5v3" /><path d="M17 6h3" /></svg>,
        account:<svg {...common}>{title ? <title>{title}</title> : null}<circle cx="12" cy="8.25" r="3.25" /><path d="M5.5 20a6.5 6.5 0 0 1 13 0" /></svg>,
        sync:<svg {...common}>{title ? <title>{title}</title> : null}<path d="M18.5 8.5A7 7 0 0 0 6.25 6.25L4.5 8" /><path d="M4.5 4.5V8h3.5" /><path d="M5.5 15.5a7 7 0 0 0 12.25 2.25L19.5 16" /><path d="M19.5 19.5V16H16" /></svg>,
        lock:<svg {...common}>{title ? <title>{title}</title> : null}<rect x="5.5" y="10" width="13" height="10" rx="2" /><path d="M8.5 10V7.5a3.5 3.5 0 0 1 7 0V10" /><path d="M12 14v2" /></svg>,
      };
      return icons[name] || icons.recipeCard;
    }

    function normalizeFractions(str) {
      return String(str || "")
        .replace(/¼/g, "1/4")
        .replace(/½/g, "1/2")
        .replace(/¾/g, "3/4")
        .replace(/⅓/g, "1/3")
        .replace(/⅔/g, "2/3")
        .replace(/⅛/g, "1/8")
        .replace(/⅜/g, "3/8")
        .replace(/⅝/g, "5/8")
        .replace(/⅞/g, "7/8");
    }

    function amountToNumber(amount) {
      const raw = normalizeFractions(amount).trim();
      if (!raw) return null;

      // Only scale clean numeric quantities. Do NOT scale package sizes like "1 (14-ounce)".
      if (/[()]/.test(raw)) return null;

      const mixed = raw.match(/^(\d+)\s+(\d+)\/(\d+)$/);
      if (mixed) return parseInt(mixed[1]) + parseInt(mixed[2]) / parseInt(mixed[3]);

      const frac = raw.match(/^(\d+)\/(\d+)$/);
      if (frac) return parseInt(frac[1]) / parseInt(frac[2]);

      const dec = raw.match(/^\d+(?:\.\d+)?$/);
      if (dec) return parseFloat(raw);

      return null;
    }

    function numberToFraction(n) {
      if (!isFinite(n)) return "";
      const whole = Math.floor(n);
      const frac = n - whole;

      const options = [
        [1/8, "1/8"],
        [1/4, "1/4"],
        [1/3, "1/3"],
        [3/8, "3/8"],
        [1/2, "1/2"],
        [5/8, "5/8"],
        [2/3, "2/3"],
        [3/4, "3/4"],
        [7/8, "7/8"]
      ];

      let best = null;
      for (const [val, label] of options) {
        if (Math.abs(frac - val) < 0.035) best = label;
      }

      if (best) return whole > 0 ? whole + " " + best : best;

      const rounded = Math.round(n * 100) / 100;
      return rounded % 1 === 0 ? String(rounded) : String(rounded);
    }

    function scaleAmount(amount, factor) {
      const original = normalizeFractions(amount).trim();
      if (!original || Number(factor) === 1) return original;
      const compound = original.match(/^(.+?)\s*\+\s*(.+)$/);
      if (compound) {
        const scaled = [compound[1], compound[2]].map((part) =>
          part.replace(/(?:\d+\s+)?\d+\/\d+|\d+(?:\.\d+)?/, (value) => {
            const n = amountToNumber(value);
            return n === null ? value : numberToFraction(n * factor);
          }).trim()
        );
        return scaled.join(" + ");
      }
      const n = amountToNumber(original);
      if (n === null) return original;
      return numberToFraction(n * factor);
    }

    function displayAmount(amount) {
      let raw = String(amount || "").trim();

      // Repair common smashed mixed fractions from earlier imports:
      // 11/4 => 1 1/4, 11/2 => 1 1/2, 21/2 => 2 1/2
      const smashed = raw.match(/^(\d+)([1-7])\/(2|3|4|8)$/);
      if (smashed && smashed[1].length >= 1) {
        raw = smashed[1] + " " + smashed[2] + "/" + smashed[3];
      }

      const glyphs = {
        "1/8":"⅛", "1/4":"¼", "1/3":"⅓", "3/8":"⅜",
        "1/2":"½", "5/8":"⅝", "2/3":"⅔", "3/4":"¾", "7/8":"⅞"
      };

      const mixed = raw.match(/^(\d+)\s+(\d+\/\d+)$/);
      if (mixed && glyphs[mixed[2]]) return mixed[1] + glyphs[mixed[2]];

      if (glyphs[raw]) return glyphs[raw];

      return raw;
    }

    function cleanUnit(unit) {
      return String(unit || "").toLowerCase().trim().replace(/\./g, "");
    }

    const CUP_GRAMS = [
      { keys:["bread flour"], grams:127 },
      { keys:["cake flour"], grams:114 },
      { keys:["almond flour"], grams:96 },
      { keys:["flour"], grams:120 },
      { keys:["powdered sugar","confectioners sugar","confectioner's sugar"], grams:120 },
      { keys:["brown sugar"], grams:220 },
      { keys:["sugar"], grams:200 },
      { keys:["butter"], grams:227 },
      { keys:["cocoa powder","cocoa"], grams:85 },
      { keys:["rolled oats","oats"], grams:90 },
      { keys:["chocolate chips","chocolate chip"], grams:170 },
      { keys:["peanut butter"], grams:258 },
      { keys:["honey"], grams:340 },
      { keys:["maple syrup"], grams:322 },
      { keys:["oil","olive oil","vegetable oil","canola oil"], grams:218 },
      { keys:["milk","buttermilk"], grams:245 },
      { keys:["heavy cream","cream"], grams:240 },
      { keys:["sour cream","yogurt"], grams:245 },
      { keys:["water"], grams:240 },
      { keys:["rice"], grams:185 },
      { keys:["nuts","walnuts","pecans","almonds"], grams:120 },
      { keys:["cornstarch"], grams:128 },
      { keys:["breadcrumbs","bread crumbs"], grams:110 }
    ];

    const UNIT_TO_CUPS = {
      cup:1, cups:1, c:1,
      tbsp:1/16, tablespoon:1/16, tablespoons:1/16, tbs:1/16,
      tsp:1/48, teaspoon:1/48, teaspoons:1/48
    };

    const METRIC_MAP = {
      cup:{mult:240,unit:"ml"}, cups:{mult:240,unit:"ml"}, c:{mult:240,unit:"ml"},
      tbsp:{mult:15,unit:"ml"}, tablespoon:{mult:15,unit:"ml"}, tablespoons:{mult:15,unit:"ml"}, tbs:{mult:15,unit:"ml"},
      tsp:{mult:5,unit:"ml"}, teaspoon:{mult:5,unit:"ml"}, teaspoons:{mult:5,unit:"ml"},
      "fl oz":{mult:30,unit:"ml"}, floz:{mult:30,unit:"ml"},
      oz:{mult:28,unit:"g"}, ounce:{mult:28,unit:"g"}, ounces:{mult:28,unit:"g"},
      lb:{mult:454,unit:"g"}, pound:{mult:454,unit:"g"}, pounds:{mult:454,unit:"g"}
    };

    function cupGramsForIngredient(name) {
      const text = String(name || "").toLowerCase();
      if (!text.trim()) return null;
      const hit = CUP_GRAMS.find((item) => item.keys.some((key) => text.includes(key)));
      return hit ? hit.grams : null;
    }

    function roundMeasure(n, unit) {
      if (!isFinite(n)) return "";
      if (unit === "g" || unit === "ml") return String(Math.round(n));
      const rounded = Math.round(n * 10) / 10;
      return rounded % 1 === 0 ? String(rounded) : String(rounded);
    }

    function nearestStandardCups(cups) {
      if (!isFinite(cups) || cups <= 0) return cups;
      const whole = Math.floor(cups);
      const frac = cups - whole;
      const options = [0, 1/8, 1/4, 1/3, 1/2, 2/3, 3/4, 1];
      let best = options[0];
      for (const opt of options) {
        if (Math.abs(frac - opt) < Math.abs(frac - best)) best = opt;
      }
      if (best === 1) return whole + 1;
      return whole + best;
    }

    function cupsToDisplay(cups) {
      if (!isFinite(cups) || cups <= 0) return { amount:"", unit:"cup" };
      const roundedCups = nearestStandardCups(cups);
      if (roundedCups >= 1/8) {
        return { amount:numberToFraction(roundedCups), unit:roundedCups <= 1 ? "cup" : "cups" };
      }

      const tsp = cups * 48;
      if (tsp < 3) {
        const roundedTsp = Math.max(1/8, Math.round(tsp * 4) / 4);
        return { amount:numberToFraction(roundedTsp), unit:Math.abs(roundedTsp - 1) < 0.001 ? "tsp" : "tsp" };
      }

      const tbsp = cups * 16;
      const roundedTbsp = Math.max(1/2, Math.round(tbsp * 2) / 2);
      return { amount:numberToFraction(roundedTbsp), unit:Math.abs(roundedTbsp - 1) < 0.001 ? "tbsp" : "tbsp" };
    }

    function convertMetric(amount, unit, ingredientName="") {
      const u = cleanUnit(unit);
      const n = amountToNumber(amount);
      if (n === null) return { amount, unit: unit||"" };

      const cupsPerUnit = UNIT_TO_CUPS[u];
      const cupGrams = cupGramsForIngredient(ingredientName);
      if (cupGrams && cupsPerUnit) {
        return { amount:roundMeasure(n * cupsPerUnit * cupGrams, "g"), unit:"g" };
      }

      const c = METRIC_MAP[u];
      if (!c) return { amount, unit: unit||"" };
      return { amount:roundMeasure(n * c.mult, c.unit), unit:c.unit };
    }

    function convertUs(amount, unit, ingredientName="") {
      const u = cleanUnit(unit);
      const n = amountToNumber(amount);
      if (n === null) return { amount, unit: unit||"" };

      const cupGrams = cupGramsForIngredient(ingredientName);
      if (cupGrams && (u === "g" || u === "gram" || u === "grams")) {
        return cupsToDisplay(n / cupGrams);
      }
      if (cupGrams && (u === "kg" || u === "kilogram" || u === "kilograms")) {
        return cupsToDisplay((n * 1000) / cupGrams);
      }
      if (u === "ml" || u === "milliliter" || u === "milliliters") {
        return cupsToDisplay(n / 240);
      }
      if (u === "l" || u === "liter" || u === "liters") {
        return cupsToDisplay((n * 1000) / 240);
      }
      return { amount, unit: unit||"" };
    }

    function displayIngredientMeasure(ing, scale=1, metric=false) {
      const amount = scaleAmount(ing.amount, scale);
      const unit = ing.unit || "";
      let measure;
      if (metric) {
        if (ing.weightAmount && ing.weightUnit) measure = { amount:scaleAmount(ing.weightAmount, scale), unit:ing.weightUnit };
        else measure = convertMetric(amount, unit, ing.name);
      } else {
        measure = convertUs(amount, unit, ing.name);
      }
      // Standardize the displayed unit abbreviation everywhere (tsp, Tbsp, oz,
      // lb, fl oz, pt, qt, gal, ml, L, g, kg, cup). Display-only — never mutates
      // the stored ingredient. Count/unknown units pass through unchanged.
      return { ...measure, unit: RecipeBoxShopping.abbreviateUnit(measure.unit, measure.amount) };
    }

    function parseAIJson(raw) {
      const m = raw.match(/\{[\s\S]*\}/);
      if (!m) throw new Error("No JSON found in response");
      return JSON.parse(m[0]);
    }

    const SUPPORTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
    function isHeicFile(file) {
      const name = (file.name || "").toLowerCase();
      const type = (file.type || "").toLowerCase();
      return type.includes("heic") || type.includes("heif") || name.endsWith(".heic") || name.endsWith(".heif");
    }
    function isSupportedImageFile(file) {
      const name = (file.name || "").toLowerCase();
      return SUPPORTED_IMAGE_TYPES.includes(file.type) ||
        /\.(jpe?g|png|gif|webp)$/i.test(name);
    }

    async function convertToJpeg(file) {
      if (isHeicFile(file)) {
        if (!window.heic2any) {
          throw new Error("HEIC support is still loading. Wait a moment and try again, or choose JPEG from your photo picker.");
        }
        const blob = await window.heic2any({ blob: file, toType: "image/jpeg", quality: 0.9 });
        const jpegBlob = Array.isArray(blob) ? blob[0] : blob;
        return new File([jpegBlob], (file.name || "recipe-photo").replace(/\.(heic|heif)$/i, "") + ".jpg", { type: "image/jpeg" });
      }
      if (!isSupportedImageFile(file)) {
        throw new Error("RecipeBox supports JPG, PNG, GIF, WebP, HEIC, HEIF, and PDF uploads.");
      }
      return new Promise((resolve) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
          const maxSide = 1800;
          const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          canvas.toBlob((blob) => {
            URL.revokeObjectURL(url);
            if (blob) resolve(new File([blob], (file.name || "recipe-photo").replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" }));
            else resolve(file);
          }, "image/jpeg", 0.92);
        };
        img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
        img.src = url;
      });
    }

    async function fileToBase64(file) {
      const converted = await convertToJpeg(file);
      return fileToBase64Payload(converted);
    }

    // Build a small JPEG copy of an uploaded card/photo/PDF page so the recipe
    // can show the user where it came from, without bloating the saved payload.
    function compressDataUrlForArchive(dataUrl, maxDim, quality) {
      maxDim = maxDim || 1280;
      quality = quality || 0.7;
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));
          canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
          try { resolve(canvas.toDataURL("image/jpeg", quality)); }
          catch (err) { reject(err); }
        };
        img.onerror = () => reject(new Error("Could not read source image"));
        img.src = dataUrl;
      });
    }

    async function buildOriginalSourcePages(list) {
      const pages = [];
      for (const img of (list || []).slice(0, 4)) {
        const src = img.preview || (img.data ? ("data:" + (img.type || "image/jpeg") + ";base64," + img.data) : "");
        if (!src) continue;
        try { pages.push(await compressDataUrlForArchive(src)); }
        catch (err) { /* skip a page we cannot render; keep the rest */ }
      }
      return pages;
    }

    function fileToDataUrl(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    }

    async function fileToBase64Payload(file) {
      const dataUrl = await fileToDataUrl(file);
      return { data: dataUrl.split(",")[1], type:file.type || "image/jpeg" };
    }

    // Storage
    const RECIPES_KEY = "recipebox-v5";
    const MEALPLAN_KEY = "recipebox-mealplan-v2";
    const TIMER_SOUND_KEY = "recipebox-timer-sound-v1";
    const TIMER_SOUND_OPTIONS = [
      { id:"classic", label:"Classic Beep" },
      { id:"soft", label:"Soft Chime" },
      { id:"bell", label:"Kitchen Bell" },
      { id:"double", label:"Double Beep" },
      { id:"digital", label:"Digital Alert" },
      { id:"ding", label:"Gentle Ding" },
      { id:"silent", label:"Silent" },
    ];
    let timerAudioCtx = null;
    function loadTimerSound() {
      try { return localStorage.getItem(TIMER_SOUND_KEY) || "bell"; } catch { return "bell"; }
    }
    function saveTimerSound(id) {
      try { localStorage.setItem(TIMER_SOUND_KEY, id); } catch {}
    }
    function tone(ctx, start, freq, duration, type, gainValue) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type || "sine";
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(gainValue || 0.12, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + duration + 0.03);
    }
    function playTimerSound(soundId) {
      if (soundId === "silent") return;
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        timerAudioCtx = timerAudioCtx || new Ctx();
        if (timerAudioCtx.state === "suspended") timerAudioCtx.resume();
        const now = timerAudioCtx.currentTime + 0.02;
        const id = soundId || "bell";
        if (id === "classic") tone(timerAudioCtx, now, 880, 0.28, "square", 0.10);
        else if (id === "soft") { tone(timerAudioCtx, now, 660, 0.25, "sine", 0.09); tone(timerAudioCtx, now + 0.18, 990, 0.45, "sine", 0.07); }
        else if (id === "bell") { tone(timerAudioCtx, now, 740, 0.18, "triangle", 0.12); tone(timerAudioCtx, now + 0.13, 1110, 0.55, "sine", 0.08); }
        else if (id === "double") { tone(timerAudioCtx, now, 780, 0.18, "square", 0.10); tone(timerAudioCtx, now + 0.28, 780, 0.18, "square", 0.10); }
        else if (id === "digital") { tone(timerAudioCtx, now, 1040, 0.12, "square", 0.09); tone(timerAudioCtx, now + 0.16, 1320, 0.12, "square", 0.09); tone(timerAudioCtx, now + 0.32, 1040, 0.16, "square", 0.09); }
        else if (id === "ding") tone(timerAudioCtx, now, 1046, 0.5, "sine", 0.08);
      } catch {}
    }
    function unlockTimerAudio() {
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        timerAudioCtx = timerAudioCtx || new Ctx();
        if (timerAudioCtx.state === "suspended") timerAudioCtx.resume();
      } catch {}
    }
    function pulseTimerHaptic() {
      try {
        if (navigator.vibrate) navigator.vibrate([180, 90, 180]);
      } catch {}
    }
    function stopTimerHaptic() {
      try {
        if (navigator.vibrate) navigator.vibrate(0);
      } catch {}
    }
function syncGetJson(url, fallback) {
  try {
    const xhr = new XMLHttpRequest();
    const target = apiUrl(url);
    xhr.open("GET", target + (target.includes("?") ? "&" : "?") + "t=" + Date.now(), false);
    xhr.withCredentials = true;
    xhr.send(null);
    if (xhr.status >= 200 && xhr.status < 300) return JSON.parse(xhr.responseText || "null") ?? fallback;
  } catch (e) {}
  return fallback;
}
function asyncPutJson(url, body) {
  try {
    apiFetch(url, { method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body), keepalive:true }).catch(() => {});
  } catch (e) {}
}
async function postJson(url, body) {
  const res = await apiFetch(url, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body || {}) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}
async function putJson(url, body) {
  const res = await apiFetch(url, { method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body || {}) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}
async function fetchJson(url, fallback) {
  try {
    const res = await apiFetch(url);
    if (!res.ok) return fallback;
    return await res.json();
  } catch {
    return fallback;
  }
}
    function loadAccountSession() {
  return syncGetJson("/api/auth/session", { user:null });
}
function hasLocalRecipeData(recipes, mealPlan) {
  return (Array.isArray(recipes) && recipes.length > 0) || (mealPlan && typeof mealPlan === "object" && Object.keys(mealPlan).length > 0);
}
function formatLedgerDate(at) {
  if (!at) return "";
  try {
    const d = new Date(at);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleDateString(undefined, { month:"short", day:"numeric" }) + ", " + d.toLocaleTimeString(undefined, { hour:"numeric", minute:"2-digit" });
  } catch { return ""; }
}
function defaultAiUsage() {
  return { period:"", count:0, limit:50, remaining:50 };
}
function loadRecipes() {
  let local = [];
  // Defensive: tolerate corrupted OR tampered localStorage (valid JSON of the
  // wrong type) — always hand back an array so the UI never crashes/blanks.
  try { const v = JSON.parse(localStorage.getItem(RECIPES_KEY) || "[]"); if (Array.isArray(v)) local = v; } catch {}
  const server = syncGetJson("/api/recipes", local);
  if (Array.isArray(server) && server.length) { try { localStorage.setItem(RECIPES_KEY, JSON.stringify(recipesForLocal(server))); } catch {} return server; }
  return local;
}
// Recipes the signed-in user actually OWNS — household-shared recipes from other
// members ride in the library for viewing but must never be saved back as ours.
function ownRecipes(r) {
  return (Array.isArray(r) ? r : []).filter((rec) => rec && !rec.householdShared);
}
// Keep the localStorage copy lean: the original-source image archive can be
// large and would risk the storage quota. It is persisted on the server for
// signed-in users; we only drop it from the local mirror. Household-shared
// recipes are excluded too (they belong to other members).
function recipesForLocal(r) {
  try {
    return ownRecipes(r).map((rec) => {
      if (rec && rec.originalSource) { const { originalSource, ...rest } = rec; return rest; }
      return rec;
    });
  } catch { return ownRecipes(r); }
}
function saveRecipes(r) {
  const own = ownRecipes(r);
  try { localStorage.setItem(RECIPES_KEY, JSON.stringify(recipesForLocal(own))); } catch {}
  asyncPutJson("/api/recipes", { recipes: own });
}
function loadMealPlan() {
  let local = {};
  try { const v = JSON.parse(localStorage.getItem(MEALPLAN_KEY) || "{}"); if (v && typeof v === "object" && !Array.isArray(v)) local = v; } catch {}
  const server = syncGetJson("/api/mealplan", local);
  if (server && Object.keys(server).length) { try { localStorage.setItem(MEALPLAN_KEY, JSON.stringify(server)); } catch {} return server; }
  return local;
}
function saveMealPlan(m) {
  try { localStorage.setItem(MEALPLAN_KEY, JSON.stringify(m)); } catch {}
  asyncPutJson("/api/mealplan", { mealPlan:m });
}
// Shopping list is local-only for now (user-specific, derived from the user's
// own recipes). A durable per-user/household model is on the roadmap.
const SHOPPING_KEY = "recipebox-shopping-v1";
function emptyShoppingList() { return RecipeBoxShopping.emptyShoppingList(); }
function loadShoppingList() {
  // Canonical defensive coercion lives in the (testable) engine, so a tampered/
  // corrupt localStorage value can never crash the shopping UI.
  try { return RecipeBoxShopping.sanitizeShoppingList(JSON.parse(localStorage.getItem(SHOPPING_KEY) || "null")); }
  catch { return emptyShoppingList(); }
}
function saveShoppingList(l) { try { localStorage.setItem(SHOPPING_KEY, JSON.stringify(l)); } catch {} }
// Pantry staples: normalized ingredient names the user keeps on hand. Used to
// exclude "already have" items from shopping lists. Local-only, user-specific.
const PANTRY_KEY = "recipebox-pantry-v1";
function loadPantry() { try { return RecipeBoxShopping.sanitizePantry(JSON.parse(localStorage.getItem(PANTRY_KEY) || "[]")); } catch { return []; } }
function savePantry(p) { try { localStorage.setItem(PANTRY_KEY, JSON.stringify(p)); } catch {} }
function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type:"application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

    // AI
    async function callAI(messages, system, maxTokens, temperature, _retried) {
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        throw new Error("You're offline. Reconnect to use RecipeBox AI — your saved recipes are still available.");
      }
      const requested = maxTokens || 2000;
      const body = { model: "claude-sonnet-4-5-20250929", max_tokens: requested, messages };
      if (system) body.system = system;
      if (typeof temperature === "number") body.temperature = temperature;
      const res = await apiFetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.aiUsage) window.dispatchEvent(new CustomEvent("recipebox-ai-usage", { detail:data.aiUsage }));
      if (data.error) throw new Error(typeof data.error === "string" ? data.error : JSON.stringify(data.error));
      // If the model ran out of output room mid-answer, the JSON is truncated and
      // unparseable. A JSON-repair pass can't recover the lost content — it needs
      // more room — so retry once with a much higher ceiling. (Anthropic bills for
      // generated tokens, not the ceiling, so this only costs more when it's used.)
      if (data.stop_reason === "max_tokens" && !_retried) {
        const bumped = Math.min(Math.max(requested * 2, 4096), 8000);
        if (bumped > requested) return callAI(messages, system, bumped, temperature, true);
      }
      return data.content.map((b) => b.text || "").join("");
    }

    const EXTRACT_PROMPT = `You are a recipe extraction assistant. Return ONLY a raw JSON object. No markdown, no backticks, no explanation. Start with { and end with }.

Structure: {"title":"string","cookTime":"string","servings":4,"description":"string","notes":"string","heroImage":"URL or empty string","macros":{"calories":0,"protein":0,"carbs":0,"fat":0,"fiber":0},"sections":[{"name":"Main","ingredients":[{"id":"i1","amount":"1","unit":"cup","name":"flour","weightAmount":"","weightUnit":""}],"steps":[{"id":"s1","text":"Mix {i1} with water.","ingredientRefs":["i1"]}]}],"tags":["tag1"]}

For title:
- Prefer the name of the recipe itself.
- For URL or YouTube imports, if the source/author/channel is clear and useful, title should be "Recipe Name - Source" unless the origin is already part of the recipe name.
- For PDFs, photos, screenshots, and handwritten cards, use only the recipe title unless the source/person/place is explicit in the source material.
- Do not add generic words like "recipe" or "(adjusted)" unless they are truly part of the title.

For notes:
- Use ONLY helpful cooking information explicitly present in the source material, page text, PDF text, image text, caption, transcript, description, or provided source links.
- Include tips, storage/make-ahead guidance, substitution notes, doneness cues, ingredient prep details, or author warnings when they would help someone cook the recipe.
- Do not invent tips or infer advice from general knowledge. If the source does not include useful extra notes, use an empty string.
- If the source provides related recipe/helper links, include only links that are directly useful for this recipe, with the original URL. Example: "Rib rub recipe: https://example.com/rib-rub".
- Do not include ads, unrelated blog story, newsletter links, or generic navigation links.

For sources with multiple recipes or variants:
- Extract one primary recipe card that best matches the title/source.
- Do not merge separate variants into one giant recipe. Mention alternate variants briefly in notes only if source-grounded and useful.
- If an uploaded photo, rendered PDF page, video, article, or transcript clearly contains multiple distinct recipe cards, standalone recipes, or full variants, do not merge them or choose one silently. Return {"error":"multiple_recipes_detected","recipes":["name 1","name 2"]} so RecipeBox can ask the user whether to import one or all.

For servings:
- Use the recipe's stated yield/servings when present (e.g. "Serves 8", "Makes 24 cookies", "Yield: 12").
- When servings are NOT stated, estimate a realistic number from the total quantities — a large-batch recipe (e.g. several pounds of meat, 9x13 pan, a whole sheet cake, a big pot of soup) serves many more than 4. Do NOT default to 4. A reasonable estimate from the ingredient amounts is expected and useful.
- Return servings as a positive integer.

For macros (nutrition) — always fill these in, never leave them at 0:
- If the source lists nutrition, use it. If it is given for the whole recipe, divide by the servings so the stored values are PER SERVING.
- If the source does NOT list nutrition, estimate per-serving calories, protein, carbs, fat, and fiber from the ingredients and the servings count. A sensible approximation is expected and helpful — do not return zeros just because the source omitted nutrition.
- macros are ALWAYS stored per single serving (not the whole recipe). Use realistic whole numbers.

For category and tags (these are SEPARATE fields, never mix them):
- "category" is the single real food type. Use one of: Breakfast, Appetizers, Entrées, Sides, Condiments & Sauces, Beverages, Desserts. Pick the closest real type. "Copycat" is NEVER a category.
- "tags" is a short list of useful labels for searching and filtering, not SEO spam. Keep each tag concise and in Title Case. Deduplicate. Use at most 8 tags.
- Only add a tag when the title, source, ingredients, or instructions clearly support it. Do not guess diet or allergy tags (Vegan, Vegetarian, Gluten-Free, Dairy-Free) unless the source explicitly says so or the recipe clearly meets it.
- Add the "Copycat" tag (not category) when the title/source clearly indicates a homemade recreation of a restaurant or brand dish (e.g. "copycat", "restaurant-style", "better than takeout", "Starbucks-style", "Olive Garden inspired"). The tag is descriptive only; never claim official affiliation or add brand logos.
- Other useful tags when clearly supported: Quick, Weeknight, Kid-Friendly, Meal Prep, Freezer-Friendly, One-Pot, Slow Cooker, Instant Pot, Air Fryer, Grill, No-Bake, Make-Ahead, High-Protein, Low-Carb, Spicy, Comfort Food, Holiday, Party, Budget-Friendly.

For heroImage: if you can identify a direct image URL from the source, include it. Otherwise leave as empty string.

Ingredient fidelity: use the exact ingredient the source states; do not substitute, simplify, or "normalize" it into a more common one. Keep half-and-half as half-and-half (never milk or cream), and likewise keep heavy cream, buttermilk, evaporated/condensed milk, sour cream, cake/bread/all-purpose flour, brown/powdered sugar, and baking soda vs baking powder exactly as stated. You may fix spelling and formatting, but never change an ingredient's identity.

For ingredient amounts:
- Preserve the source quantity exactly as a string.
- Use fractions and mixed numbers, not decimals. Use "1/4", "1/2", "3/4", "1 1/4", "1 1/2", etc.
- Preserve compound measures exactly. "1/3 cup + 3 Tablespoons sugar" should become amount "1/3 cup + 3 Tablespoons", unit "", name "sugar".
- Preserve descriptive measures exactly. "1 heaping Tbsp brown sugar" should become amount "1", unit "heaping Tbsp", name "brown sugar". "1 scant cup flour" should become amount "1", unit "scant cup", name "flour".
- Preserve common package/count measures. "1 stick butter" should become amount "1", unit "stick", name "butter".
- Include visible add-ins and optional food items as ingredients, marking optional when the source says optional.
- Never include equipment, tools, bowls, pans, knives, measuring cups/spoons, oven mitts, appliances, or serving utensils as ingredients.
- Never collapse package sizes. "1 (14-ounce) can full-fat coconut milk" must become amount "1", unit "can", name "(14-ounce) full-fat coconut milk".
- If the source includes a parenthetical weight like "1 cup (200g) sugar", store amount "1", unit "cup", name "sugar", weightAmount "200", weightUnit "g".
- If no source weight is listed, leave weightAmount and weightUnit empty.
- Do not normalize compound measures into less readable units. Do not turn "1/3 cup + 3 Tbsp" into "31 Tbsp" or any other collapsed equivalent.
- Do not invent weights.

Embed ingredient IDs like {i1} inside step text, but do not repeat the ingredient name right after the placeholder. Example: use "Mix {i1} with water", not "Mix {i1} flour with water". Macros are per serving. Return ONLY the JSON.`;

    const ADJUST_PROMPT = `You are a culinary assistant. Modify the provided RecipeBox recipe JSON as requested. Return ONLY one complete raw JSON object starting with { and ending with }. No markdown, comments, or explanation. Preserve the RecipeBox shape: title, description, heroImage, prepTime, cookTime, totalTime, servings, category, tags, macros, notes, rating, favorite, createdAt, and sections with ingredients and steps. Preserve ids when present. Do not omit sections. Keep "category" as the real food type (never "Copycat"); keep "tags" as a separate concise, deduplicated, Title Case list. "Copycat" may be a tag, never a category.`;
    const REPAIR_JSON_PROMPT = `You repair malformed recipe JSON. Return ONLY one valid raw JSON object. Preserve all recipe content you can, including source-grounded notes. Do not add markdown, comments, or explanation. The JSON must match the RecipeBox recipe structure with notes, sections, ingredients, and steps.`;
    const PANTRY_PROMPT = `You are Pantry Chef inside RecipeBox. Help users decide what to cook from ingredients they have, cravings, time, or a pantry photo.

Always prioritize saved RecipeBox recipes from the provided context. Do not invent saved recipes. If saved matches exist, start with "Recipes from your RecipeBox" and mention exact saved recipe titles. Then add "New ideas" only when useful.

For saved recipes, explain whether they look like: "You can make this now", "You're missing 1-2 things", or "Needs shopping". Suggest practical substitutions when helpful.

Ask concise clarifying questions only when needed. Keep advice home-cook friendly and scannable.

If the user asks to save, add, or make one of your new ideas into a recipe, return the full recipe JSON wrapped in <RECIPE_JSON>...</RECIPE_JSON> at the end. Use the RecipeBox recipe shape with sections, ingredients, steps, tags, macros, servings, cookTime, description, and heroImage. Keep "category" as the real food type (never "Copycat") and "tags" as a separate concise, deduplicated, Title Case list of useful labels; "Copycat" may be a tag, never a category.`;
    const EDITOR_AI_PROMPT = `You are a culinary assistant helping edit a recipe. The user will describe a change they want. Apply it to the recipe JSON and return ONLY the complete updated recipe JSON starting with {. Preserve notes unless the user asks to change them. Do not invent source notes or links. Keep "category" as the real food type and "tags" as a separate concise, deduplicated, Title Case list; "Copycat" may be a tag, never a category. No markdown, no explanation.`;

    // Shared UI
    function Spinner() {
      return <span style={{display:"inline-block",width:16,height:16,border:"2.5px solid rgba(255,255,255,0.4)",borderTopColor:"currentColor",borderRadius:"50%",animation:"spin 0.7s linear infinite"}} />;
    }

    function Tag({ label, bg, color, onClick, active, compact }) {
      const base = {background:active?C.green:(bg||C.cream3),color:active?C.white:(color||C.brown),borderRadius:20,padding:"3px 11px",fontSize:"0.73em",fontWeight:600,display:"inline-flex",alignItems:"center",lineHeight:1.4};
      if (!onClick) return <span style={{...base,padding:"2px 10px"}}>{label}</span>;
      // Compact chips (dense library cards) keep cards tidy; full-size chips
      // (Popular Tags row, recipe detail) get a comfortable thumb target.
      const tap = compact ? {padding:"4px 10px",minHeight:28} : {padding:"7px 13px",minHeight:34};
      return (
        <button type="button" onClick={(e) => { e.stopPropagation(); onClick(label); }}
          style={{...base,...tap,border:"1px solid "+(active?C.green:C.border),cursor:"pointer",fontFamily:SANS,WebkitTapHighlightColor:"transparent",touchAction:"manipulation"}}
          aria-label={(active?"Clear ":"Filter by ")+"tag "+label}>
          {label}{active && <span style={{marginLeft:5,fontWeight:800}}>×</span>}
        </button>
      );
    }

    function Stars({ value, onChange, size }) {
      return (
        <span style={{display:"inline-flex",gap:1,alignItems:"center",lineHeight:1}}>
          {[1,2,3,4,5].map((i) => (
            <span key={i} onClick={() => onChange && onChange(i)}
              role={onChange ? "button" : undefined}
              aria-label={onChange ? i + " star rating" : undefined}
              style={{display:"inline-flex",alignItems:"center",justifyContent:"center",width:(size || 16)+4,height:(size || 16)+4,color:i<=(value||0)?C.gold:C.cream3,cursor:onChange?"pointer":"default",fontSize:(size || 16),lineHeight:1,textShadow:i<=(value||0)?"0 1px 0 rgba(90,56,39,0.12)":"none"}}>
              {i <= (value || 0) ? "★" : "☆"}
            </span>
          ))}
        </span>
      );
    }

    const PANTRY_STOPWORDS = new Set(["with","and","the","for","from","make","have","some","what","can","using","use","up","quick","dinner","lunch","breakfast","recipe","recipes","ideas","idea","under","minutes","minute","tonight","please","want","craving","crave","my","a","an","of","to","in","on","or","but","salt","pepper","water","oil","olive","butter"]);
    function pantryTokens(text) {
      return String(text || "")
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, " ")
        .split(/\s+/)
        .map((x) => x.trim())
        .filter((x) => x.length > 2 && !PANTRY_STOPWORDS.has(x));
    }
    function recipeIngredients(recipe) {
      return (recipe.sections || [])
        .flatMap((section) => section.ingredients || [])
        .map((ingredient) => ingredient.name || "")
        .filter(Boolean);
    }
    function pantryRecipeSummary(recipes) {
      return (recipes || []).slice(0, 40).map((recipe) => ({
        id: recipe.id,
        title: recipe.title || "Untitled Recipe",
        category: recipe.category || "",
        tags: (recipe.tags || []).slice(0, 5),
        cookTime: recipe.cookTime || recipe.totalTime || "",
        ingredients: recipeIngredients(recipe).slice(0, 10),
      }));
    }
    function findPantryMatches(query, recipes) {
      const userTokens = new Set(pantryTokens(query));
      if (!userTokens.size) return [];
      return (recipes || []).map((recipe) => {
        const ingredients = recipeIngredients(recipe).slice(0, 16);
        const scored = ingredients.map((name) => {
          const tokens = pantryTokens(name);
          return { name, match: tokens.some((token) => userTokens.has(token)) };
        });
        const matched = scored.filter((x) => x.match).length;
        const missing = scored.filter((x) => !x.match && pantryTokens(x.name).length > 0).slice(0, 3).map((x) => x.name);
        const searchText = pantryTokens([recipe.title, recipe.category, (recipe.tags || []).join(" ")].join(" "));
        const titleScore = searchText.filter((token) => userTokens.has(token)).length;
        const score = matched * 3 + titleScore;
        const missingCount = Math.max(0, scored.filter((x) => pantryTokens(x.name).length > 0).length - matched);
        let status = "Needs shopping";
        if (matched >= 3 && missingCount <= 2) status = "You're missing 1-2 things";
        if (matched >= 3 && missingCount === 0) status = "You can make this now";
        if (matched > 0 && missingCount <= 2) status = "You're missing 1-2 things";
        return { recipe, score, matched, missing, status };
      }).filter((match) => match.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 4);
    }

    function escapeRegExp(value) {
      return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
    function duplicateIngredientNameLength(text, name) {
      const cleanName = String(name || "").replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
      if (!cleanName) return 0;
      const match = String(text || "").match(new RegExp("^\\s+" + escapeRegExp(cleanName) + "(?=\\b|\\s|[,.):;])", "i"));
      return match ? match[0].length : 0;
    }
    function displayIngredientText(ing, scale=1, metric=false) {
      const measure = displayIngredientMeasure(ing, scale, metric);
      return ((measure.amount || "") + (measure.unit ? " " + measure.unit : "") + " " + (ing.name || "")).trim();
    }
    function plainStepText(text, ingredients, scale=1, metric=false) {
      const list = ingredients || [];
      // Same display-time temperature conversion as StepText, so PDF/Cook Mode match.
      text = RecipeBoxNormalize.convertTempsInText(text, metric ? "metric" : "us");
      const regex = /\{([^}]+)\}/g;
      let out = "";
      let last = 0;
      let match;
      while ((match = regex.exec(String(text || ""))) !== null) {
        out += String(text || "").slice(last, match.index);
        const ing = list.find((item) => item.id === match[1]);
        if (ing) {
          out += displayIngredientText(ing, scale, metric);
          const duplicateLen = duplicateIngredientNameLength(String(text || "").slice(regex.lastIndex), ing.name);
          if (duplicateLen) regex.lastIndex += duplicateLen;
        } else {
          out += match[0];
        }
        last = regex.lastIndex;
      }
      out += String(text || "").slice(last);
      return out.replace(/\s+/g, " ").trim();
    }
    // One display string for a grouped ingredient (compound measures joined by
    // " + ", abbreviated units, name once) — the SAME formatting the recipe card
    // uses, so the PDF mirrors the app exactly. Display-only.
    function compoundIngredientLine(grp, scale=1, metric=false) {
      const measures = (grp.items || []).map((it) => {
        const m = displayIngredientMeasure(it, scale, metric);
        return (displayAmount(m.amount) + (m.unit ? " " + m.unit : "")).trim();
      }).filter(Boolean).join(" + ");
      return (measures ? measures + " " : "") + (grp.name || "");
    }
    const IMPORT_EQUIPMENT_WORDS = /\b(grater|bowl|cutting board|chef'?s knife|knife|scissors|measuring spoon|measuring cup|oven mitt|spatula|ladle|pan\b|pie plate|microwave-safe bowl|stove-top pan|wire cooling rack|wooden spoon|fork|whisk|parchment|foil)\b/i;
    // Distinctive ingredients that are easy for AI to "round off" to a common one
    // (e.g. half-and-half -> milk). If the source text clearly names one but the
    // extracted recipe doesn't, we flag it so the user can double-check.
    const HIGH_SIGNAL_INGREDIENTS = [
      "half and half", "heavy cream", "heavy whipping cream", "whipping cream", "light cream",
      "buttermilk", "evaporated milk", "sweetened condensed milk", "condensed milk",
      "creme fraiche", "sour cream", "mascarpone", "ricotta", "cream cheese",
      "coconut milk", "coconut cream", "almond milk", "oat milk", "soy milk",
      "cake flour", "bread flour", "self rising flour", "almond flour", "whole wheat flour",
      "powdered sugar", "confectioners sugar", "brown sugar", "cornstarch", "corn starch", "cream of tartar",
    ];
    // Same-product synonyms: if the recipe already contains any member of a
    // group, a source mention of another member is NOT a substitution (e.g.
    // "heavy cream" and "heavy whipping cream" are the same thing). Prevents
    // false "double-check the ingredients" warnings from polluting saved notes.
    const INGREDIENT_EQUIVALENTS = [
      ["heavy cream", "heavy whipping cream", "whipping cream"],
      ["powdered sugar", "confectioners sugar"],
      ["cornstarch", "corn starch"],
    ];
    function findSourceIngredientMismatches(sourceText, recipe) {
      const norm = (s) => String(s || "").toLowerCase().replace(/[-]+/g, " ").replace(/&/g, "and").replace(/\s+/g, " ");
      const src = norm(sourceText);
      if (!src) return [];
      const ing = norm((recipe && recipe.sections || []).flatMap((s) => (s.ingredients || []).map((i) => (i && i.name) || "")).join(" "));
      const equivPresent = (term) => {
        const group = INGREDIENT_EQUIVALENTS.find((g) => g.includes(term));
        return group ? group.some((t) => ing.includes(t)) : false;
      };
      const seen = new Set();
      const out = [];
      HIGH_SIGNAL_INGREDIENTS.forEach((term) => {
        if (src.includes(term) && !ing.includes(term) && !equivPresent(term)) {
          const pretty = term === "half and half" ? "half-and-half" : term;
          if (!seen.has(pretty)) { seen.add(pretty); out.push(pretty); }
        }
      });
      return out.slice(0, 5);
    }

    function sanitizeImportedRecipe(recipe) {
      if (!recipe || !Array.isArray(recipe.sections)) return recipe;
      const filtered = {
        ...recipe,
        sections: recipe.sections.map((section) => ({
          ...section,
          ingredients: (section.ingredients || []).filter((ingredient) => {
            const text = [ingredient.amount, ingredient.unit, ingredient.name].filter(Boolean).join(" ");
            return !IMPORT_EQUIPMENT_WORDS.test(text);
          })
        }))
      };
      // Stage 2: deterministic RecipeBox normalization (one consistent style;
      // formatting only — quantities/order/structure preserved). Single import
      // chokepoint, so every path (URL/text/photo/PDF/YouTube/social) is normalized.
      try { return RecipeBoxNormalize.normalizeRecipe(filtered); } catch { return filtered; }
    }

    function StepText({ text, ingredients, scale, metric }) {
      // Display-time temperature conversion to the user's chosen mode (°F<->°C).
      const t = RecipeBoxNormalize.convertTempsInText(text, metric ? "metric" : "us");
      const parts = [];
      const regex = /\{([^}]+)\}/g;
      let last = 0, match;
      while ((match = regex.exec(t)) !== null) {
        if (match.index > last) parts.push({ type:"text", value:t.slice(last, match.index) });
        const ing = ingredients.find((i) => i.id === match[1]);
        if (ing) {
          parts.push({ type:"chip", value:displayIngredientText(ing, scale, metric) });
          const duplicateLen = duplicateIngredientNameLength(t.slice(regex.lastIndex), ing.name);
          if (duplicateLen) regex.lastIndex += duplicateLen;
        }
        last = regex.lastIndex;
      }
      if (last < t.length) parts.push({ type:"text", value:t.slice(last) });
      return (
        <span>
          {parts.map((p, i) => p.type === "chip"
            ? <span key={i} style={{background:C.goldPale,border:"1px solid "+C.goldLight,borderRadius:5,padding:"1px 6px",margin:"0 2px",fontSize:"0.87em",fontWeight:600,color:C.brown,whiteSpace:"normal",display:"inline",overflowWrap:"break-word",wordBreak:"normal",maxWidth:"100%",boxDecorationBreak:"clone",WebkitBoxDecorationBreak:"clone"}}>{p.value}</span>
            : <span key={i}>{p.value}</span>)}
        </span>
      );
    }

    function NoteText({ text }) {
      const raw = String(text || "");
      const parts = [];
      const re = /(https?:\/\/[^\s),\]]+)/g;
      let last = 0, match;
      while ((match = re.exec(raw)) !== null) {
        if (match.index > last) parts.push({ type:"text", value:raw.slice(last, match.index) });
        parts.push({ type:"link", value:match[1] });
        last = re.lastIndex;
      }
      if (last < raw.length) parts.push({ type:"text", value:raw.slice(last) });
      return (
        <span>
          {parts.map((part, i) => part.type === "link"
            ? <a key={i} href={part.value} target="_blank" rel="noreferrer" style={{color:C.green,fontWeight:800,overflowWrap:"anywhere"}}>{part.value}</a>
            : <span key={i}>{part.value}</span>)}
        </span>
      );
    }

    async function parseRecipeJsonWithRepair(raw, contextLabel) {
      try {
        return parseAIJson(raw);
      } catch (err) {
        const repaired = await callAI([{
          role:"user",
          content:
            "Repair this malformed RecipeBox recipe JSON from " + (contextLabel || "AI") + ". Return only valid JSON, with no markdown or explanation.\n\n" +
            raw
        }], REPAIR_JSON_PROMPT, 6000, 0);
        return parseAIJson(repaired);
      }
    }

    // Category Modal
    function CategoryModal({ onSelect, onCancel }) {
      return (
        <div className="modal-overlay" onClick={onCancel}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div style={{padding:"24px 24px 8px",borderBottom:"1px solid "+C.border}}>
              <div style={{fontFamily:SERIF,fontSize:"1.3em",color:C.dark,marginBottom:4}}>Save to Library</div>
              <div style={{color:C.light,fontSize:"0.85em"}}>Choose a category for this recipe</div>
            </div>
            <div style={{padding:"12px 16px 20px"}}>
              {CATEGORIES.map((c) => (
                <button key={c} onClick={() => onSelect(c)}
                  style={{display:"block",width:"100%",padding:"13px 16px",marginBottom:8,border:"1.5px solid "+C.border,borderRadius:10,background:C.white,color:C.dark,fontWeight:600,cursor:"pointer",fontSize:"0.95em",fontFamily:SANS,textAlign:"left",transition:"all 0.15s"}}
                  onMouseEnter={(e) => { e.target.style.borderColor=C.terra; e.target.style.background=C.terraPale; }}
                  onMouseLeave={(e) => { e.target.style.borderColor=C.border; e.target.style.background=C.white; }}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
        </div>
      );
    }

    function MissingPhotoModal({ onAdd, onSkip, inputRef }) {
      return (
        <div className="modal-overlay" onClick={onSkip}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div style={{padding:"24px 24px 8px",borderBottom:"1px solid "+C.border}}>
              <div style={{fontFamily:SERIF,fontSize:"1.3em",color:C.dark,marginBottom:4}}>Add a cover photo?</div>
              <div style={{color:C.light,fontSize:"0.85em",lineHeight:1.5}}>Your recipe is ready to save. Would you like to choose a cover photo?</div>
            </div>
            <div style={{padding:"18px 16px 20px",display:"grid",gap:10}}>
              <input ref={inputRef} type="file" accept="image/*,image/heic,image/heif" onChange={onAdd} style={{display:"none"}} />
              <button onClick={() => inputRef.current.click()}
                style={{width:"100%",background:C.green,color:C.white,border:"none",borderRadius:10,padding:"13px 16px",fontWeight:700,cursor:"pointer",fontSize:"0.95em",fontFamily:SANS,display:"inline-flex",alignItems:"center",justifyContent:"center",gap:8}}>
                <Icon name="camera" size={18} /> Choose Photo
              </button>
              <button onClick={onSkip}
                style={{width:"100%",background:C.white,color:C.brown,border:"1.5px solid "+C.border,borderRadius:10,padding:"12px 16px",fontWeight:700,cursor:"pointer",fontSize:"0.9em",fontFamily:SANS}}>
                Not Now
              </button>
            </div>
          </div>
        </div>
      );
    }

    // Bottom Nav
    function BottomNav({ tab, setTab, badges }) {
      const items = [
        { id:"library", icon:"library", label:"Library" },
        { id:"plan", icon:"mealPlan", label:"Plan" },
        { id:"shopping", icon:"shoppingList", label:"Shop" },
        { id:"pantry", icon:"pantry", label:"Pantry" },
        { id:"settings", icon:"settings", label:"Settings" },
      ];
      return (
        <div style={{position:"fixed",bottom:0,left:0,right:0,background:C.paper,borderTop:"1px solid "+C.border,display:"flex",zIndex:30,boxShadow:"0 -8px 24px rgba(90,56,39,0.10)",paddingBottom:"calc(env(safe-area-inset-bottom) + 8px)",overflowX:"hidden"}}>
          {items.map((item) => {
            const active = tab === item.id;
            const badge = badges && badges[item.id];
            return (
              <button key={item.id} onClick={() => setTab(item.id)}
                style={{flex:"1 1 0",minWidth:0,padding:"12px 0 10px",border:"none",background:"none",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:2,position:"relative",color:active?"#1f5a37":"#9a7a68",fontFamily:SANS,WebkitTapHighlightColor:"transparent"}}>
                <span style={{position:"relative",display:"inline-flex"}}>
                  <Icon name={item.icon} size={23} style={{marginBottom:2}} />
                  {badge > 0 && (
                    <span aria-label={badge+" new"} style={{position:"absolute",top:-5,right:-9,minWidth:17,height:17,padding:"0 4px",borderRadius:999,background:"#c2402e",color:"#fff",fontSize:"0.6em",fontWeight:900,display:"flex",alignItems:"center",justifyContent:"center",border:"1.5px solid "+C.paper,lineHeight:1}}>{badge > 9 ? "9+" : badge}</span>
                  )}
                </span>
                <span style={{fontSize:"0.67em",fontWeight:active?700:500,color:"inherit",fontFamily:SANS}}>{item.label}</span>
                {active && <div style={{position:"absolute",bottom:0,width:22,height:3,background:"#c2952e",borderRadius:2}} />}
              </button>
            );
          })}
        </div>
      );
    }

    function useWindowCompactHeader(threshold = 28) {
      const [compact, setCompact] = useState(false);
      useEffect(() => {
        const onScroll = () => setCompact(window.scrollY > threshold);
        onScroll();
        window.addEventListener("scroll", onScroll, { passive:true });
        return () => window.removeEventListener("scroll", onScroll);
      }, [threshold]);
      return compact;
    }

    function PageHeader({ title, subtitle, compact = false, top = 28, right = 20, bottom = 24 }) {
      return (
        <div style={{...S.brandHeader,position:compact?"fixed":"sticky",top:0,left:compact?0:undefined,right:compact?0:undefined,width:compact?"100%":undefined,zIndex:compact?28:18,padding:compact?safePad(10,16,10):safePad(top,right,bottom),transition:"padding 0.18s ease, box-shadow 0.18s ease"}}>
          <div style={{maxWidth:900,margin:"0 auto"}}>
            <div style={{fontFamily:SERIF,fontSize:compact?"1.08em":"1.8em",color:C.white,lineHeight:compact?1.15:1,transition:"font-size 0.18s ease"}}>{title}</div>
            {!compact && subtitle && <div style={{color:"rgba(255,249,238,0.72)",fontSize:"0.8em",marginTop:3}}>{subtitle}</div>}
          </div>
        </div>
      );
    }

    // Generic, on-theme placeholder emblem for recipes without a photo — a
    // serving cloche. Used instead of a category stock image (which mismatched
    // the recipe, e.g. a pie photo on an ice cream recipe).
    function DishGlyph({ size = 42, color = "rgba(255,249,238,0.36)" }) {
      return (
        <svg width={size} height={size} viewBox="0 0 48 48" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M8 32a16 16 0 0 1 32 0" />
          <line x1="5" y1="32" x2="43" y2="32" />
          <circle cx="24" cy="12.6" r="1.5" fill={color} stroke="none" />
          <path d="M24 14.1v2" />
        </svg>
      );
    }

    // Recipe Card
    function RecipeCard({ recipe, onClick, onFavorite, onTagClick }) {
      const color = cardColor(recipe.title);
      const cardImage = recipe.heroImage || "";
      const hasImage = cardImage && cardImage.length > 0;
      return (
        <div onClick={onClick} className="card" style={{...S.card,overflow:"hidden"}}>
          <div style={{height:104,position:"relative",overflow:"hidden",background:hasImage?"#000":`linear-gradient(135deg, ${color}, ${C.brown})`}}>
            {hasImage ? (
              <img src={cardImage} alt={recipe.title}
                style={{width:"100%",height:"100%",objectFit:"cover",opacity:recipe.heroImage?0.85:0.72}}
                onError={(e) => { e.target.style.display="none"; e.target.parentNode.style.background=`linear-gradient(135deg, ${color}, ${color}BB)`; }} />
            ) : (
              <span style={{position:"absolute",top:"50%",left:"50%",transform:"translate(-50%,-50%)",userSelect:"none"}}><DishGlyph size={42} /></span>
            )}
            {recipe.householdShared
              ? <span style={{position:"absolute",top:8,left:8,background:"rgba(32,20,14,0.55)",color:C.white,borderRadius:12,padding:"3px 9px",fontSize:"0.64em",fontWeight:700,display:"inline-flex",alignItems:"center",gap:4,zIndex:2}}><Icon name="sync" size={11} /> {recipe.ownerName || "Shared"}</span>
              : <button onClick={(e) => { e.stopPropagation(); onFavorite && onFavorite(); }}
                  style={{position:"absolute",top:8,right:8,background:"rgba(32,20,14,0.44)",border:"1px solid rgba(255,255,255,0.18)",borderRadius:"50%",width:32,height:32,cursor:"pointer",fontSize:"0.95em",color:recipe.favorite?C.goldLight:"rgba(255,255,255,0.78)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:2}}>
                  <Icon name="favorite" size={17} strokeWidth={recipe.favorite ? 2.5 : 2} />
                </button>}
            <div style={{position:"absolute",bottom:0,left:0,right:0,display:"flex",justifyContent:"space-between",padding:"0 8px 6px",zIndex:2}}>
              {recipe.cookTime && <span style={{background:"rgba(32,20,14,0.55)",color:C.white,borderRadius:12,padding:"2px 8px",fontSize:"0.69em",fontWeight:700,display:"inline-flex",alignItems:"center",gap:4}}><Icon name="timer" size={12} /> {recipe.cookTime}</span>}
              {recipe.macros?.calories > 0 && <span style={{background:"rgba(32,20,14,0.55)",color:C.white,borderRadius:12,padding:"2px 8px",fontSize:"0.69em",fontWeight:700}}>{recipe.macros.calories} cal</span>}
            </div>
          </div>
          <div style={{padding:"11px 13px 13px"}}>
            <div style={{fontFamily:SERIF,fontSize:"1.02em",color:C.dark,lineHeight:1.25,marginBottom:4}}>{recipe.title}</div>
            {recipe.rating > 0 && <Stars value={recipe.rating} size={11} />}
            {recipe.description && <div style={{color:C.light,fontSize:"0.76em",lineHeight:1.5,marginTop:4,overflow:"hidden",display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical"}}>{recipe.description}</div>}
            {recipe.tags?.length > 0 && (
              <div style={{display:"flex",flexWrap:"wrap",gap:4,marginTop:7}}>
                {recipe.tags.slice(0,3).map((t) => <Tag key={t} label={t} onClick={onTagClick} compact />)}
              </div>
            )}
          </div>
        </div>
      );
    }

    // Library
    function Library({ recipes, mealPlan, onOpen, onAdd, onFavorite, setTab, tagFilter, onTagFilter, onCreateShoppingList }) {
      const [search, setSearch] = useState("");
      const [cat, setCat] = useState("All");
      const [filter, setFilter] = useState("all");
      const [showAllCats, setShowAllCats] = useState(false);
      const [selectMode, setSelectMode] = useState(false);
      const [selected, setSelected] = useState([]);
      const toggleSelect = (id) => setSelected((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);
      const exitSelect = () => { setSelectMode(false); setSelected([]); };
      const tagKey = (t) => RecipeBoxTags.normalizeTagKey(t);
      const activeTag = tagFilter || "";
      const activeTagKey = tagKey(activeTag);
      // Selecting a tag clears the other filters so the tag view is clean.
      const selectTag = (t) => { onTagFilter && onTagFilter(t); setCat("All"); setFilter("all"); setSearch(""); };
      const clearTag = () => { onTagFilter && onTagFilter(""); };

      const today = DAYS[new Date().getDay() === 0 ? 6 : new Date().getDay() - 1];
      const todayRecipes = (mealPlan[today] || []).map((id) => recipes.find((r) => r.id === id)).filter(Boolean);

      const filtered = recipes.filter((r) => {
        const q = search.toLowerCase();
        const matchCat = cat === "All" || r.category === cat;
        const matchFilter = filter === "all" || (filter === "favorites" && r.favorite) || (filter === "recent" && Date.now() - new Date(r.createdAt).getTime() < 7 * 86400000);
        const matchSearch = !q || r.title.toLowerCase().includes(q) || (r.category||"").toLowerCase().includes(q) || (r.tags||[]).some((t) => t.toLowerCase().includes(q)) || (r.sections||[]).some((s) => s.ingredients.some((i) => i.name.toLowerCase().includes(q)));
        const matchTag = !activeTagKey || RecipeBoxTags.recipeInCollection(r, activeTag);
        return matchCat && matchFilter && matchSearch && matchTag;
      });

      const sortedRecipes = [...recipes].sort((a,b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
      const categoryCounts = {};
      CATEGORIES.forEach((c) => { categoryCounts[c] = recipes.filter((r) => r.category === c).length; });
      const favoriteCount = recipes.filter((r) => r.favorite).length;
      // Browse tiles: categories with recipes lead (by count), empty ones are
      // tucked behind "Show all categories" so empty scaffolding never dominates.
      const catCards = CATEGORIES.map((c) => ({ label:c, count:categoryCounts[c], image:CATEGORY_IMAGES[c], onClick:() => { setCat(c); setFilter("all"); } }));
      const filledCats = catCards.filter((c) => c.count > 0).sort((a, b) => (b.count - a.count) || a.label.localeCompare(b.label));
      const emptyCats = catCards.filter((c) => c.count === 0).sort((a, b) => a.label.localeCompare(b.label));
      const favCard = favoriteCount > 0 ? [{ label:"Favorites", count:favoriteCount, image:CATEGORY_IMAGES["Favorites"], onClick:() => { setCat("All"); setFilter("favorites"); } }] : [];
      const primaryBrowse = [...favCard, ...filledCats];

      // Tag frequency from the user's own recipes: dedupe by normalized key.
      // Feeds Quick Finds (below). No global tag table.
      const tagCounts = {};
      const tagDisplay = {};
      recipes.forEach((r) => RecipeBoxTags.collectionKeys(r).forEach((key) => {
        if (!key) return;
        tagCounts[key] = (tagCounts[key] || 0) + 1;
        if (!tagDisplay[key]) tagDisplay[key] = RecipeBoxTags.displayTag(key);
      }));
      // Quick Finds: the user's own tags as compact, warm shortcut chips
      // (frequency, then alphabetical). One light section replaces the old
      // Popular Tags row + heavy Collections grid; tapping filters the library.
      const quickFinds = Object.keys(tagCounts)
        .sort((a, b) => (tagCounts[b] - tagCounts[a]) || tagDisplay[a].localeCompare(tagDisplay[b]))
        .map((key) => ({ key, label: tagDisplay[key], count: tagCounts[key] }));

      // Recently Saved: fast re-entry into the latest imports — only once the box
      // is big enough that it's distinct from the full feed below (no empty feel).
      const recentRecipes = sortedRecipes.slice(0, 5);
      const showRecent = recipes.length >= 6;

      const isDashboard = cat === "All" && filter === "all" && !search.trim() && !activeTagKey;

      return (
        <div style={{...S.page,paddingBottom:NAV_CLEARANCE}}>
          <div style={{...S.brandHeader,padding:safePad(28,20,24)}}>
            <div style={{maxWidth:900,margin:"0 auto"}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20}}>
                <div>
                  <div style={{fontFamily:SERIF,fontSize:"1.95em",color:C.white,lineHeight:1}}>Your RecipeBox</div>
                  <div style={{color:"rgba(255,249,238,0.78)",fontSize:"0.78em",marginTop:4}}>{recipes.length ? recipes.length+" recipe"+(recipes.length!==1?"s":"")+" tucked away" : "A clean place for family favorites"}</div>
                </div>
                <button onClick={onAdd} style={{...S.goldBtn,borderRadius:12,padding:"11px 18px",fontSize:"0.88em"}}>
                  + Add Recipe
                </button>
              </div>
              <div style={{position:"relative"}}>
                <span style={{position:"absolute",left:14,top:"50%",transform:"translateY(-50%)",color:"rgba(255,255,255,0.4)",display:"inline-flex"}}><Icon name="search" size={18} /></span>
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search recipes, ingredients, tags..."
                  style={{width:"100%",padding:"12px 16px 12px 42px",borderRadius:12,border:"1px solid rgba(255,249,238,0.18)",fontSize:"0.9em",background:"rgba(255,249,238,0.12)",color:C.white,outline:"none",fontFamily:SANS}} />
              </div>
            </div>
          </div>

          <div style={{maxWidth:900,margin:"0 auto",padding:"0 16px"}}>
            {todayRecipes.length > 0 && (
              <div onClick={() => setTab("plan")} style={{...S.cardSoft,background:`linear-gradient(135deg, ${C.greenPale}, ${C.goldPale})`,padding:"13px 18px",marginTop:18,cursor:"pointer",display:"flex",alignItems:"center",gap:12}}>
                <span style={{fontSize:"1.4em",color:C.green,display:"inline-flex"}}><Icon name="mealPlan" size={24} /></span>
                <div style={{flex:1}}>
                  <div style={{fontWeight:700,color:C.dark,fontSize:"0.88em"}}>Today - {today}</div>
                  <div style={{color:C.mid,fontSize:"0.8em"}}>{todayRecipes.map((r) => r.title).join(" · ")}</div>
                </div>
                <span style={{color:C.light}}>›</span>
              </div>
            )}

            {recipes.length > 0 && (
              <div style={{display:"flex",gap:7,marginTop:16,overflowX:"auto",paddingBottom:4}}>
                {["all","favorites","recent"].map((f) => (
                  <button key={f} onClick={() => setFilter(f)}
                    style={{border:"1.5px solid "+(filter===f?C.green:C.border),background:filter===f?C.green:C.paper,color:filter===f?C.white:C.mid,borderRadius:20,padding:"6px 14px",fontSize:"0.78em",fontWeight:700,cursor:"pointer",whiteSpace:"nowrap",fontFamily:SANS,flexShrink:0}}>
                    {f==="all"?"All":f==="favorites"?<span style={{display:"inline-flex",alignItems:"center",gap:5}}><Icon name="favorite" size={13} /> Favorites</span>:"Recent"}
                  </button>
                ))}
              </div>
            )}

            {activeTag ? (
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexWrap:"wrap",marginTop:14,background:C.greenPale,border:"1px solid "+C.green+"40",borderRadius:12,padding:"10px 14px"}}>
                <div style={{fontSize:"0.86em",color:C.dark,fontWeight:700}}>Showing recipes tagged <span style={{color:C.green}}>{RecipeBoxTags.displayTag(activeTag)}</span></div>
                <button onClick={clearTag} style={{...S.ghostBtn,borderRadius:999,padding:"6px 13px",fontSize:"0.78em"}}>Clear tag filter</button>
              </div>
            ) : isDashboard && quickFinds.length > 0 && (
              <div style={{marginTop:16}}>
                <div style={{fontSize:"0.72em",fontWeight:800,letterSpacing:"0.04em",textTransform:"uppercase",color:C.light,marginBottom:9}}>Quick Finds</div>
                <div style={{display:"flex",gap:8,overflowX:"auto",WebkitOverflowScrolling:"touch",margin:"0 -16px",padding:"0 16px 4px"}}>
                  {quickFinds.map((t) => (
                    <button key={t.key} onClick={() => selectTag(t.label)}
                      style={{flexShrink:0,display:"inline-flex",alignItems:"center",gap:7,background:C.goldPale,border:"1px solid "+C.goldLight,color:C.dark,borderRadius:999,padding:"8px 14px",minHeight:36,fontSize:"0.82em",fontWeight:700,cursor:"pointer",fontFamily:SANS,whiteSpace:"nowrap",WebkitTapHighlightColor:"transparent",touchAction:"manipulation"}}>
                      {t.label}
                      <span style={{background:C.paper,color:C.brown,borderRadius:999,minWidth:18,height:18,padding:"0 5px",display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:"0.74em",fontWeight:900,border:"1px solid "+C.goldLight}}>{t.count}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {filtered.length === 0 && !isDashboard ? (
              <div style={{padding:"36px 0 60px"}}>
                {!isDashboard && (
                  <button onClick={() => { setCat("All"); setFilter("all"); setSearch(""); clearTag(); }}
                    style={{...S.ghostBtn,borderRadius:999,padding:"7px 13px",fontSize:"0.78em",marginBottom:24}}>
                    ← Back to Your RecipeBox
                  </button>
                )}
                <div style={{textAlign:"center",padding:"36px 0",color:C.light}}>
                  No recipes match your search
                </div>
              </div>
            ) : isDashboard && recipes.length === 0 ? (
              <div className="fade-up" style={{marginTop:22}}>
                <div style={{...S.card,padding:"24px 20px"}}>
                  <div style={{fontFamily:SERIF,fontSize:"1.5em",color:C.dark,lineHeight:1.15,marginBottom:6}}>Welcome to your RecipeBox</div>
                  <div style={{color:C.light,fontSize:"0.9em",lineHeight:1.5,marginBottom:18}}>Start your box with a recipe you love. Pick a way to add the first one — it only takes a few seconds. AI imports, edits, and planning use AI Assists, and you start with a welcome balance.</div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(150px, 1fr))",gap:12}}>
                    {[
                      { mode:"url", icon:"import", label:"Import from the web", hint:"Paste a recipe link" },
                      { mode:"media", icon:"camera", label:"Snap a photo or card", hint:"Cards, screenshots, PDFs" },
                      { mode:"text", icon:"recipeCard", label:"Paste recipe text", hint:"Type or paste from anywhere" },
                    ].map((tile) => (
                      <button key={tile.mode} onClick={() => onAdd(tile.mode)}
                        style={{textAlign:"left",border:"1px solid "+C.border,background:C.paper,borderRadius:14,padding:"15px 14px",cursor:"pointer",fontFamily:SANS,display:"flex",flexDirection:"column",gap:8,minHeight:118,WebkitTapHighlightColor:"transparent",touchAction:"manipulation"}}>
                        <span style={{width:40,height:40,borderRadius:11,background:C.greenPale,color:C.green,display:"inline-flex",alignItems:"center",justifyContent:"center",border:"1px solid "+C.green+"33"}}><Icon name={tile.icon} size={21} /></span>
                        <span style={{fontWeight:800,color:C.dark,fontSize:"0.92em",lineHeight:1.2}}>{tile.label}</span>
                        <span style={{color:C.light,fontSize:"0.76em",lineHeight:1.4}}>{tile.hint}</span>
                      </button>
                    ))}
                  </div>
                  <button onClick={() => setTab("pantry")}
                    style={{marginTop:12,width:"100%",border:"1px solid "+C.goldLight,background:C.goldPale,borderRadius:14,padding:"14px 16px",cursor:"pointer",fontFamily:SANS,display:"flex",alignItems:"center",gap:12,textAlign:"left",WebkitTapHighlightColor:"transparent",touchAction:"manipulation"}}>
                    <span style={{width:40,height:40,borderRadius:11,background:C.paper,color:C.brown,display:"inline-flex",alignItems:"center",justifyContent:"center",border:"1px solid "+C.goldLight,flexShrink:0}}><Icon name="chef" size={21} /></span>
                    <span style={{flex:1,minWidth:0}}>
                      <span style={{display:"block",fontWeight:800,color:C.brown,fontSize:"0.92em"}}>Not sure yet? Ask Pantry Chef</span>
                      <span style={{display:"block",color:C.brownLight||C.light,fontSize:"0.76em",marginTop:2}}>Tell it what you have and get a recipe idea</span>
                    </span>
                    <span style={{color:C.gold,fontWeight:900,fontSize:"1.1em"}}>›</span>
                  </button>
                  <div style={{marginTop:16,fontSize:"0.76em",color:C.light,lineHeight:1.5,display:"flex",alignItems:"center",gap:7}}>
                    <Icon name="sync" size={14} /> Everything saves to your account and syncs across your devices.
                  </div>
                </div>
              </div>
            ) : isDashboard ? (
              <div>
                {showRecent && (
                  <div style={{marginTop:24}}>
                    <h3 style={{margin:"0 0 13px",fontFamily:SERIF,fontSize:"1.25em",color:C.dark,fontWeight:400}}>Recently Saved</h3>
                    <div style={{display:"flex",gap:13,overflowX:"auto",WebkitOverflowScrolling:"touch",margin:"0 -16px",padding:"0 16px 6px"}}>
                      {recentRecipes.map((r) => {
                        const img = r.heroImage || "";
                        return (
                          <button key={r.id} onClick={() => onOpen(r)}
                            style={{flexShrink:0,width:150,textAlign:"left",border:"1px solid "+C.border,background:C.paper,borderRadius:14,overflow:"hidden",cursor:"pointer",fontFamily:SANS,padding:0,boxShadow:"0 6px 16px rgba(90,56,39,0.08)",WebkitTapHighlightColor:"transparent",touchAction:"manipulation"}}>
                            <div style={{height:92,position:"relative",overflow:"hidden",background:img?"#000":`linear-gradient(135deg, ${cardColor(r.title)}, ${C.brown})`}}>
                              {img
                                ? <img src={img} alt="" style={{width:"100%",height:"100%",objectFit:"cover",opacity:0.85}} onError={(e)=>{e.target.style.display="none";}} />
                                : <span style={{position:"absolute",top:"50%",left:"50%",transform:"translate(-50%,-50%)"}}><DishGlyph size={36} /></span>}
                              {r.cookTime && <span style={{position:"absolute",left:7,bottom:7,background:"rgba(32,20,14,0.55)",color:C.white,borderRadius:10,padding:"2px 7px",fontSize:"0.66em",fontWeight:700,display:"inline-flex",alignItems:"center",gap:3}}><Icon name="timer" size={10} /> {r.cookTime}</span>}
                            </div>
                            <div style={{padding:"9px 11px 11px",fontFamily:SERIF,fontSize:"0.9em",color:C.dark,lineHeight:1.25,overflow:"hidden",display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",minHeight:"2.4em"}}>{r.title}</div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                <div style={{marginTop:24}}>
                  <h3 style={{margin:"0 0 13px",fontFamily:SERIF,fontSize:"1.25em",color:C.dark,fontWeight:400}}>Browse your box</h3>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(150px, 1fr))",gap:12}}>
                    {(showAllCats ? [...primaryBrowse, ...emptyCats] : primaryBrowse).map((card) => (
                      <button key={card.label} onClick={card.onClick}
                        style={{height:116,position:"relative",overflow:"hidden",background:C.dark,border:"1px solid rgba(216,199,174,0.95)",borderRadius:14,padding:0,textAlign:"left",cursor:"pointer",boxShadow:"0 10px 24px rgba(90,56,39,0.13)",fontFamily:SANS,opacity:card.count===0?0.82:1}}>
                        <img src={card.image} alt="" style={{position:"absolute",inset:0,width:"100%",height:"100%",objectFit:"cover",opacity:0.74}} />
                        <div style={{position:"absolute",inset:0,background:"linear-gradient(180deg, rgba(32,20,14,0.06), rgba(32,20,14,0.48))"}} />
                        <div style={{position:"absolute",left:13,right:13,bottom:12,color:C.white}}>
                          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}}>
                            <span style={{fontWeight:900,fontSize:"0.9em",textShadow:"0 1px 3px rgba(0,0,0,0.35)"}}>{card.label}</span>
                            <span style={{background:"rgba(255,249,238,0.88)",color:C.brown,border:"1px solid rgba(216,199,174,0.95)",borderRadius:999,padding:"2px 8px",fontSize:"0.72em",fontWeight:900,boxShadow:"0 2px 8px rgba(32,20,14,0.16)"}}>{card.count}</span>
                          </div>
                          <div style={{marginTop:4,color:"rgba(255,249,238,0.86)",fontSize:"0.74em"}}>{card.count === 1 ? "1 recipe" : card.count + " recipes"}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                  {emptyCats.length > 0 && (
                    <button onClick={() => setShowAllCats((v) => !v)}
                      style={{marginTop:12,background:"transparent",border:"1px dashed "+C.border,color:C.brown,borderRadius:999,padding:"8px 16px",minHeight:36,fontSize:"0.78em",fontWeight:700,cursor:"pointer",fontFamily:SANS,WebkitTapHighlightColor:"transparent",touchAction:"manipulation"}}>
                      {showAllCats ? "Show fewer categories" : "Show all categories (" + emptyCats.length + " empty)"}
                    </button>
                  )}
                </div>

                <div style={{marginTop:30}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,marginBottom:13,flexWrap:"wrap"}}>
                    <h3 style={{margin:0,fontFamily:SERIF,fontSize:"1.25em",color:C.dark,fontWeight:400}}>All Recipes</h3>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      {selectMode ? (
                        <>
                          <button onClick={() => onCreateShoppingList(selected, "Shopping List from " + selected.length + " Recipe" + (selected.length===1?"":"s"))} disabled={selected.length===0}
                            style={{background:selected.length?C.green:C.cream3,color:selected.length?C.white:C.light,border:"none",borderRadius:999,padding:"7px 15px",fontSize:"0.8em",fontWeight:800,cursor:selected.length?"pointer":"not-allowed",fontFamily:SANS}}>
                            Create Shopping List{selected.length?" ("+selected.length+")":""}
                          </button>
                          <button onClick={exitSelect} style={{...S.ghostBtn,borderRadius:999,padding:"7px 13px",fontSize:"0.78em"}}>Cancel</button>
                        </>
                      ) : (
                        recipes.length > 1 && (
                          <button onClick={() => setSelectMode(true)} style={{...S.ghostBtn,borderRadius:999,padding:"7px 13px",fontSize:"0.78em",display:"inline-flex",alignItems:"center",gap:6}}>
                            <Icon name="shoppingList" size={15} /> Make a list
                          </button>
                        )
                      )}
                    </div>
                  </div>
                  {selectMode && <div style={{fontSize:"0.8em",color:C.mid,marginBottom:11}}>Tap recipes to build one combined shopping list.</div>}
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(195px, 1fr))",gap:14}}>
                    {sortedRecipes.map((r) => selectMode ? (
                      <div key={r.id} style={{position:"relative"}}>
                        <RecipeCard recipe={r} onClick={() => {}} onFavorite={() => {}} onTagClick={() => {}} />
                        <button onClick={() => toggleSelect(r.id)} aria-label={"Select "+r.title}
                          style={{position:"absolute",inset:0,borderRadius:14,border:selected.includes(r.id)?"3px solid "+C.green:"2px solid rgba(0,0,0,0.05)",background:selected.includes(r.id)?"rgba(44,74,51,0.10)":"transparent",cursor:"pointer",padding:0,WebkitTapHighlightColor:"transparent"}}>
                          <span style={{position:"absolute",top:8,left:8,width:27,height:27,borderRadius:"50%",background:selected.includes(r.id)?C.green:"rgba(255,255,255,0.94)",border:"2px solid "+(selected.includes(r.id)?C.green:C.border),color:C.white,display:"inline-flex",alignItems:"center",justifyContent:"center",boxShadow:"0 1px 5px rgba(0,0,0,0.22)"}}>
                            {selected.includes(r.id) && <Icon name="check" size={15} strokeWidth={3} />}
                          </span>
                        </button>
                      </div>
                    ) : <RecipeCard key={r.id} recipe={r} onClick={() => onOpen(r)} onFavorite={() => onFavorite(r.id)} onTagClick={selectTag} />)}
                  </div>
                </div>
              </div>
            ) : (
              <div style={{marginTop:24}}>
                <button onClick={() => { setCat("All"); setFilter("all"); setSearch(""); clearTag(); }}
                  style={{...S.ghostBtn,borderRadius:999,padding:"7px 13px",fontSize:"0.78em",marginBottom:14}}>
                  ← Back to Your RecipeBox
                </button>

                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:13}}>
                  <h3 style={{margin:0,fontFamily:SERIF,fontSize:"1.25em",color:C.dark,fontWeight:400}}>
                    {activeTag ? RecipeBoxTags.displayTag(activeTag) : cat !== "All" ? cat : filter === "favorites" ? "Favorites" : filter === "recent" ? "Recent Recipes" : "Search Results"}
                  </h3>
                  <span style={{fontSize:"0.78em",color:C.light}}>{filtered.length} recipe{filtered.length!==1?"s":""}</span>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(195px, 1fr))",gap:14}}>
                  {filtered.map((r) => <RecipeCard key={r.id} recipe={r} onClick={() => onOpen(r)} onFavorite={() => onFavorite(r.id)} onTagClick={selectTag} />)}
                </div>
              </div>
            )}
          </div>
        </div>
      );
    }

    // Meal Planner
    function MealPlanner({ recipes, mealPlan, setMealPlan, onOpen, onGenerateShoppingList, inHousehold }) {
      const [picking, setPicking] = useState(null);
      const [pickFilter, setPickFilter] = useState("all");
      const [search, setSearch] = useState("");
      const [shoppingItems, setShoppingItems] = useState([]);
      const compactHeader = useWindowCompactHeader();
      const today = DAYS[new Date().getDay() === 0 ? 6 : new Date().getDay() - 1];
      const plannedRecipeIds = Object.values(mealPlan).flat();
      const plannedRecipes = plannedRecipeIds.map((id) => recipes.find((r) => r.id === id)).filter(Boolean);
      const totalCal = plannedRecipeIds.reduce((s, id) => { const r = recipes.find((x) => x.id === id); return s + (r?.macros?.calories || 0); }, 0);
      const mealCount = plannedRecipes.length;
      const hasMeals = mealCount > 0;
      const uniqueRecipeCount = new Set(plannedRecipes.map((r) => r.id)).size;

      // Current calendar week (Mon–Sun) for context only — the plan itself is a
      // single recurring week keyed by day name, so there is no week navigation.
      const weekRange = (() => {
        const now = new Date();
        const dow = now.getDay() === 0 ? 6 : now.getDay() - 1;
        const mon = new Date(now); mon.setDate(now.getDate() - dow);
        const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
        const fmt = (d) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
        return fmt(mon) + " – " + (mon.getMonth() === sun.getMonth() ? sun.getDate() : fmt(sun));
      })();

      const quickKey = RecipeBoxTags.normalizeTagKey("Quick");
      const pickerRecipes = recipes.filter((r) => {
        const q = search.toLowerCase();
        const ms = !q || r.title.toLowerCase().includes(q) || (r.tags || []).some((t) => t.toLowerCase().includes(q));
        const mf = pickFilter === "all"
          || (pickFilter === "favorites" && r.favorite)
          || (pickFilter === "recent" && Date.now() - new Date(r.createdAt).getTime() < 14 * 86400000)
          || (pickFilter === "quick" && (r.tags || []).some((t) => RecipeBoxTags.normalizeTagKey(t) === quickKey));
        return ms && mf;
      });
      const openPicker = (day, f) => { setPicking({ day }); setPickFilter(f || "all"); setSearch(""); };
      const closePicker = () => { setPicking(null); setSearch(""); setPickFilter("all"); };
      const addRecipe = (day, id) => { setMealPlan({ ...mealPlan, [day]: [...(mealPlan[day] || []), id] }); closePicker(); };

      function buildMealPlanShoppingList() {
        const sections = plannedRecipes.flatMap((recipe) =>
          (recipe.sections || []).map((section) => ({
            ...section,
            name: recipe.title + (section.name ? " - " + section.name : "")
          }))
        );
        const items = RecipeBoxShopping.buildShoppingListFromSections(sections);
        setShoppingItems(items);
      }
      function toggleShoppingItem(id) {
        setShoppingItems((items) => items.map((item) => item.id === id ? { ...item, checked:!item.checked } : item));
      }
      function editShoppingItem(id, text) {
        setShoppingItems((items) => items.map((item) => item.id === id ? { ...item, text } : item));
      }
      async function copyShoppingList() {
        const text = shoppingItems.map((item) => (item.checked ? "[x] " : "[ ] ") + item.text).join("\n");
        try { await navigator.clipboard.writeText(text); }
        catch { window.prompt("Copy shopping list:", text); }
      }

      return (
        <div style={{...S.page,paddingBottom:NAV_CLEARANCE}}>
          <PageHeader title={inHousehold ? "Household Meal Plan" : "Weekly Meal Plan"} subtitle={inHousehold ? "Shared with your household" : "Plan the week from your RecipeBox"} compact={compactHeader} />
          <div style={{maxWidth:900,margin:"20px auto",padding:"0 16px"}}>
            <div style={{...S.cardSoft,padding:"12px 15px",marginBottom:14,display:"flex",alignItems:"center",gap:12}}>
              <div style={{width:40,height:40,borderRadius:11,background:C.greenPale,color:C.green,display:"inline-flex",alignItems:"center",justifyContent:"center",border:"1px solid "+C.green+"22",flexShrink:0}}><Icon name="mealPlan" size={21} /></div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontWeight:800,color:C.dark,fontSize:"0.9em"}}>This week · {weekRange}</div>
                <div style={{fontSize:"0.78em",color:C.light,marginTop:2}}>{hasMeals ? mealCount+" meal"+(mealCount===1?"":"s")+" planned · "+uniqueRecipeCount+" recipe"+(uniqueRecipeCount===1?"":"s")+" · ~"+totalCal.toLocaleString()+" cal" : "Nothing planned yet"}</div>
              </div>
            </div>

            {hasMeals ? (
              <div style={{...S.card,padding:"13px 15px",marginBottom:14}}>
                <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                  <div style={{flex:1,minWidth:180}}>
                    <div style={{fontFamily:SERIF,fontSize:"1.05em",color:C.dark}}>Shopping List</div>
                    <div style={{fontSize:"0.78em",color:C.light}}>{"Ingredients from "+mealCount+" planned meal"+(mealCount===1?"":"s")+(uniqueRecipeCount!==mealCount?" · "+uniqueRecipeCount+" recipes":"")}</div>
                  </div>
                  <button onClick={() => onGenerateShoppingList(Array.from(new Set(plannedRecipes.map((r) => r.id))))}
                    style={{background:C.green,color:C.white,border:"none",borderRadius:9,padding:"9px 12px",fontWeight:800,cursor:"pointer",fontSize:"0.78em",fontFamily:SANS}}>
                    Generate Shopping List
                  </button>
                </div>
                {shoppingItems.length > 0 && (
                  <div style={{marginTop:13,borderTop:"1px solid "+C.cream3,paddingTop:10}}>
                    <div style={{display:"flex",gap:8,marginBottom:9,flexWrap:"wrap"}}>
                      <button onClick={copyShoppingList} style={{...S.goldBtn,border:"1px solid "+C.goldLight,borderRadius:8,padding:"7px 10px",fontSize:"0.76em"}}>Copy</button>
                      <button onClick={() => setShoppingItems((items) => items.map((item) => ({ ...item, checked:false })))} style={{...S.ghostBtn,borderRadius:8,padding:"7px 10px",fontSize:"0.76em"}}>Reset</button>
                      <button onClick={() => setShoppingItems([])} style={{...S.ghostBtn,color:C.light,borderRadius:8,padding:"7px 10px",fontSize:"0.76em"}}>Clear</button>
                    </div>
                    <div style={{display:"grid",gap:11}}>
                      {RecipeBoxShopping.groupShoppingItemsByCategory(shoppingItems).map((group) => (
                        <div key={group.category}>
                          <div style={{fontSize:"0.68em",letterSpacing:1.8,textTransform:"uppercase",fontWeight:800,color:C.brownLight,margin:"2px 0 6px"}}>{group.category}</div>
                          <div style={{display:"grid",gap:7}}>
                            {group.items.map((item) => (
                              <label key={item.id} style={{display:"flex",alignItems:"center",gap:8,background:item.checked?C.greenPale:C.paper2,border:"1px solid "+(item.checked?C.green+"30":C.border),borderRadius:8,padding:"7px 9px"}}>
                                <input type="checkbox" checked={item.checked} onChange={() => toggleShoppingItem(item.id)} />
                                <input value={item.text} onChange={(e) => editShoppingItem(item.id, e.target.value)}
                                  style={{flex:1,minWidth:0,border:"none",background:"transparent",outline:"none",fontSize:"0.84em",color:item.checked?C.light:C.dark,textDecoration:item.checked?"line-through":"none",fontFamily:SANS}} />
                              </label>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div style={{...S.card,padding:"18px",marginBottom:14,background:`linear-gradient(135deg, ${C.greenPale}, ${C.goldPale})`,border:"1px solid "+C.goldLight}}>
                <div style={{fontFamily:SERIF,fontSize:"1.2em",color:C.dark,marginBottom:5}}>Ready to plan your week?</div>
                <div style={{fontSize:"0.84em",color:C.mid,lineHeight:1.5,marginBottom:recipes.length?14:0}}>{recipes.length ? "Start with a few favorites or quick recipes — RecipeBox builds the shopping list for you." : "Add a few recipes to your RecipeBox first, then plan your week here."}</div>
                {recipes.length > 0 && (
                  <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                    <button onClick={() => openPicker(today, "all")} style={{background:C.green,color:C.white,border:"none",borderRadius:999,padding:"9px 15px",minHeight:38,fontWeight:800,cursor:"pointer",fontSize:"0.8em",fontFamily:SANS,WebkitTapHighlightColor:"transparent",touchAction:"manipulation"}}>Add from RecipeBox</button>
                    <button onClick={() => openPicker(today, "favorites")} style={{background:C.paper,color:C.dark,border:"1px solid "+C.goldLight,borderRadius:999,padding:"9px 15px",minHeight:38,fontWeight:700,cursor:"pointer",fontSize:"0.8em",fontFamily:SANS,WebkitTapHighlightColor:"transparent",touchAction:"manipulation"}}>Favorites</button>
                    <button onClick={() => openPicker(today, "quick")} style={{background:C.paper,color:C.dark,border:"1px solid "+C.goldLight,borderRadius:999,padding:"9px 15px",minHeight:38,fontWeight:700,cursor:"pointer",fontSize:"0.8em",fontFamily:SANS,WebkitTapHighlightColor:"transparent",touchAction:"manipulation"}}>Quick</button>
                  </div>
                )}
              </div>
            )}
            {DAYS.map((day) => {
              const meals = (mealPlan[day]||[]).map((id) => recipes.find((r) => r.id===id)).filter(Boolean);
              const isToday = day===today;
              const empty = meals.length===0;
              return (
                <div key={day} style={{...S.card,padding:empty?"13px 15px":"15px 17px",marginBottom:12,...(isToday?{border:"1px solid "+C.green+"40",boxShadow:"inset 3px 0 0 "+C.green}:{border:"1px solid "+C.border})}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:empty?0:10}}>
                    <div style={{fontWeight:700,color:C.dark,fontSize:"0.92em"}}>{day}</div>
                    {isToday && <Tag label="Today" bg={C.greenPale} color={C.green} />}
                    <div style={{flex:1}} />
                    {!empty && <button onClick={() => openPicker(day)} style={{background:C.greenPale,border:"1px solid "+C.green+"30",borderRadius:8,padding:"6px 12px",color:C.green,fontWeight:800,cursor:"pointer",fontSize:"0.78em",fontFamily:SANS,minHeight:34,WebkitTapHighlightColor:"transparent",touchAction:"manipulation"}}>+ Add</button>}
                  </div>
                  {empty ? (
                    <button onClick={() => openPicker(day)} style={{width:"100%",marginTop:10,background:"transparent",border:"none",padding:0,textAlign:"left",cursor:"pointer",fontFamily:SANS,display:"flex",alignItems:"center",gap:11,WebkitTapHighlightColor:"transparent",touchAction:"manipulation"}}>
                      <span style={{width:38,height:38,borderRadius:10,border:"1.5px dashed "+(isToday?C.green+"66":C.border),color:isToday?C.green:C.light,display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:"1.3em",flexShrink:0}}>+</span>
                      <span style={{flex:1,minWidth:0}}>
                        <span style={{display:"block",fontWeight:700,color:isToday?C.dark:C.mid,fontSize:"0.86em"}}>{isToday ? "What's for dinner tonight?" : "Open night"}</span>
                        <span style={{display:"block",color:C.light,fontSize:"0.76em",marginTop:1}}>{isToday ? "Tap to add a recipe" : "Tap to plan dinner"}</span>
                      </span>
                    </button>
                  ) : (
                    <div style={{display:"grid",gap:8}}>
                      {meals.map((r, i) => {
                        const img = r.heroImage || "";
                        return (
                        <div key={i} className="meal-plan-row">
                          <div style={{width:38,height:38,borderRadius:8,overflow:"hidden",background:img?"#000":cardColor(r.title),display:"flex",alignItems:"center",justifyContent:"center",fontFamily:SERIF,color:"rgba(255,255,255,0.7)",fontSize:"1.05em",flexShrink:0}}>
                            {img ? <img src={img} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}} onError={(e)=>{e.target.style.display="none";e.target.parentNode.textContent=r.title?.[0]||"R";}} /> : (r.title?.[0] || "R")}
                          </div>
                          <div style={{flex:1,minWidth:0}}>
                            <div className="meal-plan-title">{r.title}</div>
                            <div className="meal-plan-meta">
                              {[r.category, r.cookTime, r.macros?.calories>0 ? r.macros.calories+" cal" : ""].filter(Boolean).join(" · ") || "Planned recipe"}
                            </div>
                          </div>
                          <div className="meal-plan-actions">
                            <button onClick={() => onOpen(r)} style={{...S.ghostBtn,borderRadius:7,padding:"7px 11px",fontSize:"0.74em",minHeight:34}}>Open</button>
                            <button onClick={() => { const u={...mealPlan,[day]:(mealPlan[day]||[]).filter((_,j)=>j!==i)}; setMealPlan(u); }} aria-label="Remove" style={{background:"none",border:"none",color:C.light,cursor:"pointer",padding:"5px 7px",fontSize:"1.1em",lineHeight:1,minHeight:34}}>×</button>
                          </div>
                        </div>
                      );})}
                    </div>
                  )}
                </div>
              );
            })}
            {!hasMeals && (
              <div style={{...S.cardSoft,padding:"12px 15px",marginTop:2,display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                <div style={{flex:1,minWidth:160,fontSize:"0.8em",color:C.light,lineHeight:1.45}}>Plan a few meals and RecipeBox will combine the ingredients for you.</div>
                <button disabled style={{background:C.cream3,color:C.light,border:"none",borderRadius:9,padding:"9px 12px",fontWeight:800,cursor:"not-allowed",fontSize:"0.76em",fontFamily:SANS}}>Generate after adding meals</button>
              </div>
            )}
          </div>
          {picking && (
            <div onClick={closePicker} style={{position:"fixed",inset:0,background:"rgba(32,20,14,0.55)",zIndex:50,display:"flex",alignItems:"flex-end",justifyContent:"center"}}>
              <div onClick={(e) => e.stopPropagation()} style={{background:C.paper,border:"1px solid "+C.border,borderRadius:"20px 20px 0 0",width:"100%",maxWidth:600,maxHeight:"78vh",display:"flex",flexDirection:"column"}}>
                <div style={{padding:"18px 20px 12px",borderBottom:"1px solid "+C.border}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
                    <div style={{fontFamily:SERIF,fontSize:"1.15em"}}>Add a recipe to {picking.day}</div>
                    <button onClick={closePicker} style={{background:"none",border:"none",fontSize:"1.4em",cursor:"pointer",color:C.light,minHeight:34,minWidth:34}}>×</button>
                  </div>
                  <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search recipes, tags..." style={{...S.input,width:"100%",padding:"9px 14px",fontSize:"0.9em"}} />
                  <div style={{display:"flex",gap:7,marginTop:10,overflowX:"auto",paddingBottom:2}}>
                    {[["all","All"],["favorites","Favorites"],["recent","Recent"],["quick","Quick"]].map(([f,label]) => (
                      <button key={f} onClick={() => setPickFilter(f)}
                        style={{flexShrink:0,border:"1.5px solid "+(pickFilter===f?C.green:C.border),background:pickFilter===f?C.green:C.paper,color:pickFilter===f?C.white:C.mid,borderRadius:20,padding:"5px 13px",fontSize:"0.76em",fontWeight:700,cursor:"pointer",whiteSpace:"nowrap",fontFamily:SANS,minHeight:32,WebkitTapHighlightColor:"transparent",touchAction:"manipulation"}}>{label}</button>
                    ))}
                  </div>
                </div>
                <div style={{flex:1,overflowY:"auto",WebkitOverflowScrolling:"touch",padding:"8px 12px",paddingBottom:"calc(env(safe-area-inset-bottom, 0px) + 14px)"}}>
                  {pickerRecipes.length === 0 ? (
                    <div style={{textAlign:"center",color:C.light,fontSize:"0.85em",padding:"34px 16px",lineHeight:1.5}}>
                      {recipes.length === 0 ? "Your RecipeBox is empty — add a recipe first." : "No recipes match. Try a different filter or search."}
                    </div>
                  ) : pickerRecipes.map((r) => {
                    const img = r.heroImage || "";
                    return (
                    <div key={r.id} onClick={() => addRecipe(picking.day, r.id)}
                      style={{display:"flex",alignItems:"center",gap:11,padding:"9px 8px",borderRadius:8,cursor:"pointer",borderBottom:"1px solid "+C.cream2,WebkitTapHighlightColor:"transparent",touchAction:"manipulation"}}>
                      <div style={{width:38,height:38,borderRadius:8,overflow:"hidden",background:img?"#000":cardColor(r.title),display:"flex",alignItems:"center",justifyContent:"center",fontFamily:SERIF,color:"rgba(255,255,255,0.55)",fontSize:"1.1em",flexShrink:0}}>
                        {img ? <img src={img} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}} onError={(e)=>{e.target.style.display="none";e.target.parentNode.textContent=r.title?.[0]||"R";}} /> : (r.title?.[0] || "R")}
                      </div>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontWeight:600,fontSize:"0.88em",color:C.dark,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.title}</div>
                        <div style={{fontSize:"0.73em",color:C.light}}>{[r.category, r.cookTime].filter(Boolean).join(" · ")}</div>
                      </div>
                      <span style={{color:C.green,fontSize:"1.2em",flexShrink:0}}>+</span>
                    </div>
                  );})}
                </div>
              </div>
            </div>
          )}
        </div>
      );
    }

    // Combined, source-aware grocery checklist built from one or more recipes
    // (Library multi-select, the weekly meal plan, or a single recipe) plus
    // manual items. Consolidation is deterministic (RecipeBoxShopping); list
    // state (checked / removed / edits / manual) persists in localStorage.
    function itemKey(it) {
      const base = it.parts && it.parts[0] ? it.parts[0].normalized_ingredient_name : it.text;
      return base + "|" + it.category + "|" + (it.combined ? "*" : it.text);
    }
    function sectionsFromRecipes(sourceRecipes) {
      return (sourceRecipes || []).flatMap((r) =>
        (r.sections || []).map((s) => ({
          name: r.title,
          ingredients: (s.ingredients || []).map((i) => ({ ...i, source: { id: r.id, title: r.title } })),
        })),
      );
    }
    function ShoppingListScreen({ list, recipes, onChange, setTab, onOpenRecipe, pantry, onTogglePantry, inHousehold }) {
      const [adding, setAdding] = useState("");
      const [editingKey, setEditingKey] = useState(null);
      const [expanded, setExpanded] = useState(null);
      const [showHave, setShowHave] = useState(false);
      const addRef = useRef(null);
      const pantrySet = new Set(pantry || []);
      const normOf = (text) => { try { return RecipeBoxShopping.normalizeIngredientName(text || ""); } catch { return (text || "").toLowerCase().trim(); } };
      const sourceRecipes = (list.recipeIds || []).map((id) => recipes.find((r) => r.id === id)).filter(Boolean);
      const generated = RecipeBoxShopping.buildShoppingListFromSections(sectionsFromRecipes(sourceRecipes));
      const genItems = generated
        .filter((it) => !list.removed[itemKey(it)])
        .map((it) => { const k = itemKey(it); const normName = (it.parts && it.parts[0] && it.parts[0].normalized_ingredient_name) || normOf(it.text); return { id: k, key: k, text: list.edits[k] != null ? list.edits[k] : it.text, category: it.category, checked: !!list.checked[k], sources: it.sources || [], sourceCount: it.sourceCount || 0, manual: false, normName }; });
      const manualItems = (list.manualItems || []).map((m) => { const k = "m:" + m.id; return { id: k, key: k, text: list.edits[k] != null ? list.edits[k] : m.text, category: m.category || "Pantry", checked: !!list.checked[k], sources: [], sourceCount: 0, manual: true, manualId: m.id, normName: normOf(m.text) }; });
      const allItems = [...genItems, ...manualItems];
      // Pantry-aware: items whose ingredient is a saved staple are set aside as
      // "already have" (excluded from the active checklist) until untracked.
      const haveItems = allItems.filter((i) => i.normName && pantrySet.has(i.normName));
      const activeItems = allItems.filter((i) => !(i.normName && pantrySet.has(i.normName)));
      const total = activeItems.length;
      const done = activeItems.filter((i) => i.checked).length;
      const groups = RecipeBoxShopping.groupShoppingItemsByCategory(activeItems);

      const toggle = (k) => onChange((l) => ({ ...l, checked: { ...l.checked, [k]: !l.checked[k] } }));
      const editText = (k, text) => onChange((l) => ({ ...l, edits: { ...l.edits, [k]: text } }));
      const removeItem = (it) => onChange((l) => it.manual ? { ...l, manualItems: (l.manualItems || []).filter((m) => m.id !== it.manualId) } : { ...l, removed: { ...l.removed, [it.key]: true } });
      const addManual = () => {
        const t = adding.trim(); if (!t) return;
        const id = Date.now() + "-" + Math.random().toString(36).slice(2, 7);
        let category = "Pantry"; try { category = RecipeBoxShopping.parseShoppingIngredient(t).category || "Pantry"; } catch {}
        onChange((l) => ({ ...l, manualItems: [...(l.manualItems || []), { id, text: t, category }] }));
        setAdding("");
      };
      const clearChecked = () => onChange((l) => ({ ...l, checked: {} }));
      const startFresh = () => { if (window.confirm("Clear this whole shopping list?")) onChange(() => emptyShoppingList()); };
      const titleValue = list.title || (sourceRecipes.length ? "Shopping List from " + sourceRecipes.length + " Recipe" + (sourceRecipes.length === 1 ? "" : "s") : "Shopping List");

      async function copyList() {
        const lines = [];
        groups.forEach((g) => { lines.push(g.category.toUpperCase()); g.items.forEach((i) => lines.push((i.checked ? "[x] " : "[ ] ") + i.text)); lines.push(""); });
        const text = titleValue + "\n\n" + lines.join("\n");
        try { await navigator.clipboard.writeText(text); } catch { window.prompt("Copy shopping list:", text); }
      }

      const sourceTitles = sourceRecipes.map((r) => r.title);

      const openSource = (src) => { const r = recipes.find((x) => x.id === src.id); if (r && onOpenRecipe) onOpenRecipe(r); };

      return (
        <div style={{...S.page,paddingBottom:NAV_CLEARANCE}}>
          <div style={{...S.brandHeader,padding:safePad(24,16,16)}}>
            <div style={{maxWidth:760,margin:"0 auto"}}>
              <input value={titleValue} onChange={(e) => onChange((l) => ({ ...l, title: e.target.value }))} aria-label="List title"
                style={{width:"100%",background:"transparent",border:"none",color:C.white,fontFamily:SERIF,fontSize:"1.5em",outline:"none",padding:0,marginBottom:4}} />
              <div style={{color:"rgba(255,249,238,0.82)",fontSize:"0.78em"}}>
                {inHousehold && <span style={{display:"inline-flex",alignItems:"center",gap:4,marginRight:7}}><Icon name="sync" size={12} /> Household list · shared</span>}
                {total > 0 ? done + " of " + total + " checked" : (inHousehold ? "" : "Your shopping list")}
                {sourceTitles.length > 0 && " · from " + sourceTitles.slice(0, 2).join(", ") + (sourceTitles.length > 2 ? " +" + (sourceTitles.length - 2) + " more" : "")}
              </div>
            </div>
          </div>

          <div style={{maxWidth:760,margin:"16px auto",padding:"0 16px"}}>
            <div style={{display:"flex",gap:8,marginBottom:14}}>
              <input ref={addRef} value={adding} onChange={(e) => setAdding(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addManual(); }}
                placeholder="Add an item (e.g. paper towels)…"
                style={{flex:1,minWidth:0,padding:"12px 14px",borderRadius:11,border:"1px solid "+C.border,fontSize:"0.92em",background:C.paper,color:C.dark,outline:"none",fontFamily:SANS}} />
              <button onClick={addManual} style={{...S.goldBtn,borderRadius:11,padding:"12px 18px",fontSize:"0.85em",flexShrink:0}}>Add</button>
            </div>

            {allItems.length === 0 ? (
              <div style={{...S.card,padding:"30px 22px",textAlign:"center"}}>
                <div style={{width:48,height:48,margin:"0 auto 12px",borderRadius:13,background:C.greenPale,color:C.green,display:"inline-flex",alignItems:"center",justifyContent:"center",border:"1px solid "+C.green+"22"}}><Icon name="shoppingList" size={24} /></div>
                <div style={{fontFamily:SERIF,fontSize:"1.2em",color:C.dark,marginBottom:5}}>Your shopping list is empty</div>
                <div style={{color:C.light,fontSize:"0.86em",lineHeight:1.5,marginBottom:16}}>Add recipes from your Library, generate one from your Meal Plan, or add items manually.</div>
                <div style={{display:"flex",gap:8,flexWrap:"wrap",justifyContent:"center"}}>
                  <button onClick={() => addRef.current && addRef.current.focus()} style={{background:C.green,color:C.white,border:"none",borderRadius:999,padding:"10px 18px",fontWeight:800,fontSize:"0.82em",cursor:"pointer",fontFamily:SANS}}>Add item</button>
                  <button onClick={() => setTab("library")} style={{...S.ghostBtn,borderRadius:999,padding:"10px 16px",fontSize:"0.82em"}}>Choose recipes</button>
                  <button onClick={() => setTab("plan")} style={{...S.ghostBtn,borderRadius:999,padding:"10px 16px",fontSize:"0.82em"}}>Go to Meal Plan</button>
                </div>
              </div>
            ) : (
              <>
                {activeItems.length === 0 && (
                  <div style={{...S.card,padding:"22px",textAlign:"center",color:C.light,fontSize:"0.88em",marginBottom:14}}>You already have everything below in your pantry. Nice.</div>
                )}
                {groups.map((group) => {
                  const ordered = [...group.items].sort((a, b) => (a.checked === b.checked ? 0 : a.checked ? 1 : -1));
                  return (
                    <div key={group.category} style={{marginBottom:16}}>
                      <div style={{fontSize:"0.7em",fontWeight:800,letterSpacing:"0.06em",textTransform:"uppercase",color:C.brownLight||C.light,margin:"0 2px 8px"}}>{group.category} <span style={{color:C.light}}>· {group.items.length}</span></div>
                      <div style={{display:"grid",gap:8}}>
                        {ordered.map((item) => {
                          const editing = editingKey === item.key;
                          return (
                          <div key={item.id} style={{background:item.checked?(C.cream2||C.paper2):C.paper,border:"1px solid "+C.border,borderRadius:12,opacity:item.checked?0.62:1,transition:"opacity 0.15s"}}>
                            <div style={{display:"flex",alignItems:"flex-start",gap:11,padding:"11px 12px"}}>
                              {/* Tapping the row (checkbox + name) toggles checked. */}
                              <div onClick={() => { if (!editing) toggle(item.key); }} style={{flex:1,minWidth:0,display:"flex",alignItems:"flex-start",gap:11,cursor:editing?"default":"pointer"}}>
                                <span aria-hidden style={{flexShrink:0,width:27,height:27,borderRadius:8,border:"2px solid "+(item.checked?C.green:C.border),background:item.checked?C.green:"transparent",color:C.white,display:"inline-flex",alignItems:"center",justifyContent:"center",marginTop:1}}>
                                  {item.checked && <Icon name="check" size={15} strokeWidth={3} />}
                                </span>
                                <div style={{flex:1,minWidth:0}}>
                                  {editing ? (
                                    <input autoFocus value={item.text} onChange={(e) => editText(item.key, e.target.value)} onClick={(e) => e.stopPropagation()}
                                      onKeyDown={(e) => { if (e.key === "Enter") setEditingKey(null); }} onBlur={() => setEditingKey(null)}
                                      style={{width:"100%",border:"1px solid "+C.green+"55",borderRadius:7,background:C.paper,outline:"none",fontSize:"0.92em",color:C.dark,fontFamily:SANS,padding:"5px 7px"}} />
                                  ) : (
                                    <span style={{fontSize:"0.92em",color:item.checked?C.light:C.dark,textDecoration:item.checked?"line-through":"none",wordBreak:"break-word"}}>{item.text}</span>
                                  )}
                                  {!item.manual && item.sourceCount > 0 && (
                                    <button onClick={(e) => { e.stopPropagation(); setExpanded(expanded === item.key ? null : item.key); }}
                                      style={{marginTop:3,background:"none",border:"none",padding:0,cursor:"pointer",color:C.brown,fontSize:"0.72em",fontFamily:SANS,display:"inline-flex",alignItems:"center",gap:3}}>
                                      {item.sourceCount > 1 ? "Used in " + item.sourceCount + " recipes" : (item.sources[0]?.title || "1 recipe")}
                                      <span aria-hidden>{expanded === item.key ? "▴" : "▾"}</span>
                                    </button>
                                  )}
                                  {item.manual && <div style={{fontSize:"0.72em",color:C.light,marginTop:3}}>Added by you</div>}
                                </div>
                              </div>
                              <div style={{display:"flex",alignItems:"center",gap:2,flexShrink:0}}>
                                {item.normName && (
                                  <button onClick={() => onTogglePantry(item.normName)} aria-label="I already have this" title="I always keep this on hand"
                                    style={{background:"none",border:"none",color:C.light,cursor:"pointer",padding:"5px 6px",minHeight:32,display:"inline-flex",alignItems:"center"}}>
                                    <Icon name="pantry" size={16} />
                                  </button>
                                )}
                                <button onClick={() => setEditingKey(editing ? null : item.key)} aria-label={editing?"Done editing":"Edit item"}
                                  style={{background:"none",border:"none",color:editing?C.green:C.light,cursor:"pointer",padding:"5px 6px",minHeight:32,display:"inline-flex",alignItems:"center"}}>
                                  <Icon name={editing ? "check" : "edit"} size={16} />
                                </button>
                                <button onClick={() => removeItem(item)} aria-label="Delete item" style={{background:"none",border:"none",color:C.light,cursor:"pointer",fontSize:"1.2em",lineHeight:1,padding:"5px 7px",minHeight:32}}>×</button>
                              </div>
                            </div>
                            {expanded === item.key && !item.manual && item.sources.length > 0 && (
                              <div style={{borderTop:"1px solid "+C.border,padding:"8px 12px 10px",background:C.paper2||C.cream2}}>
                                <div style={{fontSize:"0.68em",fontWeight:800,letterSpacing:"0.05em",textTransform:"uppercase",color:C.light,marginBottom:5}}>From these recipes</div>
                                {item.sources.map((src) => (
                                  <button key={src.id} onClick={() => openSource(src)}
                                    style={{display:"flex",alignItems:"center",justifyContent:"space-between",width:"100%",background:"none",border:"none",padding:"6px 0",cursor:"pointer",fontFamily:SANS,textAlign:"left"}}>
                                    <span style={{fontSize:"0.84em",color:C.green,fontWeight:600}}>{src.title}</span>
                                    <span aria-hidden style={{color:C.light}}>›</span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        );})}
                      </div>
                    </div>
                  );
                })}

                {haveItems.length > 0 && (
                  <div style={{marginTop:8,marginBottom:8,border:"1px solid "+C.border,borderRadius:12,overflow:"hidden"}}>
                    <button onClick={() => setShowHave((v) => !v)} style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,background:C.paper2||C.cream2,border:"none",padding:"11px 13px",cursor:"pointer",fontFamily:SANS}}>
                      <span style={{display:"inline-flex",alignItems:"center",gap:8,color:C.brown,fontWeight:700,fontSize:"0.82em"}}><Icon name="pantry" size={16} /> Already have · {haveItems.length}</span>
                      <span aria-hidden style={{color:C.light}}>{showHave ? "▴" : "▾"}</span>
                    </button>
                    {showHave && (
                      <div style={{padding:"4px 13px 10px"}}>
                        <div style={{fontSize:"0.72em",color:C.light,margin:"4px 0 8px",lineHeight:1.4}}>These are in your pantry staples, so they're left off the list. Tap "Need it" to add one back this time.</div>
                        {haveItems.map((item) => (
                          <div key={item.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,padding:"6px 0",borderTop:"1px solid "+C.border}}>
                            <span style={{fontSize:"0.86em",color:C.mid,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{item.text}</span>
                            <button onClick={() => onTogglePantry(item.normName)} style={{...S.ghostBtn,borderRadius:999,padding:"5px 12px",fontSize:"0.74em",flexShrink:0}}>Need it</button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:6}}>
                  <button onClick={copyList} style={{...S.goldBtn,border:"1px solid "+C.goldLight,borderRadius:10,padding:"9px 14px",fontSize:"0.8em"}}>Copy list</button>
                  {done > 0 && <button onClick={clearChecked} style={{...S.ghostBtn,borderRadius:10,padding:"9px 14px",fontSize:"0.8em"}}>Uncheck all</button>}
                  <button onClick={startFresh} style={{...S.ghostBtn,color:C.light,borderRadius:10,padding:"9px 14px",fontSize:"0.8em"}}>Clear list</button>
                </div>
                <p style={{fontSize:"0.74em",color:C.light,lineHeight:1.5,marginTop:14}}>
                  Tap an item to check it off, or the pantry icon to mark a staple you always keep on hand (it'll stay off future lists). Ingredients are combined conservatively — items that change how a recipe turns out, like different milks, creams, cheeses, or chocolates, are kept separate on purpose.
                </p>
              </>
            )}
          </div>
        </div>
      );
    }

    // Pantry Chef
    function PantryChef({ recipes, onImport, onOpenRecipe }) {
      const [messages, setMessages] = useState([{ role:"assistant", content:"Tell me what you have on hand, or add a pantry photo. I will check your saved recipe cards first, then suggest something new if you need it." }]);
      const [input, setInput] = useState("");
      const [image, setImage] = useState(null);
      const [loading, setLoading] = useState(false);
      const [compactHeader, setCompactHeader] = useState(false);
      const imgRef = useRef();
      const bottomRef = useRef();
      const starters = [
        "What can I make with chicken and rice?",
        "Use up vegetables",
        "Quick dinner under 30 minutes",
        "What can I make from my pantry photo?"
      ];
      const promptCards = [
        { title:"Use what I have", text:"Tell me what's in your fridge or pantry.", prompt:"I want to use what I have in my fridge or pantry." },
        { title:"Check my RecipeBox", text:"Find saved recipe cards that match.", prompt:"Check my RecipeBox for recipes that match what I have." },
        { title:"Quick dinner idea", text:"Get something simple for tonight.", prompt:"Give me a quick, simple dinner idea for tonight." },
      ];

      useEffect(() => { bottomRef.current?.scrollIntoView({ behavior:"smooth" }); }, [messages]);

      async function send(quickText) {
        const promptText = quickText || input;
        if (!promptText.trim() && !image) return;
        const display = image ? (promptText || "Photo sent") : promptText;
        const matches = findPantryMatches(promptText, recipes);
        const savedContext = {
          savedRecipeMatches: matches.map((match) => ({
            title: match.recipe.title,
            status: match.status,
            matchedIngredients: match.matched,
            possibleMissing: match.missing,
          })),
          recipeBoxSummary: pantryRecipeSummary(recipes),
        };
        const contextText =
          "RecipeBox saved recipe context:\n" + JSON.stringify(savedContext) +
          "\n\nUser request:\n" + (promptText || "What can I make from this photo?");
        const userContent = image ? [
          { type:"image", source:{ type:"base64", media_type:image.type, data:image.data } },
          { type:"text", text:contextText }
        ] : contextText;
        setMessages((p) => [...p, { role:"user", content:display }]);
        setInput(""); setImage(null); setLoading(true);
        try {
          const apiMsgs = messages.map((m) => ({ role:m.role, content:m.content }));
          apiMsgs.push({ role:"user", content:userContent });
          const reply = await callAI(apiMsgs, PANTRY_PROMPT, 1600);
          const jm = reply.match(/<RECIPE_JSON>([\s\S]*?)<\/RECIPE_JSON>/);
          const clean = reply.replace(/<RECIPE_JSON>[\s\S]*?<\/RECIPE_JSON>/g,"").trim();
          let draft = null;
          if (jm) {
            try {
              draft = JSON.parse(jm[1].trim());
              draft.id=uid(); draft.createdAt=new Date().toISOString(); draft.rating=0; draft.favorite=false;
              if (!draft.heroImage) draft.heroImage="";
            } catch(e) {}
          }
          setMessages((p) => [...p, { role:"assistant", content:clean || "I found a recipe draft for you.", matches, draft }]);
        } catch(e) { setMessages((p) => [...p, { role:"assistant", content:"Sorry, something went wrong. Try again!" }]); }
        setLoading(false);
      }

      return (
        <div style={{height:PANTRY_NAV_OFFSET,maxHeight:PANTRY_NAV_OFFSET,display:"flex",flexDirection:"column",background:C.cream,overflow:"hidden"}}>
          <PageHeader title="Pantry Chef" subtitle="Ideas from your RecipeBox and what you have on hand" compact={compactHeader} top={16} right={16} bottom={14} />
          <div onScroll={(e) => setCompactHeader(e.currentTarget.scrollTop > 20)} style={{flex:1,minHeight:0,overflowY:"auto",padding:"12px"}}>
            <div style={{maxWidth:680,margin:"0 auto",display:"flex",flexDirection:"column",gap:11}}>
              {messages.map((m, i) => (
                <div key={i} className="fade-up" style={{display:"flex",justifyContent:m.role==="user"?"flex-end":"flex-start"}}>
                  <div style={{maxWidth:"88%",display:"flex",flexDirection:"column",gap:8,alignItems:m.role==="user"?"flex-end":"stretch"}}>
                    <div style={{background:m.role==="user"?C.green:C.paper,color:m.role==="user"?C.white:C.dark,borderRadius:m.role==="user"?"16px 16px 4px 16px":"16px 16px 16px 4px",padding:"10px 14px",fontSize:"0.88em",lineHeight:1.65,boxShadow:"0 6px 18px rgba(90,56,39,0.08)",border:m.role!=="user"?"1px solid "+C.border:"none",whiteSpace:"pre-wrap"}}>{m.content}</div>
                    {m.matches && m.matches.length > 0 && (
                      <div style={{display:"grid",gap:8}}>
                        <div style={{fontSize:"0.68em",letterSpacing:1.4,textTransform:"uppercase",color:C.light,fontWeight:700}}>Recipes from your RecipeBox</div>
                        {m.matches.map((match) => (
                          <button key={match.recipe.id} onClick={() => onOpenRecipe(match.recipe)}
                            style={{...S.cardSoft,display:"flex",alignItems:"center",gap:10,textAlign:"left",padding:"9px 10px",cursor:"pointer",fontFamily:SANS}}>
                            <div style={{width:36,height:36,borderRadius:8,background:cardColor(match.recipe.title),display:"flex",alignItems:"center",justifyContent:"center",fontFamily:SERIF,color:"rgba(255,255,255,0.65)",fontSize:"1.1em",flexShrink:0}}>{match.recipe.title?.[0] || "R"}</div>
                            <div style={{flex:1,minWidth:0}}>
                              <div style={{fontSize:"0.86em",fontWeight:700,color:C.dark,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{match.recipe.title}</div>
                              <div style={{fontSize:"0.72em",color:C.green,fontWeight:700}}>{match.status}</div>
                              {match.missing.length > 0 && <div style={{fontSize:"0.7em",color:C.light,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>Check: {match.missing.join(", ")}</div>}
                            </div>
                            <span style={{color:C.terra,fontSize:"1.1em"}}>›</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {m.draft && (
                      <button onClick={() => onImport(m.draft)}
                        style={{...S.primaryBtn,alignSelf:"flex-start",borderRadius:9,padding:"10px 13px",fontSize:"0.82em"}}>
                        Save "{m.draft.title || "Recipe"}"
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {messages.length <= 1 && !loading && (
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(150px, 1fr))",gap:9,margin:"2px 0 4px"}}>
                  {promptCards.map((card) => (
                    <button key={card.title} onClick={() => send(card.prompt)}
                      style={{...S.cardSoft,background:C.paper,textAlign:"left",padding:"11px 12px",cursor:"pointer",fontFamily:SANS,boxShadow:"0 5px 14px rgba(90,56,39,0.06)"}}>
                      <div style={{fontFamily:SERIF,fontSize:"1.02em",color:C.dark,lineHeight:1.15,marginBottom:4}}>{card.title}</div>
                      <div style={{fontSize:"0.76em",color:C.light,lineHeight:1.35}}>{card.text}</div>
                    </button>
                  ))}
                </div>
              )}
              {loading && <div style={{display:"flex"}}><div style={{...S.cardSoft,borderRadius:"16px 16px 16px 4px",padding:"10px 16px",color:C.light,fontSize:"0.85em"}}>Thinking...</div></div>}
              <div ref={bottomRef} />
            </div>
          </div>
          {messages.length <= 1 && !loading && (
            <div style={{padding:"0 12px 6px",background:C.cream,flexShrink:0}}>
              <div style={{maxWidth:680,margin:"0 auto",display:"flex",gap:7,overflowX:"auto",paddingBottom:4}}>
                {starters.map((starter) => (
                  <button key={starter} onClick={() => send(starter)}
                    style={{whiteSpace:"nowrap",background:C.paper,border:"1px solid "+C.border,borderRadius:20,padding:"7px 11px",fontSize:"0.76em",color:C.brown,cursor:"pointer",fontFamily:SANS,boxShadow:"0 2px 8px rgba(90,56,39,0.06)"}}>
                    {starter}
                  </button>
                ))}
              </div>
            </div>
          )}
          {image && <div style={{textAlign:"center",padding:"3px 0",fontSize:"0.76em",color:C.terra,flexShrink:0}}>Photo ready</div>}
          <div style={{padding:"8px 12px 10px",background:C.paper,borderTop:"1px solid "+C.border,flexShrink:0}}>
            <div style={{maxWidth:680,margin:"0 auto",display:"flex",gap:7,alignItems:"flex-end"}}>
              <input type="file" ref={imgRef} accept="image/*,image/heic,image/heif" onChange={async (e) => { const f=e.target.files[0]; if(!f)return; const b=await fileToBase64(f); setImage(b); }} style={{display:"none"}} />
              <button onClick={() => imgRef.current.click()} style={{background:C.cream2,border:"1px solid "+C.border,borderRadius:9,padding:"10px 12px",cursor:"pointer",fontSize:"1em",flexShrink:0}}>+</button>
              <textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send();} }} placeholder="What do you have? What are you craving?" rows={2} style={{...S.input,flex:1,padding:"9px 12px",fontSize:"0.88em",resize:"none"}} />
              <button onClick={() => send()} disabled={loading||(!input.trim()&&!image)} style={{...S.goldBtn,borderRadius:9,padding:"10px 18px",opacity:loading?0.6:1}}>Send</button>
            </div>
          </div>
        </div>
      );
    }

    function Settings({ timerSound, setTimerSound, account, setAccount, recipes, mealPlan, aiUsage, onCloudData, onOpenAdmin, newFeedback }) {
      const [mode, setMode] = useState("create");
      const [email, setEmail] = useState("");
      const [displayName, setDisplayName] = useState("");
      const [password, setPassword] = useState("");
      const [confirmPassword, setConfirmPassword] = useState("");
      const [syncLocal, setSyncLocal] = useState(() => hasLocalRecipeData(recipes, mealPlan));
      const [deleteConfirm, setDeleteConfirm] = useState("");
      const [deletePassword, setDeletePassword] = useState("");
      const [currentPassword, setCurrentPassword] = useState("");
      const [newPassword, setNewPassword] = useState("");
      const [confirmNewPassword, setConfirmNewPassword] = useState("");
      const [accountMsg, setAccountMsg] = useState("");
      const [accountBusy, setAccountBusy] = useState(false);
      const [verifyState, setVerifyState] = useState("");
      async function resendVerification() {
        setVerifyState("sending");
        try {
          const data = await postJson("/api/auth/resend-verification", {});
          setVerifyState(data.alreadyVerified ? "verified" : (data.sent ? "sent" : "unavailable"));
        } catch { setVerifyState("error"); }
      }
      const [backupMsg, setBackupMsg] = useState("");
      const [tagBusy, setTagBusy] = useState(false);
      const [tagMsg, setTagMsg] = useState("");
      const [feedbackType, setFeedbackType] = useState("bug");
      const [feedbackText, setFeedbackText] = useState("");
      const [feedbackMsg, setFeedbackMsg] = useState("");
      const [feedbackBusy, setFeedbackBusy] = useState(false);
      const [ledger, setLedger] = useState(null);
      const [ledgerOpen, setLedgerOpen] = useState(false);
      const [ledgerLoading, setLedgerLoading] = useState(false);
      async function loadLedger() {
        setLedgerLoading(true);
        try { setLedger(await fetchJson("/api/me/ai-ledger", { entries: [] })); }
        catch { setLedger({ entries: [] }); }
        setLedgerLoading(false);
      }
      function toggleLedger() {
        const open = !ledgerOpen;
        setLedgerOpen(open);
        if (open && !ledger && !ledgerLoading) loadLedger();
      }
      const [credits, setCredits] = useState(null);
      useEffect(() => {
        if (!account) { setCredits(null); return; }
        let alive = true;
        fetchJson("/api/me/credits", null).then((c) => { if (alive && c) setCredits(c); }).catch(() => {});
        return () => { alive = false; };
      }, [account?.id]);
      // Read-only display config (tiers, prices, AI Assist packs). Never trusted
      // for enforcement — the server is always authoritative.
      const [entConfig, setEntConfig] = useState(null);
      useEffect(() => {
        let alive = true;
        fetchJson("/api/config/entitlements", null).then((c) => { if (alive && c) setEntConfig(c); }).catch(() => {});
        return () => { alive = false; };
      }, []);
      function notifyPackComingSoon() {
        try { window.alert("AI Assist packs are coming soon. You'll never be charged without setting up billing first."); } catch {}
      }

      // --- Family / household (M1) ---
      const [household, setHousehold] = useState(null); // { household, role, members, memberCap } | { household:null }
      const [hhBusy, setHhBusy] = useState(false);
      const [hhMsg, setHhMsg] = useState("");
      const [hhName, setHhName] = useState("");
      const [hhJoinCode, setHhJoinCode] = useState("");
      const [hhInvite, setHhInvite] = useState(null); // { code, expiresInDays }
      const refreshHousehold = React.useCallback(() => {
        if (!account) { setHousehold(null); return; }
        fetchJson("/api/household", null).then((h) => setHousehold(h || { household: null })).catch(() => {});
      }, [account?.id]);
      useEffect(() => { refreshHousehold(); }, [refreshHousehold]);
      async function hhAction(fn) {
        setHhBusy(true); setHhMsg("");
        try { await fn(); } catch (e) { setHhMsg(e.message || "Something went wrong."); } finally { setHhBusy(false); }
      }
      const inHousehold = household && household.household;
      const hhRole = household?.role;
      const canInviteRole = (role) => role === "owner" || role === "adult"; // display gate; server enforces

      // --- Founders thank-you offer (beta testers only) ---
      const [founderOffer, setFounderOffer] = useState(null);
      const [convBusy, setConvBusy] = useState(false);
      const [convMsg, setConvMsg] = useState("");
      const loadFounderOffer = React.useCallback(() => {
        if (!account) { setFounderOffer(null); return; }
        fetchJson("/api/me/founder-offer", null).then((o) => setFounderOffer(o)).catch(() => {});
      }, [account?.id]);
      useEffect(() => { loadFounderOffer(); }, [loadFounderOffer]);
      async function chooseConversion(choice, label) {
        if (choice === "free" && !window.confirm("Switch to the Free tier now? You'll get 15 welcome AI Assists, then 5 each month — and leave the unlimited beta.")) return;
        setConvBusy(true); setConvMsg("");
        try {
          await postJson("/api/me/convert", { choice });
          setConvMsg(choice === "free"
            ? "You're on the Free tier now. Thank you for testing RecipeBox!"
            : "Reserved — your " + label + " price is locked in. You'll claim it when paid plans launch; no charge now.");
          loadFounderOffer();
          if (choice === "free") fetchJson("/api/me/credits", null).then((c) => { if (c) setCredits(c); }).catch(() => {});
        } catch (e) { setConvMsg(e.message || "Could not save your choice."); }
        finally { setConvBusy(false); }
      }

      const compactHeader = useWindowCompactHeader();
      const localDataAvailable = hasLocalRecipeData(recipes, mealPlan);
      const importRef = useRef();

      function chooseSound(id) {
        setTimerSound(id);
        saveTimerSound(id);
      }
      async function createAccount() {
        setAccountBusy(true);
        setAccountMsg("");
        try {
          if (password !== confirmPassword) throw new Error("Passwords do not match.");
          const data = await postJson("/api/auth/signup", { email, displayName, password, recipes:syncLocal?recipes:[], mealPlan:syncLocal?mealPlan:{} });
          setAccount(data.user);
          setAccountMsg("Account created. You're signed in.");
          await onCloudData();
        } catch (err) {
          setAccountMsg(err.message || "Could not create account.");
        } finally {
          setAccountBusy(false);
        }
      }
      async function signIn() {
        setAccountBusy(true);
        setAccountMsg("");
        try {
          const data = await postJson("/api/auth/signin", { email, password });
          setAccount(data.user);
          if (syncLocal && localDataAvailable) {
            const migrated = await postJson("/api/auth/migrate", { recipes, mealPlan });
            await onCloudData(migrated.recipes, migrated.mealPlan);
            setAccountMsg("Signed in. This device's recipes were added to your account.");
          } else {
            setAccountMsg("Signed in. Your cloud RecipeBox is loaded.");
            await onCloudData();
          }
        } catch (err) {
          setAccountMsg(err.message || "Could not sign in.");
        } finally {
          setAccountBusy(false);
        }
      }
      async function requestReset() {
        setAccountBusy(true);
        setAccountMsg("");
        try {
          await postJson("/api/auth/request-password-reset", { email });
          setAccountMsg("If that email has a RecipeBox account, a reset link is on the way.");
        } catch (err) {
          setAccountMsg(err.message || "Could not send reset link.");
        } finally {
          setAccountBusy(false);
        }
      }
      async function deleteAccount() {
        if (deleteConfirm !== "DELETE") {
          setAccountMsg("Type DELETE to confirm account deletion.");
          return;
        }
        setAccountBusy(true);
        setAccountMsg("");
        try {
          await postJson("/api/auth/delete-account", { password:deletePassword });
          // Wipe local device copies too (recipes mirror, meal plan, shopping
          // list, pantry staples) so no personal data lingers after deletion.
          try { [RECIPES_KEY, MEALPLAN_KEY, SHOPPING_KEY, PANTRY_KEY].forEach((k) => localStorage.removeItem(k)); } catch {}
          setAccount(null);
          setDeleteConfirm("");
          setDeletePassword("");
          setAccountMsg("Account deleted.");
        } catch (err) {
          setAccountMsg(err.message || "Could not delete account.");
        } finally {
          setAccountBusy(false);
        }
      }
      async function changePassword() {
        setAccountBusy(true);
        setAccountMsg("");
        try {
          if (newPassword !== confirmNewPassword) throw new Error("New passwords do not match.");
          await postJson("/api/auth/change-password", { currentPassword, newPassword });
          setCurrentPassword("");
          setNewPassword("");
          setConfirmNewPassword("");
          setAccountMsg("Password updated. Other signed-in sessions were cleared.");
        } catch (err) {
          setAccountMsg(err.message || "Could not update password.");
        } finally {
          setAccountBusy(false);
        }
      }
      async function signOut() {
        setAccountBusy(true);
        setAccountMsg("");
        try {
          await postJson("/api/auth/signout", {});
          setAccount(null);
          setAccountMsg("Signed out. This device keeps its local recipes.");
        } catch (err) {
          setAccountMsg(err.message || "Could not sign out.");
        } finally {
          setAccountBusy(false);
        }
      }
      async function migrateLocal() {
        setAccountBusy(true);
        setAccountMsg("");
        try {
          const data = await postJson("/api/auth/migrate", { recipes, mealPlan });
          await onCloudData(data.recipes, data.mealPlan);
          setAccountMsg("This device's recipes are synced to your account.");
        } catch (err) {
          setAccountMsg(err.message || "Could not sync recipes.");
        } finally {
          setAccountBusy(false);
        }
      }
      async function sendFeedback() {
        setFeedbackBusy(true);
        setFeedbackMsg("");
        try {
          await postJson("/api/feedback", {
            type: feedbackType,
            message: feedbackText,
            page: "Settings",
            device: navigator.userAgent || "",
            metadata: {
              appVersion: APP_VERSION,
              recipeCount: recipes.length,
              plannedCount: Object.values(mealPlan || {}).flat().length,
              viewport: { width: window.innerWidth, height: window.innerHeight },
            },
          });
          setFeedbackText("");
          setFeedbackMsg("Feedback sent. Thank you.");
        } catch (err) {
          setFeedbackMsg(err.message || "Could not send feedback.");
        } finally {
          setFeedbackBusy(false);
        }
      }
      function backupBase() {
        const stamp = new Date().toISOString().slice(0, 10);
        return { stamp, recipes:Array.isArray(recipes) ? recipes : [], mealPlan:mealPlan && typeof mealPlan === "object" ? mealPlan : {} };
      }
      function exportRecipes() {
        const data = backupBase();
        downloadJson("recipebox-recipes-"+data.stamp+".json", data.recipes);
        setBackupMsg("Recipe cards exported.");
      }
      function exportMealPlan() {
        const data = backupBase();
        downloadJson("recipebox-meal-plan-"+data.stamp+".json", data.mealPlan);
        setBackupMsg("Meal plan exported.");
      }
      function exportBackup() {
        const data = backupBase();
        // Include the local-only data (shopping list + pantry staples) so a full
        // export is genuinely complete. These live only on this device.
        let shoppingList = null, pantryStaples = null;
        try { shoppingList = JSON.parse(localStorage.getItem(SHOPPING_KEY) || "null"); } catch {}
        try { pantryStaples = JSON.parse(localStorage.getItem(PANTRY_KEY) || "null"); } catch {}
        downloadJson("recipebox-backup-"+data.stamp+".json", {
          app:"RecipeBox",
          version:2,
          exportedAt:new Date().toISOString(),
          account: account ? { email: account.email } : null,
          recipes:data.recipes,
          mealPlan:data.mealPlan,
          shoppingList: shoppingList || undefined,
          pantryStaples: Array.isArray(pantryStaples) ? pantryStaples : undefined,
        });
        setBackupMsg("Full RecipeBox backup exported (recipes, tags, meal plan, shopping list, pantry).");
      }
      async function restoreBackup(file) {
        if (!file) return;
        setBackupMsg("");
        try {
          const raw = await file.text();
          const parsed = JSON.parse(raw);
          const nextRecipes = Array.isArray(parsed) ? parsed : Array.isArray(parsed.recipes) ? parsed.recipes : null;
          const nextMealPlan = parsed && typeof parsed === "object" && parsed.mealPlan && typeof parsed.mealPlan === "object" ? parsed.mealPlan : {};
          if (!Array.isArray(nextRecipes)) throw new Error("That file does not look like a RecipeBox backup.");
          const ok = window.confirm("Import this backup and replace the recipes and meal plan on this device"+(account ? " and your signed-in account" : "")+"?");
          if (!ok) return;
          try { localStorage.setItem(RECIPES_KEY, JSON.stringify(recipesForLocal(nextRecipes))); } catch {}
          try { localStorage.setItem(MEALPLAN_KEY, JSON.stringify(nextMealPlan)); } catch {}
          await putJson("/api/recipes", { recipes:nextRecipes });
          await putJson("/api/mealplan", { mealPlan:nextMealPlan });
          await onCloudData(nextRecipes, nextMealPlan);
          setBackupMsg("Backup imported: "+nextRecipes.length+" recipe card"+(nextRecipes.length===1?"":"s")+" restored.");
        } catch (err) {
          setBackupMsg(err.message || "Could not import that backup.");
        } finally {
          if (importRef.current) importRef.current.value = "";
        }
      }
      // One-tap, non-destructive: merge deterministic tag suggestions into every
      // existing recipe. Never removes tags the user added; no AI calls.
      function tagKeySet(tags) {
        return (tags || []).map((t) => RecipeBoxTags.normalizeTagKey(t)).filter(Boolean).sort().join("|");
      }
      async function backfillTags() {
        setTagMsg("");
        const list = Array.isArray(recipes) ? recipes : [];
        if (!list.length) { setTagMsg("No recipes to tag yet — import or add one first."); return; }
        let changed = 0;
        const updated = list.map((r) => {
          const tags = RecipeBoxTags.applyTagsOnCreate(r);
          if (tagKeySet(tags) !== tagKeySet(r.tags)) changed++;
          return { ...r, tags };
        });
        if (!changed) { setTagMsg("Your recipes already have suggested tags — nothing to add."); return; }
        const ok = window.confirm("Suggest tags for your library? This adds tags to " + changed + " recipe" + (changed===1?"":"s") + " and never removes tags you added.");
        if (!ok) return;
        setTagBusy(true);
        try {
          await putJson("/api/recipes", { recipes: updated });
          await onCloudData(updated, mealPlan);
          setTagMsg("Added suggested tags to " + changed + " recipe" + (changed===1?"":"s") + ". Browse them from the Library search and Quick Finds.");
        } catch (err) {
          setTagMsg(err.message || "Could not update tags. Please try again.");
        } finally { setTagBusy(false); }
      }
      const placeholder = [
        { title:"Appearance", text:"RecipeBox display and card preferences coming soon." },
        { title:"Import Preferences", text:"Default cleanup and recipe-card photo options coming soon." },
      ];
      return (
        <div style={{...S.page,paddingBottom:NAV_CLEARANCE}}>
          <PageHeader title="Settings" subtitle="Account, sync, timers, and recipe-box preferences" compact={compactHeader} />
          <div style={{maxWidth:760,margin:"18px auto",padding:"0 16px",display:"grid",gap:14}}>
            <div style={{...S.card,padding:16}}>
              <div style={{fontFamily:SERIF,fontSize:"1.15em",color:C.dark,marginBottom:4}}>RecipeBox Account</div>
              {account ? (
                <div>
                  <div style={{fontSize:"0.86em",color:C.mid,lineHeight:1.5,marginBottom:12}}>
                    Signed in as <strong>{account.email}</strong>. Your recipes and meal plan sync to this account.
                  </div>
                  {account.emailVerified === false && (
                    <div style={{background:C.goldPale,border:"1px solid "+C.goldLight,borderRadius:11,padding:"12px 14px",marginBottom:12}}>
                      <div style={{fontWeight:700,color:C.brown,fontSize:"0.86em",marginBottom:3}}>Confirm your email</div>
                      <div style={{fontSize:"0.8em",color:C.mid,lineHeight:1.45,marginBottom:9}}>We sent a confirmation link to {account.email}. Tap it to confirm your address. {verifyState==="sent" && "Sent — check your inbox."} {verifyState==="verified" && "Already confirmed — refresh the app."} {verifyState==="unavailable" && "Email isn't configured yet; you can keep using RecipeBox."} {verifyState==="error" && "Couldn't send right now — try again shortly."}</div>
                      <button onClick={resendVerification} disabled={verifyState==="sending"} style={{...S.ghostBtn,borderRadius:9,padding:"8px 12px",fontSize:"0.78em",opacity:verifyState==="sending"?0.6:1}}>
                        {verifyState==="sending" ? "Sending…" : "Resend confirmation email"}
                      </button>
                    </div>
                  )}
                  <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                    <button onClick={migrateLocal} disabled={accountBusy} style={{...S.primaryBtn,borderRadius:9,padding:"9px 11px",fontSize:"0.78em",opacity:accountBusy?0.65:1}}>
                      Sync this device
                    </button>
                    <button onClick={signOut} disabled={accountBusy} style={{...S.ghostBtn,borderRadius:9,padding:"9px 11px",fontSize:"0.78em",opacity:accountBusy?0.65:1}}>
                      Sign out
                    </button>
                  </div>
                  <div style={{marginTop:16,paddingTop:14,borderTop:"1px solid "+C.border}}>
                    <div style={{fontFamily:SERIF,fontSize:"1.02em",color:C.dark,marginBottom:4}}>Password</div>
                    <div style={{fontSize:"0.78em",color:C.light,lineHeight:1.45,marginBottom:10}}>Change your password here. New passwords need at least 6 characters.</div>
                    <div style={{display:"grid",gap:8}}>
                      <input type="password" value={currentPassword} onChange={(e)=>setCurrentPassword(e.target.value)} placeholder="Current password"
                        style={{...S.input,width:"100%",padding:"9px 11px",fontSize:"0.84em"}} />
                      <input type="password" value={newPassword} onChange={(e)=>setNewPassword(e.target.value)} placeholder="New password"
                        style={{...S.input,width:"100%",padding:"9px 11px",fontSize:"0.84em"}} />
                      <input type="password" value={confirmNewPassword} onChange={(e)=>setConfirmNewPassword(e.target.value)} placeholder="Confirm new password"
                        style={{...S.input,width:"100%",padding:"9px 11px",fontSize:"0.84em"}} />
                      <button onClick={changePassword} disabled={accountBusy || !currentPassword || !newPassword || !confirmNewPassword}
                        style={{...S.goldBtn,borderRadius:9,padding:"9px 11px",fontSize:"0.78em",opacity:(accountBusy || !currentPassword || !newPassword || !confirmNewPassword)?0.55:1}}>
                        Update Password
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div>
                  <div style={{fontSize:"0.84em",color:C.light,lineHeight:1.5,marginBottom:12}}>Keep your RecipeBox synced with email and password. Apple and Google sign-in are planned for v1.</div>
                  <div style={{display:"flex",gap:7,marginBottom:12}}>
                    {["create","signin","reset"].map((m) => (
                      <button key={m} onClick={() => { setMode(m); setAccountMsg(""); }}
                        style={{background:mode===m?C.green:C.cream2,color:mode===m?C.white:C.mid,border:"1px solid "+(mode===m?C.green:C.border),borderRadius:999,padding:"6px 12px",fontWeight:800,fontSize:"0.76em",fontFamily:SANS,cursor:"pointer"}}>
                        {m==="create" ? "Create account" : m==="signin" ? "Sign in" : "Reset"}
                      </button>
                    ))}
                  </div>
                  <div style={{display:"grid",gap:9}}>
                    <input value={email} onChange={(e)=>setEmail(e.target.value)} placeholder="Email address" inputMode="email" autoCapitalize="none"
                      style={{...S.input,width:"100%",padding:"10px 12px",fontSize:"0.88em"}} />
                    {mode === "reset" ? (
                      <div style={{fontSize:"0.78em",color:C.light,lineHeight:1.45}}>Enter your email and RecipeBox will send a reset link.</div>
                    ) : mode === "create" ? (
                      <>
                        <input value={displayName} onChange={(e)=>setDisplayName(e.target.value)} placeholder="Name (optional)"
                          style={{...S.input,width:"100%",padding:"10px 12px",fontSize:"0.88em"}} />
                        <input type="password" value={password} onChange={(e)=>setPassword(e.target.value)} placeholder="Password"
                          style={{...S.input,width:"100%",padding:"10px 12px",fontSize:"0.88em"}} />
                        <div style={{color:C.light,fontSize:"0.74em",lineHeight:1.35,marginTop:-4}}>At least 6 characters. No special rules.</div>
                        <input type="password" value={confirmPassword} onChange={(e)=>setConfirmPassword(e.target.value)} placeholder="Confirm password"
                          style={{...S.input,width:"100%",padding:"10px 12px",fontSize:"0.88em"}} />
                      </>
                    ) : (
                      <input type="password" value={password} onChange={(e)=>setPassword(e.target.value)} placeholder="Password"
                        style={{...S.input,width:"100%",padding:"10px 12px",fontSize:"0.88em"}} />
                    )}
                    {mode !== "reset" && localDataAvailable && (
                      <label style={{display:"flex",gap:8,alignItems:"flex-start",fontSize:"0.78em",color:C.mid,lineHeight:1.35}}>
                        <input type="checkbox" checked={syncLocal} onChange={(e)=>setSyncLocal(e.target.checked)} style={{marginTop:2}} />
                        Add recipes already on this device to the account.
                      </label>
                    )}
                    <button onClick={mode === "reset" ? requestReset : mode === "create" ? createAccount : signIn} disabled={accountBusy}
                      style={{...S.goldBtn,borderRadius:9,padding:"10px 13px",fontWeight:900,opacity:accountBusy?0.65:1}}>
                      {accountBusy ? "Working..." : mode === "reset" ? "Send Reset Link" : mode === "create" ? "Create Account" : "Sign In"}
                    </button>
                  </div>
                </div>
              )}
              {accountMsg && <div style={{marginTop:12,color:accountMsg.includes("Could not")||accountMsg.includes("did not")?C.red:C.green,fontSize:"0.8em",lineHeight:1.4,fontWeight:700}}>{accountMsg}</div>}
            </div>

            <div style={{...S.card,padding:16}}>
              <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
                <div style={{flex:1}}>
                  <div style={{fontFamily:SERIF,fontSize:"1.15em",color:C.dark}}>Timer Sound</div>
                  <div style={{fontSize:"0.78em",color:C.light}}>Choose what plays when a cooking timer finishes.</div>
                </div>
                <button onClick={() => playTimerSound(timerSound)} style={{...S.goldBtn,border:"1px solid "+C.goldLight,borderRadius:8,padding:"7px 10px",fontSize:"0.76em"}}>Test</button>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(145px, 1fr))",gap:8}}>
                {TIMER_SOUND_OPTIONS.map((option) => {
                  const active = timerSound === option.id;
                  return (
                    <button key={option.id} onClick={() => chooseSound(option.id)}
                      style={{background:active?C.greenPale:C.cream2,border:"1.5px solid "+(active?C.green:C.border),borderRadius:9,padding:"9px 10px",textAlign:"left",color:active?C.green:C.dark,fontWeight:700,cursor:"pointer",fontSize:"0.82em",fontFamily:SANS}}>
                      <span style={{display:"inline-flex",alignItems:"center",gap:6}}>{active && <Icon name="check" size={14} />}{option.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {account && (
              <div style={{...S.card,padding:16}}>
                <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:8}}>
                  <div style={{flex:1}}>
                    <div style={{fontFamily:SERIF,fontSize:"1.15em",color:C.dark}}>AI Assists</div>
                    <div style={{fontSize:"0.78em",color:C.light}}>Spent when AI imports, edits, or plans for you. Cost varies by action.</div>
                  </div>
                  <div style={{fontWeight:900,color:C.green,fontSize:"0.92em"}}>{aiUsage?.unlimited ? "Unlimited" : ((credits && credits.totalRemaining != null ? credits.totalRemaining : (aiUsage?.remaining ?? 0))+" left")}</div>
                </div>
                <div style={{height:9,background:C.cream2,borderRadius:999,overflow:"hidden",border:"1px solid "+C.border}}>
                  <div style={{width:(aiUsage?.unlimited ? "100%" : ((Math.min(aiUsage?.count || 0, aiUsage?.limit || 50) / Math.max(aiUsage?.limit || 50, 1)) * 100)+"%"),height:"100%",background:C.green,borderRadius:999}} />
                </div>
                <div style={{display:"flex",justifyContent:"space-between",gap:8,marginTop:8,fontSize:"0.76em",color:C.light}}>
                  <span>{aiUsage?.unlimited ? "Master Admin unlimited AI access" : (aiUsage?.count || 0)+" of "+(aiUsage?.limit || 5)+" monthly AI Assists used"}</span>
                  <span>{aiUsage?.period || "This month"}</span>
                </div>
                {!aiUsage?.unlimited && (
                  <div style={{marginTop:10,display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,flexWrap:"wrap"}}>
                    <span style={{fontSize:"0.78em",color:C.mid,fontWeight:700}}>Plan: <span style={{color:C.green,textTransform:"capitalize"}}>{credits?.plan || "free"}</span></span>
                    {credits?.monthly?.resetsAt && <span style={{fontSize:"0.74em",color:C.light}}>Renews {new Date(credits.monthly.resetsAt).toLocaleDateString(undefined,{month:"short",day:"numeric"})}</span>}
                  </div>
                )}
                {!aiUsage?.unlimited && (
                  <div style={{marginTop:10,display:"flex",gap:7,flexWrap:"wrap"}}>
                    {[
                      {label:"Monthly",val:credits?.monthly?.remaining ?? (aiUsage?.remaining ?? 0),sub:"renews monthly"},
                      {label:"Bonus",val:credits?.bonusAssists ?? 0,sub:"never expire"},
                      {label:"Purchased",val:credits?.purchasedAssists ?? 0,sub:"never expire"},
                      {label:"Total",val:credits?.totalRemaining ?? (aiUsage?.remaining ?? 0),sub:"available now"},
                    ].map((b) => (
                      <div key={b.label} style={{flex:"1 1 70px",minWidth:70,background:b.label==="Total"?C.greenPale:C.cream2,border:"1px solid "+(b.label==="Total"?C.green+"40":C.border),borderRadius:9,padding:"8px 9px"}}>
                        <div style={{fontWeight:900,fontSize:"1.05em",color:b.label==="Total"?C.green:C.dark}}>{b.val}</div>
                        <div style={{fontSize:"0.66em",color:C.mid,fontWeight:700}}>{b.label}</div>
                        <div style={{fontSize:"0.6em",color:C.light}}>{b.sub}</div>
                      </div>
                    ))}
                  </div>
                )}
                {!aiUsage?.unlimited && (credits?.totalRemaining ?? 1) <= 0 && (
                  <div style={{marginTop:10,background:C.goldPale,border:"1px solid "+C.goldLight,borderRadius:9,padding:"9px 11px",fontSize:"0.76em",color:C.brown,lineHeight:1.5}}>
                    <strong>You're out of AI Assists.</strong> You can wait until your next reset{credits?.monthly?.resetsAt ? " on "+new Date(credits.monthly.resetsAt).toLocaleDateString(undefined,{month:"short",day:"numeric"}) : ""}, or add a pack that never expires.
                  </div>
                )}
                <div style={{marginTop:10,background:C.greenPale,border:"1px solid "+C.green+"30",borderRadius:9,padding:"8px 11px",fontSize:"0.74em",color:C.brown,lineHeight:1.5}}>
                  Behind-the-scenes cleanup or formatting retries are free. A blocked page or a failed action never costs you an AI Assist. Purchased AI Assists never expire.
                </div>
                {!aiUsage?.unlimited && (
                  <div style={{marginTop:10}}>
                    <button onClick={toggleLedger}
                      style={{...S.ghostBtn,borderRadius:8,padding:"8px 12px",fontSize:"0.8em",width:"100%",display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
                      {ledgerOpen ? "Hide recent activity" : "View recent activity"}
                    </button>
                    {ledgerOpen && (
                      <div style={{marginTop:10}}>
                        {ledgerLoading ? (
                          <div style={{textAlign:"center",color:C.light,fontSize:"0.8em",padding:"10px 0"}}>Loading your activity...</div>
                        ) : (ledger?.entries?.length ? (
                          <div style={{display:"flex",flexDirection:"column",gap:6}}>
                            {ledger.entries.map((e, i) => (
                              <div key={i} style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,background:C.cream2,border:"1px solid "+C.border,borderRadius:8,padding:"8px 11px"}}>
                                <div style={{minWidth:0}}>
                                  <div style={{fontWeight:700,color:C.dark,fontSize:"0.82em",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{e.label}</div>
                                  <div style={{color:C.light,fontSize:"0.72em",marginTop:1}}>{formatLedgerDate(e.at)}</div>
                                </div>
                                <span style={{flexShrink:0,fontWeight:800,fontSize:"0.74em",color:e.assists>0?C.brown:C.green}}>
                                  {e.assists>0 ? (e.assists+" AI Assist"+(e.assists>1?"s":"")) : "No charge"}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div style={{textAlign:"center",color:C.light,fontSize:"0.8em",padding:"10px 0"}}>No AI activity yet this account.</div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {!aiUsage?.unlimited && entConfig?.assistPacks && (
                  <div style={{marginTop:12}}>
                    <div style={{fontSize:"0.78em",fontWeight:800,color:C.dark,marginBottom:6}}>Add AI Assists <span style={{fontWeight:600,color:C.light}}>· never expire</span></div>
                    <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
                      {entConfig.assistPacks.map((p) => (
                        <button key={p.id} onClick={notifyPackComingSoon}
                          style={{flex:"1 1 80px",minWidth:80,background:C.cream2,border:"1px solid "+C.border,borderRadius:9,padding:"9px 8px",cursor:"pointer",fontFamily:SANS,textAlign:"center"}}>
                          <div style={{fontWeight:900,color:C.dark,fontSize:"0.92em"}}>{p.assists}</div>
                          <div style={{fontSize:"0.64em",color:C.mid,fontWeight:700,marginBottom:3}}>AI Assists</div>
                          <div style={{fontSize:"0.74em",color:C.green,fontWeight:800}}>${p.price.toFixed(2)}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {!aiUsage?.unlimited && entConfig?.tiers && (
                  <div style={{marginTop:12}}>
                    <div style={{fontSize:"0.78em",fontWeight:800,color:C.dark,marginBottom:6}}>Plans</div>
                    <div style={{display:"flex",flexDirection:"column",gap:7}}>
                      {["free","plus","family"].map((k) => entConfig.tiers[k] && (
                        <div key={k} style={{background:C.cream2,border:"1px solid "+C.border,borderRadius:9,padding:"9px 11px"}}>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",gap:8}}>
                            <span style={{fontWeight:800,color:C.dark,fontSize:"0.86em"}}>{entConfig.tiers[k].name}</span>
                            <span style={{fontSize:"0.74em",color:C.green,fontWeight:800}}>{
                              entConfig.tiers[k].price == null ? "Free"
                                : (entConfig.tiers[k].price.monthly != null ? "$"+entConfig.tiers[k].price.monthly+"/mo · $"+entConfig.tiers[k].price.yearly+"/yr"
                                  : "$"+entConfig.tiers[k].price.yearly+"/yr")
                            }</span>
                          </div>
                          <div style={{fontSize:"0.73em",color:C.mid,lineHeight:1.5,marginTop:3}}>{entConfig.tiers[k].tagline}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{marginTop:8,fontSize:"0.71em",color:C.light,lineHeight:1.5}}>Paid plans and AI Assist packs are coming soon. You'll never be charged without setting up billing first.</div>
                  </div>
                )}
              </div>
            )}

            {account && founderOffer?.eligible && (
              <div style={{...S.card,padding:16,border:"1px solid "+C.goldLight,background:"linear-gradient(160deg,#FFFDF7,"+C.goldPale+")"}}>
                <div style={{fontFamily:SERIF,fontSize:"1.3em",color:C.dark,marginBottom:4}}>Thank you for testing RecipeBox 💛</div>
                <div style={{fontSize:"0.84em",color:C.mid,lineHeight:1.6,marginBottom:13}}>
                  You helped shape this app, and that means the world. As a beta tester you've earned <strong style={{color:C.brown}}>Founders pricing</strong> — locked in for as long as you keep your plan, and only ever offered to early testers like you. Pick what fits, no pressure:
                </div>
                {(() => {
                  const free = founderOffer.freeTier || { name:"Free", price:null };
                  const tiles = [free, ...(founderOffer.options || [])];
                  return (
                    <div style={{display:"flex",flexDirection:"column",gap:9}}>
                      {tiles.map((t) => {
                        const isChosen = founderOffer.choice === t.id;
                        const isFree = t.id === "free";
                        const priceLabel = isFree ? "Free forever" : ("$" + t.price.yearly + "/yr · locked");
                        const assists = isFree ? "15 welcome, then 5/mo" : (t.monthlyAssists + (t.shared ? " shared" : "") + "/mo");
                        return (
                          <div key={t.id} style={{border:"1px solid "+(isChosen?C.green:C.border),background:isChosen?C.greenPale:C.paper,borderRadius:11,padding:"11px 13px"}}>
                            <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",gap:8,flexWrap:"wrap"}}>
                              <span style={{fontWeight:800,color:C.dark,fontSize:"0.92em"}}>{t.name}{t.id==="founder_family" && <span style={{fontSize:"0.72em",color:C.brown,fontWeight:700}}> · up to {t.memberCap} members</span>}</span>
                              <span style={{fontSize:"0.8em",color:C.green,fontWeight:800}}>{priceLabel}</span>
                            </div>
                            <div style={{fontSize:"0.74em",color:C.light,margin:"2px 0 9px"}}>{assists} AI Assists</div>
                            <button disabled={convBusy || isChosen} onClick={() => chooseConversion(t.id, t.name)}
                              style={{width:"100%",background:isChosen?"transparent":(isFree?C.cream2:C.green),border:isChosen?"1px solid "+C.green:"none",borderRadius:9,padding:"9px 12px",color:isChosen?C.green:(isFree?C.dark:C.white),fontWeight:800,fontSize:"0.82em",cursor:(convBusy||isChosen)?"default":"pointer",fontFamily:SANS}}>
                              {isChosen ? "✓ Your choice" : (isFree ? "Switch to Free now" : "Reserve this price")}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
                {convMsg && <div style={{marginTop:11,fontSize:"0.79em",color:C.green,fontWeight:700,lineHeight:1.5}}>{convMsg}</div>}
                <div style={{marginTop:11,fontSize:"0.71em",color:C.light,lineHeight:1.5}}>Founder prices are beta-only and locked forever. You won't be charged now — paid plans aren't live yet; reserving just holds your price. Free takes effect right away. You can change your choice while the offer is open.</div>
              </div>
            )}

            {account && (
              <div style={{...S.card,padding:16}}>
                <div style={{marginBottom:10}}>
                  <div style={{fontFamily:SERIF,fontSize:"1.15em",color:C.dark}}>Household</div>
                  <div style={{fontSize:"0.78em",color:C.light}}>Cook together — share with up to {household?.memberCap || 4} family members (Family plan).</div>
                </div>

                {!inHousehold ? (
                  <div style={{display:"flex",flexDirection:"column",gap:12}}>
                    <div>
                      <div style={{fontSize:"0.78em",fontWeight:800,color:C.dark,marginBottom:6}}>Start a household</div>
                      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                        <input value={hhName} onChange={(e)=>setHhName(e.target.value)} placeholder="Household name (e.g. The Airds)" maxLength={60}
                          style={{flex:"1 1 180px",minWidth:160,padding:"9px 11px",border:"1px solid "+C.border,borderRadius:9,fontSize:"0.85em",outline:"none",fontFamily:SANS}} />
                        <button disabled={hhBusy} onClick={()=>hhAction(async()=>{ const h=await postJson("/api/household/create",{name:hhName}); setHousehold(h); setHhName(""); setHhMsg("Household created. Invite your family below."); })}
                          style={{background:C.green,border:"none",borderRadius:9,padding:"9px 16px",color:C.white,fontWeight:800,fontSize:"0.82em",cursor:hhBusy?"default":"pointer",fontFamily:SANS}}>Create</button>
                      </div>
                    </div>
                    <div style={{borderTop:"1px solid "+C.border,paddingTop:12}}>
                      <div style={{fontSize:"0.78em",fontWeight:800,color:C.dark,marginBottom:6}}>Join with an invite code</div>
                      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                        <input value={hhJoinCode} onChange={(e)=>setHhJoinCode(e.target.value.toUpperCase())} placeholder="XXXX-XXXX" maxLength={12}
                          style={{flex:"1 1 140px",minWidth:120,padding:"9px 11px",border:"1px solid "+C.border,borderRadius:9,fontSize:"0.85em",outline:"none",fontFamily:SANS,letterSpacing:1}} />
                        <button disabled={hhBusy} onClick={()=>hhAction(async()=>{ const h=await postJson("/api/household/join",{code:hhJoinCode}); setHousehold(h); setHhJoinCode(""); setHhMsg("You've joined the household."); })}
                          style={{...S.ghostBtn,borderRadius:9,padding:"9px 16px",fontSize:"0.82em"}}>Join</button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div>
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,flexWrap:"wrap",marginBottom:10}}>
                      <span style={{fontFamily:SERIF,fontSize:"1.05em",color:C.green}}>{household.household.name}</span>
                      <span style={{fontSize:"0.74em",color:C.light}}>{household.members.length} of {household.memberCap} members · you're {hhRole === "owner" ? "the owner" : hhRole}</span>
                    </div>
                    <div style={{display:"flex",flexDirection:"column",gap:7,marginBottom:12}}>
                      {household.members.map((m)=>(
                        <div key={m.userId} style={{display:"flex",alignItems:"center",gap:10,background:C.cream2,border:"1px solid "+C.border,borderRadius:9,padding:"8px 11px"}}>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{fontWeight:700,color:C.dark,fontSize:"0.84em",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{m.displayName || m.email}{m.isYou && <span style={{color:C.light,fontWeight:600}}> (you)</span>}</div>
                            <div style={{fontSize:"0.7em",color:C.light,textTransform:"capitalize"}}>{m.role}</div>
                          </div>
                          {hhRole === "owner" && !m.isYou && m.role !== "owner" && (
                            <button disabled={hhBusy} onClick={()=>hhAction(async()=>{ const h=await postJson("/api/household/remove",{userId:m.userId}); setHousehold(h); })}
                              style={{background:"none",border:"1px solid "+C.border,borderRadius:7,padding:"5px 10px",color:C.red,fontWeight:700,fontSize:"0.72em",cursor:"pointer",fontFamily:SANS}}>Remove</button>
                          )}
                        </div>
                      ))}
                    </div>

                    {hhInvite ? (
                      <div style={{background:C.goldPale,border:"1px solid "+C.goldLight,borderRadius:10,padding:"11px 13px",marginBottom:12}}>
                        <div style={{fontSize:"0.74em",color:C.brown,marginBottom:5}}>Share this code — it works once and expires in {hhInvite.expiresInDays} days:</div>
                        <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                          <span style={{fontFamily:SERIF,fontSize:"1.3em",letterSpacing:2,color:C.dark}}>{hhInvite.code}</span>
                          <button onClick={()=>{ try{navigator.clipboard.writeText(hhInvite.code);setHhMsg("Invite code copied.");}catch{} }}
                            style={{...S.ghostBtn,borderRadius:8,padding:"6px 12px",fontSize:"0.76em"}}>Copy</button>
                          <button onClick={()=>setHhInvite(null)} style={{background:"none",border:"none",color:C.light,fontSize:"0.76em",cursor:"pointer",fontFamily:SANS}}>Done</button>
                        </div>
                      </div>
                    ) : (canInviteRole(hhRole) && household.members.length < household.memberCap && (
                      <button disabled={hhBusy} onClick={()=>hhAction(async()=>{ const inv=await postJson("/api/household/invite",{role:"member"}); setHhInvite(inv); })}
                        style={{background:C.green,border:"none",borderRadius:9,padding:"9px 16px",color:C.white,fontWeight:800,fontSize:"0.82em",cursor:hhBusy?"default":"pointer",fontFamily:SANS,marginBottom:12}}>+ Invite a member</button>
                    ))}

                    <div style={{display:"flex",gap:8,flexWrap:"wrap",borderTop:"1px solid "+C.border,paddingTop:11}}>
                      {hhRole === "owner" ? (
                        <button disabled={hhBusy} onClick={()=>{ if(!window.confirm("Disband this household? Members will be removed. (Their own recipes are not affected.)"))return; hhAction(async()=>{ await postJson("/api/household/disband",{}); setHousehold({household:null}); setHhInvite(null); setHhMsg("Household disbanded."); }); }}
                          style={{background:"none",border:"1px solid "+C.border,borderRadius:8,padding:"7px 13px",color:C.red,fontWeight:700,fontSize:"0.78em",cursor:"pointer",fontFamily:SANS}}>Disband household</button>
                      ) : (
                        <button disabled={hhBusy} onClick={()=>{ if(!window.confirm("Leave this household?"))return; hhAction(async()=>{ await postJson("/api/household/leave",{}); setHousehold({household:null}); setHhMsg("You left the household."); }); }}
                          style={{background:"none",border:"1px solid "+C.border,borderRadius:8,padding:"7px 13px",color:C.red,fontWeight:700,fontSize:"0.78em",cursor:"pointer",fontFamily:SANS}}>Leave household</button>
                      )}
                    </div>
                    <div style={{marginTop:11,fontSize:"0.72em",color:C.light,lineHeight:1.5}}>Shared library, meal plan, shopping list & a shared AI Assist pool are coming next. For now this sets up your family group.</div>
                  </div>
                )}
                {hhMsg && <div style={{marginTop:10,fontSize:"0.78em",color:C.green,fontWeight:700}}>{hhMsg}</div>}
              </div>
            )}

            {account?.isMasterAdmin && (
              <div style={{...S.card,padding:16,border:"1px solid rgba(184,138,43,0.45)",background:"linear-gradient(135deg,#20140e,#2d2119)"}}>
                <div style={{display:"flex",alignItems:"center",gap:12}}>
                  <div style={{width:42,height:42,borderRadius:12,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(216,179,95,0.14)",color:C.goldLight,border:"1px solid rgba(216,179,95,0.25)"}}>
                    <Icon name="lock" size={21} />
                  </div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontFamily:SERIF,fontSize:"1.15em",color:C.white}}>App Control</div>
                    <div style={{fontSize:"0.78em",color:"rgba(255,249,238,0.68)",lineHeight:1.4}}>Master Admin operating brain for rules, prompts, limits, and knowledge.</div>
                  </div>
                  {newFeedback > 0 && (
                    <span style={{flexShrink:0,minWidth:22,height:22,padding:"0 7px",borderRadius:999,background:"#c2402e",color:"#fff",fontSize:"0.72em",fontWeight:900,display:"flex",alignItems:"center",justifyContent:"center",lineHeight:1}}>{newFeedback > 99 ? "99+" : newFeedback}</span>
                  )}
                </div>
                {newFeedback > 0 && (
                  <div style={{marginTop:11,background:"rgba(194,64,46,0.16)",border:"1px solid rgba(194,64,46,0.4)",borderRadius:9,padding:"9px 12px",fontSize:"0.8em",color:"#ffd9d2",fontWeight:700}}>
                    {newFeedback === 1 ? "1 new piece of beta feedback is waiting." : newFeedback + " new pieces of beta feedback are waiting."}
                  </div>
                )}
                <button onClick={onOpenAdmin} style={{...S.goldBtn,width:"100%",marginTop:13,borderRadius:9,padding:"10px 12px",fontSize:"0.82em"}}>
                  {newFeedback > 0 ? "Open App Control · Read feedback" : "Open App Control"}
                </button>
              </div>
            )}

            {placeholder.map((card) => (
              <div key={card.title} style={{...S.card,padding:16}}>
                <div style={{fontFamily:SERIF,fontSize:"1.05em",color:C.dark,marginBottom:4}}>{card.title}</div>
                <div style={{fontSize:"0.82em",color:C.light,lineHeight:1.5}}>{card.text}</div>
              </div>
            ))}

            {account && (
              <div style={{...S.card,padding:16}}>
                <div style={{fontFamily:SERIF,fontSize:"1.15em",color:C.dark,marginBottom:4}}>Beta Feedback</div>
                <div style={{fontSize:"0.82em",color:C.light,lineHeight:1.5,marginBottom:12}}>Send bugs, confusing moments, or ideas straight into App Control for beta tracking.</div>
                <div style={{display:"grid",gap:9}}>
                  <div style={{display:"flex",gap:7,overflowX:"auto",paddingBottom:2}}>
                    {[
                      ["bug","Bug"],
                      ["confusing","Confusing"],
                      ["import","Import"],
                      ["idea","Idea"],
                      ["general","General"],
                    ].map(([id,label]) => (
                      <button key={id} onClick={()=>setFeedbackType(id)}
                        style={{border:"1.5px solid "+(feedbackType===id?C.green:C.border),background:feedbackType===id?C.green:C.paper,color:feedbackType===id?C.white:C.mid,borderRadius:999,padding:"7px 11px",fontSize:"0.76em",fontWeight:800,cursor:"pointer",whiteSpace:"nowrap",fontFamily:SANS}}>
                        {label}
                      </button>
                    ))}
                  </div>
                  <textarea value={feedbackText} onChange={(e)=>setFeedbackText(e.target.value)} placeholder="What happened? What felt off? What would make RecipeBox better?" rows={4}
                    style={{...S.input,width:"100%",padding:"10px 12px",fontSize:"0.86em",resize:"vertical",lineHeight:1.45}} />
                  <button onClick={sendFeedback} disabled={feedbackBusy || feedbackText.trim().length < 8}
                    style={{...S.primaryBtn,borderRadius:9,padding:"10px 12px",fontSize:"0.82em",opacity:(feedbackBusy || feedbackText.trim().length < 8)?0.55:1}}>
                    {feedbackBusy ? "Sending..." : "Send Feedback"}
                  </button>
                  {feedbackMsg && <div style={{color:feedbackMsg.includes("Could not")||feedbackMsg.includes("little more")?C.red:C.green,fontSize:"0.78em",fontWeight:800,lineHeight:1.4}}>{feedbackMsg}</div>}
                </div>
              </div>
            )}

            <div style={{...S.card,padding:16}}>
              <div style={{fontFamily:SERIF,fontSize:"1.15em",color:C.dark,marginBottom:4}}>Tag your library</div>
              <div style={{fontSize:"0.82em",color:C.light,lineHeight:1.5,marginBottom:12}}>Add smart tags (like Copycat, Quick, or Air Fryer) to recipes you saved earlier, so you can filter and browse your whole box. It only adds tags that clearly fit and never removes tags you added.</div>
              <button onClick={backfillTags} disabled={tagBusy} style={{...S.primaryBtn,borderRadius:9,padding:"10px 14px",fontSize:"0.8em",opacity:tagBusy?0.65:1,cursor:tagBusy?"not-allowed":"pointer"}}>
                {tagBusy ? "Tagging your recipes..." : "Suggest tags for my recipes"}
              </button>
              {tagMsg && <div style={{marginTop:10,color:tagMsg.includes("Could not")?C.red:C.green,fontSize:"0.78em",fontWeight:700,lineHeight:1.4}}>{tagMsg}</div>}
            </div>

            <div style={{...S.card,padding:16}}>
              <div style={{fontFamily:SERIF,fontSize:"1.15em",color:C.dark,marginBottom:4}}>Data & Backup</div>
              <div style={{fontSize:"0.82em",color:C.light,lineHeight:1.5,marginBottom:12}}>Keep a local copy of your recipe cards and meal plan. Imports replace your current RecipeBox data after confirmation.</div>
              <input ref={importRef} type="file" accept="application/json,.json" onChange={(e)=>restoreBackup(e.target.files && e.target.files[0])} style={{display:"none"}} />
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(145px, 1fr))",gap:8}}>
                <button onClick={exportBackup} style={{...S.primaryBtn,borderRadius:9,padding:"10px 11px",fontSize:"0.78em"}}>Export Backup</button>
                <button onClick={exportRecipes} style={{...S.ghostBtn,borderRadius:9,padding:"10px 11px",fontSize:"0.78em"}}>Export Recipes</button>
                <button onClick={exportMealPlan} style={{...S.ghostBtn,borderRadius:9,padding:"10px 11px",fontSize:"0.78em"}}>Export Meal Plan</button>
                <button onClick={()=>importRef.current.click()} style={{...S.goldBtn,borderRadius:9,padding:"10px 11px",fontSize:"0.78em"}}>Import Backup</button>
              </div>
              {backupMsg && <div style={{marginTop:10,color:backupMsg.includes("Could not")||backupMsg.includes("does not")?C.red:C.green,fontSize:"0.78em",fontWeight:700,lineHeight:1.4}}>{backupMsg}</div>}
            </div>

            <div style={{...S.card,padding:16}}>
              <div style={{fontFamily:SERIF,fontSize:"1.15em",color:C.dark,marginBottom:4}}>About RecipeBox</div>
              <div style={{fontSize:"0.82em",color:C.mid,lineHeight:1.55}}>RecipeBox is your personal family recipe box: AI-powered import, clean recipe cards, meal planning, Pantry Chef, Cook Mode, timers, and cloud sync for your signed-in devices.</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(120px, 1fr))",gap:8,marginTop:12}}>
                <div style={{...S.cardSoft,padding:"9px 10px"}}><div style={{fontWeight:900,color:C.dark,fontSize:"0.9em"}}>{recipes.length}</div><div style={{fontSize:"0.72em",color:C.light}}>recipe cards</div></div>
                <div style={{...S.cardSoft,padding:"9px 10px"}}><div style={{fontWeight:900,color:C.dark,fontSize:"0.9em"}}>{Object.values(mealPlan || {}).flat().length}</div><div style={{fontSize:"0.72em",color:C.light}}>planned meals</div></div>
                <div style={{...S.cardSoft,padding:"9px 10px"}}><div style={{fontWeight:900,color:C.dark,fontSize:"0.9em"}}>{APP_VERSION}</div><div style={{fontSize:"0.72em",color:C.light}}>app version</div></div>
              </div>
            </div>

            <div style={{...S.card,padding:16}}>
              <div style={{fontFamily:SERIF,fontSize:"1.15em",color:C.dark,marginBottom:4}}>Legal & Support</div>
              <div style={{fontSize:"0.82em",color:C.light,lineHeight:1.5,marginBottom:12}}>Release-ready links for help, privacy, terms, and account deletion.</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(135px, 1fr))",gap:8}}>
                <a href="/support.html" target="_blank" rel="noreferrer" style={{...S.ghostBtn,textDecoration:"none",textAlign:"center",borderRadius:9,padding:"10px 11px",fontSize:"0.78em"}}>Support</a>
                <a href="/privacy.html" target="_blank" rel="noreferrer" style={{...S.ghostBtn,textDecoration:"none",textAlign:"center",borderRadius:9,padding:"10px 11px",fontSize:"0.78em"}}>Privacy</a>
                <a href="/terms.html" target="_blank" rel="noreferrer" style={{...S.ghostBtn,textDecoration:"none",textAlign:"center",borderRadius:9,padding:"10px 11px",fontSize:"0.78em"}}>Terms</a>
                <a href="/delete-account.html" target="_blank" rel="noreferrer" style={{...S.ghostBtn,textDecoration:"none",textAlign:"center",borderRadius:9,padding:"10px 11px",fontSize:"0.78em"}}>Delete Account</a>
              </div>
            </div>

            {account && (
              <div style={{...S.card,padding:16,border:"1px solid "+C.redPale,background:C.paper}}>
                <div style={{fontFamily:SERIF,fontSize:"1.05em",color:C.dark,marginBottom:4}}>Danger Zone</div>
                <div style={{fontWeight:900,color:C.red,fontSize:"0.86em",marginBottom:6}}>Delete account</div>
                <div style={{fontSize:"0.78em",color:C.light,lineHeight:1.45,marginBottom:10}}>This permanently deletes your account, recipes, meal plan, sessions, and usage history from RecipeBox cloud storage, and clears your shopping list and pantry from this device. This can't be undone — export a backup first if you want a copy.</div>
                <div style={{display:"grid",gap:8}}>
                  <input value={deleteConfirm} onChange={(e)=>setDeleteConfirm(e.target.value)} placeholder="Type DELETE"
                    style={{...S.input,width:"100%",padding:"9px 11px",fontSize:"0.84em"}} />
                  <input type="password" value={deletePassword} onChange={(e)=>setDeletePassword(e.target.value)} placeholder="Password"
                    style={{...S.input,width:"100%",padding:"9px 11px",fontSize:"0.84em"}} />
                  <button onClick={deleteAccount} disabled={accountBusy || deleteConfirm !== "DELETE" || !deletePassword}
                    style={{background:C.red,color:C.white,border:"none",borderRadius:8,padding:"9px 11px",fontWeight:900,fontSize:"0.78em",fontFamily:SANS,cursor:"pointer",opacity:(accountBusy || deleteConfirm !== "DELETE" || !deletePassword)?0.55:1}}>
                    Delete my account
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      );
    }

    function emptyAdminDraft() {
      return { title:"", category:"Methodology", useWhen:"", scopeType:"Global", scopeValue:"", appliesToFeatures:[], priority:50, active:true, content:"", sourceOrigin:"RecipeBox" };
    }

    function AppControl({ account, onBack, onFeedbackChange }) {
      const [sources, setSources] = useState([]);
      const [changes, setChanges] = useState([]);
      const [feedback, setFeedback] = useState([]);
      const [feedbackUnread, setFeedbackUnread] = useState(0);
      const [usage, setUsage] = useState(null);
      const [usageLoading, setUsageLoading] = useState(false);
      const [filter, setFilter] = useState("All");
      const [editor, setEditor] = useState(null);
      const [draft, setDraft] = useState(() => emptyAdminDraft());
      const [busy, setBusy] = useState(false);
      const [message, setMessage] = useState("");
      const [section, setSection] = useState("knowledge");
      const [users, setUsers] = useState([]);
      const [userSummary, setUserSummary] = useState({ totalUsers:0, newSignups:0, active7:0, active30:0 });
      const [userSearch, setUserSearch] = useState("");
      const [userTier, setUserTier] = useState("all");
      const dark = { bg:"#11120f", panel:"#1a1714", panel2:"#231d18", line:"rgba(255,249,238,0.12)", text:"#fff9ee", muted:"rgba(255,249,238,0.64)", gold:"#d8b35f", green:"#6fb184", red:"#e0786d" };

      async function loadAdmin() {
        setBusy(true);
        try {
          const [knowledgeData, logData, feedbackData] = await Promise.all([
            fetchJson("/api/admin/knowledge", { sources:[] }),
            fetchJson("/api/admin/change-log", { changes:[] }),
            fetchJson("/api/admin/feedback", { items:[], unread:0 }),
          ]);
          setSources(knowledgeData.sources || []);
          setChanges(logData.changes || []);
          setFeedback(feedbackData.items || []);
          setFeedbackUnread(feedbackData.unread || 0);
          if (onFeedbackChange) onFeedbackChange(feedbackData.unread || 0);
        } catch (err) {
          setMessage(err.message || "Could not load App Control.");
        } finally { setBusy(false); }
      }
      useEffect(() => { loadAdmin(); }, []);
      async function markFeedback(id, status) {
        try {
          await postJson("/api/admin/feedback/" + encodeURIComponent(id) + "/status", { status });
          setFeedback((prev) => {
            const next = prev.map((f) => f.id === id ? { ...f, status } : f);
            const unread = next.filter((f) => f.status === "new").length;
            setFeedbackUnread(unread);
            if (onFeedbackChange) onFeedbackChange(unread);
            return next;
          });
        } catch (err) { setMessage(err.message || "Could not update feedback."); }
      }
      async function loadUsers() {
        setBusy(true);
        try {
          const qs = new URLSearchParams({ search:userSearch, tier:userTier });
          const data = await fetchJson("/api/admin/users?" + qs.toString(), { summary:{}, users:[] });
          setUserSummary(data.summary || {});
          setUsers(data.users || []);
        } catch (err) {
          setMessage(err.message || "Could not load users.");
        } finally { setBusy(false); }
      }
      useEffect(() => {
        if (section !== "users") return;
        const t = setTimeout(loadUsers, 220);
        return () => clearTimeout(t);
      }, [section, userSearch, userTier]);
      async function loadUsage() {
        setUsageLoading(true);
        try { setUsage(await fetchJson("/api/admin/ai-usage-summary", null)); }
        catch (err) { setMessage(err.message || "Could not load usage."); }
        finally { setUsageLoading(false); }
      }
      useEffect(() => { if (section === "usage" && !usage && !usageLoading) loadUsage(); }, [section]);

      const visibleSources = sources.filter((source) => filter === "All" || source.category === filter);
      const chip = (active) => ({ border:"1px solid "+(active?dark.gold:dark.line), background:active?"rgba(216,179,95,0.16)":"rgba(255,249,238,0.04)", color:active?dark.gold:dark.muted, borderRadius:999, padding:"8px 11px", fontSize:"0.76em", fontWeight:900, fontFamily:SANS, cursor:"pointer", whiteSpace:"nowrap" });
      function editSource(source) { setEditor(source.id); setDraft({ ...source, appliesToFeatures:source.appliesToFeatures || [] }); setMessage(""); }
      function newSource() { setEditor("create"); setDraft(emptyAdminDraft()); setMessage(""); }
      function toggleFeature(feature) {
        setDraft((prev) => {
          const list = prev.appliesToFeatures || [];
          return { ...prev, appliesToFeatures:list.includes(feature) ? list.filter((x) => x !== feature) : [...list, feature] };
        });
      }
      async function saveSource() {
        setBusy(true);
        try {
          const payload = { title:draft.title, category:draft.category, useWhen:draft.useWhen, scopeType:draft.scopeType, scopeValue:draft.scopeValue, appliesToFeatures:draft.appliesToFeatures || [], priority:Number(draft.priority || 50), active:!!draft.active, content:draft.content, sourceOrigin:draft.sourceOrigin || "RecipeBox" };
          editor === "create" ? await postJson("/api/admin/knowledge", payload) : await putJson("/api/admin/knowledge/" + encodeURIComponent(editor), payload);
          setEditor(null);
          setMessage("App Control source saved.");
          await loadAdmin();
        } catch (err) {
          setMessage(err.message || "Could not save source.");
        } finally { setBusy(false); }
      }
      async function deactivateSource(source) {
        if (!window.confirm("Deactivate this App Control source?")) return;
        setBusy(true);
        try {
          const res = await apiFetch("/api/admin/knowledge/" + encodeURIComponent(source.id), { method:"DELETE" });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || "Could not deactivate source.");
          setMessage("Source deactivated.");
          await loadAdmin();
        } catch (err) { setMessage(err.message || "Could not deactivate source."); }
        finally { setBusy(false); }
      }
      async function rollback(change) {
        if (!window.confirm("Roll back this App Control change?")) return;
        setBusy(true);
        try {
          await postJson("/api/admin/change-log/" + encodeURIComponent(change.id) + "/rollback", {});
          setMessage("Change rolled back.");
          await loadAdmin();
        } catch (err) { setMessage(err.message || "Could not roll back change."); }
        finally { setBusy(false); }
      }
      async function whatsNextSync() {
        setBusy(true);
        try { await postJson("/api/admin/whatsnext-sync", {}); }
        catch (err) { setMessage(err.message || "WhatsNext sync is not configured yet."); }
        finally { setBusy(false); loadAdmin(); }
      }
      async function changeUserTier(user, plan) {
        setBusy(true);
        try {
          await putJson("/api/admin/users/" + encodeURIComponent(user.id) + "/entitlement", { plan });
          setMessage((user.displayName || user.email || "User") + " moved to " + plan + ".");
          await loadUsers();
        } catch (err) {
          setMessage(err.message || "Could not update user.");
        } finally { setBusy(false); }
      }
      function fmtDate(value) {
        if (!value) return "Never";
        try { return new Date(value).toLocaleDateString(undefined, { month:"short", day:"numeric", year:"numeric" }); } catch { return "Unknown"; }
      }

      return (
        <div className="admin-shell" style={{background:dark.bg,color:dark.text,width:"100%"}}>
          <div style={{position:"sticky",top:0,zIndex:24,background:"linear-gradient(135deg,#11120f,#2a2018)",borderBottom:"1px solid "+dark.line,padding:safePad(18,18,18)}}>
            <div className="admin-header-inner" style={{display:"flex",alignItems:"center",gap:12}}>
              <button onClick={onBack} style={{width:40,height:40,borderRadius:12,border:"1px solid "+dark.line,background:"rgba(255,249,238,0.05)",color:dark.text,cursor:"pointer",fontWeight:900}}>←</button>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:"0.68em",letterSpacing:2,textTransform:"uppercase",color:dark.gold,fontWeight:900}}>Master Admin · {account?.email}</div>
                <div style={{fontFamily:SERIF,fontSize:"clamp(1.8rem, 7vw, 3.2rem)",lineHeight:1}}>App Control</div>
                <div style={{fontSize:"0.84em",color:dark.muted,lineHeight:1.35}}>Plain-English operating rules, knowledge, guardrails, feature behavior, and rollback history.</div>
              </div>
              <button onClick={newSource} style={{...S.goldBtn,borderRadius:10,padding:"10px 12px",fontSize:"0.82em",display:"inline-flex",alignItems:"center",gap:7}}><Icon name="plus" size={16} /> Add Source</button>
            </div>
          </div>

          <div className="admin-content">
            <div style={{display:"flex",gap:8,overflowX:"auto",WebkitOverflowScrolling:"touch",paddingBottom:2}}>
              {[
                ["knowledge","Knowledge"],
                ["users","Users"],
                ["usage","Usage"],
                ["feedback","Feedback"],
              ].map(([id,label]) => (
                <button key={id} onClick={() => setSection(id)} style={{...chip(section === id),padding:"9px 13px",display:"inline-flex",alignItems:"center",gap:7}}>
                  {label}
                  {id === "feedback" && feedbackUnread > 0 && (
                    <span style={{minWidth:18,height:18,padding:"0 5px",borderRadius:999,background:"#c2402e",color:"#fff",fontSize:"0.86em",fontWeight:900,display:"inline-flex",alignItems:"center",justifyContent:"center",lineHeight:1}}>{feedbackUnread > 99 ? "99+" : feedbackUnread}</span>
                  )}
                </button>
              ))}
            </div>

            {section === "knowledge" && <React.Fragment>
            <div className="admin-stats-grid">
              {[["Sources",sources.length],["Active",sources.filter((x)=>x.active).length],["Inactive",sources.filter((x)=>!x.active).length],["Changes",changes.length]].map(([label,value]) => (
                <div key={label} style={{background:dark.panel,border:"1px solid "+dark.line,borderRadius:14,padding:14}}>
                  <div style={{fontSize:"0.72em",textTransform:"uppercase",letterSpacing:1.4,color:dark.muted,fontWeight:800}}>{label}</div>
                  <div style={{fontFamily:SERIF,fontSize:"2em",lineHeight:1}}>{value}</div>
                </div>
              ))}
            </div>

            <div className="admin-panel" style={{background:dark.panel,border:"1px solid "+dark.line,borderRadius:16,padding:14}}>
              <div style={{display:"flex",justifyContent:"space-between",gap:10,marginBottom:12,alignItems:"flex-start",flexWrap:"wrap"}}>
                <div style={{minWidth:0,flex:"1 1 260px"}}><div style={{fontFamily:SERIF,fontSize:"1.4em"}}>Knowledge Base</div><div style={{fontSize:"0.8em",color:dark.muted}}>Schema-validated sources only. No raw code, SQL, HTML, or scripts.</div></div>
                <button onClick={whatsNextSync} disabled={busy} style={{...S.ghostBtn,borderColor:dark.line,background:"rgba(255,249,238,0.04)",color:dark.text,borderRadius:10,padding:"9px 10px",fontSize:"0.78em"}}><Icon name="sync" size={15} /> Sync</button>
              </div>
              <div style={{display:"flex",gap:8,overflowX:"auto",WebkitOverflowScrolling:"touch",paddingBottom:8,marginBottom:8,maxWidth:"100%"}}>
                {APP_CONTROL_CATEGORIES.map((cat) => <button key={cat} onClick={() => setFilter(cat)} style={chip(filter === cat)}>{cat}</button>)}
              </div>
              {message && <div style={{margin:"8px 0 12px",color:message.includes("Could not")||message.includes("required")||message.includes("not configured")?dark.red:dark.green,fontWeight:900,fontSize:"0.82em"}}>{message}</div>}
              <div className="admin-panel-grid">
                {visibleSources.map((source) => (
                  <div key={source.id} className="admin-source-card" style={{background:dark.panel2,border:"1px solid "+(source.active?dark.line:"rgba(224,120,109,0.35)"),borderRadius:14,padding:14,display:"grid",gap:10}}>
                    <div style={{display:"flex",gap:10,alignItems:"flex-start"}}>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontFamily:SERIF,fontSize:"1.18em",lineHeight:1.1}}>{source.title}</div>
                        <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:8}}>
                          <span style={{fontSize:"0.68em",fontWeight:900,color:dark.gold,border:"1px solid rgba(216,179,95,0.28)",borderRadius:999,padding:"4px 7px"}}>{source.category}</span>
                          <span style={{fontSize:"0.68em",fontWeight:900,color:source.active?dark.green:dark.red,border:"1px solid "+(source.active?"rgba(111,177,132,0.35)":"rgba(224,120,109,0.35)"),borderRadius:999,padding:"4px 7px"}}>{source.active?"Active":"Inactive"}</span>
                        </div>
                      </div>
                      <button onClick={() => editSource(source)} style={{background:"rgba(255,249,238,0.05)",border:"1px solid "+dark.line,color:dark.text,borderRadius:9,width:34,height:34,cursor:"pointer"}}><Icon name="edit" size={15} /></button>
                      <button onClick={() => deactivateSource(source)} style={{background:"rgba(224,120,109,0.08)",border:"1px solid rgba(224,120,109,0.3)",color:dark.red,borderRadius:9,width:34,height:34,cursor:"pointer"}}><Icon name="trash" size={15} /></button>
                    </div>
                    <div style={{fontSize:"0.8em",color:dark.muted,lineHeight:1.45}}>{source.useWhen}</div>
                    <div className="admin-source-footer" style={{fontSize:"0.72em",color:"rgba(255,249,238,0.52)"}}><span>{source.scopeType}{source.scopeValue ? ": "+source.scopeValue : ""}</span><span>{(source.content || "").length.toLocaleString()} chars · v{source.version}</span></div>
                  </div>
                ))}
              </div>
            </div>

            <div className="admin-panel" style={{background:dark.panel,border:"1px solid "+dark.line,borderRadius:16,padding:14}}>
              <div style={{fontFamily:SERIF,fontSize:"1.35em",marginBottom:4}}>Change Log / Rollback</div>
              <div style={{fontSize:"0.8em",color:dark.muted,marginBottom:12}}>Every change is logged. Rollback restores the previous validated value.</div>
              <div style={{display:"grid",gap:8}}>
                {changes.slice(0, 14).map((change) => (
                  <div key={change.id} style={{display:"flex",gap:10,alignItems:"center",background:dark.panel2,border:"1px solid "+dark.line,borderRadius:12,padding:10}}>
                    <div style={{flex:1,minWidth:0}}><div style={{fontWeight:900,fontSize:"0.82em"}}>{change.action} <span style={{color:dark.muted,fontWeight:600}}>· {change.sourceId}</span></div><div style={{fontSize:"0.72em",color:dark.muted}}>{new Date(change.changedAt).toLocaleString()} · {change.note || "No note"}</div></div>
                    <button onClick={() => rollback(change)} disabled={!change.previousValue || busy} style={{...S.ghostBtn,borderRadius:9,padding:"8px 9px",fontSize:"0.72em",opacity:!change.previousValue?0.4:1}}>Rollback</button>
                  </div>
                ))}
              </div>
            </div>
            </React.Fragment>}

            {section === "users" && (
              <div style={{display:"grid",gap:14}}>
                <div className="admin-stats-grid">
                  {[["Total Users",userSummary.totalUsers||0],["New Signups",userSummary.newSignups||0],["Active 7 Days",userSummary.active7||0],["Active 30 Days",userSummary.active30||0]].map(([label,value]) => (
                    <div key={label} style={{background:dark.panel,border:"1px solid "+dark.line,borderRadius:14,padding:14,minWidth:0}}>
                      <div style={{fontSize:"0.72em",textTransform:"uppercase",letterSpacing:1.4,color:dark.muted,fontWeight:800}}>{label}</div>
                      <div style={{fontFamily:SERIF,fontSize:"2em",lineHeight:1}}>{value}</div>
                    </div>
                  ))}
                </div>
                <div className="admin-panel" style={{background:dark.panel,border:"1px solid "+dark.line,borderRadius:16,padding:14,display:"grid",gap:12}}>
                  <div style={{display:"flex",gap:10,alignItems:"flex-end",flexWrap:"wrap"}}>
                    <div style={{flex:"1 1 240px",minWidth:0}}>
                      <div style={{fontFamily:SERIF,fontSize:"1.4em"}}>Users</div>
                      <div style={{fontSize:"0.8em",color:dark.muted}}>Beta management, activity, storage, and account tiers.</div>
                    </div>
                    <input value={userSearch} onChange={(e)=>setUserSearch(e.target.value)} placeholder="Search name or email" style={{...S.input,padding:"10px 12px",background:"#fff9ee",minWidth:0,flex:"1 1 220px"}} />
                    <select value={userTier} onChange={(e)=>setUserTier(e.target.value)} style={{...S.input,padding:"10px 12px",background:"#fff9ee",flex:"0 1 160px"}}>
                      <option value="all">All tiers</option>
                      <option value="free">Free</option>
                      <option value="beta">Beta</option>
                      <option value="plus">Plus</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>
                  {message && <div style={{color:message.includes("Could not")||message.includes("required")?dark.red:dark.green,fontWeight:900,fontSize:"0.82em"}}>{message}</div>}
                  <div style={{display:"grid",gap:9}}>
                    {users.map((user) => (
                      <div key={user.id} className="admin-user-row" style={{background:dark.panel2,border:"1px solid "+dark.line,borderRadius:13,padding:12,minWidth:0}}>
                        <div style={{minWidth:0}}>
                          <div style={{fontWeight:900,color:dark.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{user.displayName || "Unnamed user"}</div>
                          <div style={{fontSize:"0.78em",color:dark.muted,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{user.email}</div>
                          <div style={{fontSize:"0.72em",color:"rgba(255,249,238,0.48)",marginTop:4}}>Joined {fmtDate(user.createdAt)} · Active {fmtDate(user.lastActiveAt)}</div>
                        </div>
                        <div style={{display:"flex",gap:6,flexWrap:"wrap",fontSize:"0.72em",color:dark.muted}}>
                          <span style={{border:"1px solid rgba(216,179,95,0.3)",borderRadius:999,padding:"4px 7px",color:dark.gold,fontWeight:900}}>{user.tier}</span>
                          <span>{user.recipeCount} recipes</span>
                          <span>{user.plannedCount} planned</span>
                          <span>{user.aiUsageCount} AI calls</span>
                          <span>{user.importCount} imports</span>
                          {user.repairCount > 0 && <span>{user.repairCount} repair</span>}
                          {user.failedAiCount > 0 && <span>{user.failedAiCount} failed</span>}
                          <span style={{color:dark.gold}}>${(user.providerCostUsd || 0).toFixed(2)} cost</span>
                        </div>
                        <div style={{display:"flex",gap:8,alignItems:"center",justifyContent:"flex-end",flexWrap:"wrap"}}>
                          {user.role === "master_admin" ? (
                            <span style={{fontSize:"0.78em",color:dark.gold,fontWeight:900}}>Master Admin</span>
                          ) : (
                            <select value={["free","beta","plus"].includes(user.tier) ? user.tier : "beta"} onChange={(e)=>changeUserTier(user, e.target.value)} disabled={busy} style={{...S.input,padding:"8px 10px",background:"#fff9ee",minWidth:110}}>
                              <option value="free">Free</option>
                              <option value="beta">Beta</option>
                              <option value="plus">Plus</option>
                            </select>
                          )}
                          <button disabled style={{...S.ghostBtn,borderColor:dark.line,background:"rgba(255,249,238,0.04)",color:dark.muted,borderRadius:9,padding:"8px 9px",fontSize:"0.72em",opacity:0.58,cursor:"not-allowed"}}>Disable later</button>
                        </div>
                      </div>
                    ))}
                    {!users.length && <div style={{padding:18,textAlign:"center",color:dark.muted}}>No users match those filters.</div>}
                  </div>
                </div>
              </div>
            )}

            {section === "usage" && (() => {
              const map = {};
              (usage?.daily || []).forEach((d) => { map[d.day] = d; });
              const days14 = [];
              for (let i = 13; i >= 0; i--) {
                const dt = new Date(Date.now() - i * 86400000);
                const key = dt.toISOString().slice(0, 10);
                const e = map[key];
                days14.push({ key, label: String(dt.getUTCDate()), billable: e ? e.billable : 0 });
              }
              const maxDay = Math.max(1, ...days14.map((d) => d.billable));
              const t = usage?.totals || {};
              const at = usage?.allTime || {};
              const per = usage?.perUser || {};
              const usd = (n) => "$" + Number(n || 0).toFixed(2);
              return (
                <div style={{display:"grid",gap:14}}>
                  {usageLoading && !usage ? (
                    <div style={{textAlign:"center",color:dark.muted,padding:24}}>Loading usage…</div>
                  ) : (
                    <React.Fragment>
                      <div className="admin-stats-grid">
                        {[["Billable actions (30d)", t.billable || 0], ["Provider cost (30d)", usd(t.cost)], ["Failed (30d)", t.failed || 0], ["All-time cost", usd(at.cost)]].map(([label, value]) => (
                          <div key={label} style={{background:dark.panel,border:"1px solid "+dark.line,borderRadius:14,padding:14,minWidth:0}}>
                            <div style={{fontSize:"0.72em",textTransform:"uppercase",letterSpacing:1.4,color:dark.muted,fontWeight:800}}>{label}</div>
                            <div style={{fontFamily:SERIF,fontSize:"1.9em",lineHeight:1.1}}>{value}</div>
                          </div>
                        ))}
                      </div>

                      <div className="admin-panel" style={{background:dark.panel,border:"1px solid "+dark.line,borderRadius:16,padding:14,display:"grid",gap:6}}>
                        <div style={{fontFamily:SERIF,fontSize:"1.3em"}}>AI Assist tuning ({usage?.period})</div>
                        <div style={{fontSize:"0.84em",color:dark.muted,lineHeight:1.5}}>
                          This month {per.activeUsers || 0} user{(per.activeUsers === 1 ? "" : "s")} used AI. Average <strong style={{color:dark.text}}>{Number(per.avgBillable || 0).toFixed(1)}</strong> billable actions each; heaviest used <strong style={{color:dark.text}}>{per.maxBillable || 0}</strong>. Compare against the monthly AI Assist allowances: <span style={{color:dark.gold}}>Free 5 (+15 welcome) · Plus 250 · Family 600 · Founder 300</span>. Cost varies by action (import 1 · adjust 2 · Pantry Chef 2 · meal plan 4). Beta is unlimited until launch.
                        </div>
                      </div>

                      <div className="admin-panel" style={{background:dark.panel,border:"1px solid "+dark.line,borderRadius:16,padding:14}}>
                        <div style={{fontFamily:SERIF,fontSize:"1.2em",marginBottom:12}}>Daily AI actions (14 days)</div>
                        <div style={{display:"flex",alignItems:"flex-end",gap:4,height:110}}>
                          {days14.map((d) => (
                            <div key={d.key} title={d.key + ": " + d.billable} style={{flex:1,minWidth:0,display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
                              <div style={{width:"100%",height:Math.round((d.billable / maxDay) * 84) + 2,background:d.billable ? dark.green : "rgba(255,249,238,0.12)",borderRadius:3}} />
                              <span style={{fontSize:"0.6em",color:dark.muted}}>{d.label}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="admin-panel" style={{background:dark.panel,border:"1px solid "+dark.line,borderRadius:16,padding:14,display:"grid",gap:10}}>
                        <div style={{fontFamily:SERIF,fontSize:"1.2em"}}>By feature (30 days)</div>
                        {(usage?.byFeature || []).map((f) => (
                          <div key={f.feature} style={{display:"flex",justifyContent:"space-between",gap:10,fontSize:"0.84em",color:dark.text,borderBottom:"1px solid "+dark.line,paddingBottom:6}}>
                            <span style={{textTransform:"capitalize"}}>{f.feature}{f.feature === "repair" ? " (free)" : ""}</span>
                            <span style={{color:dark.muted}}>{f.calls} calls · {usd(f.cost)}</span>
                          </div>
                        ))}
                        {!(usage?.byFeature || []).length && <div style={{color:dark.muted,fontSize:"0.84em"}}>No AI activity in the last 30 days.</div>}
                      </div>

                      <div className="admin-panel" style={{background:dark.panel,border:"1px solid "+dark.line,borderRadius:16,padding:14,display:"grid",gap:9}}>
                        <div style={{fontFamily:SERIF,fontSize:"1.2em"}}>Heaviest users ({usage?.period})</div>
                        {(usage?.topUsers || []).map((u, i) => (
                          <div key={i} style={{display:"flex",justifyContent:"space-between",gap:10,fontSize:"0.84em"}}>
                            <span style={{color:dark.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{u.displayName || u.email || "Unknown"}</span>
                            <span style={{color:dark.muted,whiteSpace:"nowrap"}}>{u.billable} assists · {usd(u.cost)}</span>
                          </div>
                        ))}
                        {!(usage?.topUsers || []).length && <div style={{color:dark.muted,fontSize:"0.84em"}}>No AI usage yet this month.</div>}
                      </div>
                    </React.Fragment>
                  )}
                </div>
              );
            })()}

            {section === "feedback" && (
              <div style={{display:"grid",gap:14}}>
                <div className="admin-stats-grid">
                  {[["New",feedbackUnread],["Total",feedback.length]].map(([label,value]) => (
                    <div key={label} style={{background:dark.panel,border:"1px solid "+dark.line,borderRadius:14,padding:14,minWidth:0}}>
                      <div style={{fontSize:"0.72em",textTransform:"uppercase",letterSpacing:1.4,color:dark.muted,fontWeight:800}}>{label}</div>
                      <div style={{fontFamily:SERIF,fontSize:"2em",lineHeight:1,color:label==="New"&&value>0?dark.red:dark.text}}>{value}</div>
                    </div>
                  ))}
                </div>
                <div className="admin-panel" style={{background:dark.panel,border:"1px solid "+dark.line,borderRadius:16,padding:14,display:"grid",gap:12}}>
                  <div style={{minWidth:0}}>
                    <div style={{fontFamily:SERIF,fontSize:"1.4em"}}>Beta Feedback</div>
                    <div style={{fontSize:"0.8em",color:dark.muted}}>What beta users sent from Settings. Only you can see this.</div>
                  </div>
                  {message && <div style={{color:message.includes("Could not")?dark.red:dark.green,fontWeight:900,fontSize:"0.82em"}}>{message}</div>}
                  <div style={{display:"grid",gap:9}}>
                    {feedback.map((f) => (
                      <div key={f.id} style={{background:dark.panel2,border:"1px solid "+(f.status==="new"?"rgba(224,120,109,0.45)":dark.line),borderRadius:13,padding:13,display:"grid",gap:8,minWidth:0}}>
                        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                          <span style={{border:"1px solid rgba(216,179,95,0.3)",borderRadius:999,padding:"3px 9px",color:dark.gold,fontWeight:900,fontSize:"0.72em",textTransform:"capitalize"}}>{f.type}</span>
                          {f.status==="new" && <span style={{borderRadius:999,padding:"3px 9px",background:"#c2402e",color:"#fff",fontWeight:900,fontSize:"0.7em"}}>NEW</span>}
                          <span style={{fontSize:"0.74em",color:dark.muted,marginLeft:"auto"}}>{fmtDate(f.createdAt)}</span>
                        </div>
                        <div style={{color:dark.text,fontSize:"0.9em",lineHeight:1.5,whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{f.message}</div>
                        <div style={{fontSize:"0.72em",color:dark.muted,overflowWrap:"anywhere"}}>
                          {(f.displayName || "Unnamed") + (f.email ? " · " + f.email : "")}{f.page ? " · " + f.page : ""}{f.device ? " · " + f.device : ""}
                        </div>
                        <div style={{display:"flex",justifyContent:"flex-end"}}>
                          {f.status==="new"
                            ? <button onClick={() => markFeedback(f.id, "reviewed")} style={{...S.goldBtn,borderRadius:9,padding:"8px 13px",fontSize:"0.76em"}}>Mark reviewed</button>
                            : <button onClick={() => markFeedback(f.id, "new")} style={{...S.ghostBtn,borderColor:dark.line,background:"rgba(255,249,238,0.04)",color:dark.muted,borderRadius:9,padding:"8px 13px",fontSize:"0.76em"}}>Mark unread</button>}
                        </div>
                      </div>
                    ))}
                    {!feedback.length && <div style={{padding:18,textAlign:"center",color:dark.muted}}>No feedback yet. When beta users send notes from Settings, they show up here.</div>}
                  </div>
                </div>
              </div>
            )}
          </div>

          {editor && (
            <div className="modal-overlay" style={{alignItems:"flex-start",justifyContent:"center",overflowY:"auto",overflowX:"hidden",padding:"max(12px, env(safe-area-inset-top)) 12px max(18px, env(safe-area-inset-bottom))"}}>
              <div className="modal-box" style={{width:"min(760px, 100%)",maxWidth:"100%",maxHeight:"calc(100dvh - 24px)",overflowY:"auto",overflowX:"hidden",margin:"0 auto",background:dark.panel,color:dark.text,border:"1px solid "+dark.line,borderRadius:18,alignSelf:"flex-start"}}>
                <div style={{padding:18,borderBottom:"1px solid "+dark.line,display:"flex",alignItems:"center",gap:10}}>
                  <div style={{flex:1}}><div style={{fontFamily:SERIF,fontSize:"1.45em"}}>{editor === "create" ? "Add Knowledge Source" : "Edit Knowledge Source"}</div><div style={{fontSize:"0.78em",color:dark.muted}}>Typed fields only. Invalid values are rejected server-side.</div></div>
                  <button onClick={() => setEditor(null)} style={{background:"none",border:"none",color:dark.text,cursor:"pointer"}}><Icon name="close" /></button>
                </div>
                <div style={{padding:18,display:"grid",gap:12}}>
                  <input value={draft.title || ""} onChange={(e)=>setDraft({...draft,title:e.target.value})} placeholder="Title" style={{...S.input,padding:12,background:"#fff9ee",width:"100%"}} />
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(min(180px, 100%), 1fr))",gap:10}}>
                    <select value={draft.category || "Methodology"} onChange={(e)=>setDraft({...draft,category:e.target.value})} style={{...S.input,padding:12,background:"#fff9ee"}}>{APP_CONTROL_CATEGORIES.filter((x)=>x!=="All").map((cat)=><option key={cat}>{cat}</option>)}</select>
                    <select value={draft.scopeType || "Global"} onChange={(e)=>setDraft({...draft,scopeType:e.target.value,scopeValue:e.target.value==="Global"?"":draft.scopeValue})} style={{...S.input,padding:12,background:"#fff9ee"}}>{APP_CONTROL_SCOPE_TYPES.map((scope)=><option key={scope}>{scope}</option>)}</select>
                    {draft.scopeType === "Feature" ? <select value={draft.scopeValue || ""} onChange={(e)=>setDraft({...draft,scopeValue:e.target.value})} style={{...S.input,padding:12,background:"#fff9ee"}}><option value="">Choose feature</option>{APP_CONTROL_FEATURES.map((feature)=><option key={feature}>{feature}</option>)}</select> : <input value={draft.scopeValue || ""} onChange={(e)=>setDraft({...draft,scopeValue:e.target.value})} placeholder="Scope value" disabled={draft.scopeType==="Global"} style={{...S.input,padding:12,background:"#fff9ee",opacity:draft.scopeType==="Global"?0.6:1}} />}
                  </div>
                  <textarea value={draft.useWhen || ""} onChange={(e)=>setDraft({...draft,useWhen:e.target.value})} placeholder="Use when..." style={{...S.input,padding:12,minHeight:76,background:"#fff9ee",resize:"vertical"}} />
                  <textarea value={draft.content || ""} onChange={(e)=>setDraft({...draft,content:e.target.value})} placeholder="Knowledge / rules / behavior guidance..." style={{...S.input,padding:12,minHeight:220,background:"#fff9ee",resize:"vertical",lineHeight:1.5}} />
                  <div><div style={{fontSize:"0.72em",letterSpacing:1.5,textTransform:"uppercase",color:dark.gold,fontWeight:900,marginBottom:8}}>Applies To Features</div><div style={{display:"flex",gap:7,flexWrap:"wrap",maxWidth:"100%"}}>{APP_CONTROL_FEATURES.map((feature) => <button key={feature} onClick={() => toggleFeature(feature)} style={{...chip((draft.appliesToFeatures || []).includes(feature)),whiteSpace:"normal",textAlign:"left"}}>{feature}</button>)}</div></div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(min(180px, 100%), 1fr))",gap:10}}><input type="number" min="0" max="100" value={draft.priority ?? 50} onChange={(e)=>setDraft({...draft,priority:e.target.value})} style={{...S.input,padding:12,background:"#fff9ee"}} /><label style={{display:"flex",alignItems:"center",gap:9,color:dark.muted,fontSize:"0.86em"}}><input type="checkbox" checked={draft.active !== false} onChange={(e)=>setDraft({...draft,active:e.target.checked})} />Active</label></div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(min(170px, 100%), 1fr))",gap:10}}><button onClick={saveSource} disabled={busy} style={{...S.goldBtn,padding:"12px 14px",borderRadius:10}}>{busy ? "Saving..." : "Save Source"}</button><button onClick={() => setEditor(null)} style={{...S.ghostBtn,padding:"12px 14px",borderRadius:10}}>Cancel</button></div>
                </div>
              </div>
            </div>
          )}
        </div>
      );
    }

    // Import Screen
    function ImportScreen({ onDone, onCancel, initialMode, initialValue }) {
      const startMode = ["url","youtube","social","text","media"].includes(initialMode) ? initialMode : "url";
      const seed = (m) => (startMode === m && initialValue ? initialValue : "");
      const [mode, setMode] = useState(startMode);
      const [url, setUrl] = useState(seed("url"));
      const [ytUrl, setYtUrl] = useState(seed("youtube"));
      const [socialUrl, setSocialUrl] = useState(seed("social"));
      const [text, setText] = useState(seed("text"));
      const [images, setImages] = useState([]);
      const [pdfTexts, setPdfTexts] = useState([]);
      const [pdfImages, setPdfImages] = useState([]);
      const [mediaFiles, setMediaFiles] = useState([]);
      const [loading, setLoading] = useState(false);
      const [loadingMsg, setLoadingMsg] = useState("");
      const [error, setError] = useState("");
      const [recovery, setRecovery] = useState("");
      const [showPhotoPrompt, setShowPhotoPrompt] = useState(false);
      const [showCategoryModal, setShowCategoryModal] = useState(false);
      const [pendingRecipe, setPendingRecipe] = useState(null);
      const [multiRecipe, setMultiRecipe] = useState(null);
      const fileRef = useRef();
      const heroPromptRef = useRef();

      function applyMediaItems(items) {
        const next = items.slice(0, 4);
        const hasPdf = next.some((item) => item.type === "pdf");
        const hasImage = next.some((item) => item.type === "image");
        if (hasPdf && hasImage) {
          throw new Error("Choose either PDF files or photo/image files for one import, not both together.");
        }
        setMediaFiles(next);
        setPdfTexts(next.filter((item) => item.type === "pdf").map((item) => item.pdfText || ""));
        setPdfImages(next.filter((item) => item.type === "pdf").flatMap((item) => item.pdfImages || []));
        setImages(next.filter((item) => item.type === "image").map((item) => item.imageData).filter(Boolean));
      }

      function readyRecipeForSave(recipe, options = {}) {
        const enriched = RecipeBoxShopping.enrichRecipeIngredients(recipe);
        setPendingRecipe(enriched);
        if (enriched.heroImage || options.skipPhotoPrompt) setShowCategoryModal(true);
        else setShowPhotoPrompt(true);
      }

      // Re-runs extraction against the SAME captured source, but focused on a
      // single named recipe (or asking the model to combine variants). This is a
      // fresh paid extraction, which is why the review screen discloses AI Assists.
      function buildFocusedMessages(messages, instruction) {
        return (messages || []).map((m, idx) => {
          if (idx !== 0 || !m || m.role !== "user") return m;
          if (typeof m.content === "string") return { ...m, content: instruction + "\n\n" + m.content };
          if (Array.isArray(m.content)) return { ...m, content: [{ type:"text", text: instruction }, ...m.content] };
          return m;
        });
      }

      function prepImportedRecipe(parsed, heroFallback, originalSource) {
        if (!parsed || parsed.error || !parsed.title || !parsed.sections) return null;
        let recipe = sanitizeImportedRecipe(parsed);
        if (!recipe.heroImage && heroFallback) recipe.heroImage = heroFallback;
        recipe.id = uid();
        recipe.createdAt = new Date().toISOString();
        recipe.rating = 0;
        recipe.favorite = false;
        if (!recipe.heroImage) recipe.heroImage = "";
        if (!recipe.notes) recipe.notes = "";
        if (originalSource) recipe.originalSource = originalSource;
        return recipe;
      }

      async function extractNamedRecipe(ctx, name) {
        const instruction = "The source below contains multiple distinct recipes. Extract ONLY the single recipe titled \"" + name + "\". Ignore every other recipe in the source. Do not merge recipes together. Return one complete recipe as valid JSON, and do NOT return multiple_recipes_detected.";
        const parsed = await callAIExtract(buildFocusedMessages(ctx.messages, instruction), EXTRACT_PROMPT, ctx.maxTokens, { forceRecipe: true });
        return prepImportedRecipe(parsed, ctx.heroFallback, ctx.originalSource);
      }

      async function importChoice(choice) {
        if (!multiRecipe || loading) return;
        const ctx = multiRecipe;
        setError("");
        setLoading(true);
        try {
          if (choice.type === "combined") {
            setLoadingMsg("Combining recipes into one card...");
            const instruction = "The source below contains multiple related recipes or variants. Combine them into ONE recipe card. Keep each component as its own labeled section under \"sections\" (use the component name as the section name). Do not drop any ingredients or steps. Return one complete recipe as valid JSON, and do NOT return multiple_recipes_detected.";
            const parsed = await callAIExtract(buildFocusedMessages(ctx.messages, instruction), EXTRACT_PROMPT, Math.max(ctx.maxTokens, 4000), { forceRecipe: true });
            const recipe = prepImportedRecipe(parsed, ctx.heroFallback, ctx.originalSource);
            if (!recipe) throw new Error("Could not combine these recipes. Try importing one at a time.");
            setMultiRecipe(null);
            readyRecipeForSave(recipe, { skipPhotoPrompt: mode === "media" });
          } else if (choice.type === "all") {
            const recipes = [];
            for (let i = 0; i < ctx.names.length; i++) {
              setLoadingMsg("Extracting recipe " + (i + 1) + " of " + ctx.names.length + "...");
              try {
                const r = await extractNamedRecipe(ctx, ctx.names[i]);
                if (r) recipes.push(r);
              } catch (err) { /* keep the ones that succeed */ }
            }
            if (!recipes.length) throw new Error("Could not extract these recipes separately. Try importing one at a time.");
            setMultiRecipe(null);
            onDone(recipes);
          } else {
            setLoadingMsg("Extracting \"" + choice.name + "\"...");
            const recipe = await extractNamedRecipe(ctx, choice.name);
            if (!recipe) throw new Error("Could not extract \"" + choice.name + "\". Try another recipe from the list.");
            setMultiRecipe(null);
            readyRecipeForSave(recipe, { skipPhotoPrompt: mode === "media" });
          }
        } catch (e) {
          setError(e.message || "Could not import the selected recipe.");
        }
        setLoading(false);
        setLoadingMsg("");
      }

      async function parseImportedRecipe(raw) {
        try {
          return parseAIJson(raw);
        } catch (err) {
          setLoadingMsg("Cleaning up recipe format...");
          const repaired = await callAI([{
            role: "user",
            content:
              "Repair this malformed RecipeBox recipe JSON. Return only valid JSON, with no markdown or explanation.\n\n" +
              raw
          }], REPAIR_JSON_PROMPT, 6000, 0);
          try {
            return parseAIJson(repaired);
          } catch {
            throw new Error("RecipeBox could not read the recipe format. Try Paste Text, or upload a clearer PDF/photo.");
          }
        }
      }

      // Constrained extraction via Anthropic tool use (Phase 2): the model fills a
      // typed recipe schema instead of emitting free-text JSON, so we get valid,
      // complete structures far more reliably and skip the JSON-repair pass.
      // Returns a recipe object or an issue object ({error, recipes, message}) in
      // the same shape the old text path produced. Falls back to text + repair if
      // the model returns text instead of a tool call, so it can never do worse.
      async function callAIExtract(messages, system, maxTokens, opts, _retried) {
        opts = opts || {};
        if (typeof navigator !== "undefined" && navigator.onLine === false) {
          throw new Error("You're offline. Reconnect to use RecipeBox AI — your saved recipes are still available.");
        }
        const requested = maxTokens || 2500;
        const body = {
          model: "claude-sonnet-4-5-20250929",
          max_tokens: requested,
          messages,
          tools: RecipeBoxSchema.EXTRACTION_TOOLS,
          tool_choice: opts.forceRecipe ? RecipeBoxSchema.TOOL_CHOICE_RECIPE : RecipeBoxSchema.TOOL_CHOICE_ANY,
        };
        if (system) body.system = system;
        const res = await apiFetch("/api/ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const data = await res.json();
        if (data.aiUsage) window.dispatchEvent(new CustomEvent("recipebox-ai-usage", { detail: data.aiUsage }));
        if (data.error) throw new Error(typeof data.error === "string" ? data.error : JSON.stringify(data.error));
        // Tool input truncated mid-generation? Retry once with more room.
        if (data.stop_reason === "max_tokens" && !_retried) {
          const bumped = Math.min(Math.max(requested * 2, 4096), 8000);
          if (bumped > requested) return callAIExtract(messages, system, bumped, opts, true);
        }
        const interp = RecipeBoxSchema.interpretToolResponse(data);
        if (interp && interp.recipe) return interp.recipe;
        if (interp && interp.error) return interp;
        // No tool_use — the model returned text. Fall back to the text+repair path.
        const text = RecipeBoxSchema.textContent(data);
        if (text.trim()) return await parseImportedRecipe(text);
        throw new Error("RecipeBox could not read the recipe. Try Paste Text, or upload a clearer photo/PDF.");
      }

      async function extract() {
        setLoading(true);
        setError("");
        setRecovery("");

        try {
          let parsed;
          // Captured so we can re-run extraction against the SAME source if the
          // model reports multiple distinct recipes and the user picks one/all/combined.
          let extractCtx = null;
          // Lightweight copy of the original card/photo/PDF page(s) for media imports.
          let originalSource = null;
          // Source-confidence metadata for thin YouTube/social imports.
          let importSourceQuality = "high";
          let importWarnings = [];
          let importSourceText = "";
          // Whatever raw caption/transcript text we scraped — if auto-extraction
          // comes up thin, we offer it back so the user can finish it as text
          // instead of hitting a dead end.
          let capturedText = "";

          if (mode === "url") {
            setLoadingMsg("Fetching recipe page...");
            const pageRes = await apiFetch("/api/fetch-url?url=" + encodeURIComponent(url));
            const pageData = await pageRes.json();
            if (pageData.error) throw new Error(pageData.error);

            if (pageData.recipe && pageData.extractComplete) {
              // Deterministic structured-data import: the page carried complete
              // schema.org/Recipe (or microdata), so we use it verbatim — as
              // accurate as the publisher's own data, instant, and FREE (no AI,
              // no AI Assist spent).
              setLoadingMsg("Reading structured recipe data...");
              parsed = pageData.recipe;
              if (!parsed.heroImage && pageData.image) parsed.heroImage = pageData.image;
              parsed.sourceUrl = pageData.finalUrl || pageData.url || url;
              parsed.importMethod = "structured-data";
            } else {
              // No usable structured data — fall back to AI, grounding it with any
              // partial deterministic extraction we did get.
              setLoadingMsg("Extracting recipe...");
              const prompt =
                "Extract the recipe ONLY from the source material below. Do not use memory for ingredients, steps, quantities, or times. Do not invent missing ingredients, steps, quantities, times, or notes; if one of those is missing, leave it blank. EXCEPTION: always set realistic servings (use the stated yield, otherwise estimate from the quantities — never default to 4) and always fill per-serving macros (use the source's nutrition if present, otherwise estimate from the ingredients — never leave them 0). Put source-grounded cooking tips, make-ahead/storage/substitution guidance, and directly useful helper links in notes only when they appear in the source. Return only valid JSON.\n\n" +
                "Source URL: " + (pageData.finalUrl || pageData.url || url) + "\n" +
                "Page title: " + (pageData.title || "") + "\n" +
                "Detected hero image: " + (pageData.image || "") + "\n\n" +
                "JSON-LD / structured data:\n" + JSON.stringify(pageData.jsonLd || []) + "\n\n" +
                (pageData.recipe ? "Partial structured recipe (use as the source of truth where present):\n" + JSON.stringify(pageData.recipe) + "\n\n" : "") +
                "Potentially useful source links:\n" + JSON.stringify(pageData.helpfulLinks || []) + "\n\n" +
                "Visible page text:\n" + (pageData.text || "");
              const urlMessages = [{ role:"user", content:prompt }];
              extractCtx = { messages: urlMessages, maxTokens: 4096, heroFallback: pageData.image || "" };
              parsed = await callAIExtract(urlMessages, EXTRACT_PROMPT, 2500);
              if (parsed.error === "unknown_recipe") throw new Error("Recipe not found. Please use Paste Text instead.");
              if (!parsed.heroImage && pageData.image) parsed.heroImage = pageData.image;
              parsed.sourceUrl = pageData.finalUrl || pageData.url || url;
              importSourceText = pageData.text || "";
            }

          } else if (mode === "youtube") {
            setLoadingMsg("Fetching YouTube details...");
            const transcriptRes = await apiFetch("/api/transcript?url=" + encodeURIComponent(ytUrl));
            const transcriptData = await transcriptRes.json();
            if (transcriptData.error) throw new Error("Could not fetch YouTube details: " + transcriptData.error);
            capturedText = [transcriptData.title, transcriptData.description, transcriptData.transcript].filter(Boolean).join("\n\n");
            if (transcriptData.sourceQuality === "low") {
              throw new Error("We couldn't read enough recipe detail from this video. Try pasting the recipe text or using screenshots instead.");
            }

            setLoadingMsg("Extracting recipe from video text...");
            let content = "Video title: " + transcriptData.title + "\n";
            if (transcriptData.author) content += "Video channel/source: " + transcriptData.author + "\n";
            content += "\n";
            // The description is where creators usually paste the full WRITTEN
            // recipe (clean ingredient list + steps), so prefer it as the primary
            // source; the spoken transcript is often scattered/auto-generated and
            // is best used to fill gaps. Send both when available.
            if (transcriptData.description) {
              content += "Video description (usually the written recipe — treat as the primary source):\n" + transcriptData.description + "\n\n";
            }
            if (transcriptData.transcript) {
              content += "Spoken transcript (may be auto-generated and scattered — use to fill in detail the description omits):\n" + transcriptData.transcript;
            }
            if (!transcriptData.description && !transcriptData.transcript) {
              throw new Error("We couldn't read enough recipe detail from this video. Try pasting the recipe text or using screenshots instead.");
            }
            if (transcriptData.thumbnail) {
              content += "\n\nVideo thumbnail URL: " + transcriptData.thumbnail;
            }
            if (transcriptData.warnings?.length) {
              content += "\n\nImporter warnings: " + transcriptData.warnings.join("; ");
            }
            importSourceText = content;
            importSourceQuality = transcriptData.sourceQuality === "good" ? "high" : (transcriptData.sourceQuality || "medium");
            if (transcriptData.sourceUsed && transcriptData.sourceUsed !== "transcript") {
              // No real transcript — built from description/metadata, lower confidence.
              if (importSourceQuality === "high") importSourceQuality = "medium";
              importWarnings.push("Built from the video description, not a full spoken transcript.");
            }
            if (Array.isArray(transcriptData.warnings)) importWarnings = importWarnings.concat(transcriptData.warnings.filter((w) => /transcript|caption/i.test(w)));

            const ytMessages = [{ role:"user", content:"Extract the recipe from this YouTube video content. Use only the description, transcript, and metadata below; prefer the written description when it contains the recipe. Use the exact ingredients the source states — do not substitute one for a more common one (e.g. keep half-and-half, do not write milk or cream). Put helpful source-grounded tips or warnings in notes; do not invent notes from general cooking knowledge. Always set realistic servings (estimate from the quantities if not stated — never default to 4) and always fill per-serving macros (estimate from the ingredients if not stated — never leave them 0). If the video contains multiple full recipe variants, return {\"error\":\"multiple_recipes_detected\",\"recipes\":[\"name 1\",\"name 2\"]} instead of merging them or choosing one silently.\n\n" + content }];
            extractCtx = { messages: ytMessages, maxTokens: 6000, heroFallback: transcriptData.thumbnail || "" };
            parsed = await callAIExtract(ytMessages, EXTRACT_PROMPT, 6000);
            if (parsed.error === "unknown_recipe" || parsed.error === "not_enough_recipe_text") {
              throw new Error("We couldn't read enough recipe detail from this video. Try pasting the recipe text or using screenshots instead.");
            }
            if (!parsed.heroImage && transcriptData.thumbnail) {
              parsed.heroImage = transcriptData.thumbnail;
            }

          } else if (mode === "social") {
            setLoadingMsg("Fetching public social post...");
            const socialRes = await apiFetch("/api/fetch-social?url=" + encodeURIComponent(socialUrl));
            const socialData = await socialRes.json();
            if (socialData.error) {
              throw new Error("RecipeBox could not access the full caption or recipe text from this social post. Try Paste Text with the caption or upload screenshots.");
            }
            const availableText = [
              socialData.caption,
              socialData.description,
              socialData.text,
              socialData.title
            ].filter(Boolean).join("\n\n").trim();
            capturedText = availableText;
            if (availableText.length < 120 || socialData.sourceQuality === "low") {
              throw new Error("RecipeBox could not access the full caption or recipe text from this social post. Try Paste Text with the caption or upload screenshots.");
            }
            importSourceText = [socialData.caption, socialData.description, socialData.text].filter(Boolean).join("\n");
            importSourceQuality = socialData.sourceQuality === "good" ? "high" : (socialData.sourceQuality || "medium");
            if (Array.isArray(socialData.warnings)) importWarnings = importWarnings.concat(socialData.warnings);

            setLoadingMsg("Extracting recipe from social post...");
            const prompt =
              "Extract a recipe ONLY from the public social source data below. Do not use memory. Do not infer a recipe from the title, thumbnail, author, or platform. Do not invent missing ingredients, quantities, steps, times, or notes. Use the EXACT ingredients the caption/text states — never substitute or simplify an ingredient into a more common one (e.g. half-and-half must not become milk or cream). Once the recipe itself is grounded in the source, always set realistic servings (estimate from the quantities — never default to 4) and always fill per-serving macros (estimate from the ingredients when not stated — never leave them 0). Put helpful source-grounded tips in notes only when they appear in the caption or page text. If the source data does not include enough recipe details, return {\"error\":\"not_enough_recipe_text\",\"message\":\"Try Paste Text with the caption or upload screenshots.\"}.\n\n" +
              "Platform: " + (socialData.platform || "") + "\n" +
              "Source URL: " + (socialData.finalUrl || socialData.url || socialUrl) + "\n" +
              "Title: " + (socialData.title || "") + "\n" +
              "Author: " + (socialData.author || "") + "\n" +
              "Caption/description:\n" + (socialData.caption || socialData.description || "") + "\n\n" +
              "Public page text:\n" + (socialData.text || "") + "\n\n" +
              "Detected image/thumbnail URL: " + (socialData.image || socialData.thumbnail || "") + "\n" +
              "Source quality: " + (socialData.sourceQuality || "") + "\n" +
              "Warnings: " + (socialData.warnings || []).join("; ");
            const socialMessages = [{ role:"user", content:prompt }];
            extractCtx = { messages: socialMessages, maxTokens: 4096, heroFallback: socialData.image || socialData.thumbnail || "" };
            parsed = await callAIExtract(socialMessages, EXTRACT_PROMPT, 2500);
            if (parsed.error === "not_enough_recipe_text" || parsed.error === "unknown_recipe") {
              throw new Error(parsed.message || "RecipeBox could not access the full caption or recipe text from this social post. Try Paste Text with the caption or upload screenshots.");
            }
            const socialImage = socialData.image || socialData.thumbnail || "";
            if (!parsed.heroImage && socialImage) parsed.heroImage = socialImage;

          } else if (mode === "text") {
            setLoadingMsg("Extracting recipe...");
            const textMessages = [{ role:"user", content:"Extract the recipe from this text. Put source-grounded tips or extra cooking guidance in notes only when present in the text; do not invent notes. Always set realistic servings (use the stated yield, otherwise estimate from the quantities — never default to 4) and always fill per-serving macros (use stated nutrition if present, otherwise estimate from the ingredients — never leave them 0).\n\n" + text }];
            extractCtx = { messages: textMessages, maxTokens: 4096, heroFallback: "" };
            parsed = await callAIExtract(textMessages, EXTRACT_PROMPT, 2000);
            importSourceText = text;

          } else if (mode === "media" && pdfTexts.length > 0) {
            setLoadingMsg("Reading recipe from PDF...");
            const pdfContent = pdfTexts.join(" ");
            if (pdfContent.trim()) {
              const pdfMessages = [{
                role:"user",
                content:
                  "Extract the recipe ONLY from the PDF text below. Do not invent missing ingredients, steps, or notes. Always set realistic servings (use the stated yield, otherwise estimate from the quantities — never default to 4) and always fill per-serving macros (use the PDF's nutrition if present, otherwise estimate from the ingredients — never leave them 0). Put helpful source-grounded tips in notes only when present in the PDF text. Return valid JSON only.\n\n" +
                  pdfContent.slice(0, 24000)
              }];
              extractCtx = { messages: pdfMessages, maxTokens: 6000, heroFallback: "" };
              parsed = await callAIExtract(pdfMessages, EXTRACT_PROMPT, 3500);
            } else if (pdfImages.length > 0) {
              setLoadingMsg("Reading scanned PDF pages...");
              const pdfArr = pdfImages.map((img) => ({
                type: "image",
                source: { type: "base64", media_type: img.type, data: img.data }
              }));
              pdfArr.push({ type: "text", text: "Extract the recipe from these rendered PDF page image(s). The PDF may be sideways, scanned, illustrated, handwritten, or a photo of a recipe card. Some images may be rotated duplicates of the same page; use the clearest orientation and do not duplicate recipe content. Carefully transcribe the visible recipe text first, preserve uncertain quantities as written, and do not invent missing details or notes. Include all visible ingredient-list items and visible add-ins mentioned in directions, such as garnishes, green onions, sauces, peppers, cheese, or variations, unless clearly optional; optional items should be marked optional. Do not include equipment/tools as ingredients. If the PDF page image(s) clearly show multiple distinct recipe cards or standalone recipes, return {\"error\":\"multiple_recipes_detected\",\"recipes\":[\"name 1\",\"name 2\"]} instead of merging them. If the pages are parts of the same recipe, extract one recipe. Put helpful notes only when they are visible in the PDF image text. Always set realistic servings (use the stated yield, otherwise estimate from the quantities — never default to 4) and always fill per-serving macros (use visible nutrition if present, otherwise estimate from the ingredients — never leave them 0)." });
              const pdfImgMessages = [{ role:"user", content: pdfArr }];
              extractCtx = { messages: pdfImgMessages, maxTokens: 6000, heroFallback: "" };
              parsed = await callAIExtract(pdfImgMessages, EXTRACT_PROMPT, 3500);
            } else {
              throw new Error("Could not read PDF text or render PDF pages. Try a clearer PDF/photo.");
            }
          } else if (mode === "media" && images.length > 0) {
            setLoadingMsg("Reading recipe from image...");
            const imgArr = images.map((img, i) => ({
              type: "image",
              source: { type: "base64", media_type: img.type, data: img.data }
            }));
            imgArr.push({ type: "text", text: "Extract the recipe from these " + images.length + " image(s). These may be handwritten recipe cards or cookbook pages. Carefully transcribe the visible text first, preserve uncertain quantities as written, and do not invent missing details or notes. Include all visible ingredient-list items and visible add-ins mentioned in directions, such as garnishes, green onions, sauces, peppers, cheese, or variations, unless clearly optional; optional items should be marked optional. Do not include equipment/tools as ingredients. If the image(s) clearly show multiple distinct recipe cards or standalone recipes, return {\"error\":\"multiple_recipes_detected\",\"recipes\":[\"name 1\",\"name 2\"]} instead of merging them. If the images are front/back or separate pages of the same recipe, extract one recipe. Put helpful notes only when they are visible in the image text. Always set realistic servings (use the stated yield, otherwise estimate from the quantities — never default to 4) and always fill per-serving macros (use visible nutrition if present, otherwise estimate from the ingredients — never leave them 0)." });
            const imgMessages = [{ role:"user", content: imgArr }];
            extractCtx = { messages: imgMessages, maxTokens: 6000, heroFallback: "" };
            parsed = await callAIExtract(imgMessages, EXTRACT_PROMPT, 3000);
          }

          // Preserve a lightweight original-source copy for photo/PDF imports so
          // the recipe can show where it came from. Captured before the
          // multiple-recipe handoff so per-recipe selections keep it too.
          if (mode === "media") {
            const sourceImgs = images.length ? images : pdfImages;
            if (sourceImgs.length) {
              setLoadingMsg("Saving a copy of your original...");
              const pages = await buildOriginalSourcePages(sourceImgs);
              if (pages.length) {
                originalSource = { kind: images.length ? "image" : "pdf", pages, capturedAt: new Date().toISOString() };
                if (extractCtx) extractCtx.originalSource = originalSource;
              }
            }
          }

          if (parsed?.error === "multiple_recipes_detected") {
            const names = (Array.isArray(parsed.recipes) ? parsed.recipes : [])
              .map((n) => (typeof n === "string" ? n.trim() : "")).filter(Boolean);
            if (extractCtx && names.length) {
              // Hand off to the review screen instead of silently merging or failing.
              setMultiRecipe({ names, ...extractCtx });
              setLoading(false);
              setLoadingMsg("");
              return;
            }
            const label = names.length ? " (" + names.join(", ") + ")" : "";
            throw new Error("I found multiple recipes in this upload" + label + ". Import one recipe at a time for now, or crop/select the card you want.");
          }
          if (!parsed || !parsed.title || !parsed.sections) throw new Error("Could not extract a complete recipe. Try Paste Text.");
          parsed = sanitizeImportedRecipe(parsed);
          parsed.id = uid();
          parsed.createdAt = new Date().toISOString();
          parsed.rating = 0;
          parsed.favorite = false;
          if (!parsed.heroImage) parsed.heroImage = "";
          if (!parsed.notes) parsed.notes = "";
          if (originalSource) parsed.originalSource = originalSource;
          // YouTube/social: warn when the source clearly names a distinctive
          // ingredient that didn't make it into the recipe (likely an AI
          // round-off, e.g. half-and-half -> milk), or when the source was thin.
          // Clean, complete imports get no warning, so good recipes stay tidy.
          if (mode === "youtube" || mode === "social") {
            const mismatches = findSourceIngredientMismatches(importSourceText, parsed);
            if (mismatches.length || importSourceQuality !== "high" || importWarnings.length) {
              parsed.sourceQuality = importSourceQuality;
              if (mismatches.length) importWarnings.unshift("The " + (mode === "youtube" ? "video" : "post") + " mentions " + mismatches.join(", ") + " — make sure the ingredients match.");
              else if (importSourceQuality !== "high") importWarnings.push("Reconstructed from limited " + (mode === "youtube" ? "video/transcript" : "social post") + " information — please review the ingredients before cooking.");
              parsed.importWarnings = Array.from(new Set(importWarnings)).slice(0, 4);
            }
          }

          // Grounding/verification (Phase 3): for any text-based AI import, check
          // that the extracted ingredients are actually grounded in the source —
          // flag likely hallucinations and distinctive drops. Deterministic
          // structured-data imports are publisher-accurate and skip this; image-
          // only imports have no source text to check against. Surfaced by the
          // review banner on the recipe (Phase 4), not buried in notes.
          if (importSourceText && parsed.importMethod !== "structured-data" && typeof RecipeBoxGrounding !== "undefined") {
            const verdict = RecipeBoxGrounding.verifyImport(parsed, importSourceText);
            parsed.importConfidence = verdict.confidence;
            if (verdict.needsReview) {
              parsed.sourceQuality = parsed.sourceQuality && parsed.sourceQuality !== "high" ? parsed.sourceQuality : "review";
              parsed.importWarnings = Array.from(new Set((parsed.importWarnings || []).concat(verdict.warnings))).slice(0, 4);
            }
          }

          // Import quality audit (deterministic, all imports): surface any
          // remaining formatting/spelling/mixed-unit issues the normalizer flagged
          // for the user to glance at via the review banner.
          try {
            const aud = RecipeBoxNormalize.auditRecipe(parsed, "us");
            if (aud.warnings.length) {
              parsed.importWarnings = Array.from(new Set((parsed.importWarnings || []).concat(aud.warnings))).slice(0, 4);
            }
          } catch {}

          readyRecipeForSave(parsed, { skipPhotoPrompt: mode === "media" });

        } catch(e) {
          setError(e.message || "Could not extract recipe.");
          // Thin YouTube/social import that still scraped real text? Offer it
          // back as a one-tap handoff to Paste Text instead of a dead end.
          if ((mode === "youtube" || mode === "social") && capturedText && capturedText.trim().length > 30) {
            setRecovery(capturedText.trim());
          }
        }
        setLoading(false);
        setLoadingMsg("");
      }

      function manualSaveText() {
        setError("");
        const raw = text.trim();
        if (!raw) {
          setError("Paste some recipe text first.");
          return;
        }

        const lines = raw.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
        const title = lines[0] || "Untitled Recipe";

        const ingredientsIndex = lines.findIndex(x => /^ingredients:?$/i.test(x));
        const instructionsIndex = lines.findIndex(x => /^(instructions|directions|method):?$/i.test(x));

        let ingredientLines = [];
        let instructionLines = [];

        if (ingredientsIndex >= 0 && instructionsIndex > ingredientsIndex) {
          ingredientLines = lines.slice(ingredientsIndex + 1, instructionsIndex);
          instructionLines = lines.slice(instructionsIndex + 1);
        } else {
          ingredientLines = lines.slice(1);
          instructionLines = ["Add instructions."];
        }

        function parseIngredient(line) {
          const match = line.match(/^([\d\/\.\s]+)?\s*([a-zA-Z]+)?\s*(.*)$/);
          if (!match) return { amount: "", unit: "", name: line };
          return {
            amount: (match[1] || "").trim(),
            unit: (match[2] || "").trim(),
            name: (match[3] || line).trim()
          };
        }

        const parsed = {
          id: uid(),
          title,
          description: "",
          heroImage: "",
          prepTime: "",
          cookTime: "",
          totalTime: "",
          servings: "",
          category: "",
          tags: [],
          macros: {},
          notes: "",
          rating: 0,
          favorite: false,
          createdAt: new Date().toISOString(),
          sections: [
            {
              name: "Main",
              ingredients: ingredientLines.map(parseIngredient),
              steps: instructionLines.map(x => ({ text: x.replace(/^\d+\.\s*/, "") }))
            }
          ]
        };

        readyRecipeForSave(parsed);
      }

      function handleCategorySelect(category) {
        const recipe = { ...pendingRecipe, category };
        setShowCategoryModal(false);
        setPendingRecipe(null);
        onDone(recipe);
      }

      async function handlePromptHeroImage(e) {
        const file = e.target.files[0];
        if (!file) return;
        try {
          const b = await fileToBase64(file);
          const dataUrl = "data:" + b.type + ";base64," + b.data;
          setPendingRecipe((p) => ({ ...p, heroImage:dataUrl }));
          setShowPhotoPrompt(false);
          setShowCategoryModal(true);
        } catch (err) {
          setError(err.message || "Could not read that photo.");
          setShowPhotoPrompt(false);
          setShowCategoryModal(true);
        } finally {
          e.target.value = "";
        }
      }

      function skipPromptHeroImage() {
        setShowPhotoPrompt(false);
        setShowCategoryModal(true);
      }

      async function extractPdfText(file) {
        return new Promise(function(resolve) {
          const reader = new FileReader();
          reader.onload = async function(e) {
            try {
              const lib = window["pdfjs-dist/build/pdf"];
              lib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
              const pdf = await lib.getDocument({ data: e.target.result }).promise;
              let text = "";
              for (let i = 1; i <= Math.min(pdf.numPages, 10); i++) {
                const page = await pdf.getPage(i);
                const c = await page.getTextContent();
                text += c.items.map(function(x) { return x.str; }).join(" ") + " ";
              }
              resolve(text.trim());
            } catch(err) { resolve(""); }
          };
          reader.readAsArrayBuffer(file);
        });
      }
      async function renderPdfPagesAsImages(file) {
        return new Promise(function(resolve) {
          const reader = new FileReader();
          reader.onload = async function(e) {
            try {
              const lib = window["pdfjs-dist/build/pdf"];
              lib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
              const pdf = await lib.getDocument({ data: e.target.result }).promise;
              const pages = [];
              for (let i = 1; i <= Math.min(pdf.numPages, 4); i++) {
                const page = await pdf.getPage(i);
                const viewport = page.getViewport({ scale: 2 });
                const canvas = document.createElement("canvas");
                canvas.width = Math.round(viewport.width);
                canvas.height = Math.round(viewport.height);
                const ctx = canvas.getContext("2d");
                await page.render({ canvasContext: ctx, viewport }).promise;
                const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
                pages.push({ data:dataUrl.split(",")[1], type:"image/jpeg", preview:dataUrl });
                if (pdf.numPages <= 2) {
                  const rotated = document.createElement("canvas");
                  rotated.width = canvas.height;
                  rotated.height = canvas.width;
                  const rotatedCtx = rotated.getContext("2d");
                  rotatedCtx.translate(rotated.width / 2, rotated.height / 2);
                  rotatedCtx.rotate(Math.PI / 2);
                  rotatedCtx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
                  const rotatedUrl = rotated.toDataURL("image/jpeg", 0.9);
                  pages.push({ data:rotatedUrl.split(",")[1], type:"image/jpeg", preview:rotatedUrl });
                }
              }
              resolve(pages.slice(0, 4));
            } catch(err) { resolve([]); }
          };
          reader.readAsArrayBuffer(file);
        });
      }
      async function handleFiles(e) {
        setError("");
        try {
          const files = Array.from(e.target.files).slice(0, 4);
          if (!files.length) return;
          const nextItems = [];
          for (const file of files) {
            const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
            if (isPdf) {
              const pdfText = await extractPdfText(file);
              const pdfImages = pdfText.trim() ? [] : await renderPdfPagesAsImages(file);
              nextItems.push({
                id:uid(),
                name:file.name || "Recipe PDF",
                type:"pdf",
                pdfText,
                pdfImages
              });
            } else {
              const heic = isHeicFile(file);
              const converted = await convertToJpeg(file);
              const preview = await fileToDataUrl(converted);
              nextItems.push({
                id:uid(),
                name:file.name || "Recipe image",
                type:"image",
                preview,
                imageData:{ data:preview.split(",")[1], type:converted.type || "image/jpeg" },
                badge:heic ? "HEIC converted" : "Image"
              });
            }
          }
          applyMediaItems([...mediaFiles, ...nextItems]);
        } catch (err) {
          if (!mediaFiles.length) {
            setImages([]);
            setPdfTexts([]);
            setPdfImages([]);
            setMediaFiles([]);
          }
          setError(err.message || "Could not read that upload. Try saving it as JPG or PNG first.");
        } finally {
          e.target.value = "";
        }
      }
      function removeMediaFile(id) {
        try {
          applyMediaItems(mediaFiles.filter((file) => file.id !== id));
        } catch (err) {
          setError(err.message || "Could not update uploads.");
        }
      }
      function clearMediaFiles() {
        setMediaFiles([]);
        setImages([]);
        setPdfTexts([]);
        setPdfImages([]);
      }

      const tabs = [
        { id:"url", label:"Web" },
        { id:"youtube", label:"YouTube" },
        { id:"social", label:"Social" },
        { id:"text", label:"Paste" },
        { id:"media", label:"Photo/PDF" },
      ];

      const canSubmit = !loading && (
        (mode==="url" && url) ||
        (mode==="youtube" && ytUrl) ||
        (mode==="social" && socialUrl) ||
        (mode==="text" && text.trim()) ||
        (mode==="media" && (images.length > 0 || pdfTexts.length > 0))
      );

      return (
        <div style={S.page}>
          {showPhotoPrompt && (
            <MissingPhotoModal
              onAdd={handlePromptHeroImage}
              onSkip={skipPromptHeroImage}
              inputRef={heroPromptRef}
            />
          )}
          {showCategoryModal && (
            <CategoryModal
              onSelect={handleCategorySelect}
              onCancel={() => { setShowCategoryModal(false); setShowPhotoPrompt(false); setPendingRecipe(null); }}
            />
          )}
          {multiRecipe && (
            <div className="modal-overlay" onClick={() => { if (!loading) { setMultiRecipe(null); } }}>
              <div className="modal-box" onClick={(e) => e.stopPropagation()}>
                <div style={{padding:"24px 24px 8px",borderBottom:"1px solid "+C.border}}>
                  <div style={{fontFamily:SERIF,fontSize:"1.3em",color:C.dark,marginBottom:4}}>We found more than one recipe</div>
                  <div style={{color:C.light,fontSize:"0.85em",lineHeight:1.5}}>This source looks like it has several distinct recipes. Pick the one you want, combine them into a single card, or import them all.</div>
                </div>
                <div style={{padding:"14px 16px 8px"}}>
                  <div style={{fontSize:"0.72em",fontWeight:800,letterSpacing:"0.04em",textTransform:"uppercase",color:C.light,marginBottom:8}}>Recipes detected</div>
                  <div style={{display:"grid",gap:8,marginBottom:14}}>
                    {multiRecipe.names.map((name, i) => (
                      <button key={i} disabled={loading} onClick={() => importChoice({ type:"one", name })}
                        style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,width:"100%",padding:"13px 15px",border:"1.5px solid "+C.border,borderRadius:10,background:C.white,color:C.dark,fontWeight:600,cursor:loading?"not-allowed":"pointer",fontSize:"0.92em",fontFamily:SANS,textAlign:"left",opacity:loading?0.6:1}}>
                        <span style={{overflow:"hidden",textOverflow:"ellipsis"}}>{name}</span>
                        <span style={{color:C.green,fontWeight:800,fontSize:"0.82em",whiteSpace:"nowrap"}}>Import →</span>
                      </button>
                    ))}
                  </div>
                  <div style={{display:"grid",gap:8}}>
                    <button disabled={loading} onClick={() => importChoice({ type:"combined" })}
                      style={{...S.ghostBtn,borderRadius:10,padding:"12px 15px",fontSize:"0.88em",textAlign:"left",cursor:loading?"not-allowed":"pointer",opacity:loading?0.6:1}}>
                      Combine into one recipe card
                    </button>
                    <button disabled={loading} onClick={() => importChoice({ type:"all" })}
                      style={{...S.ghostBtn,borderRadius:10,padding:"12px 15px",fontSize:"0.88em",textAlign:"left",cursor:loading?"not-allowed":"pointer",opacity:loading?0.6:1}}>
                      Import all {multiRecipe.names.length} separately
                    </button>
                  </div>
                  <div style={{marginTop:12,background:C.goldPale,border:"1px solid "+C.goldLight,borderRadius:8,padding:"9px 12px",fontSize:"0.76em",color:C.brown,lineHeight:1.5}}>
                    Each option runs a fresh AI extraction and uses AI Assists. Importing all separately uses one extraction per recipe.
                  </div>
                  {loading && (
                    <div style={{marginTop:13,display:"flex",alignItems:"center",justifyContent:"center",gap:10,color:C.green,fontSize:"0.85em",fontWeight:700}}>
                      <Spinner /> <span style={{color:C.green}}>{loadingMsg || "Working..."}</span>
                    </div>
                  )}
                  {error && (
                    <div style={{marginTop:12,background:C.redPale,border:"1px solid "+C.red+"50",borderRadius:8,padding:"10px 13px",fontSize:"0.82em",color:C.red,lineHeight:1.6}}>{error}</div>
                  )}
                </div>
                <div style={{padding:"4px 16px 18px"}}>
                  <button disabled={loading} onClick={() => { setMultiRecipe(null); setError(""); }}
                    style={{width:"100%",background:C.white,color:C.brown,border:"1.5px solid "+C.border,borderRadius:10,padding:"11px 16px",fontWeight:700,cursor:loading?"not-allowed":"pointer",fontSize:"0.88em",fontFamily:SANS,opacity:loading?0.6:1}}>
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}
          <div style={{...S.brandHeader,padding:safePad(20,20,20),display:"flex",alignItems:"center",gap:12}}>
            <button onClick={onCancel} style={{background:"rgba(255,255,255,0.12)",border:"none",borderRadius:8,padding:"7px 14px",color:"rgba(255,255,255,0.8)",cursor:"pointer",fontFamily:SANS,fontSize:"0.85em"}}>← Back</button>
            <div>
              <div style={{fontFamily:SERIF,fontSize:"1.35em",color:C.white,lineHeight:1}}>Add a recipe to your box</div>
              <div style={{fontSize:"0.76em",color:"rgba(255,249,238,0.72)",marginTop:3}}>RecipeBox will help turn it into a clean card.</div>
            </div>
          </div>

          <div style={{maxWidth:560,margin:"0 auto",padding:"28px 20px"}}>
            <div style={{display:"flex",background:C.cream2,border:"1px solid "+C.border,borderRadius:12,padding:4,marginBottom:22,overflowX:"auto"}}>
              {tabs.map((t) => (
                <button key={t.id} onClick={() => { setMode(t.id); setError(""); setRecovery(""); }}
                  style={{flex:"1 0 74px",padding:"9px 4px",border:"none",borderRadius:9,background:mode===t.id?C.paper:"transparent",color:mode===t.id?C.green:C.light,fontWeight:mode===t.id?800:600,cursor:"pointer",fontSize:"0.74em",fontFamily:SANS,boxShadow:mode===t.id?"0 3px 10px rgba(90,56,39,0.10)":"none"}}>
                  {t.label}
                </button>
              ))}
            </div>

            {mode === "url" && (
              <input value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key==="Enter"&&extract()} placeholder="https://recipe-site.com/recipe-name"
                style={{...S.input,width:"100%",padding:"12px 15px",fontSize:"0.92em",marginBottom:18,boxSizing:"border-box"}} />
            )}

            {mode === "youtube" && (
              <div>
                <input value={ytUrl} onChange={(e) => setYtUrl(e.target.value)} onKeyDown={(e) => e.key==="Enter"&&extract()} placeholder="https://youtube.com/watch?v=..."
                  style={{...S.input,width:"100%",padding:"12px 15px",fontSize:"0.92em",marginBottom:10,boxSizing:"border-box"}} />
                <div style={{...S.cardSoft,background:C.goldPale,border:"1px solid "+C.goldLight,padding:"10px 13px",fontSize:"0.78em",color:C.brown,marginBottom:18,lineHeight:1.5}}>
                  RecipeBox will look for the video transcript and build a recipe card. It works best when the recipe is spoken in the video.
                </div>
              </div>
            )}

            {mode === "social" && (
              <div>
                <input value={socialUrl} onChange={(e) => setSocialUrl(e.target.value)} onKeyDown={(e) => e.key==="Enter"&&extract()} placeholder="https://www.tiktok.com/@creator/video/..."
                  style={{...S.input,width:"100%",padding:"12px 15px",fontSize:"0.92em",marginBottom:10,boxSizing:"border-box"}} />
                <div style={{...S.cardSoft,background:C.goldPale,border:"1px solid "+C.goldLight,padding:"10px 13px",fontSize:"0.78em",color:C.brown,marginBottom:18,lineHeight:1.5}}>
                  Works best with public posts that include the recipe in the caption. If RecipeBox cannot access it, paste the caption or upload screenshots.
                </div>
              </div>
            )}

            {mode === "text" && (
              <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste a family recipe, cookbook text, or notes here..." rows={11}
                style={{...S.input,width:"100%",padding:"12px 15px",fontSize:"0.9em",resize:"vertical",marginBottom:18,boxSizing:"border-box"}} />
            )}

            {mode === "media" && (
              <div>
                <input ref={fileRef} type="file" accept="image/*,.pdf,image/heic,image/heif" multiple onChange={handleFiles} style={{display:"none"}} />
                <div onClick={() => fileRef.current.click()}
                  style={{border:"2px dashed "+(mediaFiles.length>0?C.green:C.border),borderRadius:14,padding:36,textAlign:"center",cursor:"pointer",color:mediaFiles.length>0?C.green:C.light,marginBottom:10,background:mediaFiles.length>0?C.greenPale:C.paper}}>
                  <div style={{display:"flex",justifyContent:"center",marginBottom:6}}><Icon name={mediaFiles.length>0?"check":"plus"} size={30} /></div>
                  <div style={{fontWeight:600,fontSize:"0.88em"}}>
                    {mediaFiles.length>0 ? mediaFiles.length+" file"+(mediaFiles.length>1?"s":"")+" ready - tap to add more" : "Upload a recipe card, screenshot, or PDF"}
                  </div>
                  <div style={{fontSize:"0.75em",marginTop:4,color:C.light}}>Up to 4 images of the same recipe · HEIC, JPG, PNG, PDF</div>
                </div>
                {mediaFiles.length > 0 && (
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(126px, 1fr))",gap:9,marginBottom:10}}>
                    {mediaFiles.map((file, i) => (
                      <div key={file.id || i} style={{...S.cardSoft,padding:7,color:C.dark,fontSize:"0.76em",position:"relative",overflow:"hidden"}}>
                        <button onClick={() => removeMediaFile(file.id)} aria-label={"Remove "+file.name} style={{position:"absolute",top:5,right:5,zIndex:2,width:24,height:24,borderRadius:"50%",border:"none",background:"rgba(32,20,14,0.72)",color:C.white,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"1em",lineHeight:1}}>×</button>
                        {file.type === "image" ? (
                          <img src={file.preview} alt={file.name} style={{width:"100%",aspectRatio:"1 / 1",objectFit:"cover",borderRadius:7,display:"block",background:C.cream2,border:"1px solid "+C.border}} />
                        ) : (
                          <div style={{width:"100%",aspectRatio:"1 / 1",borderRadius:7,background:C.goldPale,border:"1px solid "+C.goldLight,display:"flex",alignItems:"center",justifyContent:"center",color:C.brown,fontWeight:900,fontSize:"1.05em"}}>PDF</div>
                        )}
                        <div style={{marginTop:6,fontWeight:800,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{file.name}</div>
                        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:6,marginTop:2}}>
                          <span style={{fontSize:"0.68em",color:C.light}}>{file.type==="pdf" ? "Text PDF" : (file.badge || "Image")}</span>
                          <span style={{fontSize:"0.68em",color:C.light}}>#{i+1}</span>
                        </div>
                      </div>
                    ))}
                    {mediaFiles.length < 4 && (
                      <button onClick={() => fileRef.current.click()} style={{...S.ghostBtn,minHeight:120,borderRadius:10,border:"1px dashed "+C.goldLight,background:C.paper,color:C.brown,padding:10,fontSize:"0.78em",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:5}}>
                        <Icon name="plus" size={22} />
                        Add another page
                      </button>
                    )}
                  </div>
                )}
                {images.length > 0 && (
                  <div style={{...S.cardSoft,background:C.goldPale,border:"1px solid "+C.goldLight,padding:"8px 12px",fontSize:"0.78em",color:C.brown,marginBottom:10}}>
                    Please make sure all images are pages of the same recipe. HEIC/HEIF photos are converted to JPEG before RecipeBox reads them.
                  </div>
                )}
                {mediaFiles.length > 0 && (
                  <button onClick={clearMediaFiles} style={{...S.ghostBtn,borderRadius:8,padding:"7px 10px",fontSize:"0.76em",marginBottom:10}}>Clear uploads</button>
                )}
              </div>
            )}

            {mode === "text" && (
              <button onClick={manualSaveText} disabled={!text.trim() || loading}
                style={{...S.primaryBtn,width:"100%",borderRadius:12,padding:15,cursor:text.trim()&&!loading?"pointer":"not-allowed",fontSize:"0.95em",opacity:text.trim()&&!loading?1:0.6,marginBottom:10}}>
                Save Text Manually
              </button>
            )}

            <button onClick={extract} disabled={!canSubmit}
              style={{...S.goldBtn,width:"100%",borderRadius:12,padding:15,cursor:canSubmit?"pointer":"not-allowed",fontSize:"0.95em",opacity:canSubmit?1:0.6,display:"flex",alignItems:"center",justifyContent:"center",gap:10}}>
              {loading ? <><Spinner /> {loadingMsg || "Extracting..."}</> : (mode==="social" ? "Add Social Recipe" : "Add Recipe to Box")}
            </button>

            {error && (
              <div style={{marginTop:13,background:C.redPale,border:"1px solid "+C.red+"50",borderRadius:8,padding:"11px 15px",fontSize:"0.83em",color:C.red,lineHeight:1.6}}>
                {error}
                {recovery && (
                  <div style={{marginTop:10,paddingTop:10,borderTop:"1px solid "+C.red+"30"}}>
                    <div style={{color:C.dark,marginBottom:8}}>We did capture the post's text. Review and tidy it as a paste, then import:</div>
                    <button onClick={() => { setMode("text"); setText(recovery); setRecovery(""); setError(""); }}
                      style={{background:C.green,color:C.white,border:"none",borderRadius:9,padding:"9px 15px",fontWeight:800,fontSize:"0.92em",cursor:"pointer",fontFamily:SANS,WebkitTapHighlightColor:"transparent"}}>
                      Review captured text →
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      );
    }

    // Recipe View
    function RecipeView({ recipe, inHousehold, onBack, onEdit, onDelete, onUpdate, onImport, onTagClick, onAddToShopping, timerSound }) {
      const [scale, setScale] = useState(1);
      const [metric, setMetric] = useState(false);
      const [cookMode, setCookMode] = useState(false);
      const [cookStep, setCookStep] = useState(0);
      const [timers, setTimers] = useState({});
      const [showAI, setShowAI] = useState(false);
      const [showShop, setShowShop] = useState(false);
      const [showOriginal, setShowOriginal] = useState(false);
      const [showWTB, setShowWTB] = useState(false);
      const [macroWhole, setMacroWhole] = useState(false);
      const [nutLoading, setNutLoading] = useState(false);
      const [nutError, setNutError] = useState("");
      const [showCollections, setShowCollections] = useState(false);
      const [aiQuery, setAiQuery] = useState("");
      const [aiLoading, setAiLoading] = useState(false);
      const [aiResult, setAiResult] = useState(null);
      const [aiError, setAiError] = useState("");
      const [wtbMode, setWtbMode] = useState("text");
      const [wtbText, setWtbText] = useState("");
      const [wtbImage, setWtbImage] = useState(null);
      const [wtbResult, setWtbResult] = useState(null);
      const [wtbLoading, setWtbLoading] = useState(false);
      const wtbImgRef = useRef();

      // Always open a recipe at the very top, no matter where the Library/search
      // was scrolled. Keyed on recipe.id so it fires when a new recipe opens but
      // not when toggling internal state like Cook Mode. useLayoutEffect resets
      // before paint to avoid a scroll flash.
      React.useLayoutEffect(() => {
        try { window.scrollTo(0, 0); } catch {}
        if (document.scrollingElement) document.scrollingElement.scrollTop = 0;
        if (document.documentElement) document.documentElement.scrollTop = 0;
        if (document.body) document.body.scrollTop = 0;
      }, [recipe.id]);
      const heroImgRef = useRef();

      function normalizeViewSections(recipe) {
        const sections = Array.isArray(recipe.sections) ? recipe.sections : [];

        const oldIngredients = sections.find(sec => /^ingredients$/i.test(sec.title || sec.name || "") && Array.isArray(sec.items));
        const oldInstructions = sections.find(sec => /^(instructions|directions|method)$/i.test(sec.title || sec.name || "") && Array.isArray(sec.items));

        if (oldIngredients || oldInstructions) {
          return [{
            name: "Main",
            ingredients: (oldIngredients?.items || []).map(item => {
              if (typeof item === "object") return item;
              return { amount: "", unit: "", name: String(item) };
            }),
            steps: (oldInstructions?.items || []).map(item => {
              if (typeof item === "object" && item.text) return item;
              return { text: String(item).replace(/^\d+\.\s*/, "") };
            })
          }];
        }

        return sections.map(sec => ({
          name: sec.name || sec.title || "Main",
          ingredients: Array.isArray(sec.ingredients)
            ? sec.ingredients.map(ing => typeof ing === "object" ? ing : { amount: "", unit: "", name: String(ing) })
            : [],
          steps: Array.isArray(sec.steps)
            ? sec.steps.map(step => typeof step === "object" && step.text ? step : { text: String(step) })
            : []
        }));
      }

      const displaySections = normalizeViewSections(recipe);

      const allSteps = displaySections.flatMap((s) => (s.steps || []).map((st) => ({ ...st, secName:s.name, ingredients:s.ingredients || [] })));
      const allIngredients = displaySections.flatMap((s) => s.ingredients || []);
      const shoppingItems = RecipeBoxShopping.buildShoppingListFromSections(displaySections, { scale });
      const shoppingGroups = RecipeBoxShopping.groupShoppingItemsByCategory(shoppingItems);

      useEffect(() => {
        const iv = setInterval(() => {
          setTimers((p) => {
            const n = { ...p }; let changed = false;
            Object.keys(n).forEach((k) => {
              const timer = n[k];
              if (timer.running && timer.rem > 0) {
                const nextRem = timer.rem - 1;
                n[k] = { ...timer, rem:nextRem, running:nextRem > 0, alerted:nextRem === 0 ? true : timer.alerted, dismissed:nextRem === 0 ? false : timer.dismissed };
                changed=true;
                if (nextRem === 0 && !timer.alerted) {
                  playTimerSound(timerSound);
                  pulseTimerHaptic();
                }
              }
            });
            return changed ? n : p;
          });
        }, 1000);
        return () => clearInterval(iv);
      }, [timerSound]);

      function timerLabel(sec) {
        if (sec % 3600 === 0) return (sec / 3600) + " hr";
        if (sec >= 3600) {
          const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
          return h + " hr" + (m ? " " + m + " min" : "");
        }
        return Math.round(sec / 60) + " min";
      }
      function timerOptionList(low, high, unitSec) {
        if (low > high) { const t = low; low = high; high = t; }
        const span = high - low;
        const values = span <= 6
          ? Array.from({ length: span + 1 }, (_, i) => low + i)
          : [low, Math.round((low + high) / 2), high];
        return [...new Set(values)].map((value) => ({ label: timerLabel(value * unitSec), sec: value * unitSec }));
      }
      function timerOptions(text) {
        const raw = String(text || "");
        const range = raw.match(/(\d+)\s*(?:-|–|—|\bto\b|\bor\b)\s*(\d+)\s*(minutes?|mins?|hours?|hrs?)\b/i);
        if (range) {
          const unitSec = /^h/i.test(range[3]) ? 3600 : 60;
          const options = timerOptionList(parseInt(range[1]), parseInt(range[2]), unitSec);
          return { defaultSec: options[options.length - 1].sec, options };
        }
        const single = raw.match(/(\d+)\s*(minutes?|mins?|hours?|hrs?)\b/i);
        if (!single) return null;
        const unitSec = /^h/i.test(single[2]) ? 3600 : 60;
        const sec = parseInt(single[1]) * unitSec;
        return { defaultSec: sec, options:[{ label: timerLabel(sec), sec }] };
      }
      function startTimer(key, sec) {
        unlockTimerAudio();
        setTimers((p) => ({...p,[key]:{rem:sec,total:sec,running:true,alerted:false,dismissed:false}}));
      }
      function fmt(s) { return Math.floor(s/60)+":"+String(s%60).padStart(2,"0"); }
      const expiredTimerEntry = Object.entries(timers).find(([, timer]) => timer && timer.rem === 0 && timer.alerted && !timer.dismissed);
      const expiredTimerKey = expiredTimerEntry ? expiredTimerEntry[0] : null;
      const expiredTimer = expiredTimerEntry ? expiredTimerEntry[1] : null;

      useEffect(() => {
        if (!expiredTimerKey) {
          stopTimerHaptic();
          return;
        }
        pulseTimerHaptic();
        const iv = setInterval(pulseTimerHaptic, 1400);
        return () => {
          clearInterval(iv);
          stopTimerHaptic();
        };
      }, [expiredTimerKey]);

      function dismissTimer(key) {
        stopTimerHaptic();
        setTimers((p) => p[key] ? ({...p,[key]:{...p[key],dismissed:true}}) : p);
      }
      function restartTimer(key) {
        unlockTimerAudio();
        stopTimerHaptic();
        setTimers((p) => p[key] ? ({...p,[key]:{...p[key],rem:p[key].total,running:true,alerted:false,dismissed:false}}) : p);
      }

      const timerAlert = expiredTimer ? (
        <div role="alertdialog" aria-modal="true" style={{position:"fixed",inset:0,zIndex:180,background:"rgba(28,20,16,0.72)",display:"flex",alignItems:"center",justifyContent:"center",padding:18}}>
          <div className="timer-alert-card" style={{width:"100%",maxWidth:390,background:C.cream,border:"2px solid "+C.red,borderRadius:18,padding:"26px 22px",textAlign:"center",animation:"timerPulse 1.1s ease-in-out infinite",boxShadow:"0 22px 70px rgba(0,0,0,0.35)"}}>
            <div style={{display:"flex",justifyContent:"center",color:C.red,marginBottom:8}}><Icon name="bell" size={48} strokeWidth={1.8} /></div>
            <div style={{fontFamily:SERIF,fontSize:"2em",color:C.red,lineHeight:1.05,marginBottom:6}}>Timer Done</div>
            <div style={{color:C.mid,fontWeight:700,marginBottom:18}}>{fmt(expiredTimer.total)} is up</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              <button onClick={() => restartTimer(expiredTimerKey)} style={{background:C.goldPale,border:"1px solid "+C.goldLight,borderRadius:10,padding:"12px 10px",color:C.brown,fontWeight:800,cursor:"pointer",fontFamily:SANS}}>Restart</button>
              <button onClick={() => dismissTimer(expiredTimerKey)} style={{background:C.dark,border:"none",borderRadius:10,padding:"12px 10px",color:C.white,fontWeight:800,cursor:"pointer",fontFamily:SANS}}>Dismiss</button>
            </div>
            <div style={{fontSize:"0.72em",color:C.light,marginTop:13,lineHeight:1.4}}>Haptic pulses continue until dismissed when this device supports browser vibration.</div>
          </div>
        </div>
      ) : null;

      // On-demand AI nutrition estimate. Writes into the existing recipe.macros
      // shape (so the macros card, PDF export, and hero badge all keep working)
      // plus a fingerprint of the ingredients it was based on, so we can later
      // flag the estimate as stale if the recipe is edited. Bills exactly 1 AI
      // Assist server-side (the prompt is classified as the `nutrition` feature).
      async function runNutritionEstimate() {
        if (nutLoading) return;
        setNutError("");
        setNutLoading(true);
        try {
          const { system, messages, maxTokens } = RecipeBoxNutrition.nutritionPrompt(recipe);
          const raw = await callAI(messages, system, maxTokens);
          const values = RecipeBoxNutrition.parseNutrition(raw);
          if (!values) throw new Error("Couldn't read a nutrition estimate this time. Please try again.");
          onUpdate({
            ...recipe,
            macros: { ...(recipe.macros || {}), ...values },
            nutritionBasis: RecipeBoxNutrition.ingredientsFingerprint(recipe),
            nutritionEstimatedAt: new Date().toISOString(),
          });
        } catch (e) {
          setNutError(e.message || "Nutrition estimate failed. Please try again.");
        } finally {
          setNutLoading(false);
        }
      }

      async function runAIAdjust() {
        if (!aiQuery.trim()) return;
        setAiLoading(true);
        setAiError("");
        setAiResult(null);
        try {
          const { originalSource, ...recipeForAI } = recipe;
          const raw = await callAI([{ role:"user", content:"Recipe: "+JSON.stringify(recipeForAI)+"\nRequest: "+aiQuery }], ADJUST_PROMPT, 3500);
          const adjusted = await parseRecipeJsonWithRepair(raw, "AI adjustment");
          if (!adjusted || !adjusted.title || !Array.isArray(adjusted.sections)) throw new Error("The adjusted recipe was incomplete.");
          setAiResult(adjusted);
        }
        catch(e) { setAiError(e.message || "AI adjustment failed. Try a smaller change or try again."); }
        setAiLoading(false);
      }

      async function runWTB() {
        setWtbLoading(true);
        const il = allIngredients.map((i) => i.amount+(i.unit?" "+i.unit:"")+" "+i.name).join(", ");
        try {
          let msgs;
          if (wtbMode==="photo"&&wtbImage) {
            msgs=[{role:"user",content:[{type:"image",source:{type:"base64",media_type:wtbImage.type,data:wtbImage.data}},{type:"text",text:"For recipe: "+recipe.title+"\nNeeded: "+il+"\nWhich do I have? Return JSON: {\"have\":[],\"need\":[],\"notes\":\"\"}"}]}];
          } else {
            msgs=[{role:"user",content:"For recipe: "+recipe.title+"\nNeeded: "+il+"\nI have: "+wtbText+"\nReturn JSON: {\"have\":[],\"need\":[],\"notes\":\"\"}"}];
          }
          setWtbResult(parseAIJson(await callAI(msgs, null, 800)));
        } catch(e) { alert("Analysis failed."); }
        setWtbLoading(false);
      }

      function buildRecipeDoc() {
        if (!window.jspdf) { alert("PDF library loading. Try again."); return null; }
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        const pageW = doc.internal.pageSize.getWidth();
        const pageH = doc.internal.pageSize.getHeight();
        const margin = 16;
        let y = 20;
        const rgb = (hex) => {
          const value = hex.replace("#", "");
          return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16)];
        };
        const setText = (hex) => doc.setTextColor(...rgb(hex));
        // Copyright-safe footer stamped on every page at the end: RecipeBox
        // branding, a personal-use/attribution note, and page numbers.
        const stampFooters = () => {
          const pages = doc.getNumberOfPages();
          const attribution = recipe.sourceUrl ? ("Imported from " + String(recipe.sourceUrl).replace(/^https?:\/\//, "").slice(0, 70)) : "Saved with RecipeBox for personal use";
          for (let p = 1; p <= pages; p++) {
            doc.setPage(p);
            doc.setDrawColor(...rgb(C.border)); doc.setLineWidth(0.2);
            doc.line(margin, pageH - 14, pageW - margin, pageH - 14);
            doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); setText(C.light);
            doc.text(attribution + " · original recipe rights remain with their authors", margin, pageH - 9);
            doc.text("Page " + p + " of " + pages, pageW - margin, pageH - 9, { align: "right" });
          }
        };
        const ensure = (space = 14) => {
          if (y + space <= pageH - 18) return;
          doc.addPage();
          y = 18;
        };
        const writeWrapped = (text, x, width, lineHeight = 5) => {
          doc.splitTextToSize(String(text || ""), width).forEach((line) => {
            ensure(lineHeight + 2);
            doc.text(line, x, y);
            y += lineHeight;
          });
        };
        doc.setFillColor(...rgb(C.green));
        doc.rect(0, 0, pageW, 34, "F");
        doc.setFont("helvetica", "bold"); doc.setFontSize(10); setText(C.goldLight);
        doc.text("RecipeBox", margin, 13);
        doc.setFont("helvetica", "bold"); doc.setFontSize(21); setText(C.white);
        writeWrapped(recipe.title, margin, pageW - margin * 2, 8);
        y = Math.max(y + 4, 43);
        const chips = [
          recipe.category,
          Math.round((recipe.servings || 4) * scale) + " servings",
          recipe.prepTime && "Prep " + recipe.prepTime,
          recipe.cookTime && "Cook " + recipe.cookTime,
          recipe.totalTime && "Total " + recipe.totalTime,
          recipe.rating > 0 && recipe.rating + "/5 stars"
        ].filter(Boolean);
        doc.setFont("helvetica", "normal"); doc.setFontSize(9); setText(C.brown);
        let chipX = margin;
        chips.forEach((chip) => {
          const w = doc.getTextWidth(chip) + 8;
          if (chipX + w > pageW - margin) { chipX = margin; y += 8; }
          doc.setFillColor(...rgb(C.goldPale)); doc.roundedRect(chipX, y - 5, w, 7, 2, 2, "F");
          doc.text(chip, chipX + 4, y);
          chipX += w + 4;
        });
        y += chips.length ? 14 : 2;
        if (recipe.description) {
          doc.setFont("helvetica", "normal"); doc.setFontSize(10); setText(C.mid);
          writeWrapped(recipe.description, margin, pageW - margin * 2, 5);
          y += 4;
        }
        displaySections.forEach((sec) => {
          ensure(18);
          if (displaySections.length > 1) {
            doc.setFontSize(13); doc.setFont("helvetica", "bold"); setText(C.green);
            doc.text(sec.name || "Main", margin, y); y += 8;
          }
          doc.setFontSize(13); doc.setFont("helvetica","bold"); setText(C.dark); doc.text("Ingredients",margin,y); y+=7;
          RecipeBoxShopping.groupCompoundIngredients(sec.ingredients).forEach((grp) => {
            doc.setFontSize(10); doc.setFont("helvetica","normal"); setText(C.mid);
            writeWrapped("- " + compoundIngredientLine(grp, scale, metric), margin + 4, pageW - margin * 2 - 4, 5);
          });
          y+=4; doc.setFontSize(13); doc.setFont("helvetica","bold"); setText(C.dark); doc.text("Directions",margin,y); y+=7;
          sec.steps.forEach((step,idx) => {
            doc.setFontSize(10); doc.setFont("helvetica","normal"); setText(C.mid);
            const t = plainStepText(step.text, sec.ingredients, scale, metric);
            writeWrapped((idx+1)+". "+t, margin, pageW - margin * 2, 5); y+=2;
          }); y+=8;
        });
        if (recipe.notes && String(recipe.notes).trim()) {
          ensure(18);
          doc.setFontSize(13); doc.setFont("helvetica", "bold"); setText(C.dark); doc.text("Notes", margin, y); y += 7;
          doc.setFontSize(10); doc.setFont("helvetica", "normal"); setText(C.mid);
          writeWrapped(String(recipe.notes), margin, pageW - margin * 2, 5);
          y += 6;
        }
        if (recipe.macros && Object.values(recipe.macros).some(Boolean)) {
          ensure(28);
          doc.setFillColor(...rgb(C.cream2)); doc.roundedRect(margin, y - 5, pageW - margin * 2, 23, 3, 3, "F");
          doc.setFont("helvetica", "bold"); doc.setFontSize(10); setText(C.dark); doc.text("Estimated nutrition per serving", margin + 5, y + 1);
          doc.setFont("helvetica", "normal"); doc.setFontSize(9); setText(C.mid);
          doc.text(["Calories " + Math.round(recipe.macros.calories || 0), "Protein " + Math.round(recipe.macros.protein || 0) + "g", "Carbs " + Math.round(recipe.macros.carbs || 0) + "g", "Fat " + Math.round(recipe.macros.fat || 0) + "g"].join("   "), margin + 5, y + 11);
          y += 24;
        }
        stampFooters();
        return doc;
      }
      function recipeFileBase() {
        return (String(recipe.title || "recipe").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-") || "recipe");
      }
      function exportPDF() {
        const doc = buildRecipeDoc();
        if (doc) doc.save(recipeFileBase() + ".pdf");
      }
      // Plain-text version of the recipe for sharing into Messages/Mail/Notes etc.
      function buildRecipeShareText() {
        const lines = [];
        lines.push(recipe.title || "Recipe");
        const meta = [
          recipe.category,
          Math.round((Number(recipe.servings) || 4) * scale) + " servings",
          recipe.totalTime ? "Total " + recipe.totalTime : (recipe.cookTime ? "Cook " + recipe.cookTime : ""),
        ].filter(Boolean);
        if (meta.length) lines.push(meta.join(" · "));
        if (recipe.description) lines.push("", recipe.description);
        displaySections.forEach((sec) => {
          lines.push("");
          if (displaySections.length > 1 && (sec.name || "").trim()) lines.push(sec.name.toUpperCase());
          lines.push("INGREDIENTS");
          RecipeBoxShopping.groupCompoundIngredients(sec.ingredients || []).forEach((grp) => lines.push("• " + compoundIngredientLine(grp, scale, metric)));
          lines.push("", "DIRECTIONS");
          (sec.steps || []).forEach((step, i) => lines.push((i + 1) + ". " + plainStepText(step.text, sec.ingredients, scale, metric)));
        });
        if (recipe.notes && String(recipe.notes).trim()) lines.push("", "NOTES", String(recipe.notes).trim());
        lines.push("", "Shared from RecipeBox");
        return lines.join("\n");
      }
      async function shareRecipe() {
        const text = buildRecipeShareText();
        try {
          // Prefer sharing the branded PDF (with a short text summary) when the
          // platform supports file sharing; otherwise share the full text.
          if (typeof navigator !== "undefined" && navigator.canShare) {
            const doc = buildRecipeDoc();
            if (doc) {
              const file = new File([doc.output("blob")], recipeFileBase() + ".pdf", { type: "application/pdf" });
              if (navigator.canShare({ files: [file] })) {
                await navigator.share({ title: recipe.title || "Recipe", text: (recipe.title || "Recipe") + " — shared from RecipeBox", files: [file] });
                return;
              }
            }
          }
          if (typeof navigator !== "undefined" && navigator.share) {
            await navigator.share({ title: recipe.title || "Recipe", text });
            return;
          }
          if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); alert("Recipe copied to clipboard."); return; }
          exportPDF();
        } catch (e) {
          if (e && e.name === "AbortError") return; // user dismissed the share sheet
          try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); alert("Recipe copied to clipboard."); return; } } catch (e2) {}
          exportPDF();
        }
      }

      const color = cardColor(recipe.title);
      const hasHeroImage = recipe.heroImage && recipe.heroImage.length > 0;

      if (cookMode && allSteps.length > 0) {
        const cur=allSteps[cookStep], tMeta=timerOptions(cur.text), tK="cook-"+cookStep, timer=timers[tK];
        return (
          <div style={{minHeight:"100dvh",background:"transparent",color:C.dark,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",fontFamily:SANS,padding:"max(env(safe-area-inset-top),20px) 20px calc(env(safe-area-inset-bottom) + 24px)"}}>
            {timerAlert}
            <div style={{maxWidth:600,width:"100%",textAlign:"center"}}>
              <div style={{color:"rgba(255,249,238,0.72)",fontSize:"0.72em",letterSpacing:3,textTransform:"uppercase",fontFamily:SANS,fontWeight:800,marginBottom:6}}>{cur.secName}</div>
              <div style={{color:"rgba(255,249,238,0.7)",fontSize:"0.8em",marginBottom:18}}>Step {cookStep+1} of {allSteps.length}</div>
              <div style={{...S.card,fontSize:"1.32em",lineHeight:1.82,marginBottom:24,padding:"30px 28px",borderRadius:16,boxShadow:"0 24px 70px rgba(32,20,14,0.28)"}}>
                <StepText text={cur.text} ingredients={cur.ingredients} scale={scale} metric={metric} />
              </div>
              {tMeta && (timer ? (
                <div style={{marginBottom:18}}>
                  <div style={{fontSize:"2.8em",fontWeight:700,color:timer.rem===0?C.red:C.goldLight,fontFamily:SERIF}}>{fmt(timer.rem)}</div>
                  {timer.rem > 0
                    ? <button onClick={() => setTimers((p) => ({...p,[tK]:{...p[tK],running:!p[tK].running}}))} style={{background:"rgba(255,249,238,0.12)",border:"1px solid rgba(255,249,238,0.35)",color:C.goldLight,borderRadius:10,padding:"9px 18px",cursor:"pointer",fontFamily:SANS,marginTop:5,fontWeight:800}}>{timer.running?"Pause":"Resume"}</button>
                    : <div style={{color:C.red,fontWeight:700,display:"inline-flex",alignItems:"center",gap:6}}><Icon name="bell" size={18} /> Time's up!</div>
                  }
                </div>
              ) : (
                <div style={{marginBottom:18}}>
                  <div style={{fontSize:"0.76em",letterSpacing:1.6,textTransform:"uppercase",color:C.goldLight,marginBottom:8,fontWeight:800}}>Timer</div>
                  <div style={{display:"flex",gap:8,justifyContent:"center",flexWrap:"wrap"}}>
                    {tMeta.options.map((opt) => (
                      <button key={opt.sec} onClick={() => startTimer(tK, opt.sec)}
                        style={{background:opt.sec===tMeta.defaultSec?C.gold:"rgba(255,249,238,0.10)",color:opt.sec===tMeta.defaultSec?C.dark:C.goldLight,border:"1px solid "+C.gold,borderRadius:10,padding:"10px 15px",fontWeight:800,cursor:"pointer",fontFamily:SANS}}>
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              <div style={{display:"flex",gap:10,justifyContent:"center",flexWrap:"wrap"}}>
                {cookStep>0 && <button onClick={() => setCookStep((p)=>p-1)} style={{background:"rgba(255,249,238,0.12)",color:C.paper,border:"1px solid rgba(255,249,238,0.25)",borderRadius:10,padding:"12px 24px",cursor:"pointer",fontFamily:SANS,fontWeight:800}}>← Back</button>}
                {cookStep<allSteps.length-1
                  ? <button onClick={() => setCookStep((p)=>p+1)} style={{...S.goldBtn,borderRadius:10,padding:"12px 28px"}}>Next →</button>
                  : <button onClick={() => setCookMode(false)} style={{background:C.paper,color:C.green,border:"none",borderRadius:10,padding:"12px 28px",fontWeight:800,cursor:"pointer",fontFamily:SANS}}>Done</button>
                }
              </div>
              <button onClick={() => setCookMode(false)} style={{marginTop:18,background:"none",border:"none",color:"rgba(255,249,238,0.64)",cursor:"pointer",fontSize:"0.82em",fontFamily:SANS,fontWeight:700}}>Exit Cook Mode</button>
            </div>
          </div>
        );
      }

      return (
        <div style={{minHeight:"100vh",background:C.cream,paddingBottom:NAV_CLEARANCE}}>
          {timerAlert}
          {/* Hero */}
          <div style={{minHeight:200,position:"relative",display:"flex",alignItems:"flex-end",overflow:"hidden",background:hasHeroImage?"#000":`linear-gradient(135deg, ${color}, ${color}AA)`}}>
            {hasHeroImage && (
              <img src={recipe.heroImage} alt={recipe.title}
                style={{position:"absolute",inset:0,width:"100%",height:"100%",objectFit:"cover",opacity:0.75}}
                onError={(e) => { e.target.style.display="none"; }} />
            )}
            <div style={{position:"absolute",inset:0,background:"linear-gradient(to bottom, rgba(0,0,0,0.1), rgba(0,0,0,0.65))"}} />
            <div style={{position:"absolute",top:"calc(env(safe-area-inset-top, 0px) + 12px)",left:"max(env(safe-area-inset-left, 0px), 14px)"}}>
              <button onClick={onBack} style={{background:"rgba(0,0,0,0.42)",border:"none",borderRadius:8,padding:"9px 14px",minHeight:38,color:C.white,cursor:"pointer",fontSize:"0.8em",fontFamily:SANS,touchAction:"manipulation"}}>← Library</button>
            </div>
            {!recipe.householdShared && (
              <div style={{position:"absolute",top:"calc(env(safe-area-inset-top, 0px) + 12px)",right:"max(env(safe-area-inset-right, 0px), 14px)",display:"flex",gap:7}}>
                <button onClick={() => onUpdate({...recipe,favorite:!recipe.favorite})} style={{background:"rgba(0,0,0,0.42)",border:"none",borderRadius:8,padding:"8px 11px",minHeight:38,color:recipe.favorite?C.goldLight:C.white,cursor:"pointer",fontSize:"1em",display:"inline-flex",alignItems:"center",justifyContent:"center",touchAction:"manipulation"}}><Icon name="favorite" size={17} strokeWidth={recipe.favorite?2.5:2} /></button>
                <button onClick={onEdit} style={{background:"rgba(0,0,0,0.42)",border:"none",borderRadius:8,padding:"9px 13px",minHeight:38,color:C.white,cursor:"pointer",fontSize:"0.8em",fontFamily:SANS,touchAction:"manipulation"}}>Edit</button>
                <button onClick={onDelete} style={{background:"rgba(180,0,0,0.48)",border:"none",borderRadius:8,padding:"9px 13px",minHeight:38,color:C.white,cursor:"pointer",fontSize:"0.8em",fontFamily:SANS,touchAction:"manipulation"}}>Delete</button>
              </div>
            )}
            <div style={{position:"relative",padding:"0 20px 18px",width:"100%"}}>
              <div style={{fontSize:"0.7em",color:"rgba(255,255,255,0.65)",letterSpacing:2,textTransform:"uppercase",marginBottom:4}}>{recipe.category}</div>
              <h1 style={{margin:0,fontFamily:SERIF,fontSize:"clamp(1.5em,5vw,2.3em)",color:C.white,fontWeight:400,lineHeight:1.1}}>{recipe.title}</h1>
              <div style={{display:"flex",gap:14,marginTop:7,flexWrap:"wrap",alignItems:"center"}}>
                {recipe.cookTime && <span style={{color:"rgba(255,255,255,0.82)",fontSize:"0.8em",display:"inline-flex",alignItems:"center",gap:5}}><Icon name="timer" size={14} /> {recipe.cookTime}</span>}
                <span style={{color:"rgba(255,255,255,0.82)",fontSize:"0.8em",display:"inline-flex",alignItems:"center",gap:5}}><Icon name="recipeCard" size={14} /> {Math.round((recipe.servings||4)*scale)} servings</span>
                {recipe.rating>0 && <Stars value={recipe.rating} size={13} />}
              </div>
            </div>
          </div>

          <div style={{maxWidth:980,margin:"0 auto",padding:"0 16px"}}>
            {/* Action bar */}
            <div style={{display:"flex",gap:7,padding:"13px 0",overflowX:"auto",borderBottom:"1px solid "+C.border}}>
              {[
                {label:"Cook",action:()=>setCookMode(true),bg:C.green,color:C.white,border:"none"},
                {label:"Share",icon:"share",action:shareRecipe,bg:C.cream2,color:C.brown,border:"1px solid "+C.border},
                {label:"Adjust",action:()=>setShowAI(!showAI),bg:C.cream2,color:C.brown,border:"1px solid "+C.border},
                {label:"Shopping List",action:()=>setShowShop(!showShop),bg:C.goldPale,color:C.brown,border:"1px solid "+C.goldLight},
                {label:"What to Buy",action:()=>setShowWTB(!showWTB),bg:C.terraPale,color:C.terra,border:"1px solid "+C.terra+"25"},
                {label:"PDF",icon:"pdf",action:exportPDF,bg:C.greenPale,color:C.green,border:"1px solid "+C.green+"25"},
              ].map((btn) => (
                <button key={btn.label} onClick={btn.action} style={{background:btn.bg,color:btn.color,border:btn.border,borderRadius:9,padding:"7px 14px",fontWeight:800,cursor:"pointer",fontSize:"0.8em",fontFamily:SANS,whiteSpace:"nowrap",flexShrink:0,display:"inline-flex",alignItems:"center",gap:6}}>{btn.icon && <Icon name={btn.icon} size={15} />}{btn.label}</button>
              ))}
            </div>

            {/* Household sharing (M2): read-only "added by" badge for a member's
                shared recipe, or a share toggle on your own recipe. */}
            {recipe.householdShared ? (
              <div style={{display:"inline-flex",alignItems:"center",gap:7,background:C.greenPale,border:"1px solid "+C.green+"33",borderRadius:999,padding:"6px 13px",margin:"4px 0 10px",fontSize:"0.78em",color:C.green,fontWeight:700}}>
                <Icon name="sync" size={14} /> Shared by {recipe.ownerName || "a household member"}
              </div>
            ) : (inHousehold && (
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,background:recipe.shared?C.greenPale:C.cream2,border:"1px solid "+(recipe.shared?C.green+"40":C.border),borderRadius:11,padding:"10px 13px",margin:"4px 0 12px"}}>
                <div style={{minWidth:0}}>
                  <div style={{fontWeight:800,color:C.dark,fontSize:"0.84em"}}>{recipe.shared ? "Shared with your household" : "Share with your household"}</div>
                  <div style={{fontSize:"0.72em",color:C.light}}>{recipe.shared ? "Everyone in your household can see this recipe." : "Let your household see this recipe in their library."}</div>
                </div>
                <button onClick={()=>onUpdate({...recipe,shared:!recipe.shared})}
                  style={{flexShrink:0,width:46,height:26,borderRadius:999,border:"none",cursor:"pointer",background:recipe.shared?C.green:C.cream3,position:"relative",transition:"background 0.15s",touchAction:"manipulation"}} aria-label="Toggle household sharing">
                  <span style={{position:"absolute",top:3,left:recipe.shared?23:3,width:20,height:20,borderRadius:"50%",background:C.white,transition:"left 0.15s",boxShadow:"0 1px 3px rgba(0,0,0,0.25)"}} />
                </button>
              </div>
            ))}

            {/* Rating (own recipes only) */}
            {!recipe.householdShared && (
            <div style={{padding:"10px 0",display:"flex",alignItems:"center",gap:10}}>
              <span style={{fontSize:"0.8em",color:C.light}}>Your rating:</span>
              <Stars value={recipe.rating||0} onChange={(v)=>onUpdate({...recipe,rating:v})} size={20} />
            </div>
            )}

            {/* Import review banner (Phase 4): surfaces grounding/verification
                warnings for AI imports so the user can confirm or fix, instead of
                trusting a possibly-drifted import silently. Persist-dismissed. */}
            {recipe.importWarnings?.length > 0 && (
              <div style={{background:C.goldPale,border:"1px solid "+C.goldLight,borderRadius:12,padding:"12px 14px",marginBottom:14}}>
                <div style={{fontWeight:800,color:C.brown,fontSize:"0.86em",marginBottom:6}}>⚠️ Double-check this AI import</div>
                <ul style={{margin:"0 0 10px",paddingLeft:18,color:C.brown,fontSize:"0.79em",lineHeight:1.5}}>
                  {recipe.importWarnings.map((w,i)=><li key={i} style={{marginBottom:3}}>{w}</li>)}
                </ul>
                <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
                  <button onClick={onEdit} style={{background:C.brown,border:"none",borderRadius:8,padding:"7px 14px",color:C.white,fontWeight:800,fontSize:"0.78em",cursor:"pointer",fontFamily:SANS,touchAction:"manipulation"}}>Edit recipe</button>
                  <button onClick={()=>onUpdate({...recipe,importWarnings:[],reviewedAt:new Date().toISOString()})} style={{background:"transparent",border:"1px solid "+C.goldLight,borderRadius:8,padding:"7px 14px",color:C.brown,fontWeight:700,fontSize:"0.78em",cursor:"pointer",fontFamily:SANS,touchAction:"manipulation"}}>Looks right</button>
                  {recipe.importConfidence != null && <span style={{fontSize:"0.72em",color:C.brown,opacity:0.75,marginLeft:"auto"}}>match {Math.round(recipe.importConfidence*100)}%</span>}
                </div>
              </div>
            )}

            {recipe.description && <p style={{color:C.mid,lineHeight:1.7,margin:"0 0 14px",fontSize:"0.92em"}}>{recipe.description}</p>}
            {recipe.tags?.length>0 && <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:14}}>{recipe.tags.map((t)=><Tag key={t} label={t} onClick={onTagClick} />)}</div>}

            {/* Smart Collections curation (own recipes): manual choice beats AI
                tags. Toggling on/off stores an include/exclude override; returning
                to the tag default clears it. */}
            {!recipe.householdShared && (() => {
              const active = RecipeBoxTags.collectionKeys(recipe);
              const labels = [];
              const seen = new Set();
              [...Array.from(active).map((k)=>RecipeBoxTags.displayTag(k)), ...RecipeBoxTags.SMART_COLLECTIONS].forEach((lbl)=>{
                const k = RecipeBoxTags.normalizeTagKey(lbl);
                if (k && !seen.has(k)) { seen.add(k); labels.push(lbl); }
              });
              return (
                <div style={{marginBottom:16}}>
                  <button onClick={()=>setShowCollections((v)=>!v)}
                    style={{background:"none",border:"none",padding:0,cursor:"pointer",fontFamily:SANS,display:"inline-flex",alignItems:"center",gap:6,color:C.brown,fontWeight:800,fontSize:"0.76em",letterSpacing:"0.03em",textTransform:"uppercase"}}>
                    Smart Collections <span style={{fontSize:"0.85em"}}>{showCollections?"▲":"▼"}</span>
                  </button>
                  {showCollections && (
                    <div style={{marginTop:9}}>
                      <div style={{fontSize:"0.74em",color:C.light,lineHeight:1.5,marginBottom:9}}>Tap to add or remove this recipe from a collection. Your choice always wins over auto-tagging.</div>
                      <div style={{display:"flex",flexWrap:"wrap",gap:7}}>
                        {labels.map((lbl)=>{
                          const member = RecipeBoxTags.recipeInCollection(recipe, lbl);
                          return (
                            <button key={lbl} onClick={()=>onUpdate({...recipe, collectionOverrides: RecipeBoxTags.setCollectionMembership(recipe, lbl, !member)})}
                              style={{display:"inline-flex",alignItems:"center",gap:5,background:member?C.green:C.cream2,border:"1px solid "+(member?C.green:C.border),color:member?C.white:C.mid,borderRadius:999,padding:"6px 12px",fontSize:"0.78em",fontWeight:700,cursor:"pointer",fontFamily:SANS,touchAction:"manipulation"}}>
                              <span style={{fontSize:"0.9em"}}>{member?"✓":"+"}</span>{RecipeBoxTags.displayTag(lbl)}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {recipe.originalSource?.pages?.length > 0 && (
              <button onClick={()=>setShowOriginal(true)}
                style={{display:"flex",alignItems:"center",gap:12,width:"100%",textAlign:"left",border:"1px solid "+C.goldLight,background:C.goldPale,borderRadius:12,padding:"10px 13px",marginBottom:16,cursor:"pointer",fontFamily:SANS}}>
                <span style={{flexShrink:0,width:42,height:42,borderRadius:9,overflow:"hidden",background:C.cream2,border:"1px solid "+C.goldLight,display:"flex",alignItems:"center",justifyContent:"center"}}>
                  <img src={recipe.originalSource.pages[0]} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}} />
                </span>
                <span style={{flex:1,minWidth:0}}>
                  <span style={{display:"block",fontWeight:800,color:C.brown,fontSize:"0.9em"}}>See the original {recipe.originalSource.kind === "pdf" ? "pages" : "recipe card"}</span>
                  <span style={{display:"block",color:C.light,fontSize:"0.76em",marginTop:1}}>Tap to view the {recipe.originalSource.pages.length>1 ? recipe.originalSource.pages.length+" images you imported" : "image you imported"}</span>
                </span>
                <span style={{color:C.gold,fontWeight:900,fontSize:"1.1em"}}>›</span>
              </button>
            )}
            {showOriginal && recipe.originalSource?.pages?.length > 0 && (
              <div onClick={()=>setShowOriginal(false)}
                style={{position:"fixed",inset:0,zIndex:80,background:"rgba(20,12,8,0.88)",display:"flex",flexDirection:"column",padding:"max(env(safe-area-inset-top),16px) 14px max(env(safe-area-inset-bottom),16px)"}}>
                <div onClick={(e)=>e.stopPropagation()} style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,marginBottom:12,flexShrink:0}}>
                  <div style={{color:C.white,fontFamily:SERIF,fontSize:"1.1em"}}>Original {recipe.originalSource.kind === "pdf" ? "pages" : "recipe card"}</div>
                  <button onClick={()=>setShowOriginal(false)} style={{background:"rgba(255,255,255,0.16)",border:"none",borderRadius:9,color:C.white,padding:"10px 16px",minHeight:40,cursor:"pointer",fontFamily:SANS,fontSize:"0.85em",fontWeight:700,touchAction:"manipulation"}}>Close</button>
                </div>
                <div onClick={(e)=>e.stopPropagation()} style={{flex:1,overflowY:"auto",WebkitOverflowScrolling:"touch",overscrollBehavior:"contain",display:"flex",flexDirection:"column",gap:12,alignItems:"center"}}>
                  {recipe.originalSource.pages.map((p,i)=>(
                    <img key={i} src={p} alt={"Original page "+(i+1)} style={{maxWidth:"100%",borderRadius:10,boxShadow:"0 8px 30px rgba(0,0,0,0.5)"}} />
                  ))}
                </div>
                <div style={{color:"rgba(255,255,255,0.6)",fontSize:"0.72em",textAlign:"center",marginTop:10,flexShrink:0}}>Saved from your import · for your reference</div>
              </div>
            )}

            {/* Nutrition */}
            {(() => {
              const macros = recipe.macros || {};
              const hasMacros = Object.values(macros).some((v)=>Number(v)>0);
              const totalServings = Math.max(1, Math.round((Number(recipe.servings)||1) * scale));
              const factor = macroWhole ? totalServings : 1;
              const stale = !!recipe.nutritionBasis && RecipeBoxNutrition.ingredientsFingerprint(recipe) !== recipe.nutritionBasis;
              const estimateBtn = (
                <button onClick={runNutritionEstimate} disabled={nutLoading}
                  style={{display:"inline-flex",alignItems:"center",gap:7,background:nutLoading?C.cream2:C.greenPale,border:"1px solid "+(nutLoading?C.border:C.green+"55"),borderRadius:9,padding:"8px 13px",color:C.green,fontWeight:800,fontSize:"0.8em",cursor:nutLoading?"default":"pointer",fontFamily:SANS,touchAction:"manipulation"}}>
                  {nutLoading
                    ? <><span style={{width:13,height:13,border:"2px solid "+C.green+"55",borderTopColor:C.green,borderRadius:"50%",display:"inline-block",animation:"spin 0.7s linear infinite"}} /> Estimating…</>
                    : <><Icon name="chef" size={15} /> {hasMacros ? "Re-estimate with AI" : "Estimate nutrition"} · 1 AI Assist</>}
                </button>
              );
              if (!hasMacros) {
                return (
                  <div style={{...S.cardSoft,marginBottom:18,padding:"12px 14px"}}>
                    <div style={{fontSize:"0.66em",color:C.light,letterSpacing:1,textTransform:"uppercase",fontWeight:800,marginBottom:8}}>Nutrition</div>
                    <div style={{fontSize:"0.82em",color:C.mid,lineHeight:1.5,marginBottom:11}}>No nutrition estimate yet. Get approximate per-serving calories and macros from the ingredient list.</div>
                    {estimateBtn}
                    {nutError && <div style={{marginTop:9,fontSize:"0.76em",color:C.red,lineHeight:1.45}}>{nutError}</div>}
                  </div>
                );
              }
              return (
              <div style={{...S.cardSoft,marginBottom:18,padding:"12px 14px"}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,marginBottom:10,flexWrap:"wrap"}}>
                  <div style={{fontSize:"0.66em",color:C.light,letterSpacing:1,textTransform:"uppercase",fontWeight:800}}>Nutrition · estimated</div>
                  <div style={{display:"inline-flex",background:C.cream2,border:"1px solid "+C.border,borderRadius:999,padding:2}}>
                    {[["serving","Per serving"],["whole","Whole recipe"]].map(([k,lbl])=>{
                      const active = (k==="whole") === macroWhole;
                      return <button key={k} onClick={()=>setMacroWhole(k==="whole")} style={{border:"none",borderRadius:999,padding:"5px 11px",fontSize:"0.7em",fontWeight:800,cursor:"pointer",fontFamily:SANS,background:active?C.green:"transparent",color:active?C.white:C.light,touchAction:"manipulation"}}>{lbl}</button>;
                    })}
                  </div>
                </div>
                <div style={{display:"flex",gap:7,flexWrap:"wrap",alignItems:"flex-end"}}>
                  {[["Calories",recipe.macros.calories,"",C.terra],["Protein",recipe.macros.protein,"g",C.blue],["Carbs",recipe.macros.carbs,"g",C.gold],["Fat",recipe.macros.fat,"g",C.greenMid||"#4A7C2F"],["Fiber",recipe.macros.fiber,"g",C.brown]].map(([label,val,unit,clr])=>(
                    <div key={label} style={{textAlign:"center",minWidth:56}}>
                      <div style={{fontSize:"1.05em",fontWeight:700,color:clr,fontFamily:SERIF}}>{Math.round((val||0)*factor)}{unit}</div>
                      <div style={{fontSize:"0.65em",color:C.light,letterSpacing:1,textTransform:"uppercase"}}>{label}</div>
                    </div>
                  ))}
                  <div style={{fontSize:"0.68em",color:C.light,alignSelf:"flex-end",marginLeft:"auto"}}>{macroWhole ? "whole recipe ("+totalServings+" servings)" : "per serving"}</div>
                </div>
                {stale && (
                  <div style={{marginTop:10,fontSize:"0.74em",color:C.brown,background:C.goldPale,border:"1px solid "+C.goldLight,borderRadius:8,padding:"7px 10px",lineHeight:1.45}}>
                    Ingredients changed since this estimate — re-estimate for updated numbers.
                  </div>
                )}
                <div style={{marginTop:11,display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                  {estimateBtn}
                  <span style={{fontSize:"0.7em",color:C.light}}>Approximate · not medical or dietary advice</span>
                </div>
                {nutError && <div style={{marginTop:8,fontSize:"0.76em",color:C.red,lineHeight:1.45}}>{nutError}</div>}
              </div>
              );
            })()}

            {/* Scale */}
            <div style={{...S.cardSoft,display:"flex",gap:5,alignItems:"center",flexWrap:"wrap",marginBottom:18,padding:"9px 13px"}}>
              <span style={{color:C.light,fontSize:"0.8em",marginRight:3}}>Scale:</span>
              {[0.5,1,1.5,2,3].map((f)=>(
                <button key={f} onClick={()=>setScale(f)} style={{background:scale===f?C.green:C.cream2,color:scale===f?C.white:C.mid,border:"none",borderRadius:7,padding:"5px 10px",cursor:"pointer",fontWeight:scale===f?800:600,fontSize:"0.78em",fontFamily:SANS}}>
                  {f===0.5?"½×":f+"×"}
                </button>
              ))}
              <div style={{width:1,background:C.border,height:18,margin:"0 3px"}} />
              {["US","Metric"].map((u)=>(
                <button key={u} onClick={()=>setMetric(u==="Metric")} style={{background:(metric?"Metric":"US")===u?C.green:C.cream2,color:(metric?"Metric":"US")===u?C.white:C.mid,border:"none",borderRadius:7,padding:"5px 10px",cursor:"pointer",fontSize:"0.78em",fontFamily:SANS,fontWeight:700}}>{u}</button>
              ))}
            </div>

            {/* AI adjust */}
            {showAI && (
              <div style={{...S.cardSoft,background:C.goldPale,border:"1px solid "+C.goldLight,padding:16,marginBottom:18}}>
                <div style={{fontFamily:SERIF,fontSize:"1.05em",marginBottom:4}}>Recipe Adjustment</div>
                <div style={{color:C.brownLight,fontSize:"0.78em",marginBottom:10}}>Try: "make gluten-free", "dairy-free", "lower calorie", "swap butter for olive oil"</div>
                <div style={{display:"flex",gap:7}}>
                  <input value={aiQuery} onChange={(e)=>setAiQuery(e.target.value)} onKeyDown={(e)=>e.key==="Enter"&&runAIAdjust()} placeholder="What would you like to change?" style={{...S.input,flex:1,padding:"8px 12px",fontSize:"0.88em"}} />
                  <button onClick={runAIAdjust} disabled={aiLoading} style={{...S.goldBtn,borderRadius:8,padding:"8px 18px",display:"flex",alignItems:"center",gap:6}}>{aiLoading?<Spinner/>:"Apply"}</button>
                </div>
                {aiError && <div style={{marginTop:9,background:C.redPale,border:"1px solid rgba(192,57,43,0.25)",borderRadius:8,padding:"8px 10px",color:C.red,fontSize:"0.78em",fontWeight:800,lineHeight:1.4}}>{aiError}</div>}
                {aiResult && (
                  <div style={{...S.cardSoft,marginTop:11,padding:11}}>
                    <div style={{fontWeight:600,marginBottom:7,color:C.dark,fontSize:"0.9em"}}>Preview: {aiResult.title}</div>
                    <div style={{display:"flex",gap:7}}>
                      <button onClick={()=>{ const r={...aiResult,id:uid(),createdAt:new Date().toISOString(),title:aiResult.title+" (adjusted)",rating:0,favorite:false,collectionOverrides:recipe.collectionOverrides}; onImport(r); setShowAI(false); setAiResult(null); }} style={{...S.primaryBtn,borderRadius:7,padding:"7px 14px",fontSize:"0.82em"}}>Save as new version</button>
                      <button onClick={()=>setAiResult(null)} style={{background:"none",border:"1px solid "+C.border,color:C.mid,borderRadius:6,padding:"6px 12px",cursor:"pointer",fontSize:"0.82em",fontFamily:SANS}}>Discard</button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Shopping list */}
            {showShop && (
              <div style={{...S.cardSoft,background:C.greenPale,border:"1px solid "+C.green+"30",padding:16,marginBottom:18}}>
                <div style={{fontFamily:SERIF,fontSize:"1.05em",marginBottom:11}}>Shopping List</div>
                {shoppingGroups.map((group) => (
                  <div key={group.category} style={{marginBottom:group.category===shoppingGroups[shoppingGroups.length-1]?.category?0:12}}>
                    <div style={{fontSize:"0.68em",letterSpacing:1.8,textTransform:"uppercase",fontWeight:800,color:C.green,margin:"0 0 5px"}}>{group.category}</div>
                    {group.items.map((item) => (
                      <div key={item.id} title={item.warning || ""} style={{padding:"5px 0",borderBottom:"1px solid "+C.blue+"18",fontSize:"0.88em",color:C.dark,display:"flex",alignItems:"center",gap:8}}>
                        <span style={{width:14,height:14,border:"1.5px solid "+C.green,borderRadius:4,flexShrink:0}} />
                        <span>{item.text}</span>
                      </div>
                    ))}
                  </div>
                ))}
                {onAddToShopping && (
                  <button onClick={() => onAddToShopping(recipe.id)}
                    style={{marginTop:14,width:"100%",background:C.green,color:C.white,border:"none",borderRadius:11,padding:"11px 14px",fontWeight:800,fontSize:"0.85em",cursor:"pointer",fontFamily:SANS,display:"inline-flex",alignItems:"center",justifyContent:"center",gap:8,WebkitTapHighlightColor:"transparent"}}>
                    <Icon name="shoppingList" size={16} /> Add to my shopping list
                  </button>
                )}
                <div style={{fontSize:"0.72em",color:C.mid,marginTop:8,textAlign:"center"}}>Combines with other recipes you add, grouped by grocery aisle.</div>
              </div>
            )}

            {/* What to buy */}
            {showWTB && (
              <div style={{...S.cardSoft,background:C.terraPale,border:"1px solid "+C.terra+"30",padding:16,marginBottom:18}}>
                <div style={{fontFamily:SERIF,fontSize:"1.05em",marginBottom:11}}>What Do I Need to Buy?</div>
                <div style={{display:"flex",gap:7,marginBottom:12}}>
                  {["text","photo"].map((m)=>(
                    <button key={m} onClick={()=>{setWtbMode(m);setWtbResult(null);}} style={{flex:1,padding:8,border:"2px solid "+(wtbMode===m?C.terra:C.border),borderRadius:8,background:wtbMode===m?C.terra:C.paper,color:wtbMode===m?C.white:C.mid,fontWeight:800,cursor:"pointer",fontSize:"0.8em",fontFamily:SANS}}>{m==="photo"?"Photo":"Describe"}</button>
                  ))}
                </div>
                {!wtbResult ? (
                  <div>
                    {wtbMode==="text"
                      ? <textarea value={wtbText} onChange={(e)=>setWtbText(e.target.value)} placeholder="List ingredients you have..." rows={3} style={{...S.input,width:"100%",padding:"8px 11px",fontSize:"0.86em",resize:"vertical",marginBottom:9,boxSizing:"border-box"}} />
                      : <div>
                          <input ref={wtbImgRef} type="file" accept="image/*" onChange={async (e)=>{ const f=e.target.files[0]; if(!f)return; const b=await fileToBase64(f); setWtbImage(b); }} style={{display:"none"}} />
                          <div onClick={()=>wtbImgRef.current.click()} style={{border:"2px dashed "+C.border,borderRadius:8,padding:22,textAlign:"center",cursor:"pointer",color:wtbImage?C.green:C.light,marginBottom:9,background:wtbImage?C.greenPale:"transparent",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>{wtbImage && <Icon name="check" size={17} />}{wtbImage?"Photo ready":"Upload fridge/pantry photo"}</div>
                        </div>
                    }
                    <button onClick={runWTB} disabled={wtbLoading||(wtbMode==="text"&&!wtbText.trim())||(wtbMode==="photo"&&!wtbImage)} style={{width:"100%",background:C.terra,color:C.white,border:"none",borderRadius:9,padding:"10px",fontWeight:800,cursor:"pointer",fontFamily:SANS,display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>{wtbLoading?<><Spinner/> Analyzing...</>:"Analyze My Kitchen"}</button>
                  </div>
                ) : (
                  <div>
                    {wtbResult.have?.length>0 && <div style={{marginBottom:11}}><div style={{fontWeight:700,color:C.green,fontSize:"0.78em",letterSpacing:1,textTransform:"uppercase",marginBottom:5,display:"flex",alignItems:"center",gap:6}}><Icon name="check" size={15} /> You Have</div>{wtbResult.have.map((x,i)=><div key={i} style={{padding:"4px 0",borderBottom:"1px solid "+C.greenPale,fontSize:"0.86em",display:"flex",alignItems:"center",gap:7}}><Icon name="check" size={14} /> {x}</div>)}</div>}
                    {wtbResult.need?.length>0 && <div style={{marginBottom:11}}><div style={{fontWeight:700,color:C.red,fontSize:"0.78em",letterSpacing:1,textTransform:"uppercase",marginBottom:5,display:"flex",alignItems:"center",gap:6}}><Icon name="shoppingList" size={15} /> Need to Buy</div>{wtbResult.need.map((x,i)=><div key={i} style={{padding:"4px 0",borderBottom:"1px solid "+C.redPale,fontSize:"0.86em",display:"flex",alignItems:"center",gap:8}}><span style={{width:13,height:13,border:"1.5px solid "+C.red,borderRadius:4,flexShrink:0}} />{x}</div>)}</div>}
                    {wtbResult.notes && <div style={{background:C.goldPale,borderRadius:8,padding:"7px 11px",fontSize:"0.8em",color:C.brown,marginBottom:7}}>{wtbResult.notes}</div>}
                    <button onClick={()=>setWtbResult(null)} style={{background:"none",border:"1px solid "+C.border,color:C.mid,borderRadius:8,padding:"6px 14px",cursor:"pointer",fontSize:"0.82em",fontFamily:SANS}}>Try again</button>
                  </div>
                )}
              </div>
            )}

            {recipe.notes && String(recipe.notes).trim() && (
              <div style={{...S.cardSoft,background:C.goldPale,border:"1px solid "+C.goldLight,padding:16,marginBottom:22}}>
                <div style={{fontSize:"0.66em",letterSpacing:2.4,textTransform:"uppercase",fontWeight:800,color:C.brownLight,marginBottom:8}}>Notes</div>
                <div style={{fontSize:"0.9em",lineHeight:1.7,color:C.mid,whiteSpace:"pre-wrap",overflowWrap:"break-word"}}>
                  <NoteText text={recipe.notes} />
                </div>
              </div>
            )}

            {/* Recipe sections */}
            {displaySections.map((sec,si)=>(
              <div key={si} style={{marginBottom:44}}>
                {displaySections.length>1 && <h2 style={{fontFamily:SERIF,fontSize:"1.2em",fontWeight:400,color:C.dark,borderBottom:"2px solid "+C.dark,paddingBottom:7,marginBottom:22}}>{sec.name}</h2>}
                <div style={{display:"grid",gridTemplateColumns:"1fr",gap:32}}>
                  <div>
                    <div style={{fontSize:"0.66em",letterSpacing:3,textTransform:"uppercase",fontWeight:700,color:C.brownLight,marginBottom:13}}>Ingredients</div>
                    {RecipeBoxShopping.groupCompoundIngredients(sec.ingredients).map((grp,i)=>{
                      const measure = grp.items.map((it)=>{ const m=displayIngredientMeasure(it,scale,metric); return displayAmount(m.amount)+(m.unit?" "+m.unit:""); }).filter(Boolean).join(" + ");
                      const compound = grp.items.length>1;
                      return <div key={i} style={{padding:"8px 0",borderBottom:"1px solid "+C.cream3,display:"flex",gap:9,alignItems:"baseline"}}><span style={{fontWeight:700,minWidth:110,color:C.dark,fontSize:"0.98em",whiteSpace:compound?"normal":"nowrap",letterSpacing:"0.01em"}}>{measure}</span><span style={{color:C.mid,fontSize:"0.88em"}}>{grp.name}</span></div>;
                    })}
                  </div>
                  <div>
                    <div style={{fontSize:"0.66em",letterSpacing:3,textTransform:"uppercase",fontWeight:700,color:C.brownLight,marginBottom:13}}>Directions</div>
                    {sec.steps.map((step,i)=>{ const tMeta=timerOptions(step.text),tK=si+"-"+i,timer=timers[tK]; return (
                      <div key={i} style={{display:"flex",gap:13,marginBottom:22}}>
                        <div style={{minWidth:28,height:28,borderRadius:"50%",background:C.dark,color:C.white,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,fontSize:"0.8em",flexShrink:0,marginTop:2}}>{i+1}</div>
                        <div style={{flex:1,minWidth:0,maxWidth:"100%",overflowX:"hidden"}}>
                          <p style={{margin:0,lineHeight:1.78,color:C.mid,fontSize:"0.9em",maxWidth:"100%",whiteSpace:"normal",overflowWrap:"break-word",wordBreak:"normal"}}><StepText text={step.text} ingredients={sec.ingredients} scale={scale} metric={metric} /></p>
                          {tMeta && (timer
                            ? <span style={{fontSize:"0.78em",fontWeight:700,color:timer.rem===0?C.red:C.brown,marginTop:6,display:"inline-flex",alignItems:"center",gap:5}}><Icon name={timer.rem===0?"bell":"timer"} size={14} />{timer.rem===0?"Done!":fmt(timer.rem)+" "}{timer.rem>0 && <button onClick={()=>setTimers((p)=>({...p,[tK]:{...p[tK],running:!p[tK].running}}))} style={{background:"none",border:"none",cursor:"pointer",fontSize:"0.73em",color:C.brownLight,fontFamily:SANS}}>{timer.running?"pause":"resume"}</button>}</span>
                            : tMeta.options.length === 1
                              ? <button onClick={()=>startTimer(tK, tMeta.defaultSec)} style={{marginTop:6,background:C.goldPale,border:"1px solid "+C.goldLight,borderRadius:5,padding:"2px 10px",fontSize:"0.73em",cursor:"pointer",color:C.brown,fontFamily:SANS,display:"inline-flex",alignItems:"center",gap:5}}><Icon name="timer" size={13} /> {tMeta.options[0].label} timer</button>
                              : <div style={{marginTop:8,display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
                                  <span style={{fontSize:"0.72em",fontWeight:700,color:C.brown,display:"inline-flex",alignItems:"center",gap:4}}><Icon name="timer" size={13} /> Timer</span>
                                  {tMeta.options.map((opt) => (
                                    <button key={opt.sec} onClick={()=>startTimer(tK, opt.sec)}
                                      style={{background:opt.sec===tMeta.defaultSec?C.goldPale:C.white,border:"1px solid "+(opt.sec===tMeta.defaultSec?C.goldLight:C.border),borderRadius:5,padding:"2px 8px",fontSize:"0.72em",cursor:"pointer",color:C.brown,fontWeight:opt.sec===tMeta.defaultSec?700:500,fontFamily:SANS}}>
                                      {opt.label}
                                    </button>
                                  ))}
                                </div>
                          )}
                        </div>
                      </div>
                    ); })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    }

    // Edit Recipe with AI Chat Helper
    function EditRecipe({ recipe, onSave, onCancel }) {
      const [draft, setDraft] = useState(() => JSON.parse(JSON.stringify(recipe)));
      const [aiChat, setAiChat] = useState("");
      const [aiLoading, setAiLoading] = useState(false);
      const [aiHistory, setAiHistory] = useState([]);
      const heroImgRef = useRef();

      const set = (k,v) => setDraft((p) => ({...p,[k]:v}));
      const setMacro = (k,v) => setDraft((p) => ({...p,macros:{...(p.macros||{}),[k]:parseFloat(v)||0}}));
      const updIng = (si,ii,k,v) => setDraft((p) => { const s=JSON.parse(JSON.stringify(p.sections)); s[si].ingredients[ii][k]=v; return {...p,sections:s}; });
      const updStep = (si,sti,v) => setDraft((p) => { const s=JSON.parse(JSON.stringify(p.sections)); s[si].steps[sti].text=v; return {...p,sections:s}; });
      const addIng = (si) => setDraft((p) => { const s=JSON.parse(JSON.stringify(p.sections)); s[si].ingredients.push({id:"i"+uid(),amount:"",unit:"",name:""}); return {...p,sections:s}; });
      const remIng = (si,ii) => setDraft((p) => { const s=JSON.parse(JSON.stringify(p.sections)); s[si].ingredients.splice(ii,1); return {...p,sections:s}; });
      const addStep = (si) => setDraft((p) => { const s=JSON.parse(JSON.stringify(p.sections)); s[si].steps.push({id:"s"+uid(),text:"",ingredientRefs:[]}); return {...p,sections:s}; });
      const remStep = (si,sti) => setDraft((p) => { const s=JSON.parse(JSON.stringify(p.sections)); s[si].steps.splice(sti,1); return {...p,sections:s}; });

      async function runEditorAI() {
        if (!aiChat.trim()) return;
        const userMsg = aiChat;
        setAiChat("");
        setAiLoading(true);
        const newHistory = [...aiHistory, { role:"user", content:userMsg }];
        setAiHistory(newHistory);
        try {
          const { originalSource, ...draftForAI } = draft;
          const systemPrompt = EDITOR_AI_PROMPT + "\n\nCurrent recipe JSON:\n" + JSON.stringify(draftForAI);
          const raw = await callAI(newHistory, systemPrompt, 2000);
          const updated = parseAIJson(raw);
          setDraft((p) => ({ ...updated, originalSource: p.originalSource }));
          setAiHistory([...newHistory, { role:"assistant", content:"Done! I've updated the recipe. You can make more changes or save when ready." }]);
        } catch(e) {
          setAiHistory([...newHistory, { role:"assistant", content:"Sorry, I couldn't apply that change. Try describing it differently." }]);
        }
        setAiLoading(false);
      }

      async function handleHeroImage(e) {
        const file = e.target.files[0];
        if (!file) return;
        const b = await fileToBase64(file);
        const dataUrl = "data:" + b.type + ";base64," + b.data;
        set("heroImage", dataUrl);
      }

      const iStyle = {padding:"8px 11px",border:"1px solid "+C.border,borderRadius:8,fontSize:"0.88em",outline:"none",fontFamily:SANS,width:"100%"};

      return (
        <div style={{minHeight:"100vh",width:"100%",overflowX:"hidden",background:C.cream}}>
          <div style={{...S.brandHeader,padding:safePad(15,20,15),display:"flex",alignItems:"center",gap:12,position:"sticky",top:0,zIndex:10}}>
            <button onClick={onCancel} style={{background:"rgba(255,255,255,0.12)",border:"none",borderRadius:8,padding:"7px 13px",color:C.white,cursor:"pointer",fontFamily:SANS,fontSize:"0.83em"}}>Cancel</button>
            <div style={{flex:1,color:"rgba(255,255,255,0.65)",fontSize:"0.86em",fontFamily:SERIF,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{draft.title}</div>
            <button onClick={() => onSave(draft)} style={{...S.goldBtn,borderRadius:8,padding:"8px 20px"}}>Save</button>
          </div>

          <div style={{maxWidth:760,margin:"0 auto",padding:"24px 20px"}}>

            {/* AI Chat Helper */}
            <div style={{background:"linear-gradient(135deg, "+C.goldPale+", "+C.terraPale+")",border:"1px solid "+C.goldLight,borderRadius:14,padding:16,marginBottom:20}}>
              <div style={{fontFamily:SERIF,fontSize:"1.1em",color:C.dark,marginBottom:4,display:"flex",alignItems:"center",gap:7}}><Icon name="spark" size={18} /> AI Recipe Helper</div>
              <div style={{color:C.brownLight,fontSize:"0.78em",marginBottom:10}}>Describe any change and AI will update the recipe instantly. Try: "add a gluten-free note", "swap cream for coconut milk", "add prep time", "make the steps more detailed"</div>
              {aiHistory.length > 0 && (
                <div style={{marginBottom:10,maxHeight:160,overflowY:"auto",display:"flex",flexDirection:"column",gap:6}}>
                  {aiHistory.map((m,i) => (
                    <div key={i} style={{display:"flex",justifyContent:m.role==="user"?"flex-end":"flex-start"}}>
                      <div style={{maxWidth:"85%",background:m.role==="user"?C.dark:C.white,color:m.role==="user"?C.white:C.dark,borderRadius:10,padding:"7px 11px",fontSize:"0.82em",lineHeight:1.5}}>{m.content}</div>
                    </div>
                  ))}
                  {aiLoading && <div style={{display:"flex"}}><div style={{background:C.white,borderRadius:10,padding:"7px 11px",fontSize:"0.82em",color:C.light}}>Updating recipe...</div></div>}
                </div>
              )}
              <div style={{display:"flex",gap:7}}>
                <input value={aiChat} onChange={(e)=>setAiChat(e.target.value)} onKeyDown={(e)=>e.key==="Enter"&&runEditorAI()} placeholder="Describe a change..." style={{...S.input,flex:1,padding:"8px 12px",fontSize:"0.88em"}} />
                <button onClick={runEditorAI} disabled={aiLoading||!aiChat.trim()} style={{...S.goldBtn,borderRadius:8,padding:"8px 16px",display:"flex",alignItems:"center",gap:5,opacity:aiLoading?0.6:1}}>{aiLoading?<Spinner/>:"Go"}</button>
              </div>
            </div>

            {/* Hero image */}
            <div style={{marginBottom:14}}>
              <label style={{display:"block",fontWeight:600,color:C.dark,fontSize:"0.82em",marginBottom:7,textTransform:"uppercase",letterSpacing:0.5}}>Recipe Photo</label>
              <input ref={heroImgRef} type="file" accept="image/*,image/heic,image/heif" onChange={handleHeroImage} style={{display:"none"}} />
              {draft.heroImage ? (
                <div style={{position:"relative",borderRadius:10,overflow:"hidden",height:140}}>
                  <img src={draft.heroImage} alt="hero" style={{width:"100%",height:"100%",objectFit:"cover"}} />
                  <button onClick={()=>set("heroImage","")} style={{position:"absolute",top:8,right:8,background:"rgba(0,0,0,0.5)",border:"none",borderRadius:6,color:C.white,cursor:"pointer",padding:"4px 10px",fontSize:"0.78em"}}>Remove</button>
                  <button onClick={()=>heroImgRef.current.click()} style={{position:"absolute",top:8,left:8,background:"rgba(0,0,0,0.5)",border:"none",borderRadius:6,color:C.white,cursor:"pointer",padding:"4px 10px",fontSize:"0.78em"}}>Change</button>
                </div>
              ) : (
                <div onClick={()=>heroImgRef.current.click()} style={{border:"2px dashed "+C.border,borderRadius:10,padding:24,textAlign:"center",cursor:"pointer",color:C.light,background:C.cream2}}>
                  <div style={{display:"flex",justifyContent:"center",marginBottom:4}}><Icon name="camera" size={30} /></div>
                  <div style={{fontSize:"0.85em",fontWeight:600}}>Add a photo from camera roll</div>
                  <div style={{fontSize:"0.75em",marginTop:2,color:C.light}}>HEIC, JPG, PNG supported</div>
                </div>
              )}
            </div>

            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:9,marginBottom:10}}>
              <input value={draft.title} onChange={(e)=>set("title",e.target.value)} placeholder="Title" style={{...iStyle,gridColumn:"1/-1"}} />
              <input value={draft.cookTime||""} onChange={(e)=>set("cookTime",e.target.value)} placeholder="Cook time" style={iStyle} />
              <input value={String(draft.servings||"")} onChange={(e)=>set("servings",e.target.value)} placeholder="Servings" style={iStyle} />
              <select value={draft.category||""} onChange={(e)=>set("category",e.target.value)} style={{...iStyle,background:C.white}}>
                <option value="">-- Category --</option>
                {CATEGORIES.map((c)=><option key={c} value={c}>{c}</option>)}
              </select>
              <input value={(draft.tags||[]).join(", ")} onChange={(e)=>set("tags",e.target.value.split(",").map((t)=>t.trim()).filter(Boolean))} placeholder="Tags: quick, vegetarian..." style={iStyle} />
            </div>
            <textarea value={draft.description||""} onChange={(e)=>set("description",e.target.value)} placeholder="Description" rows={2} style={{width:"100%",padding:"8px 11px",border:"1px solid "+C.border,borderRadius:8,fontSize:"0.86em",resize:"vertical",outline:"none",marginBottom:10,boxSizing:"border-box",fontFamily:SANS}} />
            <textarea value={draft.notes||""} onChange={(e)=>set("notes",e.target.value)} placeholder="Notes, tips, source links, storage guidance..." rows={4} style={{width:"100%",padding:"8px 11px",border:"1px solid "+C.border,borderRadius:8,fontSize:"0.86em",resize:"vertical",outline:"none",marginBottom:10,boxSizing:"border-box",fontFamily:SANS}} />

            {/* Macros */}
            <div style={{background:C.goldPale,border:"1px solid "+C.goldLight,borderRadius:8,padding:13,marginBottom:12}}>
              <div style={{fontWeight:600,fontSize:"0.78em",color:C.brown,letterSpacing:1,textTransform:"uppercase",marginBottom:9}}>Nutrition (per serving)</div>
              <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
                {["calories","protein","carbs","fat","fiber"].map((k)=>(
                  <div key={k} style={{display:"flex",flexDirection:"column",gap:3,alignItems:"center"}}>
                    <label style={{fontSize:"0.65em",color:C.brownLight,textTransform:"uppercase",letterSpacing:1}}>{k}</label>
                    <input type="number" value={(draft.macros||{})[k]||""} onChange={(e)=>setMacro(k,e.target.value)} style={{width:65,padding:"5px 7px",border:"1px solid "+C.border,borderRadius:8,fontSize:"0.86em",outline:"none",textAlign:"center"}} />
                  </div>
                ))}
              </div>
            </div>

            {/* Sections */}
            {draft.sections.map((sec,si)=>(
              <div key={si} style={{...S.card,padding:16,marginBottom:14}}>
                <div style={{display:"flex",gap:7,alignItems:"center",marginBottom:12}}>
                  <strong style={{color:C.brown,fontSize:"0.82em"}}>Section:</strong>
                  <input value={sec.name} onChange={(e)=>{ const s=JSON.parse(JSON.stringify(draft.sections)); s[si].name=e.target.value; setDraft((p)=>({...p,sections:s})); }} style={{padding:"5px 9px",border:"1px solid "+C.border,borderRadius:6,fontSize:"0.86em",outline:"none",fontFamily:SANS}} />
                </div>
                <div style={{fontSize:"0.68em",letterSpacing:2,textTransform:"uppercase",color:C.brownLight,marginBottom:7}}>Ingredients</div>
                {sec.ingredients.map((ing,ii)=>(
                  <div key={ii} style={{display:"flex",gap:4,marginBottom:4,alignItems:"center"}}>
                    <input value={ing.amount} onChange={(e)=>updIng(si,ii,"amount",e.target.value)} placeholder="Amt" style={{width:50,padding:"5px 6px",border:"1px solid "+C.border,borderRadius:5,fontSize:"0.8em",outline:"none",fontFamily:SANS}} />
                    <input value={ing.unit||""} onChange={(e)=>updIng(si,ii,"unit",e.target.value)} placeholder="Unit" style={{width:58,padding:"5px 6px",border:"1px solid "+C.border,borderRadius:5,fontSize:"0.8em",outline:"none",fontFamily:SANS}} />
                    <input value={ing.name} onChange={(e)=>updIng(si,ii,"name",e.target.value)} placeholder="Ingredient" style={{flex:1,padding:"5px 6px",border:"1px solid "+C.border,borderRadius:5,fontSize:"0.8em",outline:"none",fontFamily:SANS}} />
                    <span style={{fontSize:"0.6em",color:C.cream3}}>id:{ing.id}</span>
                    <button onClick={()=>remIng(si,ii)} style={{background:"none",border:"none",color:C.red,cursor:"pointer",fontSize:"1em"}}>×</button>
                  </div>
                ))}
                <button onClick={()=>addIng(si)} style={{background:"none",border:"1px dashed "+C.goldLight,color:C.gold,borderRadius:5,padding:"3px 9px",cursor:"pointer",fontSize:"0.78em",marginTop:3,fontFamily:SANS}}>+ ingredient</button>
                <div style={{fontSize:"0.68em",letterSpacing:2,textTransform:"uppercase",color:C.brownLight,margin:"12px 0 7px"}}>Steps <span style={{textTransform:"none",letterSpacing:0,color:C.cream3,fontWeight:400}}>- use {"{i1}"} to embed amounts</span></div>
                {sec.steps.map((step,sti)=>(
                  <div key={sti} style={{display:"flex",gap:5,marginBottom:6,alignItems:"flex-start"}}>
                    <div style={{minWidth:20,height:20,borderRadius:"50%",background:C.dark,color:C.white,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"0.68em",fontWeight:700,marginTop:4}}>{sti+1}</div>
                    <textarea value={step.text} onChange={(e)=>updStep(si,sti,e.target.value)} rows={2} style={{flex:1,padding:"5px 8px",border:"1px solid "+C.border,borderRadius:5,fontSize:"0.83em",resize:"vertical",outline:"none",fontFamily:SANS}} />
                    <button onClick={()=>remStep(si,sti)} style={{background:"none",border:"none",color:C.red,cursor:"pointer",marginTop:4}}>×</button>
                  </div>
                ))}
                <button onClick={()=>addStep(si)} style={{background:"none",border:"1px dashed "+C.goldLight,color:C.gold,borderRadius:5,padding:"3px 9px",cursor:"pointer",fontSize:"0.78em",marginTop:3,fontFamily:SANS}}>+ step</button>
              </div>
            ))}
            <button onClick={()=>setDraft((p)=>{ const s=JSON.parse(JSON.stringify(p.sections)); s.push({name:"New Section",ingredients:[],steps:[]}); return {...p,sections:s}; })} style={{background:"none",border:"1px dashed "+C.border,color:C.light,borderRadius:8,padding:"7px 18px",cursor:"pointer",fontSize:"0.86em",fontFamily:SANS}}>+ Add section</button>
          </div>
        </div>
      );
    }

    function AuthScreen({ recipes, mealPlan, setAccount, onCloudData, initialMode, resetToken }) {
      const [mode, setMode] = useState(initialMode || "create");
      const [email, setEmail] = useState("");
      const [displayName, setDisplayName] = useState("");
      const [password, setPassword] = useState("");
      const [confirmPassword, setConfirmPassword] = useState("");
      const [syncLocal, setSyncLocal] = useState(() => hasLocalRecipeData(recipes, mealPlan));
      const [message, setMessage] = useState("");
      const [busy, setBusy] = useState(false);
      const localDataAvailable = hasLocalRecipeData(recipes, mealPlan);

      async function createAccount() {
        setBusy(true);
        setMessage("");
        try {
          if (password !== confirmPassword) throw new Error("Passwords do not match.");
          const data = await postJson("/api/auth/signup", { email, displayName, password, recipes:syncLocal?recipes:[], mealPlan:syncLocal?mealPlan:{} });
          setAccount(data.user);
          await onCloudData();
        } catch (err) {
          setMessage(err.message || "Could not create account.");
        } finally {
          setBusy(false);
        }
      }
      async function signIn() {
        setBusy(true);
        setMessage("");
        try {
          const data = await postJson("/api/auth/signin", { email, password });
          setAccount(data.user);
          if (syncLocal && localDataAvailable) {
            const migrated = await postJson("/api/auth/migrate", { recipes, mealPlan });
            await onCloudData(migrated.recipes, migrated.mealPlan);
          } else {
            await onCloudData();
          }
        } catch (err) {
          setMessage(err.message || "Could not sign in.");
        } finally {
          setBusy(false);
        }
      }
      async function requestReset() {
        setBusy(true);
        setMessage("");
        try {
          await postJson("/api/auth/request-password-reset", { email });
          setMessage("If that email has a RecipeBox account, a reset link is on the way.");
        } catch (err) {
          setMessage(err.message || "Could not send reset link.");
        } finally {
          setBusy(false);
        }
      }
      async function saveNewPassword() {
        setBusy(true);
        setMessage("");
        try {
          if (password !== confirmPassword) throw new Error("Passwords do not match.");
          await postJson("/api/auth/reset-password", { token:resetToken, password });
          window.history.replaceState({}, "", window.location.pathname);
          setPassword("");
          setConfirmPassword("");
          setMode("signin");
          setMessage("Password updated. Sign in with your new password.");
        } catch (err) {
          setMessage(err.message || "Could not reset password.");
        } finally {
          setBusy(false);
        }
      }

      const isCreate = mode === "create";
      const isResetRequest = mode === "reset";
      const isNewPassword = mode === "newpass";
      return (
        <div style={{minHeight:"100dvh",background:"transparent",display:"flex",alignItems:"center",justifyContent:"center",padding:"max(env(safe-area-inset-top),20px) 20px max(env(safe-area-inset-bottom),20px)"}}>
          <div style={{width:"100%",maxWidth:430}}>
            <div style={{textAlign:"center",marginBottom:20}}>
              <img src="/icon-192.png" alt="" style={{width:92,height:92,borderRadius:22,display:"block",margin:"0 auto 14px",boxShadow:"0 18px 55px rgba(28,20,16,0.28)"}} />
              <div style={{fontFamily:SERIF,fontSize:"2.3em",color:C.white,lineHeight:1}}>RecipeBox</div>
              <div style={{marginTop:6,color:C.brownLight,fontSize:"0.9em",fontWeight:700}}>Start your RecipeBox</div>
            </div>

            <div style={{background:C.cream,border:"1px solid rgba(255,255,255,0.16)",borderRadius:18,padding:18,boxShadow:"0 18px 60px rgba(0,0,0,0.28)"}}>
              {!isNewPassword && (
                <div style={{display:"flex",gap:8,marginBottom:14}}>
                  {["create","signin"].map((m) => (
                    <button key={m} onClick={() => { setMode(m); setMessage(""); }}
                      style={{flex:1,background:mode===m?C.green:C.white,color:mode===m?C.white:C.mid,border:"1px solid "+(mode===m?C.green:C.border),borderRadius:999,padding:"8px 12px",fontWeight:900,fontSize:"0.8em",fontFamily:SANS,cursor:"pointer"}}>
                      {m==="create" ? "Create account" : "Sign in"}
                    </button>
                  ))}
                </div>
              )}

              <div style={{display:"grid",gap:10}}>
                {!isNewPassword && (
                  <input value={email} onChange={(e)=>setEmail(e.target.value)} placeholder="Email address" inputMode="email" autoCapitalize="none"
                    style={{width:"100%",padding:"12px 13px",border:"1px solid "+C.border,borderRadius:10,fontFamily:SANS,fontSize:"0.92em",outline:"none",background:C.white}} />
                )}
                {isResetRequest ? (
                  <div style={{fontSize:"0.8em",color:C.light,lineHeight:1.45}}>Enter your email and RecipeBox will send a secure reset link.</div>
                ) : isCreate ? (
                  <>
                    <input value={displayName} onChange={(e)=>setDisplayName(e.target.value)} placeholder="Name (optional)"
                      style={{width:"100%",padding:"12px 13px",border:"1px solid "+C.border,borderRadius:10,fontFamily:SANS,fontSize:"0.92em",outline:"none",background:C.white}} />
                    <input type="password" value={password} onChange={(e)=>setPassword(e.target.value)} placeholder="Password"
                      style={{width:"100%",padding:"12px 13px",border:"1px solid "+C.border,borderRadius:10,fontFamily:SANS,fontSize:"0.92em",outline:"none",background:C.white}} />
                    <div style={{color:C.light,fontSize:"0.74em",lineHeight:1.35,marginTop:-5}}>At least 6 characters. No special rules.</div>
                    <input type="password" value={confirmPassword} onChange={(e)=>setConfirmPassword(e.target.value)} placeholder="Confirm password"
                      style={{width:"100%",padding:"12px 13px",border:"1px solid "+C.border,borderRadius:10,fontFamily:SANS,fontSize:"0.92em",outline:"none",background:C.white}} />
                  </>
                ) : isNewPassword ? (
                  <>
                    <div style={{fontFamily:SERIF,fontSize:"1.25em",color:C.dark}}>Choose a new password</div>
                    <input type="password" value={password} onChange={(e)=>setPassword(e.target.value)} placeholder="New password"
                      style={{width:"100%",padding:"12px 13px",border:"1px solid "+C.border,borderRadius:10,fontFamily:SANS,fontSize:"0.92em",outline:"none",background:C.white}} />
                    <div style={{color:C.light,fontSize:"0.74em",lineHeight:1.35,marginTop:-5}}>At least 6 characters. No special rules.</div>
                    <input type="password" value={confirmPassword} onChange={(e)=>setConfirmPassword(e.target.value)} placeholder="Confirm new password"
                      style={{width:"100%",padding:"12px 13px",border:"1px solid "+C.border,borderRadius:10,fontFamily:SANS,fontSize:"0.92em",outline:"none",background:C.white}} />
                  </>
                ) : (
                  <input type="password" value={password} onChange={(e)=>setPassword(e.target.value)} placeholder="Password"
                    style={{width:"100%",padding:"12px 13px",border:"1px solid "+C.border,borderRadius:10,fontFamily:SANS,fontSize:"0.92em",outline:"none",background:C.white}} />
                )}
                {!isResetRequest && !isNewPassword && localDataAvailable && (
                  <label style={{display:"flex",gap:8,alignItems:"flex-start",fontSize:"0.78em",color:C.mid,lineHeight:1.35}}>
                    <input type="checkbox" checked={syncLocal} onChange={(e)=>setSyncLocal(e.target.checked)} style={{marginTop:2}} />
                    Add recipes already on this device to the account.
                  </label>
                )}
                <button onClick={isNewPassword ? saveNewPassword : isResetRequest ? requestReset : isCreate ? createAccount : signIn} disabled={busy}
                  style={{...S.goldBtn,borderRadius:11,padding:"12px 14px",fontWeight:900,opacity:busy?0.65:1}}>
                  {busy ? "Working..." : isNewPassword ? "Save New Password" : isResetRequest ? "Send Reset Link" : isCreate ? "Create Account" : "Sign In"}
                </button>
                {!isCreate && !isResetRequest && !isNewPassword && (
                  <button onClick={() => { setMode("reset"); setMessage(""); }} style={{background:"none",border:"none",color:C.green,fontWeight:900,fontFamily:SANS,cursor:"pointer",fontSize:"0.82em"}}>
                    Forgot password?
                  </button>
                )}
                {isResetRequest && (
                  <button onClick={() => { setMode("signin"); setMessage(""); }} style={{background:"none",border:"none",color:C.green,fontWeight:900,fontFamily:SANS,cursor:"pointer",fontSize:"0.82em"}}>
                    Back to sign in
                  </button>
                )}
              </div>

              {message && <div style={{marginTop:12,color:message.includes("Could not")||message.includes("did not")?C.red:C.green,fontSize:"0.82em",lineHeight:1.45,fontWeight:800}}>{message}</div>}
              {!isNewPassword && <div style={{marginTop:14,color:C.light,fontSize:"0.76em",lineHeight:1.45,textAlign:"center"}}>Stay signed in on this device. Sign out anytime from Settings. Apple and Google sign-in are planned for v1.</div>}
            </div>
          </div>
        </div>
      );
    }

    function SplashScreen() {
      return (
        <div style={{position:"fixed",inset:0,zIndex:200,background:"transparent",display:"flex",alignItems:"center",justifyContent:"center",padding:28}}>
          <div style={{textAlign:"center",animation:"splashIn 0.55s ease both"}}>
            <img src="/icon-192.png" alt="" style={{width:118,height:118,borderRadius:28,display:"block",margin:"0 auto 18px",boxShadow:"0 18px 55px rgba(28,20,16,0.32)",animation:"splashGlow 2.2s ease-in-out infinite"}} />
            <div style={{fontFamily:SERIF,fontSize:"2.45em",color:C.white,lineHeight:1,letterSpacing:"0.01em"}}>RecipeBox</div>
            <div style={{marginTop:9,color:"rgba(255,249,238,0.82)",fontSize:"0.92em",fontWeight:600,letterSpacing:"0.02em"}}>Your recipes, ready when you are</div>
          </div>
        </div>
      );
    }

    // Root App
    function App() {
      const [tab, setTab] = useState("library");
      const [screen, setScreen] = useState("library");
      const [recipes, setRecipes] = useState(() => loadRecipes());
      const [mealPlan, setMealPlanState] = useState(() => loadMealPlan());
      const [shoppingList, setShoppingListState] = useState(() => loadShoppingList());
      const setShoppingList = (updater) => setShoppingListState((prev) => typeof updater === "function" ? updater(prev) : updater);
      const [pantry, setPantryState] = useState(() => loadPantry());
      const togglePantry = (name) => { if (!name) return; setPantryState((p) => p.includes(name) ? p.filter((x) => x !== name) : [...p, name]); };
      // Where the meal plan / shopping list / pantry live: "personal" (default,
      // per-user) or "household" (shared) when the user is in a household. Saves
      // route to the matching endpoints. Read at save time so switching sources
      // never auto-merges personal data into the household.
      const dataSourceRef = useRef("personal");
      // Build the current shopping list from recipe ids. replace=true starts a
      // fresh list (Library multi-select / meal plan); replace=false merges (add
      // one recipe from its detail screen). Then open the shopping screen.
      function openShoppingFrom(ids, opts) {
        const o = opts || {};
        setShoppingListState((prev) => o.replace
          ? { ...emptyShoppingList(), recipeIds: Array.from(new Set(ids)), title: o.title || "" }
          : { ...prev, recipeIds: Array.from(new Set([...(prev.recipeIds || []), ...ids])), title: prev.title || o.title || "" });
        setMainTab("shopping");
      }
      const [timerSound, setTimerSound] = useState(() => loadTimerSound());
      const [current, setCurrent] = useState(null);
      const [libraryTag, setLibraryTag] = useState("");
      const [importMode, setImportMode] = useState("url");
      const [importPrefill, setImportPrefill] = useState("");
      function openImport(mode) { setImportMode(typeof mode === "string" ? mode : "url"); setImportPrefill(""); setScreen("import"); }
      // Shared-in data from the OS share sheet (Web Share Target → /?url=&text=&title=).
      const [pendingShare, setPendingShare] = useState(() => {
        try {
          const p = new URLSearchParams(window.location.search);
          const url = p.get("url") || "", text = p.get("text") || "", title = p.get("title") || "";
          if (!url && !text && !title) return null;
          const found = (url || text || title).match(/https?:\/\/[^\s"'<>]+/);
          const sharedUrl = url || (found ? found[0] : "");
          let mode = "text", value = (text || title || "").trim();
          if (sharedUrl) {
            if (/youtube\.com|youtu\.be/i.test(sharedUrl)) mode = "youtube";
            else if (/tiktok\.com|instagram\.com|facebook\.com|fb\.watch/i.test(sharedUrl)) mode = "social";
            else mode = "url";
            value = sharedUrl;
          }
          return { mode, value };
        } catch { return null; }
      });
      const [account, setAccount] = useState(() => loadAccountSession().user || null);
      // Whether the signed-in user is in a household (gates the "Share with
      // household" control on recipes).
      const [inHousehold, setInHousehold] = useState(false);
      useEffect(() => {
        if (!account) { setInHousehold(false); return; }
        let alive = true;
        fetchJson("/api/household", null).then((h) => { if (alive) setInHousehold(!!(h && h.household)); }).catch(() => {});
        return () => { alive = false; };
      }, [account?.id]);
      const [aiUsage, setAiUsage] = useState(() => defaultAiUsage());
      const [newFeedback, setNewFeedback] = useState(0);
      const [showSplash, setShowSplash] = useState(true);
      const backTabRef = useRef("library");
      const navDepthRef = useRef(0);
      const prevNavRef = useRef("splash");
      const prevTabIdxRef = useRef(0);
      // Close any detail screen back to wherever the user opened it from.
      function closeToOrigin() {
        const t = MAIN_TABS.includes(backTabRef.current) ? backTabRef.current : "library";
        setTab(t);
        setScreen("library");
      }
      function openRecipe(r, fromTab) {
        backTabRef.current = fromTab || "library";
        setCurrent(r);
        setScreen("view");
      }
      const resetToken = (() => { try { return new URLSearchParams(window.location.search).get("reset"); } catch { return null; } })();
      const [verifyMsg, setVerifyMsg] = useState(null);

      // Email confirmation link (?verify=token): confirm, strip the param, and
      // refresh the session so the "verify your email" prompt clears.
      useEffect(() => {
        let token = null;
        try { token = new URLSearchParams(window.location.search).get("verify"); } catch {}
        if (!token) return;
        try { window.history.replaceState({}, "", window.location.pathname); } catch {}
        (async () => {
          try {
            const res = await apiFetch("/api/auth/verify-email", { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ token }) });
            const data = await res.json().catch(() => ({}));
            if (res.ok && data.verified) {
              setVerifyMsg({ ok:true, text:"Your email is confirmed. Thanks!" });
              const s = await fetchJson("/api/auth/session", { user:null });
              if (s && s.user) setAccount(s.user);
            } else {
              setVerifyMsg({ ok:false, text: data.error || "That confirmation link is invalid or expired." });
            }
          } catch { setVerifyMsg({ ok:false, text:"Could not confirm your email. Try again from Settings." }); }
        })();
      }, []);

      useEffect(() => { saveRecipes(recipes); }, [recipes]);
      useEffect(() => {
        if (dataSourceRef.current === "household") asyncPutJson("/api/household/shopping-list", { shoppingList });
        else saveShoppingList(shoppingList);
      }, [shoppingList]);
      useEffect(() => {
        if (dataSourceRef.current === "household") asyncPutJson("/api/household/pantry", { pantry });
        else savePantry(pantry);
      }, [pantry]);
      // Switch the meal plan / shopping list / pantry between personal and shared
      // household sources. Household versions start from whatever the household has
      // (empty by default) — never auto-merged from personal data.
      useEffect(() => {
        let alive = true;
        if (inHousehold) {
          dataSourceRef.current = "household";
          Promise.all([
            fetchJson("/api/household/meal-plan", {}),
            fetchJson("/api/household/shopping-list", null),
            fetchJson("/api/household/pantry", []),
          ]).then(([mp, sl, pt]) => {
            if (!alive) return;
            setMealPlanState(mp && typeof mp === "object" && !Array.isArray(mp) ? mp : {});
            setShoppingListState(RecipeBoxShopping.sanitizeShoppingList(sl));
            setPantryState(RecipeBoxShopping.sanitizePantry(pt));
          }).catch(() => {});
        } else if (dataSourceRef.current === "household") {
          // Left a household — revert to personal data.
          dataSourceRef.current = "personal";
          setMealPlanState(loadMealPlan());
          setShoppingListState(loadShoppingList());
          setPantryState(loadPantry());
        } else {
          dataSourceRef.current = "personal";
        }
        return () => { alive = false; };
      }, [inHousehold]);
      useEffect(() => {
        async function refreshAiUsage() {
          if (!account) { setAiUsage(defaultAiUsage()); return; }
          setAiUsage(await fetchJson("/api/ai-usage", defaultAiUsage()));
        }
        refreshAiUsage();
        const handler = (e) => setAiUsage(e.detail || defaultAiUsage());
        window.addEventListener("recipebox-ai-usage", handler);
        return () => window.removeEventListener("recipebox-ai-usage", handler);
      }, [account?.id]);
      async function refreshAdminAlerts() {
        if (!account?.isMasterAdmin) { setNewFeedback(0); return; }
        try { const m = await fetchJson("/api/admin/app-control/meta", {}); setNewFeedback(m?.newFeedback || 0); }
        catch { /* leave count as-is */ }
      }
      useEffect(() => { refreshAdminAlerts(); }, [account?.id]);
      useEffect(() => {
        const t = setTimeout(() => setShowSplash(false), 2400);
        return () => clearTimeout(t);
      }, []);
      // Cream backdrop while signed in and inside the app (no green flash behind
      // screen transitions); transparent (green) on splash/auth.
      useEffect(() => {
        try { document.body.classList.toggle("in-app", !!account && !showSplash && !resetToken); } catch {}
      }, [account?.id, showSplash, resetToken]);
      // Strip share params from the URL once so refresh/back doesn't re-trigger.
      useEffect(() => {
        if (pendingShare) { try { window.history.replaceState({}, "", window.location.pathname); } catch {} }
      }, []);
      // Once signed in, open the importer pre-filled with the shared link/text.
      useEffect(() => {
        if (account && !showSplash && pendingShare) {
          setImportMode(pendingShare.mode);
          setImportPrefill(pendingShare.value);
          setScreen("import");
          setPendingShare(null);
        }
      }, [account?.id, showSplash, pendingShare]);
      // History-driven navigation (pushState/popstate) was intentionally REMOVED:
      // it let the OS edge-swipe-back / Android back button drive in-app screen
      // and tab changes, which felt like a buggy swipe. Until we ship the native
      // app (with reliable platform gestures), navigation is tap-only — bottom
      // nav + explicit in-screen back buttons. No swipe navigation anywhere.

      function updateMealPlan(plan) {
        setMealPlanState(plan);
        if (dataSourceRef.current === "household") asyncPutJson("/api/household/meal-plan", { mealPlan: plan });
        else saveMealPlan(plan);
      }
      async function loadCloudData(nextRecipes, nextMealPlan) {
        const cloudRecipes = Array.isArray(nextRecipes) ? nextRecipes : await fetchJson("/api/recipes", []);
        const cloudMealPlan = nextMealPlan && typeof nextMealPlan === "object" ? nextMealPlan : await fetchJson("/api/mealplan", {});
        setRecipes(Array.isArray(cloudRecipes) ? cloudRecipes : []);
        // Don't let a personal cloud refresh clobber the shared household meal
        // plan that's currently loaded (the household source effect owns it).
        if (dataSourceRef.current !== "household") setMealPlanState(cloudMealPlan && typeof cloudMealPlan === "object" ? cloudMealPlan : {});
        try { localStorage.setItem(RECIPES_KEY, JSON.stringify(recipesForLocal(Array.isArray(cloudRecipes) ? cloudRecipes : []))); } catch {}
        try { localStorage.setItem(MEALPLAN_KEY, JSON.stringify(cloudMealPlan && typeof cloudMealPlan === "object" ? cloudMealPlan : {})); } catch {}
      }
      function addRecipe(r) { const t = { ...r, tags: RecipeBoxTags.applyTagsOnCreate(r) }; setRecipes((p) => [t, ...p]); setCurrent(t); setScreen("view"); }
      function updateRecipe(r) { if (r && r.householdShared) { setCurrent(r); return; } const t = { ...r, tags: RecipeBoxTags.normalizeRecipeTags(r.tags) }; setRecipes((p) => p.map((x) => x.id===t.id?t:x)); setCurrent(t); }
      function deleteRecipe(id) { const rec = recipes.find((x) => x.id===id); if (rec && rec.householdShared) return; if (!window.confirm("Delete this recipe?")) return; setRecipes((p) => p.filter((r) => r.id!==id)); setScreen("library"); }
      function toggleFavorite(id) { setRecipes((p) => p.map((r) => r.id===id && !r.householdShared ? {...r,favorite:!r.favorite} : r)); }
      function setMainTab(nextTab) {
        if (!MAIN_TABS.includes(nextTab)) return;
        setTab(nextTab);
        setScreen("library");
      }
      // Swipe-to-navigate is intentionally DISABLED for now — it felt unreliable
      // on the web/PWA. Navigation is tap-driven (bottom nav + back buttons),
      // which still uses the directional slide transitions below. Revisit
      // gesture navigation when we build the native iOS/Android app, where the
      // platform provides reliable, interactive swipe-back. (Back burner.)

      // Build the active screen, then wrap it in ONE keyed, directionally-animated
      // container so every navigation/swipe eases in instead of hard-cutting.
      let body = null;
      let navName = "main";
      let showNav = false;
      if (showSplash) { body = <SplashScreen />; navName = "splash"; }
      else if (resetToken) { body = <AuthScreen recipes={recipes} mealPlan={mealPlan} setAccount={setAccount} onCloudData={loadCloudData} initialMode="newpass" resetToken={resetToken} />; navName = "auth"; }
      else if (!account) { body = <AuthScreen recipes={recipes} mealPlan={mealPlan} setAccount={setAccount} onCloudData={loadCloudData} />; navName = "auth"; }
      else if (screen==="admin" && account?.isMasterAdmin) { body = <AppControl account={account} onBack={()=>{refreshAdminAlerts();setScreen("library");}} onFeedbackChange={setNewFeedback} />; navName = "admin"; }
      else if (screen==="import") { body = <ImportScreen initialMode={importMode} initialValue={importPrefill} onDone={(r)=>{ const list=Array.isArray(r)?r:[r]; list.forEach(addRecipe); if(list.length!==1) setScreen("library"); /* single import: addRecipe already opens the recipe for review */ }} onCancel={()=>setScreen("library")} />; navName = "import"; }
      else if (screen==="edit"&&current) { body = <EditRecipe recipe={current} onSave={(r)=>{ if(recipes.find((x)=>x.id===r.id)) updateRecipe(r); else addRecipe(r); setScreen("view"); }} onCancel={()=>setScreen("view")} />; navName = "edit"; }
      else if (screen==="view"&&current) {
        navName = "view"; showNav = true;
        body = <RecipeView recipe={current} inHousehold={inHousehold} onBack={closeToOrigin} onEdit={()=>setScreen("edit")} onDelete={()=>deleteRecipe(current.id)} onUpdate={(r)=>{updateRecipe(r);setCurrent(r);}} onImport={(r)=>{addRecipe(r);setCurrent(r);}} onTagClick={(t)=>{setLibraryTag(t);setMainTab("library");}} onAddToShopping={(id)=>openShoppingFrom([id],{replace:false})} timerSound={timerSound} />;
      }
      else {
        navName = "main"; showNav = true;
        body = (
          <div style={{width:"100%",maxWidth:"100%",overflowX:"hidden"}}>
            {tab==="library" && <Library recipes={recipes} mealPlan={mealPlan} onOpen={(r)=>openRecipe(r,"library")} onAdd={openImport} onFavorite={toggleFavorite} setTab={setMainTab} tagFilter={libraryTag} onTagFilter={setLibraryTag} onCreateShoppingList={(ids,title)=>openShoppingFrom(ids,{replace:true,title})} />}
            {tab==="plan" && <MealPlanner recipes={recipes} mealPlan={mealPlan} setMealPlan={updateMealPlan} onOpen={(r)=>openRecipe(r,"plan")} onGenerateShoppingList={(ids)=>openShoppingFrom(ids,{replace:true,title:"This Week's Shopping List"})} inHousehold={inHousehold} />}
            {tab==="shopping" && <ShoppingListScreen list={shoppingList} recipes={recipes} onChange={setShoppingList} setTab={setMainTab} onOpenRecipe={(r)=>openRecipe(r,"shopping")} pantry={pantry} onTogglePantry={togglePantry} inHousehold={inHousehold} />}
            {tab==="pantry" && <PantryChef recipes={recipes} onImport={(r)=>{addRecipe(r);setTab("library");}} onOpenRecipe={(r)=>openRecipe(r,"pantry")} />}
            {tab==="settings" && <Settings timerSound={timerSound} setTimerSound={setTimerSound} account={account} setAccount={setAccount} recipes={recipes} mealPlan={mealPlan} aiUsage={aiUsage} onCloudData={loadCloudData} onOpenAdmin={()=>setScreen("admin")} newFeedback={newFeedback} />}
          </div>
        );
      }

      // Pick transition direction from screen "depth" (deeper = forward), with
      // tab index deciding direction for lateral tab switches.
      const DEPTH = { splash:0, auth:0, main:1, import:2, admin:2, view:2, shopping:2, edit:3 };
      const depth = DEPTH[navName] ?? 1;
      const tabIdx = MAIN_TABS.indexOf(tab);
      let navClass = "nav-fade";
      if (navName === "main" && prevNavRef.current === "main") {
        navClass = tabIdx > prevTabIdxRef.current ? "nav-fwd" : tabIdx < prevTabIdxRef.current ? "nav-back" : "nav-fade";
      } else if (depth > navDepthRef.current) navClass = "nav-fwd";
      else if (depth < navDepthRef.current) navClass = "nav-back";
      navDepthRef.current = depth;
      prevNavRef.current = navName;
      if (tabIdx >= 0) prevTabIdxRef.current = tabIdx;
      const navKey = navName + ":" + tab + ":" + (current?.id || "");

      return (
        <>
          <div key={navKey} className={navClass} style={{minHeight:"100dvh"}}>{body}</div>
          {verifyMsg && (
            <div onClick={() => setVerifyMsg(null)} style={{position:"fixed",left:"50%",transform:"translateX(-50%)",bottom:"calc(env(safe-area-inset-bottom, 0px) + "+(showNav?"78px":"18px")+")",zIndex:60,maxWidth:"min(440px, calc(100vw - 24px))",background:verifyMsg.ok?C.green:C.red,color:C.white,borderRadius:12,padding:"12px 16px",fontSize:"0.85em",fontWeight:600,boxShadow:"0 10px 30px rgba(0,0,0,0.25)",cursor:"pointer",lineHeight:1.4}}>
              {verifyMsg.text} <span style={{opacity:0.7,fontWeight:400}}> · tap to dismiss</span>
            </div>
          )}
          {showNav && <BottomNav tab={tab} setTab={setMainTab} badges={{settings:newFeedback}} />}
        </>
      );
    }

    const root = ReactDOM.createRoot(document.getElementById("root"));
    root.render(<App />);

    // Register the service worker for instant launch + offline. On an update, a
    // new worker activates and takes control; reload once to get the fresh app.
    // (No reload on the very first install, when there was no controller yet.)
    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        const hadController = !!navigator.serviceWorker.controller;
        let refreshing = false;
        navigator.serviceWorker.addEventListener("controllerchange", () => {
          if (!hadController || refreshing) return;
          refreshing = true;
          window.location.reload();
        });
        navigator.serviceWorker.register("/sw.js").catch(() => {});
      });
    }
