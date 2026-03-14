from __future__ import annotations

"""Extract destination names, location mentions, and descriptive snippets."""

import argparse
import csv
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


MELBOURNE_LOCATION_TERMS: tuple[str, ...] = (
    "melbourne",
    "melb",
    "north melbourne",
    "south melbourne",
    "east melbourne",
    "west melbourne",
    "melbourne cbd",
    "cbd",
    "fitzroy",
    "collingwood",
    "richmond",
    "carlton",
    "brunswick",
    "south yarra",
    "prahran",
    "st kilda",
    "southbank",
    "footscray",
    "docklands",
    "northcote",
    "preston",
    "coburg",
    "hawthorn",
    "camberwell",
    "moonee ponds",
    "flemington",
    "abbotsford",
    "thornbury",
    "kew",
    "toorak",
    "elwood",
    "brighton",
    "victoria",
    "vic",
)

GENERIC_LOCATION_TERMS: set[str] = {
    "melbourne",
    "melb",
    "melbourne cbd",
    "cbd",
    "victoria",
    "vic",
    "australia",
}

DESTINATION_KEYWORDS: tuple[str, ...] = (
    "cafe",
    "coffee",
    "restaurant",
    "bar",
    "pub",
    "market",
    "store",
    "bakery",
    "roastery",
    "cinema",
    "arcade",
    "festival",
    "shop",
    "diner",
    "bistro",
    "brewery",
    "wine",
)

LOCATION_PATTERN = re.compile(
    r"\b(?:at|in|near|around|from|to|visit|visited|go to|went to|try|tried|recommend|recommended|like|love)\s+"
    r"([A-Z][A-Za-z&'\-]+(?:\s+[A-Z][A-Za-z&'.\-]+){0,5})"
)
DESTINATION_PATTERN = re.compile(
    r"\b(?:try|tried|recommend|recommended|like|love|visit|visited|go to|went to)\s+"
    r"([A-Z][A-Za-z&'\-]+(?:\s+[A-Z][A-Za-z&'.\-]+){0,5})"
)
DESTINATION_IN_LOCATION_PATTERN = re.compile(
    r"\b([A-Z][A-Za-z&'\-]+(?:\s+[A-Z][A-Za-z&'.\-]+){0,5})\s+in\s+"
    r"([A-Z][A-Za-z&'\-]+(?:\s+[A-Z][A-Za-z&'.\-]+){0,3})"
)
SENTENCE_SPLIT_PATTERN = re.compile(r"(?<=[.!?])\s+|\n+")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Extract destination names and location mentions from Reddit output JSON."
    )
    parser.add_argument("input_json", help="Path to a Reddit scrape JSON file.")
    parser.add_argument(
        "--output-dir",
        default="output",
        help="Directory for cleaned JSON/CSV/meta exports.",
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
    if isinstance(value, datetime):
        return value.isoformat()
    return json.dumps(normalize_for_json(value), ensure_ascii=False)


def write_csv(items: list[dict[str, Any]], path: Path) -> None:
    fieldnames: list[str] = []
    seen: set[str] = set()
    for item in items:
        for key in item.keys():
            if key not in seen:
                seen.add(key)
                fieldnames.append(key)

    with path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames)
        writer.writeheader()
        for item in items:
            writer.writerow({key: flatten_value(item.get(key)) for key in fieldnames})


def normalize_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def sentence_candidates(text: str) -> list[str]:
    return [part.strip() for part in SENTENCE_SPLIT_PATTERN.split(text) if part.strip()]


def extract_location_mentions(text: str) -> list[str]:
    mentions: list[str] = []
    lowered = text.lower()

    for term in MELBOURNE_LOCATION_TERMS:
        if term in lowered:
            mentions.append(term.title())

    for match in LOCATION_PATTERN.findall(text):
        cleaned = match.strip(" .,:;!-")
        if cleaned and cleaned not in mentions:
            mentions.append(cleaned)

    deduped: list[str] = []
    seen: set[str] = set()
    for mention in mentions:
        key = mention.lower()
        if key in seen:
            continue
        seen.add(key)
        deduped.append(mention)
    return deduped


