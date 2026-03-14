# Scraping plan

You do not have the dataset yet, so the right first move is a narrow pipeline that produces high-signal Melbourne spots instead of trying to scrape the whole city at once.

## Scope

Start with three corridors only:

- Fitzroy / Collingwood for fashion + cafes
- CBD / Carlton for food + shopping
- Southside / Elwood for brunch + sunset lookouts

This gives enough density for interesting routes without drowning in duplicates.

## Target output

Produce one normalized `spots` file matching [`docs/database-format.md`](/Users/khanhgn/unihack/docs/database-format.md).

## Pipeline

1. Build a seed query list.
   Use queries like `melbourne hidden cafe`, `melbourne lowkey lookout`, `fitzroy fashion store`, `melbourne brunch tiktok`, `melbourne sunset instagram`.

2. Collect source URLs first, not final spots.
   Save every TikTok, Instagram reel/post, YouTube short/video, RedNote or blog link into `raw_posts`.

3. Extract candidate place mentions.
   From captions, comments, on-screen text, descriptions, and hashtags, pull place names, suburbs, and categories.

4. Resolve places to coordinates.
   Use Google Places, OpenStreetMap Nominatim, or another geocoder to turn the mention into a single lat/lng and formatted address.

5. Merge duplicates aggressively.
   Normalize by name plus suburb plus coordinates. `Higher Ground Melbourne` and `Higher Ground cafe cbd` should collapse into one spot.

6. Score each spot.
   Compute:
   `viralScore = log(mentions + creatorCount)`
   `hiddenGemScore = low total mentions but high save/share language`
   `foodScore`, `fashionScore`, `scenicScore` from source classification

7. Add visit metadata.
   Estimate `idealVisitMinutes`, `priceBand`, and `visitWindows` from map listings, menus, and source context.

8. Run manual QA on the top 100 spots.
   This matters. Social scraping gets messy fast, and one bad geocode breaks route quality.

## Source strategy

Use a mix of sources because each one fills a different gap:

- TikTok: best for trend discovery and creator language.
- Instagram: best for fashion stores, aesthetics, and location tags.
- YouTube Shorts / local vlogs: best for roundups and stronger spoken context.
- Google Maps / OpenStreetMap: best for coordinates, address, and opening hours.

## Suggested tables during scraping

Even if the app consumes one JSON file, store scrape output in stages:

- `raw_posts`
  Raw URL, platform, author, caption, hashtags, posted date, media thumbnail.
- `candidate_mentions`
  Extracted place string, suburb guess, category guess, source URL.
- `resolved_places`
  Canonical name, address, lat/lng, source confidence.
- `normalized_spots`
  Final app-facing records.

## Minimal v1 workflow

If you want the fastest path to a usable MVP:

1. Manually seed 150 social URLs.
2. Extract place mentions with Gemini in batch.
3. Resolve names to coordinates with one geocoder.
4. Manually review the top 80 unique places.
5. Export `data/melbourne-spots.sample.json`.

That is enough to make the route planner feel real.

## What to automate next

After v1 works, automate in this order:

1. URL collection
2. Caption and OCR extraction
3. Entity resolution
4. Deduplication
5. Score refresh

Do not automate route planning quality before the place resolution quality is stable.
