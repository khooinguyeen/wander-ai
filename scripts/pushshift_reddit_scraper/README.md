# Reddit Scraper

This folder contains a Reddit scraper that supports:

- Reddit official API via OAuth
- Pushshift API
- PullPush API fallback for Pushshift-style search

The script can fetch submissions from either source, or combine both into one deduplicated export.

It also supports a built-in Melbourne preset covering:

- food and drink
- cafes and bars
- entertainment and nightlife
- shopping and markets

The built-in Melbourne preset is now restricted to `r/melbourne` by default unless you explicitly pass `--subreddit`.

## Setup

1. Copy `.env.example` to `.env`.
2. Fill in your Reddit API credentials for the official API flow.
3. Add `GOOGLE_MAPS_API_KEY` if you want Google Places enrichment.
4. Install dependencies:

```powershell
pip install -r requirements.txt
```

## Run

Official Reddit API only:

```powershell
python run_reddit_scraper.py --source reddit --query melbourne food --subreddit melbourne
```

Pushshift only:

```powershell
python run_reddit_scraper.py --source pushshift --query melbourne food --subreddit melbourne
```

PullPush only:

```powershell
python run_reddit_scraper.py --source pullpush --query melbourne food --subreddit melbourne
```

PullPush with comments and replies:

```powershell
python run_reddit_scraper.py --source pullpush --query "melbourne food" --subreddit melbourne --include-comments
```

Broader Melbourne preset across food, drink, entertainment, and shopping:

```powershell
python run_reddit_scraper.py --source pullpush --preset melbourne_lifestyle --filter-melbourne-places
```

Broader Melbourne preset with comments:

```powershell
python run_reddit_scraper.py --source pullpush --preset melbourne_lifestyle --filter-melbourne-places --include-comments --only-with-comments --max-comments-per-post 50
```

Combine both:

```powershell
python run_reddit_scraper.py --source both --query melbourne food --subreddit melbourne
```

If Pushshift returns `401` or `403`, the script automatically falls back to PullPush during `--source pushshift` or `--source both`.

## Output

Each run writes:

- `reddit_scrape_<timestamp>.json`
- `reddit_scrape_<timestamp>.csv`
- `reddit_scrape_<timestamp>.meta.json`

During the run, the scraper also updates checkpoint files so partial progress is visible and survives interruptions:

- `reddit_scrape_<timestamp>_checkpoint.json`
- `reddit_scrape_<timestamp>_checkpoint.csv`
- `reddit_scrape_<timestamp>_checkpoint.meta.json`

## Google Places Enrichment

After cleaning location mentions, you can enrich them with Google Places details:

```powershell
python enrich_google_places.py output\reddit_location_mentions_20260314_172540.json --output-dir output
```

This adds fields such as:

- exact matched place name
- formatted address
- latitude / longitude
- Google place types
- business status
- opening hours / weekday text
- Google Maps URL

The Google matcher now prefers extracted destination names and rejects generic suburb/locality matches when a venue name is available.

The export includes normalized fields such as:

- `id`
- `title`
- `selftext`
- `subreddit`
- `author`
- `created_utc`
- `score`
- `num_comments`
- `permalink`
- `url`
- `source`

When `--include-comments` is enabled, each post also includes:

- `comments`
- `commentsFetchedCount`

Use `--max-comments-per-post` if you want to cap comment retrieval per submission.

If PullPush rate-limits comment requests with `429`, the scraper now waits and retries automatically. For larger runs, keep comment caps modest.

Use `--filter-melbourne-places` to remove personals, jobs, housing, classifieds, and generic Melbourne chatter, keeping only venue/activity/shopping-oriented posts.
That filter now also requires recommendation/review/suggestion intent, not just category words.

Use `--only-with-comments` to keep only posts that actually have comments. If `--include-comments` is also enabled, the scraper keeps only posts where comment bodies were successfully fetched.