def looks_like_destination(name: str) -> bool:
    lowered = name.lower().strip()
    if not lowered or lowered in GENERIC_LOCATION_TERMS:
        return False
    if lowered in {term.lower() for term in MELBOURNE_LOCATION_TERMS}:
        return False
    if any(keyword in lowered for keyword in DESTINATION_KEYWORDS):
        return True
    return len(name.split()) >= 2


def extract_destination_names(text: str) -> list[str]:
    candidates: list[str] = []

    for destination, _location in DESTINATION_IN_LOCATION_PATTERN.findall(text):
        cleaned = destination.strip(" .,:;!-")
        if cleaned and looks_like_destination(cleaned):
            candidates.append(cleaned)

    for match in DESTINATION_PATTERN.findall(text):
        cleaned = match.strip(" .,:;!-")
        if cleaned and looks_like_destination(cleaned):
            candidates.append(cleaned)

    deduped: list[str] = []
    seen: set[str] = set()
    for candidate in candidates:
        key = candidate.lower()
        if key in seen:
            continue
        seen.add(key)
        deduped.append(candidate)
    return deduped


def extract_descriptive_sentences(text: str) -> list[dict[str, Any]]:
    extracted: list[dict[str, Any]] = []
    for sentence in sentence_candidates(text):
        locations = extract_location_mentions(sentence)
        destinations = extract_destination_names(sentence)
        if not locations and not destinations:
            continue
        extracted.append(
            {
                "destinationNames": destinations,
                "locationMentions": locations,
                "description": sentence,
            }
        )
    return extracted


def clean_post(item: dict[str, Any]) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    post_id = str(item.get("id") or "").strip()
    base = {
        "postId": post_id,
        "postTitle": normalize_text(item.get("title")),
        "postPermalink": normalize_text(item.get("permalink")),
        "postSubreddit": normalize_text(item.get("subreddit")),
        "postSearchQuery": normalize_text(item.get("searchQuery")),
    }

    post_text = "\n".join(
        part for part in (normalize_text(item.get("title")), normalize_text(item.get("selftext"))) if part
    )
    for extracted in extract_descriptive_sentences(post_text):
        records.append(
            {
                **base,
                "sourceType": "post",
                "sourceId": post_id,
                "commentId": "",
                "destinationNames": extracted["destinationNames"],
                "locationMentions": extracted["locationMentions"],
                "description": extracted["description"],
            }
        )

    comments = item.get("comments")
    if isinstance(comments, list):
        for comment in comments:
            if not isinstance(comment, dict):
                continue
            comment_id = str(comment.get("id") or "").strip()
            body = normalize_text(comment.get("body"))
            if not body:
                continue
            for extracted in extract_descriptive_sentences(body):
                records.append(
                    {
                        **base,
                        "sourceType": "comment",
                        "sourceId": comment_id,
                        "commentId": comment_id,
                        "destinationNames": extracted["destinationNames"],
                        "locationMentions": extracted["locationMentions"],
                        "description": extracted["description"],
                    }
                )

    return records


def main() -> None:
    args = parse_args()
    input_path = Path(args.input_json)
    payload = json.loads(input_path.read_text(encoding="utf-8"))
    if not isinstance(payload, list):
        raise SystemExit(f"Expected JSON array in {input_path}")

    cleaned: list[dict[str, Any]] = []
    for item in payload:
        if isinstance(item, dict):
            cleaned.extend(clean_post(item))

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    json_path = output_dir / f"reddit_location_mentions_{timestamp}.json"
    csv_path = output_dir / f"reddit_location_mentions_{timestamp}.csv"
    meta_path = output_dir / f"reddit_location_mentions_{timestamp}.meta.json"

    meta = {
        "inputFile": str(input_path),
        "recordCount": len(cleaned),
        "generatedAt": datetime.now(timezone.utc).isoformat(),
    }

    json_path.write_text(
        json.dumps(normalize_for_json(cleaned), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    write_csv(cleaned, csv_path)
    meta_path.write_text(
        json.dumps(normalize_for_json(meta), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print(f"Cleaned records: {len(cleaned)}")
    print(f"JSON: {json_path}")
    print(f"CSV: {csv_path}")
    print(f"Metadata: {meta_path}")


if __name__ == "__main__":
    main()
