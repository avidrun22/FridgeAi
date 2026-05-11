-- v1.16 Tier 2 — Dietary preferences + household size on user_settings.
--
-- Powers Email 2 ("Two minutes that make the alerts actually useful"):
--   * dietary_restrictions: drives recipe-suggestion filtering so we don't
--     suggest beef to a vegetarian or peanut dishes to peanut allergies.
--   * allergens: same idea, separated because allergies are safety-critical
--     vs. dietary preferences are lifestyle.
--   * household_size: scales recipe portions in generate-recipes and informs
--     the personalized waste-estimate copy.
--
-- All additive. Existing users get sensible defaults (empty arrays, household
-- of 1) until they fill out the Settings screen.

alter table public.user_settings
  add column if not exists dietary_restrictions text[] not null default '{}',
  add column if not exists allergens            text[] not null default '{}',
  add column if not exists household_size       smallint not null default 1;

-- Defensive check constraints. Keeps bad values out of the prompt-injection
-- surface without forcing app-side validation everywhere. Recipe-gen reads
-- these straight from the row.
alter table public.user_settings
  drop constraint if exists user_settings_household_size_check,
  add  constraint     user_settings_household_size_check
    check (household_size between 1 and 20);

comment on column public.user_settings.dietary_restrictions is
  'Lifestyle dietary tags: vegetarian, vegan, pescatarian, gluten_free, dairy_free, nut_free, etc. Filtered into the generate-recipes prompt.';
comment on column public.user_settings.allergens is
  'Hard allergens (safety-critical): peanut, tree_nut, shellfish, fish, egg, milk, soy, wheat, sesame. Recipe-gen treats these as "must not contain".';
comment on column public.user_settings.household_size is
  'Number of people the user typically cooks for. Drives recipe portion scaling + personalized waste-estimate copy.';
