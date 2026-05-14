#!/usr/bin/env python3
"""
seed_recipe_bank.py — v1.19 Day 2

For each concept in recipe_seed_concepts.json, call Claude (Haiku 4.5) to
generate ok2eat's own original recipe (name, ingredients with amounts for 4
servings, step-by-step instructions, tip, emoji), validate the response,
and upsert into the recipe_bank table.

Idempotent: skips concepts whose generated slug is already present.
Resumable: re-running picks up where you left off.

USAGE:

    # Spot-check first 20 (dry-run, prints to stdout, no DB writes):
    python scripts/recipe_seed/seed_recipe_bank.py --dry-run --limit 20

    # Generate + load the next 20 (real DB writes):
    python scripts/recipe_seed/seed_recipe_bank.py --limit 20

    # Generate + load all remaining (~218 if first 20 were loaded):
    python scripts/recipe_seed/seed_recipe_bank.py

    # Generate a specific concept by name (for fixing failures):
    python scripts/recipe_seed/seed_recipe_bank.py --only "Pad Thai"

CREDENTIALS:

    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY as env vars,
    or in .appstoreconnect/telegram_config.json (same pattern as
    ingest_off_dump.py).

COST:

    ~$0.005-0.01 per recipe at Haiku 4.5 pricing. 238 concepts → $1.50-2.50
    total one-time. Tracked in real-time as we go.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import unicodedata
from pathlib import Path
from typing import Any

import anthropic  # type: ignore
from supabase import create_client  # type: ignore


SCRIPT_DIR = Path(__file__).resolve().parent
CONCEPTS_PATH = SCRIPT_DIR / "recipe_seed_concepts.json"

ANTHROPIC_MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-haiku-4-5-20251001")

# Per-recipe cost ceiling. Stop the run if any single recipe burns more than
# this — usually a sign the prompt is misfiring (token-loop / runaway gen).
PER_RECIPE_COST_CEILING_USD = 0.10

# Default emoji palette per meal type — used only if Claude's emoji field
# comes back empty or garbled.
DEFAULT_EMOJI = {
    "breakfast": "🍳",
    "lunch": "🥗",
    "dinner": "🍽️",
    "snack": "🥨",
    "dessert": "🍰",
}

# Haiku 4.5 published pricing as of May 2026.
# (Edit if pricing changes; the cost reporting is best-effort, not billing.)
HAIKU_INPUT_USD_PER_M = 1.00   # $/M input tokens
HAIKU_OUTPUT_USD_PER_M = 5.00  # $/M output tokens


# ---------------------------------------------------------------------------
# Credentials
# ---------------------------------------------------------------------------

def load_credentials() -> tuple[str, str, str]:
    """SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY."""
    url = os.environ.get("SUPABASE_URL")
    sb_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    an_key = os.environ.get("ANTHROPIC_API_KEY")

    if not (url and sb_key and an_key):
        config_path = SCRIPT_DIR.parent.parent / ".appstoreconnect" / "telegram_config.json"
        if config_path.exists():
            with open(config_path) as f:
                cfg = json.load(f)
            url = url or cfg.get("supabase_url") or cfg.get("SUPABASE_URL")
            sb_key = sb_key or cfg.get("supabase_service_role_key") or cfg.get("SUPABASE_SERVICE_ROLE_KEY")
            an_key = an_key or cfg.get("anthropic_api_key") or cfg.get("ANTHROPIC_API_KEY")

    missing = [n for n, v in [
        ("SUPABASE_URL", url),
        ("SUPABASE_SERVICE_ROLE_KEY", sb_key),
        ("ANTHROPIC_API_KEY", an_key),
    ] if not v]
    if missing:
        sys.exit(f"Missing credentials: {', '.join(missing)}. Set env vars or add to telegram_config.json.")
    return url, sb_key, an_key


# ---------------------------------------------------------------------------
# Slug + helpers
# ---------------------------------------------------------------------------

def slugify(name: str) -> str:
    """URL-safe slug. 'Chicken Parmesan' → 'chicken-parmesan',
    'Crème Brûlée' → 'creme-brulee'."""
    # Normalize accents into base char + combining mark, then drop the marks.
    # 'Crème' → 'Creme', 'Brûlée' → 'Brulee'.
    s = unicodedata.normalize("NFKD", name)
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.lower()
    s = re.sub(r"['‘’]", "", s)        # drop curly + straight apostrophes
    s = re.sub(r"\([^)]*\)", "", s)    # drop parentheticals — "(Som Tam)"
    s = re.sub(r"[^a-z0-9]+", "-", s)
    s = re.sub(r"-+", "-", s).strip("-")
    return s


def existing_slugs(supabase: Any) -> set[str]:
    """All slugs already in recipe_bank. For idempotent re-runs."""
    try:
        res = supabase.table("recipe_bank").select("slug").execute()
    except Exception as e:
        print(f"⚠️  Could not query recipe_bank — assuming empty. ({e})")
        return set()
    return {r["slug"] for r in (res.data or []) if r.get("slug")}


# ---------------------------------------------------------------------------
# Claude prompt
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = (
    "You are a recipe developer for ok2eat, a fridge-tracking app. "
    "When asked to write a recipe, respond ONLY with a JSON object — no "
    "markdown fences, no explanations, no leading text. The JSON must include "
    "every key the schema specifies. Keep instructions concise but clear (5-9 "
    "steps typical). Amounts are for 4 servings. Use real, common ingredients "
    "and standard US measurements (cup, tbsp, tsp, oz, lb, clove, etc.). "
    "Write our own original take on the dish — do NOT copy any specific "
    "publisher's recipe text."
)

USER_TEMPLATE = """Write the recipe for: {name}

