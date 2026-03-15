from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

from apify_client import ApifyClient
from dotenv import load_dotenv

SCRIPT_DIR = Path(__file__).resolve().parent
SCRIPTS_DIR = SCRIPT_DIR.parent
ROOT_DIR = SCRIPT_DIR.parent.parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from enrich_google_places import enrich_record, get_api_key  # noqa: E402
from extract_destination_array import (  # noqa: E402
    GENERIC_DESTINATIONS,
    choose_place_string,
    looks_like_good_destination,
    normalize_destination,
)
from generate_venues_dataset import (  # noqa: E402
    AIVenueFields,
    build_venue_record,
    dedupe_key,
    generate_ai_descriptions,
    generate_single_ai_description,
    infer_category,
    is_melbourne_region,
    is_probable_venue,
    load_env_file,
    merge_records,
    normalize_text,
    review_snippets,
    unique_list,
)


def log(message: str) -> None:
    print(f"[live-extract] {message}", file=sys.stderr, flush=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Live-scrape a single TikTok URL and emit venue records in the flat app format."
    )
    parser.add_argument("--url", required=True, help="TikTok video URL to scrape.")
    parser.add_argument(
        "--description-mode",
        choices=["auto", "ai", "heuristic"],
        default="auto",
        help="How to generate description, vibe, and tags.",
    )
    parser.add_argument(
        "--ai-min-interval-seconds",
        type=float,
        default=4.0,
        help="Minimum wait between Gemini requests.",
    )
    return parser.parse_args()


def normalize_tiktok_url(url: str) -> str:
    return url.strip().split("?", 1)[0].rstrip("/")


def load_env() -> None:
    load_env_file(ROOT_DIR / ".env.local")
    load_env_file(ROOT_DIR / ".env")
    if (SCRIPT_DIR / ".env").exists():
        load_dotenv(SCRIPT_DIR / ".env")


def get_apify_actor_input(url: str) -> dict[str, Any]:
    return {
        "postURLs": [url],
        "resultsPerPage": 1,
        "commentsPerPost": 20,
        "maxRepliesPerComment": 5,
        "proxyCountryCode": "AU",
        "shouldDownloadVideos": False,
        "shouldDownloadCovers": False,
        "shouldDownloadSlideshowImages": False,
        "shouldDownloadAvatars": False,
        "shouldDownloadMusicCovers": False,
    }


def fetch_tiktok_items(url: str) -> list[dict[str, Any]]:
    token = os.environ.get("APIFY_TOKEN", "").strip()
    actor_id = os.environ.get("APIFY_ACTOR_ID", "").strip()
    if not token:
        raise SystemExit("Missing APIFY_TOKEN in environment or .env.")
    if not actor_id:
        raise SystemExit("Missing APIFY_ACTOR_ID in environment or .env.")

    client = ApifyClient(token)
    log(f"Starting Apify actor run for URL: {url}")
    run = client.actor(actor_id).call(run_input=get_apify_actor_input(url), wait_secs=180)
    dataset_id = str((run or {}).get("defaultDatasetId") or "").strip()
    if not dataset_id:
        raise SystemExit("Apify run did not return a default dataset.")
    log(f"Apify run completed with dataset_id={dataset_id}")

    items = list(client.dataset(dataset_id).list_items(clean=True).items)
    log(f"Fetched {len(items)} raw item(s) from Apify dataset")
    target = normalize_tiktok_url(url)
    matched = [
        item
        for item in items
        if isinstance(item, dict)
        and normalize_tiktok_url(str(item.get("webVideoUrl") or "")) == target
    ]
    log(f"Matched {len(matched)} item(s) directly to requested TikTok URL")
    return matched or [item for item in items if isinstance(item, dict)]


