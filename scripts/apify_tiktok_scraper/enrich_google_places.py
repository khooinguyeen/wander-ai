from __future__ import annotations

"""Enrich TikTok place arrays with Google Places data."""

import argparse
import csv
import json
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv


TEXT_SEARCH_URL = "https://maps.googleapis.com/maps/api/place/textsearch/json"
DETAILS_URL = "https://maps.googleapis.com/maps/api/place/details/json"
DEFAULT_LOCATION_BIAS = "Melbourne VIC Australia"
GENERIC_LOCATION_TERMS = {"melbourne", "melb", "cbd", "victoria", "vic", "australia"}
GENERIC_GOOGLE_TYPES = {
    "locality",
    "political",
    "administrative_area_level_1",
    "administrative_area_level_2",
    "administrative_area_level_3",
    "postal_code",
    "country",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Enrich TikTok destination arrays with Google Places data."
    )
    parser.add_argument("input_json", help="Path to a TikTok place array JSON file.")
    parser.add_argument("--output-dir", default="output", help="Directory for exports.")
    parser.add_argument("--sleep-secs", type=float, default=0.05, help="Delay per request.")
    parser.add_argument("--max-records", type=int, default=0, help="Optional cap on records.")
    parser.add_argument(
        "--checkpoint-every",
        type=int,
        default=1,
        help="Write checkpoint files every N records.",
    )
    return parser.parse_args()


def normalize_for_json(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, list):
        return [normalize_for_json(item) for item in value]
    if isinstance(value, dict):
        return {key: normalize_for_json(item) for key, item in value.items()}
    return str(value)


def flatten_value(value: Any) -> str | int | float | bool | None:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    return json.dumps(normalize_for_json(value), ensure_ascii=False)


def write_csv(items: list[dict[str, Any]], path: Path) -> None:
    fieldnames: list[str] = []
    seen: set[str] = set()
    for item in items:
        for key in item:
            if key not in seen:
                seen.add(key)
                fieldnames.append(key)
    with path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames)
        writer.writeheader()
        for item in items:
            writer.writerow({key: flatten_value(item.get(key)) for key in fieldnames})


