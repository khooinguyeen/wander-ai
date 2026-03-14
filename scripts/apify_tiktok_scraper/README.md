# Apify TikTok Scraper

This folder runs your chosen Apify TikTok actor and saves a Melbourne-focused dataset locally as JSON and CSV.

## Setup

1. Put your Apify API token in `.env`:

```env
APIFY_TOKEN=your_apify_token_here
APIFY_ACTOR_ID=GdWCkxBtKWOsKjdch
```

2. Install dependencies:

```powershell
pip install -r requirements.txt
```

## Run

```powershell
python run_apify_tiktok.py
```

Optional overrides:

```powershell
python run_apify_tiktok.py --output-dir output --timeout-secs 3600
```

You can also control how often partial results are flushed locally while the actor is still running:

```powershell
python run_apify_tiktok.py --poll-secs 20
```

## Download Existing Run

If an actor run already exists and you only want to download its dataset without starting a new run:

```powershell
python download_apify_run.py 2gbP9XultGTbo6t9d
```

This writes metadata, JSON, and CSV files under `output/`.

## Input

The default actor input now lives directly inside [run_apify_tiktok.py](c:\Users\Legion\Python\apify_tiktok_scraper\run_apify_tiktok.py) as `DEFAULT_ACTOR_INPUT`.

Adjust these fields there as needed:

- `searchQueries`
- `resultsPerPage`
- `commentsPerPost`
- `maxRepliesPerComment`
- `proxyCountryCode`

The current defaults are tuned for Melbourne-only discovery across:

- food and drink reviews, recommendations, and guides
- entertainment guides and venue recommendations
- shopping guides and store recommendations

The script also filters the returned dataset locally so the saved files keep only Melbourne-matching items and expose destination fields such as:

- `destinationName`
- `destinationAddress`
- `destinationCity`
- `contentCategory`
- `melbourneMatchReasons`

## Output

Each run creates:

- `*.meta.json` with run metadata
- `*.json` with raw dataset items
- `*.csv` with flattened dataset items

While the Apify run is in progress, the script also keeps overwriting checkpoint files so partial results are preserved locally even if the run stops early or your budget runs out:

- `apify_tiktok_run_<run_id>_checkpoint.meta.json`
- `apify_tiktok_run_<run_id>_checkpoint.json`
- `apify_tiktok_run_<run_id>_checkpoint.csv`