def build_location_mentions(item: dict[str, Any], detail: dict[str, Any]) -> list[str]:
    location_meta = item.get("locationMeta") if isinstance(item.get("locationMeta"), dict) else {}
    candidates = [
        detail.get("finalLocation"),
        detail.get("destinationAddress"),
        location_meta.get("city"),
        location_meta.get("address"),
    ]

    mentions: list[str] = []
    for candidate in candidates:
        text = normalize_destination(candidate or "")
        if not text:
            continue
        lower = text.lower()
        if lower in GENERIC_DESTINATIONS:
            continue
        if lower == "victoria, australia":
            continue
        mentions.append(text)
    return unique_list(mentions)


def extract_candidate_names(item: dict[str, Any], detail: dict[str, Any]) -> list[str]:
    names: list[str] = []

    final_destination = normalize_destination(detail.get("finalDestination") or "")
    if looks_like_good_destination(final_destination):
        names.append(final_destination)

    destination_name = normalize_destination(item.get("destinationName") or "")
    if looks_like_good_destination(destination_name):
        names.append(destination_name)

    mentions = item.get("detailedMentions")
    if isinstance(mentions, list):
        for mention in mentions:
            if not isinstance(mention, dict):
                continue
            for key in ("nickName", "name"):
                candidate = normalize_destination(mention.get(key) or "")
                if looks_like_good_destination(candidate):
                    names.append(candidate)

    raw_mentions = item.get("mentions")
    if isinstance(raw_mentions, list):
        for mention in raw_mentions:
            candidate = normalize_destination(str(mention or "").lstrip("@"))
            if looks_like_good_destination(candidate):
                names.append(candidate)

    return unique_list(names)


def build_candidate_records(item: dict[str, Any]) -> list[dict[str, Any]]:
    place_string, detail = choose_place_string(item)
    if not isinstance(detail, dict):
        detail = {}

    source_url = normalize_text(item.get("webVideoUrl"))
    source_text = normalize_text(item.get("text"))
    location_mentions = build_location_mentions(item, detail)
    candidate_names = extract_candidate_names(item, detail)

    if not candidate_names and place_string:
        fallback_name = normalize_destination(detail.get("finalDestination") or place_string)
        if looks_like_good_destination(fallback_name):
            candidate_names.append(fallback_name)

    records: list[dict[str, Any]] = []
    for name in unique_list(candidate_names):
        records.append(
            {
                "sourceText": source_text,
                "description": source_text,
                "destinationNames": [name],
                "locationMentions": location_mentions,
                "sourceUrls": [source_url] if source_url else [],
                "originalTikTokVideoUrl": source_url,
                "originalTikTokId": normalize_text(item.get("id")),
            }
        )
    return records


