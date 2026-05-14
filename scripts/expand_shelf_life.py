#!/usr/bin/env python3
"""
expand_shelf_life.py — Phase 2 of the shelf-life directory expansion.

Generates structured shelf-life data for foods that USDA FoodKeeper doesn't
cover, calling Claude Haiku in batched JSON-output mode, validating every
row against a strict schema, and appending clean entries to
`data/shelf_life_extended.json`.

The goal: scale `ok2eat.com/shelf-life/` from its current 782 pages toward
5,000 items, drawing only on trusted public sources (FDA, FSIS, NCHFP,
Cooperative Extension Service, manufacturer guidance). FoodKeeper is
authoritative and never contradicted — every candidate is deduped against
its name (both base-name and full-name slugs) before being submitted to
Claude.

This script must be run from Greg's terminal — the Claude sandbox where
the dev work happens has its proxy gated to Claude-Code-managed credentials
and rejects the user's `anthropic_api_key` with 401. Greg's `.zshrc` /
`.bash_profile` environment hits Anthropic directly.

Usage:

    python3 scripts/expand_shelf_life.py --batch 50 --dry-run
        Generate 50 candidate items, print validated rows to stdout. Does
        not write to disk. Use to sanity-check output before a real run.

    python3 scripts/expand_shelf_life.py --batch 200
        Generate up to 200 new items and append to shelf_life_extended.json.

    python3 scripts/expand_shelf_life.py --batch 200 --emit-migration
        Same as --batch 200, but also writes a Supabase migration file at
        supabase/migrations/YYYYMMDD_v1NN_shelf_life_phase2_<batch>.sql
        with idempotent INSERT...ON CONFLICT DO NOTHING for the new rows.
        Greg applies via SQL editor (per CLAUDE.md convention).

    python3 scripts/expand_shelf_life.py --candidates path/to/list.txt
        Use a custom newline-delimited candidate list instead of the
        internal one. Combine with --batch to cap.

    python3 scripts/expand_shelf_life.py --resume
        Equivalent to --batch N but skips candidates whose slug already
        exists in either foodkeeper.json or shelf_life_extended.json.
        Use this to incrementally march toward 5,000 across multiple runs.

After a successful run:
    1. Re-run scripts/build_shelf_life_pages.py to regenerate /shelf-life/
       pages (self-prune in place; old orphans auto-clean).
    2. If --emit-migration was used, apply the resulting SQL via Supabase
       SQL editor.
    3. Deploy via `python3 scripts/deploy_website.py` (or Telegram /deploy).

Constraints — read carefully:
    * FoodKeeper wins every slug conflict. Period.
    * Claude is instructed to return null for any value it's uncertain about.
      Validation discards rows with implausible day ranges.
    * IDs start at 10001 and go up — gap left between FoodKeeper's 2–684
      and our extended range.
    * Idempotent: --resume produces zero new rows if the JSON is already
      caught up to the candidate list.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import date
from pathlib import Path
from typing import Optional

# ─── Paths + config ──────────────────────────────────────────────────────────

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
FOODKEEPER_PATH = ROOT / "data" / "foodkeeper.json"
EXTENDED_PATH = ROOT / "data" / "shelf_life_extended.json"
CONFIG_PATH = ROOT / ".appstoreconnect" / "telegram_config.json"
MIGRATIONS_DIR = ROOT / "supabase" / "migrations"

ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_MODEL = "claude-haiku-4-5-20251001"
ANTHROPIC_VERSION = "2023-06-01"
BATCH_SIZE = 10        # candidates per API call
MAX_RETRIES = 3
RETRY_BACKOFF_S = 5

# Allowed enum values — used by the validator. Match the FoodKeeper schema
# exactly so the existing `ok2eat_category` generated column in Supabase
# maps every row correctly without touching the schema.
ALLOWED_CATEGORIES = {
    "Dairy Products & Eggs",
    "Produce",
    "Meat",
    "Poultry",
    "Seafood",
    "Vegetarian Proteins",
    "Baked Goods",
    "Grains, Beans & Pasta",
    "Shelf Stable Foods",
    "Condiments, Sauces & Canned Goods",
    "Beverages",
    "Deli & Prepared Foods",
    "Food Purchased Frozen",
}
ALLOWED_SOURCES = {"FDA", "FSIS", "NCHFP", "Extension", "Manufacturer"}

# Day ranges — caps for sanity-checking what Claude returns. Anything past
# 10 years (3650 days) is almost certainly hallucinated; sub-1-day values
# are too volatile for our digest cadence.
MAX_DAYS = 3650
MIN_DAYS = 0

# ─── Candidate list ──────────────────────────────────────────────────────────
# Foods I judge likely-absent from FoodKeeper, grouped by category. This is
# the seed list; expand by editing this file or passing --candidates.
# Comments indicate cluster theme — Claude doesn't see these, only the names.

CANDIDATES: list[str] = [
    # ─── Specialty produce: fruits ─────────────────────────────────────
    "Cherimoya", "Sugar apple", "Soursop", "Mangosteen", "Rambutan",
    "Longan", "Jackfruit", "Durian", "Loquat", "Quince", "Medlar",
    "Tamarillo", "Cape gooseberry", "Carambola", "Sapote",
    "Mamey sapote", "Black sapote", "Pomelo", "Buddha's hand",
    "Calamansi", "Finger lime", "Blood orange", "Cara cara orange",
    "Meyer lemon", "Bergamot", "Sudachi", "Kumquat",
    "Cherry plum", "Mirabelle", "Damson", "Greengage",
    "Pluot", "Apriplum", "Honeyberry", "Mulberry", "Marionberry",
    "Boysenberry", "Olallieberry", "Salmonberry", "Cloudberry",
    "Currant", "Gooseberry", "Elderberry", "Aronia berry",
    "Goji berry", "Acai berry", "Maqui berry", "Sea buckthorn berry",
    "Black raspberry", "Pineberry", "White strawberry",
    # ─── Specialty produce: vegetables + roots ─────────────────────────
    "Yacon", "Burdock root", "Sunchoke", "Salsify", "Daikon radish",
    "Watermelon radish", "Black radish", "Lotus root", "Taro root",
    "Cassava", "Yuca", "Malanga", "Cocoyam", "Arrowroot",
    "Rutabaga", "Turnip", "Sweet potato leaves", "Cassava leaves",
    "Chayote", "Bitter melon", "Luffa", "Opo squash",
    "Kabocha squash", "Delicata squash", "Hubbard squash",
    "Spaghetti squash", "Carnival squash", "Sweet dumpling squash",
    "Romanesco", "Black cauliflower", "Purple cauliflower",
    "Brussels sprout greens", "Mustard greens", "Tatsoi",
    "Pak choi", "Choy sum", "Yu choy", "Napa cabbage",
    "Savoy cabbage", "Red cabbage", "Pointed cabbage",
    "Chinese broccoli", "Gai lan", "Sea beans", "Samphire",
    "Glasswort", "Sorrel", "Chickweed", "Lamb's quarters",
    "Purslane", "Dandelion greens", "Nettle",
    # ─── Specialty produce: mushrooms ──────────────────────────────────
    "Oyster mushrooms", "King oyster mushrooms", "Maitake mushrooms",
    "Lion's mane mushrooms", "Enoki mushrooms", "Beech mushrooms",
    "Pioppini mushrooms", "Trumpet mushrooms",
    "Morel mushrooms", "Chanterelle mushrooms", "Porcini mushrooms",
    "Hedgehog mushrooms", "Black trumpet mushrooms",
    # ─── Specialty produce: herbs + aromatics ──────────────────────────
    "Thai basil", "Holy basil", "Lemon basil", "Purple basil",
    "Chocolate mint", "Pineapple mint", "Spearmint", "Peppermint",
    "Lemon balm", "Lemon thyme", "Lemon verbena", "Lemongrass leaves",
    "Pandan leaves", "Curry leaves", "Vietnamese mint",
    "Shiso leaves", "Perilla leaves", "Bay leaves fresh",
    "Tarragon fresh", "Borage", "Lovage", "Sweet woodruff",
    "Chervil", "Marjoram fresh", "Savory fresh",
    "Sumac fresh", "Saffron threads", "Vanilla bean", "Tonka bean",
    # ─── International pantry: Latin American ──────────────────────────
    "Ancho chile dried", "Guajillo chile dried", "Pasilla chile dried",
    "Chipotle in adobo", "Mole paste", "Achiote paste",
    "Sazon seasoning", "Recaito", "Sofrito",
    "Masa harina", "Masa preparada", "Chicharrones",
    "Cotija cheese", "Asadero cheese", "Oaxaca cheese",
    "Crema mexicana", "Crema agria", "Dulce de leche",
    "Cajeta", "Piloncillo", "Mexican vanilla extract",
    "Tomatillo fresh", "Tomatillo canned", "Hominy",
    "Posole", "Mexican oregano", "Epazote", "Hoja santa",
    # ─── International pantry: Caribbean + African ─────────────────────
    "Scotch bonnet pepper", "Habanero pepper",
    "Allspice berries", "Pimento sauce", "Pickapeppa sauce",
    "Cassava flour", "Plantain flour", "Fufu flour",
    "Egusi seeds", "Palm oil", "Red palm oil",
    "Berbere spice", "Mitmita spice", "Niter kibbeh",
    "Injera bread", "Teff flour", "Sorghum flour",
    "Fonio grain", "Millet flour",
    # ─── International pantry: Eastern European ───────────────────────
    "Smetana", "Tvorog", "Farmer cheese", "Brynza",
    "Quark cheese", "Eastern European kefir",
    "Borscht concentrate", "Bigos canned",
    "Sauerkraut Polish", "Pierogi frozen",
    "Kielbasa fresh", "Bratwurst fresh", "Weisswurst",
    "Mettwurst", "Liverwurst",
    "Lingonberry preserves", "Cloudberry jam",
    "Rye sourdough starter", "Caraway seeds",
    "Juniper berries", "Pickled herring",
    "Smoked salmon Nordic", "Gravlax",
    # ─── International pantry: South Asian ────────────────────────────
    "Ghee Indian", "Cultured ghee", "Brown butter ghee",
    "Coconut chutney fresh", "Mint chutney", "Tamarind chutney",
    "Mango chutney", "Lime pickle", "Mango pickle",
    "Garam masala fresh", "Curry leaves dried",
    "Asafoetida", "Hing powder",
    "Black mustard seeds", "Brown mustard seeds",
    "Nigella seeds", "Kalonji",
    "Fenugreek seeds", "Methi leaves dried",
    "Kasuri methi", "Amchur powder",
    "Black salt", "Kala namak",
    "Tandoori paste", "Vindaloo paste",
    "Madras curry paste", "Korma paste",
    "Rogan josh paste", "Tikka masala paste",
    "Paneer fresh", "Rasmalai canned",
    "Gulab jamun mix",
    # ─── International pantry: Southeast Asian ────────────────────────
    "Galangal fresh", "Galangal dried",
    "Kaffir lime zest", "Pandan leaves frozen",
    "Tamarind paste", "Tamarind concentrate",
    "Tamarind pulp dried",
    "Coconut cream canned",
    "Palm sugar", "Gula melaka",
    "Shrimp paste", "Belacan",
    "Fish paste",
    "Banana leaves frozen", "Banana blossom",
    "Bamboo shoots fresh", "Bamboo shoots canned",
    "Water chestnuts canned", "Water chestnuts fresh",
    "Lotus seeds dried", "Lotus seed paste",
    "Black bean paste", "Yellow bean paste",
    "Tianmianjiang", "Doubanjiang",
    "Laoganma chili crisp", "Chili crisp Sichuan",
    "Sichuan peppercorns", "Five spice powder",
    "Star anise whole", "Cassia bark",
    "Rice vinegar", "Black rice vinegar",
    "Chinkiang vinegar", "Mirin",
    "Sake cooking", "Shaoxing wine",
    "Rice wine cooking",
    # ─── Plant-based alternatives ─────────────────────────────────────
    "Pea milk", "Hemp milk refrigerated", "Hemp milk shelf-stable",
    "Pistachio milk", "Macadamia milk", "Hazelnut milk",
    "Quinoa milk", "Rice milk refrigerated", "Rice milk shelf-stable",
    "Vegan whipped cream", "Vegan sour cream",
    "Vegan ricotta", "Vegan parmesan",
    "Vegan feta", "Vegan brie",
    "Vegan ice cream coconut base", "Vegan ice cream oat base",
    "Vegan ice cream almond base", "Vegan gelato",
    "Vegan chocolate dairy-free",
    "Plant-based bacon", "Plant-based deli slices",
    "Plant-based chicken nuggets", "Plant-based chicken tenders",
    "Plant-based fish fillets", "Plant-based shrimp",
    "Plant-based ground sausage", "Plant-based crumbles",
    "Plant-based meatballs", "Plant-based pulled pork",
    "Plant-based jerky", "Mushroom jerky",
    "Soy curls dry", "TVP textured vegetable protein",
    "Aquafaba", "Egg replacer powder",
    "Vegan butter sticks", "Vegan cream cheese spread",
    "Cashew cream", "Coconut whipped topping",
    # ─── Modern pantry ────────────────────────────────────────────────
    "Tigernuts dried", "Tigernut flour",
    "Acai powder", "Maca powder", "Camu camu powder",
    "Spirulina powder", "Chlorella powder",
    "Wheatgrass powder", "Barleygrass powder",
    "Lucuma powder", "Mesquite powder",
    "Cacao nibs", "Cacao butter",
    "Carob powder", "Yacon syrup",
    "Date syrup", "Coconut nectar",
    "Brown rice syrup", "Sorghum syrup",
    "Molasses blackstrap",
    "Allulose", "Erythritol granules",
    "Xylitol granules", "Mannitol",
    "Tagatose",
    "Spelt flour", "Einkorn flour",
    "Kamut flour", "Buckwheat flour",
    "Teff flour", "Sorghum flour packaged",
    "Amaranth flour", "Cassava flour packaged",
    "Tigernut flour packaged",
    "Coconut flour", "Almond flour",
    "Hazelnut flour", "Chestnut flour",
    "Brazil nut butter", "Macadamia butter",
    "Pecan butter", "Pistachio butter",
    "Pumpkin seed butter", "Watermelon seed butter",
    # ─── Modern beverages ─────────────────────────────────────────────
    "Yerba mate refrigerated", "Yerba mate dried",
    "Rooibos tea dried", "Rooibos tea brewed",
    "Hibiscus tea dried", "Hibiscus drink refrigerated",
    "Switchel", "Drinking vinegar",
    "Kvass", "Birch sap",
    "Maple water refrigerated", "Maple water shelf-stable",
    "Aloe water refrigerated", "Aloe juice",
    "Tepache", "Atole",
    "Champurrado", "Horchata refrigerated", "Horchata homemade",
    "Bubble tea pearls dried", "Bubble tea pearls cooked",
    "Tapioca pearls cooked",
    "Cold pressed coffee concentrate", "Nitro cold brew",
    "Iced coffee bottled",
    "Energy shot small bottle", "Functional mushroom drink",
    "Adaptogen latte refrigerated",
    "Probiotic shot small bottle",
    "Apple cider raw refrigerated", "Apple cider pasteurized",
    # ─── Refrigerated prepared ────────────────────────────────────────
    "Romesco sauce refrigerated",
    "Chimichurri refrigerated", "Adobo sauce refrigerated",
    "Mojo sauce refrigerated",
    "Cocktail sauce refrigerated", "Tartar sauce refrigerated",
    "Remoulade refrigerated", "Aioli refrigerated",
    "Garlic confit refrigerated",
    "Fresh hollandaise", "Fresh bearnaise",
    "Fresh bechamel", "Fresh mornay",
    "Compound butter", "Herb butter",
    "Lobster butter", "Truffle butter",
    "Fresh stock chicken", "Fresh stock beef",
    "Fresh stock vegetable", "Fresh stock fish",
    "Fresh stock seafood",
    "Demi-glace refrigerated",
    "Fresh gnocchi packaged", "Fresh cavatelli",
    "Fresh gnudi", "Fresh cappelletti",
    "Fresh agnolotti",
    "Fresh wonton wrappers", "Fresh dumpling wrappers",
    "Fresh egg roll wrappers", "Fresh spring roll wrappers rice paper",
    "Fresh phyllo dough",
    "Fresh puff pastry sheets", "Frozen puff pastry sheets",
    "Fresh croissant dough",
    # ─── Specialty cheese ────────────────────────────────────────────
    "Brie de Meaux", "Camembert", "Brillat-Savarin",
    "Saint-André", "Pierre Robert",
    "Epoisses", "Reblochon", "Munster",
    "Limburger", "Liederkranz",
    "Gorgonzola dolce", "Gorgonzola piccante",
    "Roquefort", "Stilton",
    "Cabrales", "Valdeón",
    "Bleu d'Auvergne", "Fourme d'Ambert",
    "Comté", "Gruyère",
    "Emmentaler", "Beaufort",
    "Appenzeller", "Raclette",
    "Pecorino Romano", "Pecorino Toscano",
    "Pecorino Sardo",
    "Asiago fresco", "Asiago stagionato",
    "Grana Padano", "Parmigiano Reggiano aged",
    "Caciocavallo", "Provolone aged",
    "Scamorza", "Provoletta",
    "Mozzarella di bufala fresh", "Bocconcini fresh",
    "Ciliegine fresh",
    "Stracciatella fresh", "Robiola",
    "Crescenza", "Squacquerone",
    "Goat cheese fresh log", "Goat cheese aged",
    "Sheep cheese aged",
    "Halumi grilling cheese",
    # ─── Frozen prepared ─────────────────────────────────────────────
    "Frozen pierogi", "Frozen ravioli stuffed",
    "Frozen tortellini stuffed",
    "Frozen samosas", "Frozen empanadas",
    "Frozen spring rolls", "Frozen egg rolls",
    "Frozen wontons", "Frozen baozi",
    "Frozen tamales", "Frozen pupusas",
    "Frozen arepas", "Frozen pao de queijo",
    "Frozen takoyaki", "Frozen gyoza vegetable",
    "Frozen onigiri", "Frozen sushi",
    "Frozen rice balls",
    "Frozen quiche", "Frozen pot pie",
    "Frozen lasagna", "Frozen manicotti",
    "Frozen cannelloni", "Frozen stuffed shells",
    "Frozen french toast sticks", "Frozen pancakes",
    "Frozen crepes", "Frozen blintzes",
    "Frozen pizza pockets",
    "Frozen meatballs cooked", "Frozen meatballs raw",
    "Frozen chicken nuggets", "Frozen chicken strips",
    "Frozen fish sticks", "Frozen fish fillets breaded",
    "Frozen shrimp cooked", "Frozen shrimp raw peeled",
    "Frozen calamari rings",
    "Frozen vegetable medley", "Frozen stir-fry mix",
    "Frozen hash browns", "Frozen tater tots",
    "Frozen french fries crinkle", "Frozen french fries shoestring",
    "Frozen sweet potato fries",
    # ─── Condiments + sauces by cuisine ───────────────────────────────
    "Wasabi paste tube", "Wasabi powder",
    "Yuzu kosho", "Karashi mustard",
    "Tonkatsu sauce", "Okonomi sauce",
    "Bull-Dog sauce", "Yakisoba sauce",
    "Teriyaki sauce bottled", "Eel sauce unagi",
    "Sweet chili sauce Thai", "Sweet chili sauce Vietnamese",
    "Plum sauce", "Duck sauce",
    "XO sauce", "Lao gan ma chili oil",
    "Hot oil Sichuan",
    "Tare sauce ramen", "Black garlic paste",
    "Kewpie mayonnaise",
    "Worcestershire sauce", "HP sauce",
    "Brown sauce British", "Daddies sauce",
    "Branston pickle",
    "Piccalilli", "Chow chow",
    "Mostarda", "Pasilla mustard",
    "Dijon mustard whole grain", "Dijon mustard smooth",
    "Pommery mustard", "Honey mustard",
    "Beer mustard", "Hot English mustard",
    "Wasabi mustard",
    "Wholegrain Pommery mustard",
    "Sambal manis", "Sambal terasi",
    "Sambal matah",
    # ─── Specialty proteins (not in FoodKeeper basic cuts) ────────────
    "Wagyu beef raw", "Wagyu beef cooked",
    "Bison steak raw", "Bison ground raw",
    "Bison jerky", "Elk steak raw",
    "Venison steak raw", "Venison sausage",
    "Wild boar raw", "Lamb shoulder raw",
    "Lamb shank raw", "Goat meat raw",
    "Rabbit raw", "Squab raw",
    "Pheasant raw", "Quail raw",
    "Duck breast raw", "Duck legs raw",
    "Foie gras fresh", "Pate refrigerated",
    "Mousse foie gras canned",
    "Caviar refrigerated", "Roe salmon refrigerated",
    "Tobiko flying fish roe", "Masago capelin roe",
    "Uni sea urchin fresh",
    "Octopus raw", "Squid raw", "Cuttlefish raw",
    "Conch raw", "Abalone raw",
    "Sea urchin fresh", "Geoduck raw",
    "Razor clams raw", "Steamer clams raw",
    "Soft shell crab raw", "Stone crab claws raw",
    "King crab legs raw", "Snow crab legs raw",
    "Dungeness crab whole raw",
    "Spot prawns raw", "Mantis shrimp raw",
    "Crawfish raw whole", "Crawfish tails cooked",
    # ─── Specialty bakery ─────────────────────────────────────────────
    "Focaccia fresh", "Ciabatta fresh",
    "Challah fresh", "Babka fresh",
    "Brioche loaf fresh",
    "Pretzel rolls fresh", "Pretzel sticks fresh",
    "Bagel chips packaged", "Pita chips packaged",
    "Lavash flatbread fresh",
    "Markook flatbread fresh", "Saj bread fresh",
    "Roti fresh", "Chapati fresh",
    "Paratha frozen", "Paratha fresh",
    "Rumali roti fresh",
    "Kulcha fresh",
    "Bao buns frozen", "Mantou frozen",
    "Banh mi roll fresh", "Cuban bread fresh",
    "Portuguese sweet bread", "Hawaiian sweet bread",
    "Stollen", "Panettone",
    "Pandoro", "Colomba",
    "Hot cross buns",
    "Sufganiyot frozen", "Beignets frozen",
    "Churros frozen", "Donut holes packaged",
    # ─── Specialty produce: more cultivars + heirlooms ─────────────────
    "Honeycrisp apple", "Pink Lady apple", "Fuji apple", "Gala apple",
    "Cosmic Crisp apple", "SweeTango apple", "Envy apple", "Jazz apple",
    "Opal apple", "SugarBee apple", "Newtown Pippin apple",
    "Esopus Spitzenburg apple", "Calville Blanc apple", "Cox's Orange Pippin",
    "Heirloom apple", "Crab apple", "Lady apple",
    "Anjou pear", "Bartlett pear", "Bosc pear", "Comice pear",
    "Forelle pear", "Seckel pear", "Starkrimson pear", "Asian pear nashi",
    "Korean pear", "Concorde pear",
    "Donut peach", "Saturn peach", "White peach", "Indian blood peach",
    "O'Henry peach", "Yellow nectarine", "White nectarine", "Rainier cherry",
    "Bing cherry", "Sour cherry fresh", "Sour cherry frozen",
    "Tart cherry frozen", "Black mission fig", "Brown turkey fig",
    "Calimyrna fig", "Adriatic fig",
    "Champagne grape", "Cotton candy grape", "Concord grape",
    "Muscat grape", "Thompson seedless grape",
    "Black plum", "Greengage plum", "Italian prune plum",
    "Mirabelle plum", "Pluot dapple dandy",
    "Aprium", "Apriplum hybrid", "Plumcot",
    "Heirloom tomato large", "Heirloom tomato cherry", "San Marzano tomato",
    "Cherokee Purple tomato", "Brandywine tomato", "Black Krim tomato",
    "Green Zebra tomato", "Sungold tomato", "Sun-dried tomato dry pack",
    "Sun-dried tomato oil pack",
    # ─── Sprouts + microgreens (varieties) ─────────────────────────────
    "Broccoli sprouts", "Pea sprouts", "Sunflower microgreens",
    "Radish microgreens", "Wheatgrass microgreens",
    "Bean sprouts mung", "Adzuki bean sprouts", "Clover sprouts",
    "Lentil sprouts", "Onion sprouts",
    # ─── Specialty squash + gourds (more) ──────────────────────────────
    "Honeynut squash", "Buttercup squash", "Sugar pie pumpkin",
    "Acorn squash", "Pattypan squash", "Sunburst squash",
    "Calabash gourd", "Bottle gourd lauki", "Cucuzza squash",
    "Trombetta zucchini", "Tinda gourd", "Snake gourd", "Ridge gourd",
    "Chinese long bean", "Yardlong bean", "Long bean Chinese",
    # ─── Citrus (more varieties) ───────────────────────────────────────
    "Eureka lemon", "Lisbon lemon", "Persian lime",
    "Key lime", "Limequat", "Mandarinquat", "Sumo citrus dekopon",
    "Honey tangerine honeybell", "Cara cara navel orange",
    "Seville orange sour", "Bitter orange naranja agria",
    "Tangelo", "Minneola tangelo", "Buddha hand citron",
    "Pomelo fresh", "Pomelo segments fresh", "Bergamot orange fresh",
    "Yuzu fruit fresh", "Yuzu juice bottled", "Kabosu", "Sudachi",
    "Calamansi fresh", "Calamansi pulp frozen",
    "Kaffir lime fruit makrut", "Yuzu rind preserved",
    # ─── More mushrooms ────────────────────────────────────────────────
    "Shiitake mushrooms fresh", "Shiitake mushrooms dried",
    "Cremini mushrooms", "Portobello mushrooms", "White button mushrooms",
    "Wood ear mushrooms dried", "Cloud ear mushrooms dried",
    "Matsutake mushrooms", "Lobster mushrooms", "Truffle fresh black",
    "Truffle fresh white", "Truffle oil bottled", "Truffle salt",
    "Truffle paste tube", "Mushroom medley frozen",
    "Mushroom powder shelf-stable", "Mushroom broth carton",
    # ─── More peppers + chiles ─────────────────────────────────────────
    "Poblano peppers fresh", "Anaheim peppers fresh", "Hatch chiles fresh",
    "Hatch chiles frozen", "Hatch chiles canned roasted",
    "Jalapeño peppers fresh", "Serrano peppers fresh",
    "Habanero peppers fresh", "Padron peppers fresh",
    "Shishito peppers fresh", "Banana peppers fresh", "Banana peppers pickled",
    "Cubanelle peppers fresh", "Fresno peppers fresh",
    "Bird's eye chiles fresh", "Thai chiles dried",
    "Chipotle chiles dried", "Mulato chile dried",
    "Cascabel chile dried", "Chile de arbol dried",
    "Chile piquin dried", "Aji amarillo paste",
    "Calabrian chili paste", "Sichuan chili oil",
    "Kashmiri chile dried", "Aleppo chile dried",
    "Urfa biber dried Turkish", "Maras pepper Turkish",
    "Pul biber Turkish",
    # ─── Specialty cheeses (additional) ────────────────────────────────
    "Manchego sheep aged", "Manchego sheep semi-cured",
    "Iberico cheese", "Mahon cheese", "Idiazabal cheese",
    "Tetilla cheese", "Cabra al Vino cheese",
    "Drunken Goat cheese", "Murcia al Vino",
    "Garrotxa cheese", "Roncal cheese",
    "Tomme de Savoie", "Tomme Crayeuse",
    "Saint-Nectaire", "Saint-Marcellin", "Saint-Félicien",
    "Brillat-Savarin", "Chaource", "Langres",
    "Pont-l'Évêque", "Livarot", "Maroilles",
    "Banon", "Crottin de Chavignol", "Selles-sur-Cher",
    "Valençay cheese", "Bûcheron goat", "Chèvre fresh log",
    "Boucheron", "Humboldt Fog", "Cypress Grove cheese",
    "Cheddar curds fresh", "Squeaky cheese curds",
    "Smoked Gouda", "Smoked cheddar", "Smoked mozzarella",
    "Smoked provolone", "Smoked scamorza",
    "String cheese sticks", "Babybel wax", "Laughing Cow wedges",
    "Boursin spread", "Alouette spread", "Rondelé spread",
    "Cambozola", "Saga blue", "Castello blue",
    "Point Reyes blue", "Maytag blue",
    "Rogue River blue", "Bayley Hazen blue",
    "Caciocavallo Silano", "Provolone Auricchio",
    "Asiago Pressato", "Asiago d'Allevo",
    "Caciotta", "Quartirolo Lombardo",
    "Casu marzu", "Pecorino Crotonese",
    "Halloumi Cypriot", "Anari Cypriot whey",
    "Akkawi Palestinian", "Nabulsi Palestinian",
    "Kashkaval Bulgarian", "Kasseri Greek",
    "Kefalotyri Greek", "Kefalograviera Greek",
    "Bryndza Slovakian", "Oscypek Polish smoked",
    "Paški sir Croatian", "Trappist cheese",
    "Sharp cheddar 5 year", "Cabot Clothbound cheddar",
    "Beecher's Flagship cheddar", "Tillamook sharp cheddar",
    "Reggianito Argentine", "Sardo Argentine",
    "Cotija aged", "Queso fresco fresh",
    "Queso Oaxaca string", "Queso Panela fresh",
    "Queso Quesadilla", "Queso Chihuahua",
    # ─── Cured meats (additional) ──────────────────────────────────────
    "Prosciutto di Parma sliced", "Prosciutto di San Daniele",
    "Speck Alto Adige", "Bresaola sliced",
    "Coppa sliced", "Soppressata dry-cured",
    "Capocollo dry-cured", "Mortadella sliced",
    "Salame Felino", "Finocchiona",
    "Nduja spreadable salame", "Guanciale cured jowl",
    "Pancetta arrotolata rolled", "Pancetta stesa flat",
    "Lardo di Colonnata", "Lomo Iberico",
    "Jamón Ibérico bellota", "Jamón Serrano",
    "Cecina León", "Chorizo Spanish dry-cured",
    "Chorizo Mexican raw", "Chorizo Mexican frozen",
    "Chorizo Argentine", "Linguiça Portuguese smoked",
    "Andouille sausage smoked", "Bratwurst raw", "Bratwurst cooked",
    "Weisswurst fresh", "Bockwurst",
    "Frankfurters all-beef", "Frankfurters all-pork",
    "Hot links smoked", "Boudin Cajun rice sausage",
    "Boudin noir blood sausage", "Black pudding fresh",
    "White pudding", "Haggis tinned",
    "Liverwurst deli sliced", "Braunschweiger tube",
    "Mettwurst spreadable", "Teewurst",
    "Salami Genoa", "Salami hard", "Salami cotto",
    "Hungarian salami", "Pepperoni sticks",
    "Cabanossi", "Landjaeger",
    "Pâté de campagne", "Pâté en croûte",
    "Mousse de canard", "Mousse de foie",
    "Foie gras tinned", "Foie gras torchon",
    "Rillettes potted meat", "Rillettes duck",
    "Rillons", "Confit duck legs vacuum",
    "Smoked duck breast vacuum", "Smoked ham hock",
    "Spam canned", "Vienna sausages canned",
    "Potted meat canned", "Deviled ham canned",
    "Corned beef canned", "Roast beef deli sliced",
    "Pastrami deli sliced", "Pastrami house-cured",
    "Salt-cured pork fat salo",
    # ─── Beef cuts (specific) ──────────────────────────────────────────
    "Beef cheeks fresh", "Beef shank osso buco",
    "Beef oxtail fresh", "Beef oxtail frozen",
    "Beef tongue fresh", "Beef tongue smoked",
    "Beef heart fresh", "Beef liver fresh",
    "Beef kidney fresh", "Beef sweetbreads fresh",
    "Beef marrow bones fresh", "Beef marrow bones frozen",
    "Beef bones for stock", "Beef tripe fresh",
    "Beef tripe frozen", "Honeycomb tripe fresh",
    "Skirt steak fresh", "Hanger steak fresh",
    "Bavette steak fresh", "Flap meat fresh",
    "Tri-tip fresh", "Flat iron steak fresh",
    "Picanha fresh", "Coulotte fresh",
    "Denver steak fresh", "Chuck eye steak fresh",
    "Ranch steak fresh", "Petite tender fresh",
    "Sirloin cap fresh", "Bottom round flat",
    "Eye of round roast", "Tip roast",
    "Beef brisket flat", "Beef brisket point",
    "Beef short ribs flanken", "Beef short ribs English",
    "Beef back ribs", "Plate short ribs",
    "Beef ribeye cap", "Beef ribeye filet",
    "Wagyu beef raw A5", "Wagyu ground raw",
    "Bison ribeye raw", "Bison brisket raw",
    "Elk steak frozen", "Venison ground frozen",
    "Wild boar ground raw",
    # ─── Pork cuts ─────────────────────────────────────────────────────
    "Pork belly fresh", "Pork belly cured slab bacon",
    "Pork jowl fresh", "Pork shoulder boston butt fresh",
    "Pork shoulder picnic fresh", "Pork shank fresh",
    "Pork hocks fresh", "Pork hocks smoked",
    "Pork feet fresh", "Pork feet pickled",
    "Pork rinds raw skin", "Pork lard rendered",
    "Pork fatback fresh", "Pork leaf lard",
    "Pork tenderloin fresh", "Pork loin chops bone-in",
    "Pork loin chops boneless", "Pork rib chops",
    "Pork sirloin chops", "Country style ribs",
    "Pork spare ribs", "Pork baby back ribs",
    "St Louis style ribs", "Pork riblets",
    "Pork shoulder steaks", "Pork cutlets thin sliced",
    "Pork milanesa thin pounded", "Pork country ham raw",
    "Pork country ham cooked", "Pork cushion meat",
    "Pork sirloin tip roast", "Pork rib roast bone-in",
    # ─── Lamb + goat + game ───────────────────────────────────────────
    "Lamb shank fresh", "Lamb shoulder fresh",
    "Lamb neck fresh", "Lamb leg boneless fresh",
    "Lamb leg bone-in fresh", "Lamb rack frenched",
    "Lamb chops loin fresh", "Lamb chops rib fresh",
    "Lamb chops shoulder", "Lamb riblets",
    "Lamb breast fresh", "Lamb stew meat",
    "Lamb cubes for kebab", "Ground lamb fresh",
    "Mutton stew meat", "Goat curry cubes",
    "Goat shoulder bone-in", "Goat leg bone-in",
    "Goat chops", "Cabrito young goat",
    "Veal scaloppine", "Veal cutlets thin",
    "Veal shank osso buco", "Veal cheeks fresh",
    "Veal sweetbreads fresh", "Veal liver fresh",
    "Veal stew meat", "Veal demi-glace",
    "Rabbit whole fresh", "Rabbit whole frozen",
    "Rabbit legs frozen", "Rabbit saddle",
    "Duck whole fresh", "Duck whole frozen",
    "Duck legs fresh", "Duck breast Magret",
    "Duck fat rendered", "Duck stock concentrate",
    "Goose whole frozen", "Goose fat jar",
    "Pheasant whole frozen", "Quail whole fresh",
    "Quail whole frozen", "Squab whole fresh",
    "Cornish hens fresh", "Cornish hens frozen",
    "Game birds whole frozen",
    # ─── Poultry parts ─────────────────────────────────────────────────
    "Chicken liver fresh", "Chicken hearts fresh",
    "Chicken gizzards fresh", "Chicken feet fresh",
    "Chicken feet frozen", "Chicken backs fresh",
    "Chicken necks fresh", "Chicken carcass for stock",
    "Chicken thighs boneless skin-on", "Chicken thighs boneless skinless",
    "Chicken thighs bone-in skin-on", "Chicken drumsticks fresh",
    "Chicken wings whole", "Chicken wing drumettes",
    "Chicken wing flats", "Chicken tenderloins fresh",
    "Chicken cutlets thin pounded", "Chicken half boneless",
    "Chicken quarter leg", "Spatchcock chicken whole",
    "Turkey neck fresh", "Turkey neck smoked",
    "Turkey wings fresh", "Turkey wings smoked",
    "Turkey legs smoked", "Turkey leg fresh whole",
    "Turkey thigh boneless", "Turkey thigh bone-in",
    "Turkey breast tenderloin", "Turkey breast cutlets",
    "Turkey tail fresh", "Turkey giblets",
    "Turkey heart fresh", "Turkey liver fresh",
    # ─── Seafood — fish (lots) ────────────────────────────────────────
    "Whole snapper fresh", "Whole branzino fresh",
    "Whole trout fresh", "Whole rockfish fresh",
    "Whole mackerel fresh", "Whole sardine fresh",
    "Whole porgy fresh", "Whole flounder fresh",
    "Whole sea bass fresh", "Whole pompano fresh",
    "Whole croaker fresh", "Whole spot fresh",
    "Whole sea bream fresh", "Whole turbot fresh",
    "Halibut fillet fresh", "Halibut steaks fresh",
    "Swordfish steaks fresh", "Mahi-mahi fillets fresh",
    "Grouper fillets fresh", "Snapper fillets fresh",
    "Cod fillets fresh", "Cod loins fresh",
    "Haddock fillets fresh", "Monkfish fillets fresh",
    "Monkfish tail fresh", "Sole fillets fresh",
    "Trout fillets fresh", "Char fillets fresh",
    "Arctic char fillets", "Sablefish fillets",
    "Black cod fillets", "Hake fillets fresh",
    "Pollock fillets fresh", "Tilefish fillets",
    "Bluefish fillets fresh", "Striped bass fillets",
    "Red drum fillets", "Walleye fillets fresh",
    "Lake trout fillets", "Whitefish fillets",
    "Yellowtail fillets fresh", "Hamachi sashimi grade",
    "Tuna sashimi grade fresh", "Bluefin tuna fresh",
    "Yellowfin tuna fresh", "Bonito fresh",
    "Skipjack tuna fresh", "Mackerel fillets fresh",
    "Sardine fillets fresh", "Anchovy fillets fresh",
    "Smelts fresh", "Eel fresh", "Eel smoked unagi",
    "Eel kabayaki frozen", "Squid fresh",
    "Squid frozen cleaned", "Cuttlefish fresh",
    "Octopus baby fresh", "Octopus large frozen",
    "Sea urchin uni fresh", "Conch meat frozen",
    "Conch fresh", "Abalone fresh", "Abalone frozen",
    "Geoduck fresh", "Whelk fresh",
    "Crab meat pasteurized refrigerated", "Crab meat fresh picked",
    "King crab legs frozen", "Snow crab clusters frozen",
    "Stone crab claws frozen", "Soft shell crab frozen",
    "Soft shell crab fresh", "Dungeness crab whole live",
    "Dungeness crab meat fresh", "Blue crab whole live",
    "Blue crab claws frozen", "Crawfish live", "Crawfish tails frozen",
    "Crawfish boil seasoning", "Lobster tail frozen raw",
    "Lobster tail frozen cooked", "Lobster meat fresh picked",
    "Lobster whole live", "Lobster cooked whole",
    "Langoustine frozen", "Spot prawns fresh",
    "Spot prawns frozen", "Mantis shrimp fresh",
    "Mussels live", "Mussels frozen meat",
    "Mussels in shell vacuum", "Clams live littleneck",
    "Clams live cherrystone", "Clams live manila",
    "Razor clams fresh", "Geoduck live", "Steamers live",
    "Oysters live in shell", "Oysters shucked refrigerated",
    "Oysters smoked tinned", "Scallops fresh dry-pack",
    "Scallops fresh wet-pack", "Scallops frozen IQF",
    "Bay scallops fresh", "Bay scallops frozen",
    "Salmon roe ikura", "Trout roe", "Tobiko flying fish",
    "Masago capelin roe", "Caviar sealed",
    "Caviar opened jar", "Caviar substitute", "Lumpfish roe",
    "Salt cod bacalao", "Stockfish dried",
    "Dried fish jerky", "Dried bonito flakes katsuobushi",
    "Dried anchovy ikan bilis", "Dried scallops",
    "Dried shrimp small", "Dried squid sliced",
    "Dried seaweed nori", "Dried seaweed wakame",
    "Dried seaweed kombu", "Dried seaweed hijiki",
    "Dried seaweed arame", "Dried seaweed dulse",
    "Smoked herring kippers", "Smoked trout vacuum",
    "Pickled herring jarred", "Pickled herring refrigerated",
    "Tinned tuna in oil", "Tinned tuna in water",
    "Tinned salmon pink", "Tinned salmon red",
    "Tinned crab claw meat", "Tinned crab lump",
    "Tinned mackerel in oil", "Tinned mackerel in tomato",
    "Tinned anchovy in oil", "Tinned anchovy salt-packed",
    "Tinned mussels smoked", "Tinned mussels in brine",
    "Tinned octopus in oil", "Tinned squid in ink",
    "Tinned bottarga grated", "Surimi imitation crab",
    "Fish balls Asian frozen", "Fish cakes Korean frozen",
    "Fish tofu Asian frozen", "Tempura batter mix",
    # ─── Asian noodles + wrappers ──────────────────────────────────────
    "Rice noodles fresh", "Rice noodles dry vermicelli",
    "Rice noodles dry pad thai", "Rice noodles wide pho",
    "Glass noodles dry mung bean", "Cellophane noodles dry",
    "Sweet potato noodles Korean dry", "Soba noodles dry",
    "Soba noodles fresh", "Somen noodles dry",
    "Hiyamugi noodles dry", "Egg noodles fresh Chinese",
    "Egg noodles dry", "Lo mein noodles fresh",
    "Lo mein noodles dry", "Chow mein noodles fresh",
    "Chow mein noodles dry", "Hand-pulled noodles fresh",
    "Knife-cut noodles fresh", "Ramen noodles fresh refrigerated",
    "Ramen noodles dry instant", "Udon noodles fresh",
    "Udon noodles frozen", "Udon noodles dry",
    "Kishimen noodles dry", "Yakisoba noodles fresh",
    "Korean kalguksu noodles", "Naengmyeon noodles dry",
    "Naengmyeon noodles fresh", "Bún Vietnamese rice vermicelli",
    "Banh canh thick rice noodles", "Banh hoi fine rice noodles",
    "Rice paper wrappers dried", "Wonton wrappers refrigerated",
    "Wonton wrappers frozen", "Egg roll wrappers refrigerated",
    "Spring roll wrappers frozen", "Lumpia wrappers frozen",
    "Gyoza wrappers fresh", "Gyoza wrappers frozen",
    "Shumai wrappers", "Dumpling skins fresh",
    "Dumpling skins frozen", "Steamed bun wrappers",
    "Pancake wrappers Peking duck", "Pancake mu shu",
    "Roti pratha frozen", "Murtabak frozen",
    # ─── Specialty rice + grains ───────────────────────────────────────
    "Sushi rice dry", "Calrose rice dry", "Koshihikari rice",
    "Arborio rice dry", "Carnaroli rice dry",
    "Vialone Nano rice", "Bomba rice paella",
    "Calasparra rice paella", "Jasmine rice dry",
    "Basmati rice dry brown", "Basmati rice dry white",
    "Brown jasmine rice dry", "Forbidden black rice dry",
    "Camargue red rice dry", "Bhutanese red rice",
    "Wild rice dry", "Wild rice blend",
    "Glutinous sticky rice dry", "Sweet rice Thai",
    "Sweet rice Japanese mochigome", "Mochiko sweet rice flour",
    "Mochiko shiratamako", "Parboiled rice",
    "Converted rice Uncle Ben's", "Instant rice",
    "Minute rice cooked pouch", "Microwave rice pouch",
    "Cooked rice pouch shelf-stable", "Risotto kit dry",
    "Wild rice cooked pouch", "Quinoa cooked pouch",
    "Farro cooked pouch", "Lentils cooked pouch",
    "Brown rice cooked pouch", "Cauliflower rice frozen",
    "Cauliflower rice refrigerated",
    # ─── Specialty flours ──────────────────────────────────────────────
    "00 flour Italian", "Tipo 0 flour Italian",
    "Semolina flour fine", "Semolina flour coarse",
    "Durum wheat flour", "Bread flour high-protein",
    "Cake flour", "Pastry flour", "Self-rising flour",
    "Whole wheat pastry flour", "White whole wheat flour",
    "Rye flour light", "Rye flour dark", "Rye flour pumpernickel",
    "Whole wheat flour fine", "Whole wheat flour stoneground",
    "Spelt flour whole", "Spelt flour white",
    "Einkorn flour whole", "Khorasan kamut flour",
    "Buckwheat flour light", "Buckwheat flour dark",
    "Teff flour ivory", "Teff flour brown",
    "Millet flour", "Sorghum flour",
    "Amaranth flour", "Quinoa flour",
    "Chickpea flour besan", "Fava bean flour",
    "Lentil flour", "Pea protein flour",
    "Soy flour", "Hemp flour",
    "Coconut flour", "Almond flour blanched",
    "Almond flour natural", "Hazelnut flour",
    "Chestnut flour", "Tigernut flour packaged",
    "Cassava flour", "Tapioca starch", "Tapioca pearls",
    "Arrowroot starch", "Potato starch",
    "Corn flour fine", "Cornmeal medium",
    "Cornmeal coarse polenta", "Masa harina blue",
    "Masa harina white", "Hominy grits stone-ground",
    "Hominy grits instant", "Grits stone-ground white",
    "Grits stone-ground yellow", "Polenta coarse instant",
    "Bob's Red Mill gluten-free 1-to-1", "King Arthur gluten-free flour",
    # ─── Beans + legumes ───────────────────────────────────────────────
    "Black beans dry", "Black beans canned",
    "Pinto beans dry", "Pinto beans canned",
    "Navy beans dry", "Navy beans canned",
    "Cannellini beans dry", "Cannellini beans canned",
    "Great Northern beans dry", "Kidney beans red dry",
    "Kidney beans red canned", "Kidney beans white dry",
    "Garbanzo beans dry", "Garbanzo beans canned",
    "Lima beans dry", "Lima beans canned",
    "Lima beans frozen", "Fava beans dry",
    "Fava beans canned", "Fava beans frozen",
    "Adzuki beans dry", "Adzuki beans canned",
    "Mung beans whole dry", "Mung beans split dry",
    "Black-eyed peas dry", "Black-eyed peas canned",
    "Pigeon peas dry", "Pigeon peas frozen",
    "Field peas dry", "Crowder peas dry",
    "Cranberry beans dry", "Christmas lima beans dry",
    "Heirloom beans Rancho Gordo", "Tepary beans dry",
    "Anasazi beans dry", "Pink beans dry",
    "Rio Zape beans dry", "Marrow beans dry",
    "Soldier beans dry", "Yellow eye beans dry",
    "Soybeans dry", "Soybeans edamame in pod fresh",
    "Soybeans edamame shelled frozen", "Soy nuts roasted",
    "Lentils green dry", "Lentils brown dry",
    "Lentils red split dry", "Lentils Puy dry",
    "Lentils beluga black dry", "Lentils canned",
    # ─── More pasta ────────────────────────────────────────────────────
    "Spaghetti dry", "Linguine dry", "Fettuccine dry",
    "Tagliatelle dry", "Pappardelle dry", "Bucatini dry",
    "Penne dry", "Rigatoni dry", "Ziti dry", "Mostaccioli dry",
    "Farfalle dry", "Orecchiette dry", "Cavatappi dry",
    "Rotini dry", "Fusilli dry", "Gemelli dry",
    "Conchiglie shells dry", "Macaroni elbow dry",
    "Ditalini dry", "Orzo dry pasta", "Pastina dry",
    "Acini di pepe dry", "Anelletti dry",
    "Lasagna sheets dry", "Lasagna sheets fresh refrigerated",
    "Lasagna sheets no-boil", "Manicotti dry", "Cannelloni dry",
    "Jumbo shells dry", "Lumache snail shells dry",
    "Bigoli dry", "Pici dry", "Strozzapreti dry",
    "Trofie dry", "Mafaldine dry", "Reginette dry",
    "Capellini angel hair dry", "Fideos dry",
    "Egg noodles wide", "Egg noodles broad",
    "Whole wheat spaghetti dry", "Whole wheat penne dry",
    "Chickpea pasta dry", "Lentil pasta dry",
    "Edamame pasta dry", "Black bean pasta dry",
    "Brown rice pasta dry", "Quinoa pasta dry",
    "Banza pasta", "Barilla protein pasta",
    "Spelt pasta dry", "Kamut pasta dry",
    "Buckwheat pasta dry", "Cassava pasta dry",
    "Konjac shirataki refrigerated", "Konjac shirataki shelf-stable",
    "Heart of palm pasta", "Hearts of palm noodles",
    "Veggie spirals zucchini", "Veggie spirals butternut",
    # ─── More sauces by cuisine ────────────────────────────────────────
    "Marinara jarred", "Vodka sauce jarred", "Arrabbiata jarred",
    "Puttanesca jarred", "Pesto jarred shelf-stable",
    "Pesto jarred refrigerated", "Sun-dried tomato pesto",
    "Genovese pesto fresh", "Walnut pesto", "Kale pesto",
    "Cilantro pesto", "Romesco jarred",
    "Alfredo sauce jarred", "Alfredo sauce refrigerated",
    "Carbonara sauce refrigerated", "Bolognese sauce jarred",
    "Bolognese sauce refrigerated", "Cacciatore sauce jarred",
    "Pizza sauce jarred", "Tomato sauce canned",
    "Tomato puree canned", "Crushed tomatoes canned",
    "Diced tomatoes canned", "Diced tomatoes fire-roasted",
    "Whole peeled tomatoes canned", "San Marzano tomatoes canned",
    "Tomato paste tube", "Tomato paste opened can",
    "Sun-dried tomato paste tube", "Sun-dried tomato in oil",
    "Salsa verde jarred", "Salsa roja jarred",
    "Salsa habanero jarred", "Pico de gallo refrigerated",
    "Mango salsa refrigerated", "Peach salsa jarred",
    "Pineapple salsa jarred", "Corn salsa jarred",
    "Black bean salsa jarred", "Hot sauce green pepper",
    "Hot sauce jalapeño", "Hot sauce ghost pepper",
    "Hot sauce habanero", "Carolina Reaper hot sauce",
    "Sambal oelek Indonesian", "Sambal manis sweet",
    "Sambal terasi shrimp paste", "Sambal matah balinese",
    "Curry paste Thai red", "Curry paste Thai green",
    "Curry paste Thai yellow", "Curry paste Thai massaman",
    "Curry paste Thai panang", "Curry paste Burmese",
    "Curry paste Indian rogan josh", "Curry paste Indian vindaloo",
    "Curry paste Indian korma", "Curry paste Indian madras",
    "Curry paste Japanese golden", "Curry paste Japanese vermont",
    "Curry paste Sri Lankan", "Curry powder Madras",
    "Curry powder yellow", "Curry powder hot",
    # ─── Hot sauces ────────────────────────────────────────────────────
    "Tabasco original", "Tabasco green jalapeño", "Tabasco chipotle",
    "Cholula original", "Cholula chili lime", "Cholula chipotle",
    "Tapatío original", "Valentina mild", "Valentina extra hot",
    "Crystal hot sauce", "Frank's RedHot original", "Frank's RedHot xtra hot",
    "El Yucateco green", "El Yucateco red", "El Yucateco caribbean",
    "Marie Sharp's mild", "Marie Sharp's habanero",
    "Pickapeppa sauce", "Matouk's hot sauce", "Susie's hot sauce",
    "Iguana sauce", "Tahitian hot sauce", "Walkerswood jerk",
    "Goya hot sauce", "Aji amarillo paste jarred",
    "Calabrian chili paste jarred", "Korean gochujang jarred",
    "Indonesian sambal jarred", "Sichuan chili oil jarred",
    "Chinese chili crisp Lao Gan Ma", "Chinese chili crisp Fly By Jing",
    "Sriracha Huy Fong", "Sriracha shelf-stable", "Sriracha mayo",
    "Buffalo wing sauce", "Wing sauce Asian", "Wing sauce mango habanero",
    "Hot honey", "Hot pepper jelly",
    # ─── Salad dressings ───────────────────────────────────────────────
    "Ranch dressing bottled", "Ranch dressing refrigerated",
    "Caesar dressing bottled", "Caesar dressing refrigerated",
    "Blue cheese dressing bottled", "Blue cheese dressing refrigerated",
    "Italian dressing shelf-stable", "Italian dressing refrigerated",
    "Greek dressing bottled", "Russian dressing", "Thousand Island bottled",
    "French dressing bottled", "Catalina dressing",
    "Honey mustard dressing", "Poppyseed dressing",
    "Raspberry vinaigrette", "Balsamic vinaigrette",
    "Red wine vinaigrette", "Champagne vinaigrette",
    "Lemon vinaigrette", "Green goddess refrigerated",
    "Tahini dressing refrigerated", "Miso dressing refrigerated",
    "Ginger sesame dressing", "Asian sesame dressing",
    "Cilantro lime dressing", "Avocado dressing",
    "Yogurt-based dressing refrigerated", "Buttermilk dressing",
    "Bacon ranch dressing", "Chipotle ranch dressing",
    "Cottage cheese dressing",
    # ─── Mustards + mayos ──────────────────────────────────────────────
    "Mayonnaise opened jar", "Mayonnaise olive oil", "Mayonnaise avocado oil",
    "Mayonnaise light", "Vegan mayo opened",
    "Aioli refrigerated opened", "Aioli garlic refrigerated",
    "Spicy mayo refrigerated", "Chipotle mayo bottled",
    "Sriracha mayo bottled", "Wasabi mayo tube",
    "Kewpie mayonnaise opened", "Mexican mayo Lawry's",
    "Tartar sauce opened", "Remoulade refrigerated",
    "Cocktail sauce opened", "Horseradish prepared opened jar",
    "Horseradish cream refrigerated",
    "Dijon mustard opened", "Yellow mustard opened",
    "Whole grain mustard opened", "Spicy brown mustard opened",
    "Honey mustard opened", "English mustard opened",
    "Chinese hot mustard opened", "Karashi mustard tube",
    "Wasabi paste tube opened", "Wasabi powder",
    "Yuzu kosho opened jar", "Daddies sauce", "HP sauce opened",
    "Branston pickle", "Piccalilli", "Chow chow Southern",
    "Mostarda di Cremona", "Pommery mustard",
    # ─── More pickled / fermented ──────────────────────────────────────
    "Pickled jalapeños jarred opened", "Pickled okra jarred",
    "Pickled beets jarred", "Pickled red onions refrigerated",
    "Pickled red onions homemade", "Pickled banana peppers",
    "Bread-and-butter pickles jarred", "Dill pickles shelf-stable",
    "Refrigerator pickles homemade", "Sport peppers jarred",
    "Cocktail onions jarred", "Maraschino cherries jarred",
    "Brandied cherries Luxardo", "Pickled garlic jarred",
    "Garlic confit refrigerated", "Roasted garlic paste jarred",
    "Black garlic puree jarred", "Anchovy paste tube",
    "Olives Kalamata jarred", "Olives Castelvetrano jarred",
    "Olives Castelvetrano deli", "Olives Niçoise jarred",
    "Olives Cerignola jarred", "Olives Picholine jarred",
    "Olives Manzanilla jarred", "Olives Mission jarred",
    "Olive tapenade jarred", "Caponata jarred",
    "Giardiniera refrigerated", "Giardiniera jarred",
    "Calabrian peppers jarred", "Pepperoncini jarred",
    "Cherry peppers stuffed jarred", "Sun-dried tomatoes dry pack",
    "Sun-dried tomatoes oil-packed", "Roasted red peppers jarred",
    "Roasted artichokes jarred", "Pickled artichoke hearts",
    "Artichoke hearts in water", "Artichoke hearts in oil",
    "Caperberries jarred", "Capers jarred opened",
    "Salt-packed capers", "Preserved lemons jarred",
    "Preserved lemons homemade", "Cured anchovy paste tube",
    "Kimchi shelf-stable", "Kimchi refrigerated opened",
    "Mukeunji aged kimchi", "Sauerkraut shelf-stable",
    "Sauerkraut refrigerated opened", "Sauerkraut Bavarian",
    "Sauerkraut wine-cured", "Kraut juice bottled",
    "Pickle brine bottled", "Beet kvass refrigerated",
    "Kvass refrigerated", "Tepache refrigerated",
    "Kishk fermented yogurt", "Labneh balls in oil",
    "Salt-preserved lemons homemade", "Fermented black beans douchi",
    "Fermented bean curd jarred", "Tempeh starter dry",
    "Sourdough starter fed refrigerated", "Sourdough starter dried",
    # ─── Oils + vinegars ──────────────────────────────────────────────
    "Olive oil extra virgin opened", "Olive oil light opened",
    "Olive oil pomace", "Olive oil Greek Kalamata",
    "Olive oil Spanish", "Olive oil Italian DOP",
    "Olive oil California", "Olive oil Tunisian",
    "Olive oil flavored garlic", "Olive oil flavored herb",
    "Olive oil flavored chili", "Olive oil flavored citrus",
    "Canola oil opened", "Vegetable oil opened",
    "Sunflower oil opened", "Safflower oil opened",
    "Grapeseed oil opened", "Avocado oil opened",
    "Avocado oil refined", "Avocado oil unrefined",
    "Peanut oil opened", "Sesame oil toasted opened",
    "Sesame oil light opened", "Walnut oil opened",
    "Hazelnut oil opened", "Pistachio oil opened",
    "Pumpkin seed oil opened", "Flax seed oil refrigerated",
    "Hemp seed oil refrigerated", "Coconut oil refined",
    "Coconut oil unrefined", "Coconut oil MCT",
    "Palm oil red unrefined", "Palm oil bleached",
    "Lard rendered jarred", "Tallow rendered jarred",
    "Duck fat rendered jar", "Schmaltz chicken fat",
    "Ghee jar", "Ghee opened jar", "Cultured ghee jar",
    "Brown butter homemade", "Compound butter homemade",
    "Vinegar white distilled opened", "Vinegar apple cider opened",
    "Vinegar apple cider raw mother", "Vinegar balsamic Modena opened",
    "Vinegar balsamic aged 12yr", "Vinegar balsamic aged 25yr",
    "Vinegar white balsamic", "Vinegar red wine opened",
    "Vinegar white wine opened", "Vinegar sherry opened",
    "Vinegar champagne opened", "Vinegar malt opened",
    "Vinegar coconut opened", "Vinegar sugar cane opened",
    "Vinegar rice unseasoned", "Vinegar rice seasoned sushi",
    "Vinegar rice black Chinkiang", "Vinegar rice red Chinese",
    "Vinegar persimmon Korean", "Vinegar plum umeboshi",
    # ─── Sweeteners ────────────────────────────────────────────────────
    "Sugar white granulated", "Sugar superfine caster", "Sugar powdered confectioner",
    "Sugar brown light", "Sugar brown dark", "Sugar muscovado",
    "Sugar demerara", "Sugar turbinado", "Sugar piloncillo",
    "Sugar jaggery block", "Sugar coconut palm", "Sugar date",
    "Sugar maple granulated", "Sugar pearl", "Sugar sanding",
    "Honey clover", "Honey wildflower", "Honey orange blossom",
    "Honey buckwheat", "Honey acacia", "Honey manuka",
    "Honey raw unfiltered", "Honeycomb raw",
    "Maple syrup grade A", "Maple syrup grade B",
    "Maple syrup dark robust", "Maple cream",
    "Sorghum syrup", "Cane syrup Steen's",
    "Golden syrup Lyle's", "Treacle black molasses",
    "Brown rice syrup jarred", "Yacon syrup bottled",
    "Date syrup silan", "Carob molasses",
    "Agave nectar opened", "Coconut nectar",
    "Stevia liquid", "Stevia powder packet",
    "Monk fruit liquid", "Monk fruit powder",
    "Erythritol powder", "Allulose powder",
    "Xylitol granulated", "Mannitol",
    "Sweet'N Low packet", "Equal packet",
    "Splenda packet", "Truvia packet",
    "Lakanto sweetener", "Sugar substitute blend",
    # ─── Modern beverages (more) ───────────────────────────────────────
    "Sparkling tea refrigerated", "Hop water non-alcoholic",
    "Non-alcoholic beer", "Non-alcoholic wine", "Non-alcoholic spirits",
    "Kombucha shelf-stable", "Jun tea kombucha",
    "Switchel ginger vinegar drink", "Drinking vinegar shrub",
    "Shrub bottled", "Adaptogenic latte mix powder",
    "Mushroom coffee Four Sigmatic", "Mushroom coffee instant",
    "Pre-workout powder", "Greens powder AG1",
    "Electrolyte LMNT", "Electrolyte Liquid IV",
    "Electrolyte Nuun tablet", "Electrolyte Hydrant",
    "Beet juice bottled", "Beet juice shelf-stable",
    "Tart cherry juice concentrate", "Tart cherry juice ready to drink",
    "Aloe juice bottled", "Cranberry juice 100%",
    "Pomegranate juice 100%", "Pomegranate concentrate",
    "Lemonade concentrate frozen", "Limonana refrigerated",
    "Hibiscus loose petals", "Hibiscus tea bottled",
    "Rooibos tea loose leaf", "Rooibos tea bagged",
    "Yerba mate loose leaf", "Yerba mate canned",
    "Guayusa tea loose", "Lapsang souchong tea",
    "Pu-erh tea aged", "White tea loose leaf",
    "Tulsi holy basil tea", "Genmaicha green tea",
    "Hojicha roasted tea", "Sencha green tea",
    "Gyokuro green tea", "Matcha ceremonial",
    "Matcha culinary", "Bancha green tea",
    "Bone broth concentrate jarred", "Bouillon Better Than Bouillon",
    "Beef stock carton", "Vegetable stock carton",
    "Mushroom stock carton", "Dashi stock fresh",
    "Pho broth concentrate", "Tom yum paste jarred",
    "Tom yum broth carton", "Miso soup paste tube",
    "Liquid stevia bottled", "Liquid monk fruit",
    "Aquafaba canned", "Coconut yogurt smoothie bottled",
    "Apple cider vinegar drink Bragg", "Cold-pressed juice HPP",
    "Cold-pressed juice raw", "Vegetable juice V8",
    "Tomato juice canned", "Carrot juice refrigerated",
    "Carrot juice shelf-stable", "Wheatgrass shot refrigerated",
    "Wheatgrass shot frozen", "Ginger shot refrigerated",
    "Turmeric shot refrigerated", "Echinacea shot",
    "Beet juice cold-pressed", "Celery juice cold-pressed",
    "Watermelon juice cold-pressed", "Cucumber juice cold-pressed",
    "Liquid chlorophyll bottled",
    # ─── Plant milks (more) ────────────────────────────────────────────
    "Almond milk refrigerated unsweetened",
    "Almond milk refrigerated vanilla", "Almond milk barista",
    "Oat milk refrigerated original", "Oat milk barista",
    "Oat milk chocolate", "Oat milk vanilla",
    "Soy milk original refrigerated", "Soy milk vanilla shelf-stable",
    "Cashew milk refrigerated", "Cashew milk shelf-stable",
    "Coconut milk drinking refrigerated", "Coconut milk drinking shelf-stable",
    "Hazelnut milk shelf-stable", "Hazelnut milk refrigerated",
    "Macadamia milk", "Pistachio milk Tache",
    "Hemp milk refrigerated", "Hemp milk shelf-stable",
    "Flax milk shelf-stable", "Banana milk Mooala",
    "Quinoa milk shelf-stable", "Rice milk shelf-stable",
    "Tigernut milk", "Walnut milk",
    "Pea milk Ripple", "Tofu blended milk",
    "Coconut whole milk refrigerated", "Coffee creamer non-dairy refrigerated",
    "Coffee creamer non-dairy shelf-stable", "Half-and-half plant-based",
    # ─── Confectionery + sweets ────────────────────────────────────────
    "Dark chocolate bar 70%", "Dark chocolate bar 85%",
    "Milk chocolate bar", "White chocolate bar",
    "Ruby chocolate bar", "Couverture chocolate", "Chocolate truffles",
    "Chocolate-covered almonds", "Chocolate-covered pretzels",
    "Chocolate-covered cherries", "Chocolate-covered raisins",
    "Yogurt-covered raisins", "Yogurt-covered pretzels",
    "Chocolate ganache jarred", "Chocolate fudge sauce",
    "Caramel sauce jarred", "Salted caramel sauce", "Butterscotch sauce",
    "Hot fudge topping", "Strawberry topping",
    "Sprinkles rainbow jimmies", "Sprinkles nonpareils",
    "Sprinkles pearl sugar", "Edible glitter",
    "Marshmallow fluff", "Marshmallows large bag",
    "Marshmallows mini bag", "Halva tahini",
    "Halva semolina", "Turkish delight lokum",
    "Marzipan block", "Nougat bar", "Torrone Italian",
    "Mochi ice cream", "Daifuku", "Dorayaki anko-filled",
    "Manju", "Castella cake", "Taiyaki frozen",
    "Pandoro Italian Christmas", "Panettone Italian Christmas",
    "Stollen German Christmas", "Fruitcake aged wrapped",
    "Gummy candy bag", "Sour gummy worms", "Gummy bears",
    "Licorice red bag", "Licorice black bag",
    "Saltwater taffy bag", "Caramel candies bag",
    "Candy corn", "Mints peppermint roll", "Mints altoids",
    "Mints chocolate after-dinner", "Lifesavers roll",
    "Hard candy assorted", "Toffee bar", "Brittle peanut",
    "Brittle cashew", "Brittle sesame",
    # ─── More dried fruit + nuts ───────────────────────────────────────
    "Dried apricots whole", "Dried apricots Turkish",
    "Dried apricots California sulfured", "Dried apricots unsulfured",
    "Dried mango slices", "Dried pineapple chunks",
    "Dried papaya chunks", "Dried banana chips",
    "Dried plantain chips", "Dried apples slices",
    "Dried apples rings", "Dried pears halves",
    "Dried prunes", "Dried plums",
    "Dried figs Mission", "Dried figs Turkish",
    "Dried dates Medjool", "Dried dates Deglet Noor",
    "Dried dates Barhi", "Dates fresh",
    "Raisins golden", "Raisins dark Thompson",
    "Currants dried", "Sultanas",
    "Dried cherries tart", "Dried cherries sweet",
    "Dried cranberries sweetened", "Dried cranberries unsweetened",
    "Dried blueberries", "Dried strawberries",
    "Dried raspberries", "Dried mulberries",
    "Dried goji berries", "Dried inca berries cape gooseberries",
    "Dried persimmons", "Dried kiwi slices",
    "Dried coconut shredded sweetened", "Dried coconut flakes unsweetened",
    "Toasted coconut flakes", "Coconut chips snack",
    "Trail mix bag", "Trail mix tropical",
    "Mixed nuts roasted salted", "Mixed nuts raw",
    "Almonds raw", "Almonds dry-roasted",
    "Almonds tamari", "Almonds smoked",
    "Marcona almonds tin", "Cashews raw",
    "Cashews roasted salted", "Cashews honey-roasted",
    "Walnuts halves raw", "Walnuts pieces raw",
    "Pecans raw halves", "Pecans candied",
    "Pistachios in shell", "Pistachios shelled",
    "Hazelnuts raw", "Brazil nuts raw",
    "Macadamia raw", "Macadamia honey-roasted",
    "Pine nuts raw", "Pine nuts toasted",
    "Chestnuts roasted vacuum", "Chestnuts raw fresh",
    "Peanuts in shell", "Peanuts boiled canned",
    "Roasted chickpeas snack", "Roasted fava beans snack",
    # ─── Eggs + egg products ───────────────────────────────────────────
    "Liquid egg whites carton", "Liquid eggs carton",
    "Egg substitute EggBeaters", "JUST Egg liquid",
    "JUST Egg folded frozen", "Hard-boiled eggs peeled refrigerated",
    "Pickled eggs jarred", "Century eggs preserved duck",
    "Salted duck eggs raw", "Salted duck eggs cooked",
    "Quail eggs fresh", "Quail eggs canned",
    "Duck eggs fresh", "Goose eggs fresh",
    "Tea eggs refrigerated", "Pickled quail eggs",
    "Powdered egg whites", "Powdered whole eggs",
    "Egg replacer powder Bob's Red Mill", "Egg yolks frozen",
    # ─── Snack bars + protein ──────────────────────────────────────────
    "Cliff bar", "Cliff Builder's protein bar",
    "KIND bar", "Lärabar", "RXBar", "Quest protein bar",
    "ONE protein bar", "Built bar", "Power Crunch bar",
    "Pure Protein bar", "Atkins bar", "Atlas bar",
    "Aloha protein bar", "Gomacro bar", "Health Warrior chia bar",
    "Nature Valley bar", "Kashi bar", "Special K bar",
    "Fiber One bar", "Cliff Kid Zbar", "Annie's bars",
    "Trader Joe's bar", "Snickers bar", "Skippy peanut butter cracker",
    "Lance toast chee", "Cheez-It bag opened",
    "Goldfish crackers opened", "Saltines opened sleeve",
    "Graham crackers opened", "Rice crackers Japanese senbei",
    "Wasabi peas bag", "Cracker Jack boxed",
    "Popcorn popped opened bag", "Popcorn kernels dry",
    "Microwave popcorn unpopped bag", "Cheese popcorn bag",
    "Caramel corn bag", "Skinny Pop popcorn",
    "Popcorners bag", "Pretzel crisps bag",
    "Snap pea crisps", "Whisps cheese crisps",
    "Quest tortilla chips", "Siete tortilla chips",
    "Plantain chips Inka", "Beet chips Terra",
    "Veggie straws bag", "Pop chips bag",
    # ─── Beverages — coffee + tea ──────────────────────────────────────
    "Coffee beans whole roasted", "Coffee beans light roast",
    "Coffee beans dark roast", "Coffee beans medium roast",
    "Coffee beans decaf", "Coffee beans espresso roast",
    "Coffee ground vacuum-sealed", "Coffee ground opened bag",
    "Coffee instant jar", "Coffee instant single serve",
    "Coffee pods K-Cup", "Coffee pods Nespresso",
    "Coffee concentrate refrigerated", "Coffee concentrate shelf-stable",
    "Cold brew coffee bottled", "Cold brew coffee homemade",
    "Nitro cold brew bottled", "Iced coffee bottled",
    "Coffee creamer flavored liquid", "Coffee creamer flavored powder",
    "Coffee syrup flavored", "Tea bags black",
    "Tea bags green", "Tea bags herbal",
    "Tea bags Earl Grey", "Tea bags English Breakfast",
    "Tea bags chamomile", "Tea bags peppermint",
    "Tea bags ginger", "Tea bags chai",
    "Loose leaf tea Darjeeling", "Loose leaf tea Assam",
    "Loose leaf tea Ceylon", "Loose leaf tea Yunnan",
    "Loose leaf tea Lapsang", "Loose leaf tea Pu-erh",
    "Loose leaf tea oolong", "Loose leaf tea jasmine",
    "Matcha powder culinary", "Matcha powder ceremonial",
    "Chai concentrate refrigerated", "Chai concentrate shelf-stable",
    "Chai bag dry", "Chai latte mix",
    "Golden milk mix", "Turmeric latte mix",
    "Beetroot latte mix",
    # ─── Supplements + functional ──────────────────────────────────────
    "Whey isolate tub", "Whey concentrate tub",
    "Casein protein tub", "Egg white protein tub",
    "Soy protein isolate tub", "Pea protein powder tub",
    "Hemp protein powder tub", "Brown rice protein tub",
    "Pumpkin seed protein tub", "Collagen powder bovine",
    "Collagen powder marine", "Collagen peptides flavored",
    "Multi-collagen powder", "BCAA powder",
    "EAA powder", "Creatine monohydrate powder",
    "Pre-workout powder", "Beta alanine powder",
    "L-glutamine powder", "Glutathione capsules",
    "Spirulina powder", "Chlorella powder",
    "Wheatgrass powder", "Barley grass powder",
    "Maca powder", "Ashwagandha powder",
    "Lion's mane powder", "Reishi powder",
    "Cordyceps powder", "Chaga powder",
    "Turkey tail mushroom powder", "Mushroom blend powder",
    "Beetroot powder", "Carrot powder",
    "Spinach powder", "Kale powder",
    "Greens blend powder", "Reds blend powder",
    "Berry powder blend", "Acai powder",
    "Camu camu powder", "Baobab powder",
    "Moringa powder", "Lucuma powder",
    "Mesquite powder", "Cacao powder raw",
    "Cocoa powder Dutch process", "Cocoa powder natural",
    "Cocoa powder alkalized", "Carob powder",
    "Chia seeds dry", "Flax seeds whole dry",
    "Flax seeds ground milled", "Hemp seeds hulled",
    "Hemp seeds whole", "Sunflower seeds raw shelled",
    "Sunflower seeds roasted salted", "Pumpkin seeds pepitas raw",
    "Pumpkin seeds roasted salted", "Sesame seeds white",
    "Sesame seeds black", "Sesame seeds toasted",
    "Poppy seeds dry", "Watermelon seeds roasted",
    "Squash seeds roasted", "Pomegranate seeds dried arils",
    "Hawthorn berry capsules", "Echinacea capsules",
    "Elderberry syrup", "Manuka honey jar",
    "Vitamin gummies multivitamin", "Vitamin D drops liquid",
    "Vitamin B12 sublingual", "Vitamin C chewable",
    "Iron supplements liquid", "Magnesium glycinate powder",
    "Magnesium citrate powder", "Probiotic capsules shelf-stable",
    "Probiotic capsules refrigerated", "Digestive enzymes capsules",
    "Fish oil softgels", "Fish oil liquid bottle",
    "Cod liver oil liquid", "Krill oil softgels",
    "Algae omega-3 oil liquid", "Apple cider vinegar gummies",
    "Sea moss gel refrigerated", "Sea moss dried raw",
    "Bee pollen granules", "Royal jelly capsules",
    "Propolis tincture", "CBD oil tincture",
    "Hemp seed oil refrigerated",
    # ─── Frozen meals + components (more) ─────────────────────────────
    "Frozen breakfast burrito", "Frozen breakfast sandwich Jimmy Dean",
    "Frozen breakfast bowl egg", "Frozen waffles Eggo",
    "Frozen waffles Kodiak", "Frozen pancakes",
    "Frozen french toast sticks", "Frozen crepes",
    "Frozen blintzes", "Frozen pizza thin crust",
    "Frozen pizza cauliflower crust", "Frozen pizza gluten free",
    "Frozen pizza vegan", "Frozen pizza meat lovers",
    "Frozen pizza pepperoni", "Frozen pizza cheese",
    "Frozen pizza BBQ chicken", "Frozen pizza Hawaiian",
    "Frozen pizza margherita", "Frozen pizza Detroit-style",
    "Frozen Stouffer's meal", "Frozen Lean Cuisine meal",
    "Frozen Healthy Choice meal", "Frozen Marie Callender's meal",
    "Frozen Banquet meal", "Frozen Boston Market meal",
    "Frozen Amy's vegetarian meal", "Frozen Saffron Road Indian",
    "Frozen Tasty Bite Indian", "Frozen sushi grocery",
    "Frozen poke bowl kit", "Frozen Asian rice bowl",
    "Frozen Mexican rice bowl", "Frozen burrito bowl",
    "Frozen mac and cheese single serve", "Frozen pot pie chicken",
    "Frozen pot pie vegetable", "Frozen pot pie beef",
    "Frozen shepherd's pie", "Frozen cottage pie",
    "Frozen enchiladas cheese", "Frozen enchiladas beef",
    "Frozen enchiladas chicken", "Frozen taquitos beef",
    "Frozen taquitos chicken", "Frozen quesadillas",
    "Frozen empanadas beef", "Frozen empanadas chicken",
    "Frozen samosas vegetable", "Frozen samosas meat",
    "Frozen spring rolls vegetable", "Frozen egg rolls pork",
    "Frozen pierogi potato", "Frozen pierogi cheese",
    "Frozen pierogi sauerkraut", "Frozen ravioli cheese stuffed",
    "Frozen ravioli meat stuffed", "Frozen tortellini cheese",
    "Frozen tortellini meat", "Frozen agnolotti",
    "Frozen gnocchi potato", "Frozen baozi steamed buns",
    "Frozen char siu bao", "Frozen xiao long bao soup dumplings",
    "Frozen dim sum mix", "Frozen pho noodle kit",
    "Frozen ramen kit", "Frozen pad thai kit",
    "Frozen biryani tray", "Frozen butter chicken tray",
    "Frozen palak paneer", "Frozen chicken tikka masala",
    "Frozen vindaloo", "Frozen rogan josh tray",
    "Frozen lasagna tray", "Frozen manicotti",
    "Frozen cannelloni", "Frozen stuffed shells",
    "Frozen pizza pockets Hot Pockets",
    "Frozen burrito Amy's", "Frozen burrito El Monterey",
    "Frozen falafel patties", "Frozen veggie burger Beyond",
    "Frozen veggie burger Impossible", "Frozen veggie burger Boca",
    "Frozen veggie burger MorningStar", "Frozen meatballs cooked",
    "Frozen meatballs raw", "Frozen chicken meatballs",
    "Frozen turkey meatballs", "Frozen plant-based meatballs",
    "Frozen chicken nuggets breaded", "Frozen chicken strips breaded",
    "Frozen chicken tenders", "Frozen chicken patties",
    "Frozen popcorn chicken", "Frozen plant-based nuggets",
    "Frozen fish sticks battered", "Frozen fish fillets battered",
    "Frozen fish fillets breaded", "Frozen fish fillets plain",
    "Frozen shrimp tempura", "Frozen popcorn shrimp",
    "Frozen calamari rings", "Frozen onion rings",
    "Frozen french fries crinkle", "Frozen french fries shoestring",
    "Frozen french fries steak cut", "Frozen french fries waffle",
    "Frozen tater tots", "Frozen hash browns shredded",
    "Frozen hash browns cubed", "Frozen home fries",
    "Frozen mashed potatoes", "Frozen sweet potato fries",
    "Frozen rice minute-style", "Frozen brown rice single serve",
    "Frozen jasmine rice single serve", "Frozen cauliflower rice",
    # ─── Frozen produce (more) ────────────────────────────────────────
    "Frozen broccoli florets", "Frozen broccoli rabe",
    "Frozen cauliflower florets", "Frozen cauliflower riced",
    "Frozen brussels sprouts", "Frozen spinach block",
    "Frozen spinach loose", "Frozen peas",
    "Frozen sweet corn", "Frozen white corn",
    "Frozen corn on the cob", "Frozen mixed vegetables",
    "Frozen stir-fry mix", "Frozen okra cut",
    "Frozen artichoke hearts", "Frozen asparagus",
    "Frozen green beans", "Frozen butternut squash cubes",
    "Frozen sweet potato cubes", "Frozen kale chopped",
    "Frozen collard greens chopped", "Frozen pearl onions",
    "Frozen diced onions", "Frozen diced peppers tri-color",
    "Frozen edamame in pod", "Frozen edamame shelled",
    "Frozen mixed berries", "Frozen blueberries wild",
    "Frozen blueberries cultivated", "Frozen strawberries whole",
    "Frozen strawberries sliced", "Frozen raspberries",
    "Frozen blackberries", "Frozen mixed berry blend",
    "Frozen pineapple chunks", "Frozen peach slices",
    "Frozen mango chunks", "Frozen acai pulp packets",
    "Frozen cherries dark sweet", "Frozen cherries tart",
    "Frozen banana commercial", "Frozen cantaloupe chunks",
    "Frozen smoothie pouches Jamba", "Frozen smoothie pack",
    # ─── Frozen dessert ───────────────────────────────────────────────
    "Ice cream pint vanilla", "Ice cream pint chocolate",
    "Ice cream pint strawberry", "Ice cream Ben & Jerry's pint",
    "Ice cream Häagen-Dazs pint", "Ice cream Tillamook",
    "Ice cream Halo Top", "Ice cream Talenti gelato",
    "Ice cream Magnum bars", "Ice cream sandwich",
    "Frozen yogurt", "Sorbet pint", "Sherbet pint",
    "Italian ice", "Mochi ice cream pack",
    "Coconut ice cream", "Oat ice cream",
    "Cashew ice cream", "Almond ice cream",
    "Frozen custard", "Gelato pint Italian",
    "Frozen cheesecake", "Frozen tiramisu",
    "Frozen pie crust", "Frozen pumpkin pie",
    "Frozen apple pie", "Frozen cherry pie",
    "Frozen pecan pie", "Frozen blueberry pie",
    "Frozen cobbler", "Frozen turnovers fruit",
    "Frozen toaster strudel", "Frozen Eggo waffles",
    "Frozen Kodiak waffles", "Frozen pancake mini",
    # ─── Refrigerated / deli prepared (more) ───────────────────────────
    "Hummus deli refrigerated", "Hummus roasted red pepper",
    "Hummus garlic", "Hummus edamame",
    "Hummus beet", "Hummus black bean",
    "Hummus chocolate dessert", "Tzatziki refrigerated",
    "Baba ghanoush refrigerated", "Muhammara refrigerated",
    "Spinach artichoke dip refrigerated", "French onion dip refrigerated",
    "Ranch dip refrigerated", "Buffalo chicken dip refrigerated",
    "Queso dip refrigerated", "Bean dip refrigerated",
    "Pimento cheese refrigerated", "Egg salad refrigerated",
    "Chicken salad refrigerated deli", "Tuna salad refrigerated deli",
    "Lobster salad refrigerated", "Shrimp salad refrigerated",
    "Crab salad refrigerated", "Ham salad refrigerated",
    "Potato salad refrigerated mayo", "Potato salad refrigerated mustard",
    "Macaroni salad refrigerated", "Coleslaw refrigerated",
    "Broccoli salad refrigerated", "Cucumber salad refrigerated",
    "Tabbouleh refrigerated", "Quinoa salad refrigerated",
    "Pasta salad mayo refrigerated", "Pasta salad vinaigrette",
    "Beet salad refrigerated", "Carrot raisin salad",
    "Kale salad refrigerated", "Caesar salad kit refrigerated",
    "Cobb salad kit refrigerated", "Asian salad kit refrigerated",
    "Pesto refrigerated", "Marinara refrigerated fresh",
    "Vodka sauce refrigerated", "Alfredo sauce refrigerated",
    "Sauce mole refrigerated", "Sofrito refrigerated",
    "Salsa fresh refrigerated", "Pico de gallo refrigerated",
    "Salsa verde refrigerated", "Guacamole refrigerated",
    "Guacamole avocado kit", "Pesto fresh refrigerated",
    "Romesco refrigerated", "Chimichurri refrigerated",
    "Mojo sauce refrigerated", "Cocktail sauce refrigerated",
    "Tartar sauce refrigerated", "Remoulade refrigerated",
    "Aioli refrigerated", "Garlic confit refrigerated",
    "Fresh hollandaise", "Fresh bearnaise",
    "Fresh bechamel", "Fresh mornay",
    "Compound butter herb", "Truffle butter",
    "Lobster butter", "Garlic butter",
    "Fresh stock chicken refrigerated", "Fresh stock beef refrigerated",
    "Fresh stock vegetable refrigerated", "Fresh stock fish refrigerated",
    "Demi-glace refrigerated", "Bone broth refrigerated carton",
    "Bone broth shelf-stable carton", "Veggie broth carton",
    # ─── Refrigerated / pre-cut produce ────────────────────────────────
    "Riced cauliflower fresh", "Riced broccoli fresh",
    "Spiralized zucchini fresh", "Spiralized sweet potato fresh",
    "Spiralized beet fresh", "Spiralized butternut fresh",
    "Pre-cut butternut cubed", "Pre-cut sweet potato cubed",
    "Pre-cut pineapple chunks", "Pre-cut mango chunks",
    "Pre-cut watermelon chunks", "Pre-cut cantaloupe chunks",
    "Pre-cut honeydew chunks", "Pre-cut mixed fruit",
    "Pre-cut vegetable trays", "Pre-washed kale chopped",
    "Pre-washed spinach baby bag", "Pre-washed arugula bag",
    "Pre-washed spring mix bag", "Pre-washed romaine hearts",
    "Pre-washed iceberg chopped", "Pre-washed cabbage shredded",
    "Pre-washed broccoli florets", "Pre-washed cauliflower florets",
    "Pre-washed carrots baby", "Pre-washed carrots matchstick",
    "Pre-washed celery sticks", "Pre-washed snap peas",
    "Stir-fry mix refrigerated", "Fajita mix refrigerated",
    "Mirepoix mix refrigerated", "Salad kit Caesar refrigerated",
    "Salad kit Asian sesame", "Salad kit Mediterranean",
    "Salad kit Mexican fiesta", "Salad kit BLT",
    "Coleslaw mix bagged", "Broccoli slaw bagged",
    # ─── Baby + kid foods ──────────────────────────────────────────────
    "Baby food puree jar", "Baby food puree pouch",
    "Baby cereal rice", "Baby cereal oatmeal",
    "Baby cereal multigrain", "Baby teething wafers",
    "Baby puffs", "Baby yogurt melts",
    "Baby formula powder", "Baby formula concentrate",
    "Baby formula ready-to-feed", "Toddler milk",
    "Plant-based baby formula", "Kid snack pouch fruit",
    "Kid snack pouch yogurt", "Kid snack pouch veggie",
    "Kid string cheese pack", "Kid cheese stick pack",
    "Lunchables", "Lunchables cracker stackers",
    "Goldfish small bags", "Annie's Bunny Grahams",
    "Annie's cheddar bunnies", "Earth's Best snacks",
    "Plum Organics baby food", "Happy Family baby food",
    "Cerebelly baby food", "Once Upon a Farm baby food",
    "Serenity Kids baby food",
    # ─── Pet-not-food (omit) — already accounting ──────────────────────
    # ─── Specialty grains, prepared ────────────────────────────────────
    "Cooked oatmeal refrigerated", "Overnight oats jar",
    "Cooked quinoa refrigerated", "Cooked farro refrigerated",
    "Cooked barley refrigerated", "Cooked freekeh refrigerated",
    "Cooked rice refrigerated", "Cooked black rice refrigerated",
    "Cooked brown rice refrigerated", "Cooked wild rice refrigerated",
    "Cooked beans refrigerated", "Cooked lentils refrigerated",
    "Cooked chickpeas refrigerated", "Cooked black-eyed peas refrigerated",
    "Cooked pasta refrigerated", "Cooked gnocchi refrigerated",
    # ─── More specialty produce ────────────────────────────────────────
    "Sea bean samphire", "Glasswort fresh",
    "Sea grapes fresh", "Bull kelp fresh",
    "Sugar kelp fresh", "Wakame fresh",
    "Sea lettuce fresh", "Marsh samphire",
    "Fiddleheads spring", "Ramps wild leeks",
    "Wild garlic ramps", "Ostrich ferns",
    "Cattail shoots", "Hops shoots",
    "Stinging nettles", "Garlic mustard",
    "Mache lamb's lettuce", "Komatsuna Japanese mustard",
    "Mibuna Japanese greens", "Hon tsai tai",
    "Yu choi sum flowering", "Brown beech mushrooms",
    "White beech mushrooms", "Pioppini mushrooms cluster",
    "Kabocha squash green", "Kabocha squash orange",
    "Red kuri squash", "Crown prince squash",
    "Marina di Chioggia squash", "Cinderella pumpkin",
    "Jarrahdale pumpkin", "Long Island Cheese pumpkin",
    "Sweet Dumpling squash", "Carnival pumpkin",
    "Honeyboat squash", "Galeux d'Eysines squash",
    # ─── Beans + grains specialty ──────────────────────────────────────
    "Heirloom bean varieties Rancho Gordo", "Christmas lima beans Rancho Gordo",
    "Marrow beans Rancho Gordo", "Yellow Eye beans Rancho Gordo",
    "Rio Zape beans Rancho Gordo", "Royal Corona beans Rancho Gordo",
    "Cassoulet beans Tarbais", "Flageolet beans dry",
    "Soldier beans dry", "Vermont cranberry beans",
    "Lupini beans dry", "Lupini beans pickled jar",
    "Black-eyed peas frozen", "Pigeon peas canned",
    "Pigeon peas frozen", "Roman beans canned",
    "Cranberry beans canned", "Carraline beans dry",
    "Borlotti beans dry", "Mojo beans Cuban",
    # ─── Misc / underrepresented ───────────────────────────────────────
    "Smoked paprika sweet", "Smoked paprika hot",
    "Smoked sea salt", "Hawaiian pink salt",
    "Himalayan pink salt", "Black lava salt",
    "Fleur de sel", "Sel gris", "Maldon flake salt",
    "Pickling salt", "Curing salt #1", "Curing salt #2",
    "Whole black peppercorns", "Whole white peppercorns",
    "Whole green peppercorns brined", "Whole pink peppercorns",
    "Long pepper whole", "Grains of paradise",
    "Cubeb pepper whole", "Selim pepper",
    "Tellicherry peppercorns", "Lampong peppercorns",
    "Sansho pepper ground", "Sichuan peppercorns whole",
    "Cumin seeds whole", "Cumin ground",
    "Coriander seeds whole", "Coriander ground",
    "Cardamom green pods whole", "Cardamom black pods whole",
    "Cardamom ground", "Saffron threads",
    "Cinnamon Ceylon stick", "Cinnamon cassia stick",
    "Cinnamon ground", "Nutmeg whole",
    "Nutmeg ground", "Mace whole blade",
    "Cloves whole", "Cloves ground",
    "Allspice whole berries", "Allspice ground",
    "Star anise whole", "Anise seed whole",
    "Fennel seed whole", "Caraway seed whole",
    "Mustard seed yellow", "Mustard seed brown",
    "Dill seed whole", "Celery seed whole",
    "Annatto seeds whole", "Annatto powder",
    "Sumac ground", "Za'atar blend",
    "Dukkah blend", "Ras el hanout blend",
    "Berbere blend", "Harissa spice blend dry",
    "Curry powder Madras hot", "Curry powder mild",
    "Garam masala blend", "Chaat masala blend",
    "Tandoori masala blend", "Vindaloo masala blend",
    "Five-spice blend Chinese", "Seven-spice blend Japanese shichimi",
    "Ten-spice blend", "Khmeli suneli Georgian",
    "Mitmita Ethiopian", "Lemon pepper",
    "Old Bay seasoning", "Tony Chachere's Creole",
    "Cajun seasoning", "Blackening seasoning",
    "Jerk seasoning dry rub", "Adobo seasoning Goya",
    "Sazón seasoning Goya", "Mexican oregano dried",
    "Mediterranean oregano dried", "Greek oregano dried",
    "Italian seasoning blend", "Herbes de Provence",
    "Bouquet garni dried", "Furikake rice topping",
    "Shichimi togarashi", "Yuzu salt",
    "Smoked salt", "Truffle salt",
    "Vanilla salt", "Espresso salt",
    "Citrus salt", "Rosemary salt",
]
# Trim runtime overhead by deduplicating the literal list once at module load.
# Order is preserved; first occurrence wins. Keeps the file honest if a name
# accidentally appears in two categories.
CANDIDATES = list(dict.fromkeys(CANDIDATES))

# ─── Trimmed helpers ─────────────────────────────────────────────────────────

def slugify(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (s or "").lower()).strip("-")


def load_existing() -> tuple[set[str], set[str], int]:
    """Return (base_slugs, full_slugs, next_id). FoodKeeper + extended merged."""
    fk = json.loads(FOODKEEPER_PATH.read_text())
    ext = json.loads(EXTENDED_PATH.read_text()) if EXTENDED_PATH.exists() else []
    base_slugs: set[str] = set()
    full_slugs: set[str] = set()
    used_ids: set[int] = set()
    for it in fk + ext:
        base_slugs.add(slugify(it["name"]))
        full = (it["name"] + " " + (it.get("subtitle") or "")).strip()
        full_slugs.add(slugify(full))
        if isinstance(it.get("id"), int):
            used_ids.add(it["id"])
    # Next id: max of extended IDs (skip FoodKeeper's 2–684 range) + 1, or 10001
    ext_ids = [i for i in used_ids if i >= 10001]
    next_id = max(ext_ids) + 1 if ext_ids else 10001
    return base_slugs, full_slugs, next_id


def load_anthropic_key() -> str:
    cfg = json.loads(CONFIG_PATH.read_text())
    k = cfg.get("anthropic_api_key")
    if not k or not k.startswith("sk-ant-"):
        raise SystemExit("anthropic_api_key not found / invalid in telegram_config.json")
    return k


# ─── Anthropic call ──────────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are a food-safety data curator. Your knowledge sources, in order of authority, are:
1. US FDA Refrigerator & Freezer Storage Chart
2. USDA FSIS food-safety bulletins
3. National Center for Home Food Preservation (University of Georgia)
4. Cooperative Extension Service publications (Penn State, Clemson, UMaine, NC State, Cornell, UMass, Nebraska-Lincoln)
5. Standard manufacturer best-before guidance for packaged categories

For each food name in the user's batch, return a JSON object with this exact schema. Use the CONSERVATIVE (shorter) end of any published range. If you're not confident a value, return null — never invent.

Schema per item (all keys required):
{
  "name": string,                      // canonical name, title-cased
  "subtitle": string | null,           // disambiguating qualifier (e.g., "white, red, or mixed"), or null
  "category": string,                  // one of: "Dairy Products & Eggs", "Produce", "Meat", "Poultry", "Seafood", "Vegetarian Proteins", "Baked Goods", "Grains, Beans & Pasta", "Shelf Stable Foods", "Condiments, Sauces & Canned Goods", "Beverages", "Deli & Prepared Foods", "Food Purchased Frozen"
  "subcategory": string | null,        // free-form, short
  "keywords": string,                  // space-separated search terms, lowercase
  "pantry_min_days": int | null,
  "pantry_max_days": int | null,
  "pantry_open_min_days": int | null,
  "pantry_open_max_days": int | null,
  "fridge_min_days": int | null,
  "fridge_max_days": int | null,
  "fridge_open_min_days": int | null,
  "fridge_open_max_days": int | null,
  "freezer_min_days": int | null,
  "freezer_max_days": int | null,
  "tips": string | null,               // 1-2 sentences; direct, practical; no marketing fluff
  "source": string,                    // one of: "FDA", "FSIS", "NCHFP", "Extension", "Manufacturer"
  "source_url": string | null          // canonical URL of the publication, or null for Manufacturer general
}

Rules:
- If the food is essentially the same as something USDA FoodKeeper covers (e.g., generic "cheddar cheese" or "ground beef"), return {"name": <name>, "skip": true} so the caller can drop it. We do NOT want to duplicate FoodKeeper.
- Where two of your sources disagree, take the shorter (more conservative) value.
- Day fields are integers >= 0 and <= 3650. min <= max.
- For items that are explicitly frozen prepared (e.g., "Frozen pizza"), pantry + fridge fields can be null; only freezer matters.
- For shelf-stable pantry items (e.g., "Maple syrup"), fridge_open_* should reflect "after opening, refrigerated" — this is often longer than the room-temp opened range.
- Brand voice for tips: direct, useful, no fluff. Examples: "Refrigerate after opening. Color may darken over time without indicating spoilage." NOT: "This versatile product is a kitchen essential!"

Return ONLY a JSON array of objects, no prose, no markdown fences. The array length must equal the input list length and items must be in the same order."""