def write_outputs(
    *,
    items: list[dict[str, Any]],
    json_path: Path,
    csv_path: Path,
    meta_path: Path,
    meta: dict[str, Any],
) -> None:
    json_path.write_text(
        json.dumps(normalize_for_json(items), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    write_csv(items, csv_path)
    meta_path.write_text(
        json.dumps(normalize_for_json(meta), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def get_api_key() -> str:
    candidate_paths = [
        Path(__file__).resolve().parent / ".env",
        Path(__file__).resolve().parent.parent / "reddit_scraper" / ".env",
    ]
    for path in candidate_paths:
        if path.exists():
            load_dotenv(path)
    api_key = os.environ.get("GOOGLE_MAPS_API_KEY", "").strip()
    if not api_key:
        raise SystemExit(
            "Missing GOOGLE_MAPS_API_KEY. Add it to apify_tiktok_scraper/.env or reddit_scraper/.env."
        )
    return api_key


def parse_array_record(item: str) -> dict[str, Any]:
    text = item.strip()
    if not text:
        return {}
    match = re.split(r"\s+(?:in|at|near|on)\s+", text, maxsplit=1, flags=re.IGNORECASE)
    destination_names = [match[0].strip()] if match and match[0].strip() else []
    location_mentions = [match[1].strip()] if len(match) == 2 and match[1].strip() else []
    return {
        "sourceText": text,
        "destinationNames": destination_names,
        "locationMentions": location_mentions,
        "description": text,
    }


def choose_search_term(location_mentions: list[Any], description: str) -> str:
    for location in location_mentions:
        text = str(location).strip()
        if text and text.lower() not in GENERIC_LOCATION_TERMS:
            return text
    return description[:120].strip()


def build_search_queries(
    destination_names: list[Any], location_mentions: list[Any], description: str
) -> list[str]:
    queries: list[str] = []
    for destination in destination_names:
        text = str(destination).strip()
        if text:
            queries.extend([text, f"{text} Melbourne VIC", f"{text} Victoria"])
    fallback = choose_search_term(location_mentions, description)
    if fallback:
        queries.extend([fallback, f"{fallback} Melbourne VIC"])
    deduped: list[str] = []
    seen: set[str] = set()
    for query in queries:
        key = query.lower().strip()
        if key and key not in seen:
            seen.add(key)
            deduped.append(query)
    return deduped


def google_text_search(*, api_key: str, query: str) -> dict[str, Any]:
    response = requests.get(
        TEXT_SEARCH_URL,
        params={"query": f"{query}, {DEFAULT_LOCATION_BIAS}", "key": api_key},
        timeout=60,
    )
    response.raise_for_status()
    payload = response.json()
    status = payload.get("status")
    if status not in {"OK", "ZERO_RESULTS"}:
        raise SystemExit(f"Google Text Search failed for '{query}': {payload}")
    results = payload.get("results", [])
    return results[0] if isinstance(results, list) and results else {}


def google_place_details(*, api_key: str, place_id: str) -> dict[str, Any]:
    response = requests.get(
        DETAILS_URL,
        params={
            "place_id": place_id,
            "fields": ",".join(
                [
                    "place_id",
                    "name",
                    "formatted_address",
                    "geometry/location",
                    "types",
                    "business_status",
                    "opening_hours",
                    "current_opening_hours",
                    "url",
                    "website",
                    "formatted_phone_number",
                    "price_level",
                    "rating",
                    "user_ratings_total",
                    "editorial_summary",
                    "delivery",
                    "dine_in",
                    "takeout",
                    "reservable",
                    "serves_breakfast",
                    "serves_lunch",
                    "serves_dinner",
                    "serves_beer",
                    "serves_wine",
                    "serves_vegetarian_food",
                ]
            ),
            "key": api_key,
        },
        timeout=60,
    )
    response.raise_for_status()
    payload = response.json()
    status = payload.get("status")
    if status not in {"OK", "ZERO_RESULTS"}:
        raise SystemExit(f"Google Place Details failed for '{place_id}': {payload}")
    result = payload.get("result", {})
    return result if isinstance(result, dict) else {}


def is_generic_google_match(types: list[Any]) -> bool:
    normalized = {str(item).strip().lower() for item in types}
    return bool(normalized) and normalized.issubset(GENERIC_GOOGLE_TYPES)


def enrich_record(*, api_key: str, record: dict[str, Any]) -> dict[str, Any]:
    destination_names = record.get("destinationNames")
    if not isinstance(destination_names, list):
        destination_names = []
    location_mentions = record.get("locationMentions")
    if not isinstance(location_mentions, list):
        location_mentions = []

    enriched = dict(record)
    search_queries = build_search_queries(
        destination_names, location_mentions, str(record.get("description", ""))
    )
    enriched["googleSearchQueries"] = search_queries
    if not search_queries:
        enriched["googleMatchStatus"] = "no_search_term"
        return enriched

    require_destination_match = len(destination_names) > 0
    best_result: dict[str, Any] | None = None
    best_candidate: dict[str, Any] | None = None
    best_query = ""

    for query in search_queries:
        candidate = google_text_search(api_key=api_key, query=query)
        if not candidate:
            continue
        place_id = str(candidate.get("place_id") or "").strip()
        details = google_place_details(api_key=api_key, place_id=place_id) if place_id else {}
        types = details.get("types") or candidate.get("types") or []
        if require_destination_match and is_generic_google_match(types):
            continue
        best_result = details
        best_candidate = candidate
        best_query = query
        break

    if best_result is None or best_candidate is None:
        enriched["googleMatchStatus"] = (
            "rejected_generic_match" if require_destination_match else "no_match"
        )
        return enriched

    geometry = best_result.get("geometry", {}) if isinstance(best_result, dict) else {}
    location = geometry.get("location", {}) if isinstance(geometry, dict) else {}
    opening_hours = best_result.get("opening_hours", {}) if isinstance(best_result, dict) else {}
    current_opening_hours = (
        best_result.get("current_opening_hours", {}) if isinstance(best_result, dict) else {}
    )
    editorial_summary = best_result.get("editorial_summary")

    enriched.update(
        {
            "googleSearchTerm": best_query,
            "googleMatchStatus": (
                "matched_destination" if require_destination_match else "matched_location"
            ),
            "googlePlaceId": best_result.get("place_id") or best_candidate.get("place_id"),
            "googleMatchedName": best_result.get("name") or best_candidate.get("name"),
            "googleFormattedAddress": best_result.get("formatted_address")
            or best_candidate.get("formatted_address"),
            "googleLat": location.get("lat"),
            "googleLng": location.get("lng"),
            "googleTypes": best_result.get("types") or best_candidate.get("types") or [],
            "googleBusinessStatus": best_result.get("business_status")
            or best_candidate.get("business_status"),
            "googleOpeningHoursOpenNow": opening_hours.get("open_now"),
            "googleOpeningHoursWeekdayText": opening_hours.get("weekday_text") or [],
            "googleCurrentOpeningHoursOpenNow": current_opening_hours.get("open_now"),
            "googleCurrentOpeningHoursWeekdayText": current_opening_hours.get("weekday_text")
            or [],
            "googleMapsUrl": best_result.get("url"),
            "googleWebsite": best_result.get("website"),
            "googlePhoneNumber": best_result.get("formatted_phone_number"),
            "googleRating": best_result.get("rating"),
            "googleUserRatingsTotal": best_result.get("user_ratings_total"),
            "googlePriceLevel": best_result.get("price_level"),
            "googleEditorialSummary": (
                editorial_summary.get("overview") if isinstance(editorial_summary, dict) else None
            ),
            "googleDelivery": best_result.get("delivery"),
            "googleDineIn": best_result.get("dine_in"),
            "googleTakeout": best_result.get("takeout"),
            "googleReservable": best_result.get("reservable"),
            "googleServesBreakfast": best_result.get("serves_breakfast"),
            "googleServesLunch": best_result.get("serves_lunch"),
            "googleServesDinner": best_result.get("serves_dinner"),
            "googleServesBeer": best_result.get("serves_beer"),
            "googleServesWine": best_result.get("serves_wine"),
            "googleServesVegetarianFood": best_result.get("serves_vegetarian_food"),
        }
    )
    return enriched


def main() -> None:
    args = parse_args()
    api_key = get_api_key()
    input_path = Path(args.input_json)
    payload = json.loads(input_path.read_text(encoding="utf-8"))
    if not isinstance(payload, list):
        raise SystemExit(f"Expected JSON array in {input_path}")

    records: list[dict[str, Any]] = []
    for item in payload:
        if isinstance(item, dict):
            records.append(item)
        elif isinstance(item, str):
            parsed = parse_array_record(item)
            if parsed:
                records.append(parsed)
    if args.max_records > 0:
        records = records[: args.max_records]

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    checkpoint_json_path = output_dir / f"tiktok_google_places_enriched_{timestamp}_checkpoint.json"
    checkpoint_csv_path = output_dir / f"tiktok_google_places_enriched_{timestamp}_checkpoint.csv"
    checkpoint_meta_path = output_dir / f"tiktok_google_places_enriched_{timestamp}_checkpoint.meta.json"
    json_path = output_dir / f"tiktok_google_places_enriched_{timestamp}.json"
    csv_path = output_dir / f"tiktok_google_places_enriched_{timestamp}.csv"
    meta_path = output_dir / f"tiktok_google_places_enriched_{timestamp}.meta.json"

    enriched_records: list[dict[str, Any]] = []
    for index, record in enumerate(records, start=1):
        enriched_records.append(enrich_record(api_key=api_key, record=record))
        if args.sleep_secs > 0:
            time.sleep(args.sleep_secs)
        if args.checkpoint_every > 0 and (
            index % args.checkpoint_every == 0 or index == len(records)
        ):
            checkpoint_meta = {
                "inputFile": str(input_path),
                "recordCount": len(enriched_records),
                "matchedCount": sum(
                    1
                    for item in enriched_records
                    if str(item.get("googleMatchStatus", "")).startswith("matched_")
                ),
                "generatedAt": datetime.now(timezone.utc).isoformat(),
                "isCheckpoint": True,
                "completedRecords": index,
                "totalRecords": len(records),
            }
            write_outputs(
                items=enriched_records,
                json_path=checkpoint_json_path,
                csv_path=checkpoint_csv_path,
                meta_path=checkpoint_meta_path,
                meta=checkpoint_meta,
            )
        if index % 25 == 0:
            print(f"Enriched {index}/{len(records)} records", flush=True)

    meta = {
        "inputFile": str(input_path),
        "recordCount": len(enriched_records),
        "matchedCount": sum(
            1
            for item in enriched_records
            if str(item.get("googleMatchStatus", "")).startswith("matched_")
        ),
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "isCheckpoint": False,
    }
    write_outputs(
        items=enriched_records,
        json_path=json_path,
        csv_path=csv_path,
        meta_path=meta_path,
        meta=meta,
    )
    print(f"Enriched records: {len(enriched_records)}")
    print(f"JSON: {json_path}")
    print(f"CSV: {csv_path}")
    print(f"Metadata: {meta_path}")


if __name__ == "__main__":
    main()