def enrich_candidates(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    api_key = get_api_key()
    candidates: list[dict[str, Any]] = []
    for item in items:
        candidates.extend(build_candidate_records(item))
    log(f"Built {len(candidates)} candidate place record(s) from {len(items)} item(s)")

    enriched: list[dict[str, Any]] = []
    for index, candidate in enumerate(candidates, start=1):
        log(
            "Enriching candidate "
            f"{index}/{len(candidates)}: {', '.join(candidate.get('destinationNames') or []) or 'unknown'}"
        )
        record = enrich_record(api_key=api_key, record=candidate)
        source_urls = record.get("sourceUrls")
        if not isinstance(source_urls, list):
            source_urls = []
        record["sourceUrls"] = unique_list(
            [*source_urls, normalize_text(record.get("originalTikTokVideoUrl"))]
        )
        enriched.append(record)
    log(f"Google enrichment completed for {len(enriched)} candidate record(s)")
    return enriched


def generate_ai_fields(
    venues: list[Any],
    *,
    description_mode: str,
    min_batch_interval_seconds: float,
) -> dict[str, AIVenueFields]:
    resolved_mode = description_mode
    api_key = os.environ.get("VENUES_GEMINI_API_KEY", "").strip() or os.environ.get("GEMINI_API_KEY", "").strip()
    model = os.environ.get("VENUES_GEMINI_MODEL", "gemini-2.5-flash-lite").strip()

    if resolved_mode == "auto":
        resolved_mode = "ai" if api_key else "heuristic"
    if resolved_mode != "ai":
        log("AI description mode not enabled; using heuristic fields")
        return {}
    if not api_key:
        raise RuntimeError("VENUES_GEMINI_API_KEY is required for AI venue generation.")
    log(f"Generating AI fields for {len(venues)} merged venue(s) using Gemini model {model}")

    batch_items: list[dict[str, Any]] = []
    for venue in venues:
        batch_items.append(
            {
                "google_place_id": venue.place_id,
                "name": venue.names[0] if venue.names else "",
                "address": venue.addresses[0] if venue.addresses else "",
                "google_types": venue.google_types,
                "google_rating": venue.rating,
                "google_rating_count": venue.rating_count,
                "price_level": venue.price_level,
                "google_editorial_summary": venue.editorial_summary,
                "source_texts": venue.source_texts[:3],
                "review_snippets": review_snippets(venue.reviews, max_items=4),
                "current_category": infer_category(
                    venue.google_types,
                    " ".join(venue.source_texts + venue.descriptions),
                ),
            }
        )

    ai_fields = generate_ai_descriptions(
        batch_items,
        api_key=api_key,
        model=model,
        batch_size=1,
        min_batch_interval_seconds=max(0.0, min_batch_interval_seconds),
    )

    items_by_place_id = {item["google_place_id"]: item for item in batch_items if item["google_place_id"]}
    for venue in venues:
        if venue.place_id in ai_fields:
            continue
        single_item = items_by_place_id.get(venue.place_id)
        if not single_item:
            continue
        rescued = generate_single_ai_description(
            single_item,
            api_key=api_key,
            model=model,
            min_batch_interval_seconds=max(0.0, min_batch_interval_seconds),
        )
        if rescued is not None:
            ai_fields[venue.place_id] = rescued

    missing = [venue.place_id for venue in venues if venue.place_id and venue.place_id not in ai_fields]
    if missing:
        raise RuntimeError(
            "Gemini did not return description/vibe/tags for all live-ingested venues: "
            + ", ".join(missing)
        )
    log(f"AI field generation completed for {len(ai_fields)} venue(s)")
    return ai_fields


def main() -> int:
    load_env()
    args = parse_args()
    url = normalize_tiktok_url(args.url)
    log(f"Live extract starting for URL: {url}")

    items = fetch_tiktok_items(url)
    enriched_candidates = enrich_candidates(items)
    matched_records = [
        record
        for record in enriched_candidates
        if str(record.get("googleMatchStatus", "")).startswith("matched_")
    ]

    grouped: dict[str, list[tuple[dict[str, Any], str]]] = {}
    for record in matched_records:
        grouped.setdefault(dedupe_key(record), []).append((record, "tiktok"))

    merged = [merge_records(group) for group in grouped.values()]
    merged = [venue for venue in merged if is_probable_venue(venue) and is_melbourne_region(venue)]
    merged.sort(key=lambda venue: (venue.names[0] if venue.names else "", venue.place_id))
    log(
        f"Matched Google records={len(matched_records)}, merged venues after filtering={len(merged)}"
    )

    ai_fields = generate_ai_fields(
        merged,
        description_mode=args.description_mode,
        min_batch_interval_seconds=args.ai_min_interval_seconds,
    )
    output_records = [
        build_venue_record(venue, ai_fields=ai_fields.get(venue.place_id))
        for venue in merged
    ]

    payload = {
        "inputUrl": url,
        "rawItemCount": len(items),
        "candidateRecordCount": len(enriched_candidates),
        "matchedRecordCount": len(matched_records),
        "venues": output_records,
    }
    log(f"Live extract finished with {len(output_records)} output venue(s)")
    log("Final JSON payload:")
    print(json.dumps(payload, ensure_ascii=False, indent=2), file=sys.stderr, flush=True)
    sys.stdout.reconfigure(encoding="utf-8")
    print(json.dumps(payload, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
