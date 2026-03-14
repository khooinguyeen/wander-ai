# Scout Route MVP

Quick MVP for a Melbourne discovery app that turns a social-style query into a compact day route for food, lowkey lookouts, and fashion spots.

## Stack

- Next.js App Router
- Vercel AI SDK
- Gemini via `@ai-sdk/google`
- Leaflet for the route map

## Run

1. Install dependencies.
2. Copy `.env.example` to `.env.local`.
3. Set `GOOGLE_GENERATIVE_AI_API_KEY`.
4. Optionally set `GEMINI_MODEL`.
5. Start the app with `npm run dev`.

## RedNote pipeline

1. Copy `data/rednote_seed_urls.example.txt` to `data/rednote_seed_urls.txt`.
2. Paste RedNote share URLs or share-text blocks into that file.
3. Run `python3 scripts/rednote_pipeline.py`.
4. The pipeline writes:
   `data/rednote_raw_posts_latest.json`
   `data/rednote_candidate_mentions_latest.json`
   `data/melbourne-spots.rednote_latest.json`

To minimize Gemini usage, the scraper defaults to `--extractor auto`, which only calls Gemini for ambiguous notes. You can force zero model usage with:

`python3 scripts/rednote_pipeline.py --extractor heuristic`

If you already have raw note exports, use:

`python3 scripts/rednote_pipeline.py --input-raw-json path/to/raw.json`

## Model note

The app defaults to `gemini-2.5-flash-lite` because that was the safest officially documented Lite model I could verify while building this. If your account has access to a preview model, set it through `GEMINI_MODEL` instead of hard-coding it in the source.

## Data note

There is no real Melbourne scrape in this repo yet. The current dataset is a hand-curated mock file built from public venue and place pages so the planner UI and route logic can demo against cleaner Melbourne data before the scraper is production-ready.

## Files

- `data/melbourne-spots.sample.json`: seed data in the normalized app format
- `docs/mock-data-sources.md`: source list for the current researched mock dataset
- `data/rednote_melbourne_queries.json`: RedNote-first discovery queries
- `docs/database-format.md`: recommended record shape
- `docs/rednote-research.md`: what to scrape from RedNote and why
- `docs/scraping-plan.md`: practical plan to build the dataset
- `app/api/plan/route.ts`: itinerary endpoint
- `components/planner-shell.tsx`: main planner UI
- `scripts/rednote_pipeline.py`: RedNote URL -> raw posts -> normalized spots pipeline
