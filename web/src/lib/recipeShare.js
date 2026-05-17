// recipeShare — web mirror of App.js's shareRecipe / formatRecipeAsShareText.
//
// Same two-path design as mobile: bank-backed recipes (resolvable public URL
// at /recipes/{slug}) get a URL share via navigator.share or clipboard
// fallback; ephemeral recipes (Haiku-generated EatMeFirst + AI-saved) get a
// text-content share so the recipient sees the full recipe inline — no
// dead /recipes/{uuid} that would 404.

export function isShareableRecipeId(id) {
  if (!id) return false;
  const s = String(id);
  if (/^\d{8}-/.test(s)) return false; // daily-cache id
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return false; // uuid v4
  return /^[a-z0-9][a-z0-9-]*$/i.test(s); // bank slug
}

export function formatRecipeAsShareText(recipe) {
  if (!recipe) return "";
  const parts = [];
  parts.push(recipe.name || "Recipe");
  const meta = [recipe.time, recipe.difficulty].filter(Boolean).join(" · ");
  if (meta) parts.push(meta);
  if (recipe.description) parts.push("", recipe.description);
  const ingredients = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];
  if (ingredients.length) {
    parts.push("", "INGREDIENTS");
    for (const ing of ingredients) {
      if (typeof ing === "string") {
        parts.push(`• ${ing}`);
      } else if (ing && typeof ing === "object") {
        const qty = [ing.amount, ing.unit].filter(Boolean).join(" ");
        const line = [qty, ing.name || ing.item].filter(Boolean).join(" ");
        if (line) parts.push(`• ${line}`);
      }
    }
  }
  const instructions = Array.isArray(recipe.instructions) ? recipe.instructions : [];
  if (instructions.length) {
    parts.push("", "INSTRUCTIONS");
    instructions.forEach((step, i) => { if (step) parts.push(`${i + 1}. ${step}`); });
  }
  if (recipe.tip) parts.push("", `Tip: ${recipe.tip}`);
  parts.push("", "Shared from ok2eat — https://ok2eat.com");
  return parts.join("\n");
}

// shareRecipeWeb — returns { ok: boolean, surface: "native"|"clipboard"|"none", url: string|null }.
// Caller fires analytics + toast based on the result.
export async function shareRecipeWeb(recipe, opts = {}) {
  if (!recipe) return { ok: false, surface: "none", url: null };
  const name = recipe.name || "Recipe";
  const text = formatRecipeAsShareText(recipe);
  const bankId = opts.sourceRecipeId || (isShareableRecipeId(recipe.id) ? recipe.id : null) || (isShareableRecipeId(recipe.slug) ? recipe.slug : null);
  const url = bankId
    ? `https://ok2eat.com/recipes/${encodeURIComponent(bankId)}?utm_source=share&utm_medium=web_app&utm_campaign=recipe_share`
    : null;

  const shareData = bankId
    ? { title: name, text: `${text}\n\n${url}`, url }
    : { title: name, text };

  if (typeof navigator !== "undefined" && navigator.share) {
    try {
      await navigator.share(shareData);
      return { ok: true, surface: "native", url };
    } catch (e) {
      // user canceled or browser blocked — fall through to clipboard
      if (e?.name === "AbortError") return { ok: false, surface: "none", url };
    }
  }
  // Clipboard fallback: copy the URL when available, otherwise the full text.
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      await navigator.clipboard.writeText(url || text);
      return { ok: true, surface: "clipboard", url };
    }
  } catch (_e) { /* swallow */ }
  return { ok: false, surface: "none", url };
}
