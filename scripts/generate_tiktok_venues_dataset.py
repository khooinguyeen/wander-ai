#!/usr/bin/env python3
"""Generate the venues dataset from TikTok-enriched inputs only."""

from __future__ import annotations

import sys
from pathlib import Path

from generate_venues_dataset import main as generate_main


def run() -> int:
    tiktok_review = Path(
        "scripts/apify_tiktok_scraper/output/tiktok_google_places_enriched_20260314_190326_with_reviews_20260314_220123.json"
    )
    tiktok_output = Path("scripts/venues.tiktok.generated.json")
    tiktok_live_output = Path("scripts/venues.tiktok.generated.live.json")

    forwarded_args = [
        sys.argv[0],
        "--input",
        str(tiktok_review),
        "--output",
        str(tiktok_output),
        "--live-output",
        str(tiktok_live_output),
        "--sync-tiktok-review-urls",
        *sys.argv[1:],
    ]
    sys.argv = forwarded_args
    return generate_main()


if __name__ == "__main__":
    raise SystemExit(run())