def call_haiku(api_key: str, names: list[str]) -> list[dict]:
    """One round-trip to Claude Haiku for a batch of names. Returns parsed list.
    Raises on transport failure; caller decides retry policy."""
    user_msg = "Generate shelf-life data for these foods, in order:\n" + \
               "\n".join(f"{i+1}. {n}" for i, n in enumerate(names))
    body = {
        "model": ANTHROPIC_MODEL,
        "max_tokens": 4096,
        "temperature": 0.0,
        "system": SYSTEM_PROMPT,
        "messages": [{"role": "user", "content": user_msg}],
    }
    req = urllib.request.Request(
        ANTHROPIC_URL,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "x-api-key": api_key,
            "anthropic-version": ANTHROPIC_VERSION,
            "content-type": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        payload = json.loads(resp.read())
    # Concatenate ALL text blocks rather than [0] — Haiku sometimes returns
    # multiple content entries (e.g. when it pre-thinks).
    text = "".join(
        b.get("text", "") for b in payload.get("content", []) if b.get("type") == "text"
    ).strip()
    # Strip any accidental markdown fences
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    arr = json.loads(text)
    if not isinstance(arr, list):
        raise ValueError(f"Haiku returned non-list: {type(arr).__name__}")
    return arr


def call_haiku_with_retry(api_key: str, names: list[str]) -> list[dict]:
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            return call_haiku(api_key, names)
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8", errors="replace")[:500]
            print(f"  [haiku http {e.code}] attempt {attempt}: {err_body[:200]}", file=sys.stderr)
            if e.code in (429, 500, 502, 503, 504) and attempt < MAX_RETRIES:
                time.sleep(RETRY_BACKOFF_S * attempt)
                continue
            raise
        except (json.JSONDecodeError, ValueError) as e:
            print(f"  [haiku parse error] attempt {attempt}: {e}", file=sys.stderr)
            if attempt < MAX_RETRIES:
                time.sleep(RETRY_BACKOFF_S)
                continue
            raise


# ─── Validation ──────────────────────────────────────────────────────────────

REQUIRED_KEYS = {
    "name", "subtitle", "category", "subcategory", "keywords",
    "pantry_min_days", "pantry_max_days", "pantry_open_min_days", "pantry_open_max_days",
    "fridge_min_days", "fridge_max_days", "fridge_open_min_days", "fridge_open_max_days",
    "freezer_min_days", "freezer_max_days",
    "tips", "source", "source_url",
}

DAY_FIELDS = [
    "pantry_min_days", "pantry_max_days",
    "pantry_open_min_days", "pantry_open_max_days",
    "fridge_min_days", "fridge_max_days",
    "fridge_open_min_days", "fridge_open_max_days",
    "freezer_min_days", "freezer_max_days",
]


def validate_row(row: dict, existing_base: set[str], existing_full: set[str]) -> Optional[str]:
    """Return None if valid, else a short string describing the reason for rejection."""
    if row.get("skip") is True:
        return "claude marked skip (overlaps FoodKeeper)"
    missing = REQUIRED_KEYS - set(row.keys())
    if missing:
        return f"missing keys: {sorted(missing)}"
    if not isinstance(row["name"], str) or not row["name"].strip():
        return "name empty"
    if row["category"] not in ALLOWED_CATEGORIES:
        return f"bad category: {row['category']!r}"
    if row["source"] not in ALLOWED_SOURCES:
        return f"bad source: {row['source']!r}"
    # Day fields: int|null, in [0, 3650], min<=max per channel
    for f in DAY_FIELDS:
        v = row[f]
        if v is None:
            continue
        if not isinstance(v, int) or v < MIN_DAYS or v > MAX_DAYS:
            return f"bad day value {f}={v!r}"
    for chan in ("pantry", "pantry_open", "fridge", "fridge_open", "freezer"):
        mn = row.get(f"{chan}_min_days")
        mx = row.get(f"{chan}_max_days")
        if mn is not None and mx is not None and mn > mx:
            return f"{chan} min > max ({mn} > {mx})"
    # At least one storage channel must have data (otherwise the page is empty)
    if all(row[f] is None for f in DAY_FIELDS):
        return "no storage data on any channel"
    # Dedup against FoodKeeper + already-loaded extended
    base = slugify(row["name"])
    full = slugify(row["name"] + " " + (row.get("subtitle") or ""))
    if base in existing_base:
        return f"dupe base-slug: {base}"
    if full in existing_full:
        return f"dupe full-slug: {full}"
    return None


# ─── Migration emitter ──────────────────────────────────────────────────────

def next_migration_version() -> str:
    """Scan supabase/migrations/ for the highest v1NN tag and return v1(NN+1).
    Used to name the phase-2 migration so it always sorts after the latest."""
    highest = 0
    pat = re.compile(r"_v1(\d{2})_")
    for f in MIGRATIONS_DIR.glob("*.sql"):
        m = pat.search(f.name)
        if m:
            highest = max(highest, int(m.group(1)))
    return f"v1{highest + 1:02d}"


def emit_migration(new_rows: list[dict]) -> Path:
    """Write a Supabase migration with idempotent INSERT for the new rows.
    Pattern mirrors supabase/migrations/20260514_v119_shelf_life_extended.sql.
    Version is auto-detected as max(existing v1NN) + 1."""
    today = date.today().strftime("%Y%m%d")
    version = next_migration_version()  # e.g. "v120"
    n = len(new_rows)
    path = MIGRATIONS_DIR / f"{today}_{version}_shelf_life_phase2.sql"

    def sql_str(v):
        if v is None: return "NULL"
        if isinstance(v, (int, float)): return str(v)
        # Escape single quotes
        return "'" + str(v).replace("'", "''") + "'"

    rows_sql = []
    for r in new_rows:
        vals = [
            r["id"], r["name"], r.get("subtitle"), r["category"], r.get("subcategory"),
            r.get("keywords"),
            r.get("pantry_min_days"), r.get("pantry_max_days"),
            r.get("pantry_open_min_days"), r.get("pantry_open_max_days"),
            r.get("fridge_min_days"), r.get("fridge_max_days"),
            r.get("fridge_open_min_days"), r.get("fridge_open_max_days"),
            r.get("freezer_min_days"), r.get("freezer_max_days"),
            r.get("tips"), r["source"], r.get("source_url"),
        ]
        rows_sql.append("  (" + ", ".join(sql_str(v) for v in vals) + ")")

    rows_block = ",\n".join(rows_sql)
    # Pretty-print the version label as "v1.20" in the SQL comment.
    pretty_version = version[:2] + "." + version[2:]  # "v120" -> "v1.20"
    sql = f"""-- {pretty_version} Shelf-life directory Phase 2 — bulk-load {n} additional rows.
-- Generated by scripts/expand_shelf_life.py on {date.today().isoformat()}.
--
-- Sources: FDA, FSIS, NCHFP, Cooperative Extension Service, manufacturer.
-- FoodKeeper rows are NOT touched. ON CONFLICT (id) DO NOTHING for safety.
-- Apply via Supabase SQL editor (per CLAUDE.md migration convention).

insert into public.foodkeeper_shelf_life
  (id, name, subtitle, category, subcategory, keywords,
   pantry_min_days, pantry_max_days, pantry_open_min_days, pantry_open_max_days,
   fridge_min_days, fridge_max_days, fridge_open_min_days, fridge_open_max_days,
   freezer_min_days, freezer_max_days,
   tips, source, source_url)
values
{rows_block}
on conflict (id) do nothing;

-- Sanity check (manual):
--   SELECT count(*) FROM foodkeeper_shelf_life;
--   SELECT source, count(*) FROM foodkeeper_shelf_life GROUP BY source ORDER BY 2 DESC;
"""
    path.write_text(sql)
    return path


# ─── Main ────────────────────────────────────────────────────────────────────

def main():
    p = argparse.ArgumentParser(description="Expand the ok2eat shelf-life directory.")
    p.add_argument("--batch", type=int, default=50,
                   help="Number of new items to attempt (default 50)")
    p.add_argument("--dry-run", action="store_true",
                   help="Print to stdout instead of writing to disk")
    p.add_argument("--candidates", type=Path, default=None,
                   help="Custom newline-delimited candidate list path")
    p.add_argument("--resume", action="store_true",
                   help="Skip candidates whose slug already exists (default: same behavior; this is an alias for clarity)")
    p.add_argument("--emit-migration", action="store_true",
                   help="Also write a Supabase migration SQL file")
    args = p.parse_args()

    api_key = load_anthropic_key()
    base_slugs, full_slugs, next_id = load_existing()
    print(f"Loaded: {len(base_slugs)} base slugs, {len(full_slugs)} full slugs in existing data")
    print(f"Next available id: {next_id}")

    # Load + filter candidates against existing data
    if args.candidates:
        candidates = [ln.strip() for ln in args.candidates.read_text().splitlines() if ln.strip()]
    else:
        candidates = list(CANDIDATES)
    pre_filter = len(candidates)
    candidates = [c for c in candidates if slugify(c) not in base_slugs]
    print(f"Candidates: {pre_filter} loaded, {len(candidates)} fresh after dedup against FoodKeeper + existing extended")
    if not candidates:
        print("Nothing to do — all candidates already in data. Add more to CANDIDATES or pass --candidates.")
        return
    candidates = candidates[: args.batch]
    print(f"Will process {len(candidates)} this run.")

    # Batch through Haiku
    raw_rows: list[dict] = []
    for i in range(0, len(candidates), BATCH_SIZE):
        batch = candidates[i:i + BATCH_SIZE]
        print(f"\n→ Batch {i // BATCH_SIZE + 1}: {batch[0]!r} … {batch[-1]!r} ({len(batch)} items)")
        try:
            arr = call_haiku_with_retry(api_key, batch)
        except Exception as e:
            print(f"  [skip batch] {e}", file=sys.stderr)
            continue
        if len(arr) != len(batch):
            print(f"  [warn] Haiku returned {len(arr)} for {len(batch)} requested — best-effort merge", file=sys.stderr)
        raw_rows.extend(arr)
        # gentle pacing
        time.sleep(1)

    # Validate + assign IDs
    accepted: list[dict] = []
    drops = {"skip": 0, "schema": 0, "dupe": 0, "bad-day": 0, "bad-enum": 0, "no-data": 0, "other": 0}
    cur_id = next_id
    for row in raw_rows:
        reason = validate_row(row, base_slugs, full_slugs)
        if reason is None:
            row["id"] = cur_id
            cur_id += 1
            accepted.append(row)
            base_slugs.add(slugify(row["name"]))
            full_slugs.add(slugify(row["name"] + " " + (row.get("subtitle") or "")))
        else:
            if "skip" in reason: drops["skip"] += 1
            elif "missing keys" in reason: drops["schema"] += 1
            elif "dupe" in reason: drops["dupe"] += 1
            elif "day value" in reason or "min > max" in reason: drops["bad-day"] += 1
            elif "bad category" in reason or "bad source" in reason: drops["bad-enum"] += 1
            elif "no storage" in reason: drops["no-data"] += 1
            else: drops["other"] += 1
            print(f"  [drop {row.get('name', '?')!r}] {reason}", file=sys.stderr)

    print(f"\n─── Summary ───")
    print(f"Candidates processed: {len(raw_rows)}")
    print(f"Accepted:             {len(accepted)}")
    print(f"Dropped — claude said skip:   {drops['skip']}")
    print(f"Dropped — schema invalid:     {drops['schema']}")
    print(f"Dropped — duplicate slug:     {drops['dupe']}")
    print(f"Dropped — bad day value:      {drops['bad-day']}")
    print(f"Dropped — bad enum value:     {drops['bad-enum']}")
    print(f"Dropped — no storage data:    {drops['no-data']}")
    print(f"Dropped — other:              {drops['other']}")

    # Output
    if args.dry_run:
        print("\n--- dry-run output (not written to disk) ---")
        print(json.dumps(accepted, indent=2, ensure_ascii=False))
        return

    if not accepted:
        print("Nothing accepted. No file changes.")
        return

    # Append to extended JSON
    existing = json.loads(EXTENDED_PATH.read_text()) if EXTENDED_PATH.exists() else []
    existing.extend(accepted)
    EXTENDED_PATH.write_text(json.dumps(existing, indent=2, ensure_ascii=False) + "\n")
    print(f"\n✓ Appended {len(accepted)} rows to {EXTENDED_PATH}")
    print(f"  Total extended items now: {len(existing)}")
    print(f"  Projected pages after rebuild: {660 + len(existing)} (660 FoodKeeper + {len(existing)} extended)")

    if args.emit_migration:
        path = emit_migration(accepted)
        print(f"✓ Wrote migration: {path}")
        print(f"  Apply via Supabase SQL editor: cat {path.relative_to(ROOT)} | pbcopy")

    print(f"\nNext steps:")
    print(f"  1. python3 scripts/build_shelf_life_pages.py    # regenerate + self-prune")
    if args.emit_migration:
        print(f"  2. Apply {path.name} via Supabase SQL editor")
    print(f"  {3 if args.emit_migration else 2}. python3 scripts/deploy_website.py   # or Telegram /deploy")


if __name__ == "__main__":
    main()
