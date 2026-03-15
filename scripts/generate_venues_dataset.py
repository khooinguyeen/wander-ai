#!/usr/bin/env python3
"""Build a venue dataset in the scripts/venues.json example format.

This script merges the review-enriched Reddit and TikTok Google Places exports,
deduplicates venues, and maps them into the flat venue schema used by
``scripts/venues.json``.

Descriptions can be generated in three modes:

- ``heuristic``: deterministic local summary from Google fields and reviews
- ``ai``: Gemini-only summaries using the provided evidence
- ``auto``: Gemini if ``VENUES_GEMINI_API_KEY`` is set, otherwise heuristic
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

import requests
from requests import Response
from requests.exceptions import RequestException

DEFAULT_INPUTS = [
    Path("scripts/pushshift_reddit_scraper/output/reddit_google_places_enriched_20260314_184436_with_reviews_20260314_215625.json"),
    Path("scripts/apify_tiktok_scraper/output/tiktok_google_places_enriched_20260314_190326_with_reviews_20260314_220123.json"),
]
DEFAULT_OUTPUT = Path("scripts/venues.generated.json")
GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

CATEGORY_BY_TYPE = {
    "bar": "bar",
    "night_club": "bar",
    "liquor_store": "bar",
    "restaurant": "restaurant",
    "meal_delivery": "restaurant",
    "meal_takeaway": "restaurant",
    "cafe": "cafe",
    "bakery": "cafe",
    "clothing_store": "shopping",
    "book_store": "shopping",
    "shopping_mall": "shopping",
    "home_goods_store": "shopping",
    "jewelry_store": "shopping",
    "shoe_store": "shopping",
    "department_store": "shopping",
    "store": "shopping",
    "museum": "entertainment",
    "art_gallery": "entertainment",
    "tourist_attraction": "entertainment",
    "movie_theater": "entertainment",
    "amusement_park": "entertainment",
    "bowling_alley": "entertainment",
}
VENUE_TYPES = {
    "food",
    "cafe",
    "restaurant",
    "bar",
    "bakery",
    "meal_delivery",
    "meal_takeaway",
    "night_club",
    "liquor_store",
    "clothing_store",
    "book_store",
    "shopping_mall",
    "home_goods_store",
    "jewelry_store",
    "shoe_store",
    "department_store",
    "store",
    "museum",
    "art_gallery",
    "tourist_attraction",
    "movie_theater",
    "amusement_park",
    "bowling_alley",
}
VIBE_KEYWORDS = {
    "romantic": {"romantic", "date", "intimate", "candle", "special night"},
    "cozy": {"cozy", "cosy", "warm", "welcoming", "cute", "calm"},
    "casual": {"casual", "laid-back", "laid back", "friendly", "easygoing"},
    "luxurious": {"fine dining", "elegant", "luxury", "upscale", "premium"},
    "casual-romantic": {"date night", "date-night", "shared plates", "share plates"},
}
TAG_KEYWORDS = {
    "coffee": {"coffee", "espresso", "batch brew", "filter coffee", "roaster", "beans"},
    "brunch": {"brunch", "breakfast", "eggs", "waffle", "benedict"},
    "pastry": {"croissant", "pastry", "bakery", "cake", "dessert", "crepe"},
    "cocktail": {"cocktail", "martini", "drinks", "bar"},
    "wine": {"wine", "natural wine"},
    "date-night": {"date", "romantic", "special night", "intimate"},
    "hidden-gem": {"hidden", "tucked away", "surprise find", "best kept secret"},
    "instagram": {"instagram", "instagrammable", "photogenic", "beautifully plated"},
    "queue-worthy": {"queue", "wait", "packed", "busy"},
    "live-music": {"live music"},
    "rooftop": {"rooftop"},
    "outdoor": {"outdoor", "courtyard", "beer garden", "garden"},
    "vegetarian-friendly": {"vegetarian"},
}
SUBURB_RE = re.compile(
    r"(?:^|,\s*)(?P<suburb>[^,]+?)\s+(?P<state>[A-Z]{2,3})\s+(?P<postcode>\d{4})(?:,|$)"
)
TIME_FIXUPS = {
    "\u00e2\u20ac\u00af": " ",
    "\u00e2\u20ac\u2030": "",
    "\u00e2\u20ac\u201c": "-",
    "\u00e2\u20ac\u201d": "-",
    "\u00e2\u20ac\u02dc": "",
    "\u00e2\u20ac": "",
    "\u2009": " ",
    "\u202f": " ",
    "\u2013": "-",
}


@dataclass
class VenueEvidence:
    place_id: str
    names: list[str]
    addresses: list[str]
    source_texts: list[str]
    descriptions: list[str]
    google_types: list[str]
    opening_hours: list[str]
    website: str | None
    maps_url: str | None
    phone_number: str | None
    editorial_summary: str | None
    rating: float | None
    rating_count: int | None
    price_level: int | None
    lat: float | None
    lng: float | None
    reviews: list[dict[str, Any]]
    platforms: list[str]
    source_urls: list[str]


def normalize_text(value: Any) -> str:
    if value is None:
        return ""
    text = str(value)
    for bad, good in TIME_FIXUPS.items():
        text = text.replace(bad, good)
    text = text.replace("\u2014", "-")
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def create_http_session() -> requests.Session:
    session = requests.Session()
    # Ignore inherited shell proxy settings by default because dead localhost
    # proxies in the shell environment break outbound API calls.
    session.trust_env = False
    return session


def unique_list(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        cleaned = normalize_text(value)
        if cleaned and cleaned not in seen:
            seen.add(cleaned)
            result.append(cleaned)
    return result


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "venue"


def infer_platform(path: Path) -> str:
    text = str(path).lower()
    if "reddit" in text or "pushshift" in text:
        return "reddit"
    if "tiktok" in text or "apify" in text:
        return "tiktok"
    return "unknown"


def load_records(path: Path) -> list[dict[str, Any]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, list):
        raise ValueError(f"{path} must contain a top-level JSON array")
    return [item for item in payload if isinstance(item, dict)]


def dedupe_key(record: dict[str, Any]) -> str:
    place_id = normalize_text(record.get("googlePlaceId"))
    if place_id:
        return f"place:{place_id}"
    name = normalize_text(record.get("googleMatchedName") or record.get("googleSearchTerm"))
    address = normalize_text(record.get("googleFormattedAddress"))
    return f"fallback:{slugify(name)}:{slugify(address)}"


def choose_majority(values: list[str]) -> str:
    cleaned = [normalize_text(value) for value in values if normalize_text(value)]
    if not cleaned:
        return ""
    return Counter(cleaned).most_common(1)[0][0]


def choose_numeric(values: list[Any]) -> Any:
    candidates = [value for value in values if value not in (None, "")]
    if not candidates:
        return None
    return sorted(candidates, reverse=True)[0]


def merge_records(records_by_source: list[tuple[dict[str, Any], str]]) -> VenueEvidence:
    records = [record for record, _ in records_by_source]
    platforms = unique_list([platform for _, platform in records_by_source])
    names = unique_list(
        [record.get("googleMatchedName") for record in records]
        + [record.get("googleSearchTerm") for record in records]
        + [item for record in records for item in (record.get("destinationNames") or [])]
    )
    addresses = unique_list([record.get("googleFormattedAddress") for record in records])
    source_texts = unique_list([record.get("sourceText") for record in records])
    descriptions = unique_list([record.get("description") for record in records])
    google_types = unique_list([item for record in records for item in (record.get("googleTypes") or [])])
    source_urls = unique_list(
        [
            item
            for record in records
            for item in (
                record.get("sourceUrls")
                or record.get("source_urls")
                or [record.get("originalTikTokVideoUrl")]
                or []
            )
        ]
    )
    opening_hours = unique_list(
        [
            item
            for record in records
            for item in (
                record.get("googleCurrentOpeningHoursWeekdayText")
                or record.get("googleOpeningHoursWeekdayText")
                or []
            )
        ]
    )
    reviews: list[dict[str, Any]] = []
    seen_reviews: set[tuple[str, str, str]] = set()
    for record in records:
        for review in record.get("googleTopReviews") or []:
            if not isinstance(review, dict):
                continue
            signature = (
                normalize_text(review.get("author_name")),
                normalize_text(review.get("text")),
                str(review.get("time") or ""),
            )
            if signature in seen_reviews:
                continue
            seen_reviews.add(signature)
            reviews.append(review)

    reviews.sort(key=lambda review: int(review.get("time") or 0), reverse=True)

    return VenueEvidence(
        place_id=choose_majority([record.get("googlePlaceId") for record in records]),
        names=names,
        addresses=addresses,
        source_texts=source_texts,
        descriptions=descriptions,
        google_types=google_types,
        opening_hours=opening_hours,
        website=choose_majority([record.get("googleWebsite") for record in records]) or None,
        maps_url=choose_majority([record.get("googleMapsUrl") for record in records]) or None,
        phone_number=choose_majority([record.get("googlePhoneNumber") for record in records]) or None,
        editorial_summary=choose_majority([record.get("googleEditorialSummary") for record in records]) or None,
        rating=choose_numeric([record.get("googleRating") for record in records]),
        rating_count=choose_numeric([record.get("googleUserRatingsTotal") for record in records]),
        price_level=choose_numeric([record.get("googlePriceLevel") for record in records]),
        lat=choose_numeric([record.get("googleLat") for record in records]),
        lng=choose_numeric([record.get("googleLng") for record in records]),
        reviews=reviews[:8],
        platforms=platforms,
        source_urls=source_urls,
    )


def is_probable_venue(venue: VenueEvidence) -> bool:
    types = set(venue.google_types)
    if venue.place_id and types.intersection(VENUE_TYPES):
        return True

    text_blob = " ".join(venue.names + venue.source_texts + venue.descriptions).lower()
    fallback_keywords = {
        "cafe",
        "coffee",
        "brunch",
        "restaurant",
        "bar",
        "bakery",
        "cake",
        "dinner",
        "lunch",
        "breakfast",
        "dessert",
        "wine",
        "cocktail",
        "pizza",
        "shop",
        "store",
        "shopping",
        "boutique",
        "market",
        "plaza",
        "mall",
        "bookstore",
        "records",
        "archive",
        "vinyl",
        "retail",
        "gift",
        "fashion",
        "beauty",
        "nail",
        "museum",
        "gallery",
        "cinema",
        "arcade",
        "attraction",
        "exhibit",
    }
    return any(keyword in text_blob for keyword in fallback_keywords)


def is_melbourne_region(venue: VenueEvidence) -> bool:
    address_blob = " ".join(venue.addresses).lower()
    if "victoria" in address_blob or " vic " in f" {address_blob} ":
        if venue.lat is not None and venue.lng is not None:
            return -38.6 <= float(venue.lat) <= -37.3 and 144.2 <= float(venue.lng) <= 145.9
        return True
    return False


def parse_address(address: str) -> tuple[str, str, str, str]:
    cleaned = normalize_text(address)
    match = SUBURB_RE.search(cleaned)
    suburb = match.group("suburb") if match else ""
    state = match.group("state") if match else ""
    country = cleaned.split(",")[-1].strip() if "," in cleaned else ""
    city = "Melbourne" if "Melbourne" in cleaned or state == "VIC" else ""
    return suburb, city, state, country


def infer_category(types: list[str], text_blob: str) -> str:
    for place_type in types:
        if place_type in CATEGORY_BY_TYPE:
            return CATEGORY_BY_TYPE[place_type]
    lowered = text_blob.lower()
    if "cocktail" in lowered or "wine" in lowered or "beer" in lowered:
        return "bar"
    if "cake" in lowered or "coffee" in lowered or "brunch" in lowered:
        return "cafe"
    if any(keyword in lowered for keyword in ["shop", "store", "boutique", "bookstore", "shopping", "fashion"]):
        return "shopping"
    if any(
        keyword in lowered
        for keyword in [
            "gallery",
            "museum",
            "cinema",
            "entertainment",
            "attraction",
            "exhibit",
            "market",
            "plaza",
            "records",
            "archive",
            "vinyl",
            "beauty",
            "nail",
        ]
    ):
        return "entertainment"
    return "restaurant"


def infer_vibe(text_blob: str, category: str) -> str:
    lowered = text_blob.lower()
    scored: list[tuple[int, str]] = []
    for vibe, keywords in VIBE_KEYWORDS.items():
        score = sum(1 for keyword in keywords if keyword in lowered)
        if score:
            scored.append((score, vibe))
    if scored:
        scored.sort(reverse=True)
        return scored[0][1]
    if category == "bar":
        return "romantic"
    if category == "cafe":
        return "cozy"
    if category == "shopping":
        return "casual"
    if category == "entertainment":
        return "casual"
    return "casual"


def infer_tags(types: list[str], text_blob: str, category: str) -> list[str]:
    lowered = text_blob.lower()
    tags: list[str] = []
    for place_type in types:
        if place_type in {"bakery", "cafe", "restaurant", "bar"}:
            tags.append(place_type)
    for tag, keywords in TAG_KEYWORDS.items():
        if any(keyword in lowered for keyword in keywords):
            tags.append(tag)
    if category == "restaurant":
        tags.append("dining")
    if category == "cafe":
        tags.append("morning-date")
    if category == "shopping":
        tags.append("shopping")
    if category == "entertainment":
        tags.append("experience")
    return unique_list(tags)[:8]


def review_snippets(reviews: list[dict[str, Any]], max_items: int = 4) -> list[str]:
    snippets: list[str] = []
    for review in reviews[:max_items]:
        text = normalize_text(review.get("text"))
        if not text:
            continue
        snippets.append(text[:320])
    return snippets


def pick_feature_phrases(text_blob: str, category: str) -> list[str]:
    phrases: list[str] = []
    lowered = text_blob.lower()
    checks = [
        ("city views", {"view", "views", "skyline"}),
        ("specialty coffee", {"coffee", "espresso", "filter coffee", "beans"}),
        ("brunch crowd", {"brunch", "waffle", "benedict", "eggs"}),
        ("crepe cakes", {"crepe", "mille crepe", "cake"}),
        ("cocktails", {"cocktail", "martini"}),
        ("wine list", {"wine"}),
        ("outdoor seating", {"outdoor", "courtyard", "garden", "beer garden"}),
        ("friendly service", {"friendly staff", "friendly service", "welcoming"}),
        ("laid-back atmosphere", {"chill", "laid-back", "laid back", "casual"}),
        ("beautiful interior", {"beautiful interior", "minimal interior", "ambiance", "atmosphere"}),
    ]
    for label, keywords in checks:
        if any(keyword in lowered for keyword in keywords):
            phrases.append(label)
    if not phrases:
        if category == "cafe":
            phrases.append("coffee-led menu")
        elif category == "bar":
            phrases.append("strong drinks list")
        elif category == "shopping":
            phrases.append("well-curated retail mix")
        elif category == "entertainment":
            phrases.append("memorable visit experience")
        else:
            phrases.append("popular local menu")
    return phrases[:2]


def heuristic_description(venue: VenueEvidence, category: str, suburb: str, vibe: str) -> str:
    parts = []
    subject = venue.names[0] if venue.names else "This venue"
    descriptor_blob = " ".join(
        venue.source_texts + venue.descriptions + ([venue.editorial_summary] if venue.editorial_summary else []) + review_snippets(venue.reviews)
    )
    features = pick_feature_phrases(descriptor_blob, category)
    place_part = f"{category} in {suburb}" if suburb else category
    parts.append(f"{subject} is a {vibe} {place_part} known for {', '.join(features)}.")

    if venue.rating and venue.rating_count:
        parts.append(f"Google reviews point to a {venue.rating:.1f}-star favourite with {venue.rating_count} ratings.")
    elif venue.rating:
        parts.append(f"Google reviews consistently rate it {venue.rating:.1f} stars.")

    return " ".join(parts)


def build_ai_prompt(batch: list[dict[str, Any]]) -> str:
    return json.dumps(
        {
            "task": "Write short venue descriptions plus vibe and tags for a Melbourne dataset.",
            "rules": [
                "Return a JSON array only.",
                "Each item must include google_place_id, description, vibe, and tags.",
                "Descriptions must be 1-2 sentences, 18-40 words total.",
                "vibe must be a short string such as cozy, romantic, casual, luxurious, or casual-romantic.",
                "tags must be a JSON array of 3 to 8 short lowercase strings.",
                "Use only the supplied evidence.",
                "Sound like the examples in scripts/venues.json: concise, editorial, practical, not hypey.",
                "Do not invent awards, history, or claims not supported by the evidence.",
            ],
            "venues": batch,
        },
        ensure_ascii=False,
    )


def build_single_ai_prompt(item: dict[str, Any]) -> str:
    return json.dumps(
        {
            "task": "Write one venue description plus vibe and tags for a Melbourne dataset.",
            "rules": [
                "Return exactly one JSON object, not an array.",
                "Include google_place_id, description, vibe, and tags.",
                "description must be 1-2 sentences, 18-40 words total.",
                "vibe must be a short string such as cozy, romantic, casual, luxurious, or casual-romantic.",
                "tags must be a JSON array of 3 to 8 short lowercase strings.",
                "Use only the supplied evidence.",
                "If the venue is mixed-use, focus on the hospitality or visit experience most relevant to the evidence.",
                "Do not skip the venue.",
            ],
            "venue": item,
        },
        ensure_ascii=False,
    )


def format_gemini_error(response: Response) -> str:
    try:
        payload = response.json()
    except ValueError:
        payload = {}
    error = payload.get("error") if isinstance(payload, dict) else {}
    if isinstance(error, dict):
        message = normalize_text(error.get("message"))
        error_type = normalize_text(error.get("type"))
        code = normalize_text(error.get("status") or error.get("code"))
        parts = [part for part in [error_type, code, message] if part]
        if parts:
            return " | ".join(parts)
    return normalize_text(response.text) or f"HTTP {response.status_code}"


def parse_retry_delay_seconds(message: str) -> float | None:
    ms_match = re.search(r"retry in\s+(\d+(?:\.\d+)?)ms", message, flags=re.IGNORECASE)
    if ms_match:
        return float(ms_match.group(1)) / 1000.0
    sec_match = re.search(r"retry in\s+(\d+(?:\.\d+)?)s", message, flags=re.IGNORECASE)
    if sec_match:
        return float(sec_match.group(1))
    return None


@dataclass
class AIVenueFields:
    description: str
    vibe: str
    tags: list[str]


def generate_ai_descriptions(
    items: list[dict[str, Any]],
    api_key: str,
    model: str,
    batch_size: int = 20,
    min_batch_interval_seconds: float = 4.5,
    max_retries: int = 0,
    on_progress: Callable[[dict[str, AIVenueFields]], None] | None = None,
) -> dict[str, AIVenueFields]:
    descriptions: dict[str, AIVenueFields] = {}
    session = create_http_session()
    last_request_started_at = 0.0
    total_batches = max(1, (len(items) + batch_size - 1) // batch_size)
    for batch_index, start in enumerate(range(0, len(items), batch_size), start=1):
        batch = items[start : start + batch_size]
        attempt = 0
        while True:
            wait_seconds = min_batch_interval_seconds - (time.monotonic() - last_request_started_at)
            if wait_seconds > 0:
                print(
                    f"[ai] batch {batch_index}/{total_batches}: waiting {wait_seconds:.1f}s to respect rate limit",
                    flush=True,
                )
                time.sleep(wait_seconds)
            place_preview = ", ".join(item.get("name", "") for item in batch[:2])
            print(
                f"[ai] batch {batch_index}/{total_batches}: requesting {len(batch)} venue(s)"
                + (f" [{place_preview}]" if place_preview else ""),
                flush=True,
            )
            last_request_started_at = time.monotonic()
            try:
                response = session.post(
                    GEMINI_API_URL.format(model=model),
                    params={"key": api_key},
                    headers={"Content-Type": "application/json"},
                    json={
                        "contents": [{"parts": [{"text": build_ai_prompt(batch)}]}],
                        "generationConfig": {
                            "temperature": 0.2,
                            "responseMimeType": "application/json",
                        },
                    },
                    timeout=60,
                )
            except RequestException as exc:
                if max_retries == 0 or attempt < max_retries:
                    print(
                        f"[ai] batch {batch_index}/{total_batches}: network error, retrying after {min_batch_interval_seconds:.1f}s",
                        flush=True,
                    )
                    time.sleep(min_batch_interval_seconds)
                    attempt += 1
                    continue
                raise RuntimeError(f"Gemini request failed before receiving a response: {exc}") from exc
            if response.status_code == 429 and (max_retries == 0 or attempt < max_retries):
                message = format_gemini_error(response)
                retry_after = parse_retry_delay_seconds(message) or min_batch_interval_seconds
                print(
                    f"[ai] batch {batch_index}/{total_batches}: rate limited, sleeping {max(retry_after, min_batch_interval_seconds):.1f}s",
                    flush=True,
                )
                time.sleep(max(retry_after, min_batch_interval_seconds))
                attempt += 1
                continue
            if response.status_code >= 400:
                raise RuntimeError(
                    f"Gemini request failed with status {response.status_code}: {format_gemini_error(response)}"
                )
            payload = response.json()
            text = (
                payload.get("candidates", [{}])[0]
                .get("content", {})
                .get("parts", [{}])[0]
                .get("text", "[]")
            )
            parsed = json.loads(text)
            if not isinstance(parsed, list):
                break
            for item in parsed:
                if not isinstance(item, dict):
                    continue
                place_id = normalize_text(item.get("google_place_id"))
                description = normalize_text(item.get("description"))
                vibe = normalize_text(item.get("vibe"))
                raw_tags = item.get("tags")
                tags = unique_list(raw_tags if isinstance(raw_tags, list) else [])
                if place_id and description and vibe and tags:
                    descriptions[place_id] = AIVenueFields(description=description, vibe=vibe, tags=tags[:8])
            if on_progress is not None:
                on_progress(descriptions)
            print(
                f"[ai] batch {batch_index}/{total_batches}: completed, total AI-enriched venues={len(descriptions)}",
                flush=True,
            )
            break
    return descriptions


def generate_single_ai_description(
    item: dict[str, Any],
    api_key: str,
    model: str,
    min_batch_interval_seconds: float = 4.0,
) -> AIVenueFields | None:
    session = create_http_session()
    time.sleep(max(0.0, min_batch_interval_seconds))
    try:
        response = session.post(
            GEMINI_API_URL.format(model=model),
            params={"key": api_key},
            headers={"Content-Type": "application/json"},
            json={
                "contents": [{"parts": [{"text": build_single_ai_prompt(item)}]}],
                "generationConfig": {
                    "temperature": 0.2,
                    "responseMimeType": "application/json",
                },
            },
            timeout=60,
        )
    except RequestException as exc:
        raise RuntimeError(f"Gemini single-venue request failed before receiving a response: {exc}") from exc

    if response.status_code == 429:
        message = format_gemini_error(response)
        retry_after = parse_retry_delay_seconds(message) or min_batch_interval_seconds
        time.sleep(max(retry_after, min_batch_interval_seconds))
        return generate_single_ai_description(
            item,
            api_key=api_key,
            model=model,
            min_batch_interval_seconds=min_batch_interval_seconds,
        )
    if response.status_code >= 400:
        raise RuntimeError(
            f"Gemini single-venue request failed with status {response.status_code}: {format_gemini_error(response)}"
        )

    payload = response.json()
    text = (
        payload.get("candidates", [{}])[0]
        .get("content", {})
        .get("parts", [{}])[0]
        .get("text", "{}")
    )
    parsed = json.loads(text)
    if not isinstance(parsed, dict):
        return None
    description = normalize_text(parsed.get("description"))
    vibe = normalize_text(parsed.get("vibe"))
    raw_tags = parsed.get("tags")
    tags = unique_list(raw_tags if isinstance(raw_tags, list) else [])
    if description and vibe and tags:
        return AIVenueFields(description=description, vibe=vibe, tags=tags[:8])
    return None


def to_json_string(value: list[str]) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def build_venue_record(venue: VenueEvidence, ai_fields: AIVenueFields | None = None) -> dict[str, Any]:
    name = venue.names[0] if venue.names else "Unknown venue"
    address = venue.addresses[0] if venue.addresses else ""
    suburb, city, state, country = parse_address(address)
    text_blob = " ".join(
        [
            name,
            address,
            *venue.source_texts,
            *venue.descriptions,
            *(review_snippets(venue.reviews, max_items=5)),
            venue.editorial_summary or "",
            " ".join(venue.google_types),
        ]
    )
    category = infer_category(venue.google_types, text_blob)
    vibe = ai_fields.vibe if ai_fields else infer_vibe(text_blob, category)
    tags = ai_fields.tags if ai_fields else infer_tags(venue.google_types, text_blob, category)
    description = ai_fields.description if ai_fields else heuristic_description(venue, category, suburb, vibe)

    return {
        "name": name,
        "description": description,
        "category": category,
        "suburb": suburb,
        "city": city,
        "state": state,
        "country": country,
        "address": address,
        "lat": venue.lat,
        "lng": venue.lng,
        "price_level": venue.price_level,
        "vibe": vibe,
        "tags": to_json_string(tags),
        "opening_hours": to_json_string(venue.opening_hours),
        "website": venue.website,
        "google_maps_url": venue.maps_url,
        "source_urls": to_json_string(venue.source_urls),
        "google_rating": venue.rating,
        "google_rating_count": venue.rating_count,
        "google_place_id": venue.place_id,
    }


def sync_tiktok_source_urls(
    review_file: Path,
    base_file: Path,
    write_changes: bool = False,
) -> tuple[list[dict[str, Any]], int]:
    review_records = load_records(review_file)
    base_records = load_records(base_file)
    lookup: dict[tuple[str, str], dict[str, Any]] = {}
    for record in base_records:
        key = (
            normalize_text(record.get("googlePlaceId")),
            normalize_text(record.get("sourceText")),
        )
        lookup[key] = record

    updated = 0
    for record in review_records:
        key = (
            normalize_text(record.get("googlePlaceId")),
            normalize_text(record.get("sourceText")),
        )
        base = lookup.get(key)
        if not base:
            continue
        video_url = normalize_text(base.get("originalTikTokVideoUrl") or base.get("webVideoUrl"))
        video_id = normalize_text(base.get("originalTikTokId") or base.get("id"))
        if video_url:
            source_urls = record.get("sourceUrls")
            if not isinstance(source_urls, list):
                source_urls = []
            source_urls = unique_list([*source_urls, video_url])
            if record.get("sourceUrls") != source_urls:
                record["sourceUrls"] = source_urls
                updated += 1
            record["originalTikTokVideoUrl"] = video_url
        if video_id:
            record["originalTikTokId"] = video_id

    if write_changes:
        review_file.write_text(json.dumps(review_records, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return review_records, updated


def write_json_file(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate a unified venues dataset from enriched Reddit and TikTok Google Places exports."
    )
    parser.add_argument(
        "--input",
        dest="inputs",
        action="append",
        default=[],
        help="Input JSON file path. Repeat to add more inputs. Defaults to the current Reddit and TikTok review-enriched files.",
    )
    parser.add_argument(
        "--output",
        default=str(DEFAULT_OUTPUT),
        help=f"Output JSON path. Default: {DEFAULT_OUTPUT}",
    )
    parser.add_argument(
        "--live-output",
        default="scripts/venues.generated.live.json",
        help="Path for the live in-progress JSON file written during AI runs.",
    )
    parser.add_argument(
        "--sync-tiktok-review-urls",
        action="store_true",
        help="Backfill source URLs into the TikTok review-enriched file from the base TikTok enriched export before processing.",
    )
    parser.add_argument(
        "--description-mode",
        choices=["auto", "ai", "heuristic"],
        default="auto",
        help="How to generate descriptions. Default: auto",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Optional limit on number of merged venues to write, for testing.",
    )
    parser.add_argument(
        "--ai-batch-size",
        type=int,
        default=5,
        help="Number of venues per AI request. Lower this if the model times out. Default: 5",
    )
    parser.add_argument(
        "--ai-min-interval-seconds",
        type=float,
        default=4.0,
        help="Minimum wait between AI requests to stay under rate limits. Default: 4.0",
    )
    parser.add_argument(
        "--allow-env-proxy",
        action="store_true",
        help="Allow inherited HTTP(S)_PROXY environment settings for API calls.",
    )
    return parser.parse_args()


def main() -> int:
    load_env_file(Path(".env.local"))
    load_env_file(Path(".env"))

    args = parse_args()
    if args.sync_tiktok_review_urls:
        tiktok_review = Path(
            "scripts/apify_tiktok_scraper/output/tiktok_google_places_enriched_20260314_190326_with_reviews_20260314_220123.json"
        )
        tiktok_base = Path("scripts/apify_tiktok_scraper/output/tiktok_google_places_enriched_20260314_190326.json")
        _, synced_count = sync_tiktok_source_urls(tiktok_review, tiktok_base, write_changes=True)
        print(f"Synced TikTok source URLs: {synced_count}")
    if args.allow_env_proxy:
        requests_session = requests.Session()
        requests_session.trust_env = True
        del requests_session
    input_paths = [Path(value) for value in args.inputs] if args.inputs else DEFAULT_INPUTS
    missing = [str(path) for path in input_paths if not path.exists()]
    if missing:
        print(f"Missing input files: {', '.join(missing)}", file=sys.stderr)
        return 1

    grouped: dict[str, list[tuple[dict[str, Any], str]]] = {}
    for path in input_paths:
        platform = infer_platform(path)
        for record in load_records(path):
            key = dedupe_key(record)
            grouped.setdefault(key, []).append((record, platform))

    merged = [merge_records(items) for items in grouped.values()]
    merged = [venue for venue in merged if is_probable_venue(venue) and is_melbourne_region(venue)]
    merged.sort(key=lambda item: (item.names[0] if item.names else "", item.place_id))
    if args.limit > 0:
        merged = merged[: args.limit]
    print(f"Loaded merged venue candidates: {len(merged)}", flush=True)

    description_mode = args.description_mode
    api_key = os.getenv("VENUES_GEMINI_API_KEY", "").strip() or os.getenv("GEMINI_API_KEY", "").strip()
    model = os.getenv("VENUES_GEMINI_MODEL", "gemini-2.5-flash-lite").strip()
    if description_mode == "auto":
        description_mode = "ai" if api_key else "heuristic"
    print(f"Description mode selected: {description_mode}", flush=True)
    if description_mode == "ai" and not api_key:
        print("VENUES_GEMINI_API_KEY is required for --description-mode ai", file=sys.stderr)
        return 1

    ai_descriptions: dict[str, AIVenueFields] = {}
    if description_mode == "ai":
        print(f"Using Gemini model: {model}", flush=True)
        batch = []
        ai_batch_items_by_place_id: dict[str, dict[str, Any]] = {}
        venues_by_place_id: dict[str, VenueEvidence] = {}
        for venue in merged:
            ai_item = {
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
                "current_category": infer_category(venue.google_types, " ".join(venue.source_texts + venue.descriptions)),
            }
            batch.append(ai_item)
            if venue.place_id:
                ai_batch_items_by_place_id[venue.place_id] = ai_item
                venues_by_place_id[venue.place_id] = venue

        live_output_path = Path(args.live_output)

        def write_live_output(progress_map: dict[str, AIVenueFields]) -> None:
            live_records = [
                build_venue_record(venue, ai_fields=progress_map[venue.place_id])
                for venue in merged
                if venue.place_id in progress_map
            ]
            write_json_file(live_output_path, live_records)
            print(
                f"[ai] live output updated: {len(live_records)} record(s) -> {live_output_path}",
                flush=True,
            )

        if args.allow_env_proxy:
            original_create_http_session = create_http_session

            def create_http_session_with_env() -> requests.Session:
                session = requests.Session()
                session.trust_env = True
                return session

            globals()["create_http_session"] = create_http_session_with_env
            try:
                ai_descriptions = generate_ai_descriptions(
                    batch,
                    api_key=api_key,
                    model=model,
                    batch_size=max(1, args.ai_batch_size),
                    min_batch_interval_seconds=max(0.0, args.ai_min_interval_seconds),
                    on_progress=write_live_output,
                )
            finally:
                globals()["create_http_session"] = original_create_http_session
        else:
            ai_descriptions = generate_ai_descriptions(
                batch,
                api_key=api_key,
                model=model,
                batch_size=max(1, args.ai_batch_size),
                min_batch_interval_seconds=max(0.0, args.ai_min_interval_seconds),
                on_progress=write_live_output,
            )
        missing_ai = [venue for venue in merged if venue.place_id not in ai_descriptions]
        if missing_ai:
            print(
                "[ai] Gemini skipped some venues in the first pass: "
                + ", ".join((venue.names[0] if venue.names else venue.place_id) for venue in missing_ai[:10]),
                flush=True,
            )
        for venue in missing_ai:
            if not venue.place_id:
                continue
            single_item = ai_batch_items_by_place_id.get(venue.place_id)
            if not single_item:
                continue
            print(
                f"[ai] retrying missing venue individually: {venue.names[0] if venue.names else venue.place_id}",
                flush=True,
            )
            retried = generate_ai_descriptions(
                [single_item],
                api_key=api_key,
                model=model,
                batch_size=1,
                min_batch_interval_seconds=max(0.0, args.ai_min_interval_seconds),
                on_progress=write_live_output,
            )
            ai_descriptions.update(retried)
            if venue.place_id not in ai_descriptions:
                print(
                    f"[ai] strict single-venue rescue for: {venue.names[0] if venue.names else venue.place_id}",
                    flush=True,
                )
                rescued = generate_single_ai_description(
                    single_item,
                    api_key=api_key,
                    model=model,
                    min_batch_interval_seconds=max(0.0, args.ai_min_interval_seconds),
                )
                if rescued is not None:
                    ai_descriptions[venue.place_id] = rescued
                    write_live_output(ai_descriptions)
        remaining_missing = [venue for venue in merged if venue.place_id not in ai_descriptions]
        if remaining_missing:
            raise RuntimeError(
                "AI mode did not produce description/vibe/tags for "
                f"{len(remaining_missing)} venues even after single-item retries: "
                + ", ".join((venue.names[0] if venue.names else venue.place_id) for venue in remaining_missing[:10])
            )

    output_records = [
        build_venue_record(venue, ai_fields=ai_descriptions.get(venue.place_id)) for venue in merged
    ]
    output_records.sort(key=lambda item: ((item.get("suburb") or ""), (item.get("name") or "")))

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(output_records, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"Input files: {len(input_paths)}")
    print(f"Raw records: {sum(len(load_records(path)) for path in input_paths)}")
    print(f"Merged venues: {len(output_records)}")
    print(f"Description mode: {description_mode}")
    print(f"Output written: {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