Context:
- meal_type: {meal_type}
- cuisine: {cuisine}
- estimated time: {time_minutes} minutes
- difficulty: {difficulty}
- dietary tags: {dietary_tags}

Respond ONLY with this JSON shape (no markdown, no commentary):

{{
  "name": "<short, evocative recipe name — may refine the concept name>",
  "emoji": "<single food emoji that fits the dish>",
  "description": "<1-2 sentence description, what makes it good>",
  "ingredients": [
    {{"item": "<ingredient name>", "amount": "<amount with unit>"}}
  ],
  "instructions": [
    "<step 1>",
    "<step 2>"
  ],
  "tip": "<one-line chef's tip — what makes this dish sing>"
}}

Constraints:
- 4 servings worth of ingredients.
- 5-10 instruction steps. Be concise but specific (oven temps, times, doneness cues).
- 6-15 ingredients typical.
- Honor the dietary_tags strictly (vegan = no animal products, gluten_free = no wheat/barley/rye/conventional pasta, etc.).
"""


def build_user_prompt(concept: dict) -> str:
    return USER_TEMPLATE.format(
        name=concept["name"],
        meal_type=concept["meal_type"],
        cuisine=concept["cuisine"],
        time_minutes=concept["time_minutes"],
        difficulty=concept["difficulty"],
        dietary_tags=", ".join(concept.get("dietary_tags") or []) or "(none)",
    )


# ---------------------------------------------------------------------------
# Call Claude
# ---------------------------------------------------------------------------

def call_claude(client: anthropic.Anthropic, concept: dict, model: str) -> tuple[dict, dict]:
    """Returns (parsed_recipe_dict, usage_dict). Raises on parse/validation error."""
    prompt = build_user_prompt(concept)
    resp = client.messages.create(
        model=model,
        max_tokens=2000,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": prompt}],
    )

    text = ""
    for block in resp.content:
        if getattr(block, "type", None) == "text":
            text += block.text

    # Strip any accidental markdown fences (system prompt asks for none, but defense in depth).
    cleaned = re.sub(r"```(?:json)?", "", text).strip()
    try:
        recipe = json.loads(cleaned)
    except json.JSONDecodeError as e:
        raise ValueError(f"Claude returned non-JSON: {cleaned[:200]!r} ({e})")

    # Minimal validation
    required = ["name", "ingredients", "instructions"]
    missing = [k for k in required if not recipe.get(k)]
    if missing:
        raise ValueError(f"Missing required keys: {missing}. Got: {list(recipe.keys())}")
    if not isinstance(recipe.get("ingredients"), list) or len(recipe["ingredients"]) == 0:
        raise ValueError("ingredients must be a non-empty list")
    if not isinstance(recipe.get("instructions"), list) or len(recipe["instructions"]) == 0:
        raise ValueError("instructions must be a non-empty list")

    usage = {
        "input_tokens": resp.usage.input_tokens,
        "output_tokens": resp.usage.output_tokens,
    }
    return recipe, usage


def estimate_cost(usage: dict) -> float:
    return (
        usage["input_tokens"] / 1_000_000 * HAIKU_INPUT_USD_PER_M
        + usage["output_tokens"] / 1_000_000 * HAIKU_OUTPUT_USD_PER_M
    )


# ---------------------------------------------------------------------------
# Insert
# ---------------------------------------------------------------------------

def build_row(concept: dict, recipe: dict) -> dict:
    name = recipe.get("name") or concept["name"]
    return {
        "slug": slugify(name),
        "name": name,
        "emoji": recipe.get("emoji") or DEFAULT_EMOJI.get(concept["meal_type"], "🍳"),
        "time_minutes": concept["time_minutes"],
        "difficulty": concept["difficulty"],
        "meal_type": concept["meal_type"],
        "cuisine": concept["cuisine"],
        "dietary_tags": concept.get("dietary_tags") or [],
        "description": recipe.get("description") or "",
        "ingredients": recipe["ingredients"],
        "instructions": recipe["instructions"],
        "tip": recipe.get("tip") or "",
        "source": "seed",
    }


def insert_row(supabase: Any, row: dict) -> None:
    """Upsert on slug — re-runs are safe."""
    supabase.table("recipe_bank").upsert(row, on_conflict="slug").execute()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="Don't write to DB; print to stdout.")
    parser.add_argument("--limit", type=int, default=None, help="Process only the first N unseeded concepts.")
    parser.add_argument("--only", type=str, default=None, help="Process only the concept with this exact name.")
    parser.add_argument("--model", type=str, default=ANTHROPIC_MODEL)
    parser.add_argument("--delay", type=float, default=0.2, help="Seconds between API calls (rate-limit insurance).")
    args = parser.parse_args()

    sb_url, sb_key, an_key = load_credentials()
    supabase = create_client(sb_url, sb_key)
    client = anthropic.Anthropic(api_key=an_key)

    with open(CONCEPTS_PATH) as f:
        data = json.load(f)
    concepts = data["concepts"]

    if args.only:
        concepts = [c for c in concepts if c["name"] == args.only]
        if not concepts:
            sys.exit(f"No concept named {args.only!r}.")

    # Skip concepts already in the bank (resumable runs)
    if not args.dry_run:
        seen = existing_slugs(supabase)
        before = len(concepts)
        concepts = [c for c in concepts if slugify(c["name"]) not in seen]
        skipped = before - len(concepts)
        if skipped:
            print(f"⏭  Skipping {skipped} concepts already in recipe_bank.")

    if args.limit is not None:
        concepts = concepts[: args.limit]

    if not concepts:
        print("Nothing to do.")
        return

    print(f"📋 {len(concepts)} concepts to process. Model={args.model}. dry_run={args.dry_run}")
    print()

    total_cost = 0.0
    successes = 0
    failures: list[tuple[str, str]] = []

    for i, concept in enumerate(concepts, 1):
        name = concept["name"]
        try:
            recipe, usage = call_claude(client, concept, args.model)
            cost = estimate_cost(usage)
            total_cost += cost
            if cost > PER_RECIPE_COST_CEILING_USD:
                raise RuntimeError(
                    f"per-recipe cost ${cost:.4f} exceeds ceiling ${PER_RECIPE_COST_CEILING_USD}"
                )

            row = build_row(concept, recipe)
            if args.dry_run:
                print(f"[{i}/{len(concepts)}] ✅ {row['slug']} ({row['name']}) — {usage['input_tokens']}/{usage['output_tokens']} tok, ${cost:.4f}")
                print(f"     emoji={row['emoji']}  time={row['time_minutes']}min  difficulty={row['difficulty']}")
                print(f"     {len(row['ingredients'])} ingredients, {len(row['instructions'])} steps")
                print(f"     tip: {row['tip'][:80]}{'...' if len(row['tip']) > 80 else ''}")
                print(f"     first step: {row['instructions'][0][:80]}{'...' if len(row['instructions'][0]) > 80 else ''}")
                print()
            else:
                insert_row(supabase, row)
                print(f"[{i}/{len(concepts)}] ✅ {row['slug']} — ${cost:.4f}  (running: ${total_cost:.2f})")

            successes += 1
        except Exception as e:
            print(f"[{i}/{len(concepts)}] ❌ {name}: {e}")
            failures.append((name, str(e)))

        if args.delay:
            time.sleep(args.delay)

    print()
    print("=" * 60)
    print(f"Done. {successes} ok, {len(failures)} failed.")
    print(f"Total cost: ${total_cost:.2f}")
    if failures:
        print("\nFailures (re-run with --only \"<name>\" to retry):")
        for name, err in failures:
            print(f"  • {name}: {err}")


if __name__ == "__main__":
    main()
