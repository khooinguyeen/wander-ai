from __future__ import annotations

"""Extract concise place strings from TikTok Melbourne scrape output."""

import argparse
import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any


GENERIC_DESTINATIONS = {
    "",
    "melbourne",
    "melb",
    "melbourne cbd",
    "victoria",
    "vic",
    "australia",
}

REJECT_DESTINATIONS = {
    "sandwiches",
    "melbourne chinatown",
    "welcome",
    "location",
    "venue",
    "address",
    "my kind of night life frfr",
    "the go to place",
    "march in melbourne just hits different",
    "bookstores in melbourne that",
    "clothes shopping in melbourne guide",
    "a one day event",
    "cbd",
    "fitzroy",
    "hawthorn",
    "collingwood",
    "dandenong",
    "deer park",
    "blackburn",
    "yarraville",
    "bayswater",
    "flinders street",
    "chapel street",
    "melbourne central",
    "queen victoria market",
}

LOCATION_PATTERN = re.compile(
    r"\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})\s+VIC\b|\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})\b"
)
ADDRESS_SUBURB_PATTERN = re.compile(
    r",\s*([A-Za-z][A-Za-z\s'\-]+?)\s+VIC\b", re.IGNORECASE
)
PIN_BLOCK_PATTERN = re.compile(
    r"📍\s*@?([^\n|]+?)(?:\s*\|\s*|\s*,\s*|\s*\n|$)", re.IGNORECASE
)
INLINE_PIN_PATTERN = re.compile(
    r"\b([A-Z][\w&'().\-]*(?:\s+[A-Z][\w&'().\-]*){0,6})\s*📍\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})"
)
IN_LOCATION_PATTERN = re.compile(
    r"\b([A-Z][\w&'().\-]*(?:\s+[A-Z][\w&'().\-]*){0,6})\s+in\s+([A-Z][A-Za-z\s'\-]{1,40})"
)
AT_LOCATION_PATTERN = re.compile(
    r"\bat\s+@?([A-Z][\w&'().\-]*(?:\s+[A-Z][\w&'().\-]*){0,6})\b"
)
THIS_IS_PATTERN = re.compile(
    r"\bthis is\s+@?([A-Z][\w&'().\-]*(?:\s+[A-Z][\w&'().\-]*){0,6})",
    re.IGNORECASE,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Extract place strings from Apify TikTok Melbourne output."
    )
    parser.add_argument(
        "input_json",
        nargs="?",
        default="output/apify_tiktok_melbourne_combined.json",
        help="Path to the TikTok JSON export.",
    )
    parser.add_argument(
        "--output-dir",
        default="output",
        help="Directory for extracted array and metadata.",
    )
    return parser.parse_args()


def clean_text(value: Any) -> str:
    return str(value or "").strip()


def normalize_destination(value: str) -> str:
    value = re.sub(r"\s+", " ", str(value or "")).strip(" -|,:;[]()")
    value = value.lstrip("@").strip()
    return value


def is_generic_destination(value: str) -> bool:
    normalized = normalize_destination(value).lower()
    return normalized in GENERIC_DESTINATIONS or normalized in REJECT_DESTINATIONS


def looks_like_good_destination(value: str) -> bool:
    normalized = normalize_destination(value)
    if not normalized or is_generic_destination(normalized):
        return False
    lower = normalized.lower()
    if len(normalized) < 3:
        return False
    if any(token in lower for token in ["follow for more", "guide", "things to do", "happening ", "location:", "venue:"]):
        return False
    if any(token in lower for token in ["recommendations", "melbourne cafe fam", "just hits different"]):
        return False
    if normalized.count(" ") == 0 and normalized.islower():
        return False
    if re.search(r"[#@]", normalized):
        return False
    return True


def extract_suburb_from_address(address: str) -> str:
    match = ADDRESS_SUBURB_PATTERN.search(address)
    if not match:
        return ""
    return normalize_destination(match.group(1))


def extract_from_pin_block(text: str) -> tuple[str, str]:
    inline_match = INLINE_PIN_PATTERN.search(text)
    if inline_match:
        return normalize_destination(inline_match.group(1)), normalize_destination(inline_match.group(2))

    match = PIN_BLOCK_PATTERN.search(text)
    if not match:
        return "", ""
    block = normalize_destination(match.group(1))
    if not block:
        return "", ""
    number_match = re.search(r"\s+\d", block)
    if number_match:
        split_at = number_match.start()
        return normalize_destination(block[:split_at]), normalize_destination(block[split_at:].strip())
    if "," in block:
        left, right = [normalize_destination(part) for part in block.split(",", 1)]
        return left, right
    return block, ""


def extract_from_sentence(text: str) -> tuple[str, str]:
    for pattern in (IN_LOCATION_PATTERN,):
        match = pattern.search(text)
        if match:
            return normalize_destination(match.group(1)), normalize_destination(match.group(2))
    for pattern in (THIS_IS_PATTERN, AT_LOCATION_PATTERN):
        match = pattern.search(text)
        if match:
            candidate = normalize_destination(match.group(1))
            if looks_like_good_destination(candidate):
                return candidate, ""
    return "", ""


def choose_place_string(item: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    text = clean_text(item.get("text"))
    destination_name = normalize_destination(item.get("destinationName"))
    destination_address = clean_text(item.get("destinationAddress"))
    location_meta = item.get("locationMeta") if isinstance(item.get("locationMeta"), dict) else {}
    location_name = normalize_destination(location_meta.get("locationName")) if location_meta else ""
    suburb_from_address = extract_suburb_from_address(destination_address)

    parsed_name, parsed_location = extract_from_pin_block(text)
    if not parsed_name:
        parsed_name, parsed_location = extract_from_sentence(text)

    candidates = []
    if looks_like_good_destination(destination_name):
        candidates.append(destination_name)
    if looks_like_good_destination(parsed_name):
        candidates.append(parsed_name)
    if not candidates:
        mention_names = item.get("mentions")
        if isinstance(mention_names, list):
            for mention in mention_names:
                mention_text = normalize_destination(mention)
                if looks_like_good_destination(mention_text):
                    candidates.append(mention_text)
                    break

    location_candidates = [parsed_location, suburb_from_address]
    if location_name and location_name.lower() not in GENERIC_DESTINATIONS:
        if not destination_name or location_name.lower() != destination_name.lower():
            location_candidates.append(location_name)
    location = next(
        (
            normalize_destination(candidate)
            for candidate in location_candidates
            if normalize_destination(candidate)
            and normalize_destination(candidate).lower() not in GENERIC_DESTINATIONS
            and normalize_destination(candidate).lower() not in REJECT_DESTINATIONS
        ),
        "",
    )

    destination = next((candidate for candidate in candidates if candidate), "")
    if not destination:
        return "", {}

    if location and location.lower() not in destination.lower():
        place_string = f"{destination} in {location}"
    else:
        place_string = destination

    details = {
        "tiktokId": clean_text(item.get("id")),
        "webVideoUrl": clean_text(item.get("webVideoUrl")),
        "text": text,
        "destinationName": destination_name,
        "destinationAddress": destination_address,
        "parsedDestinationName": parsed_name,
        "parsedLocation": parsed_location,
        "finalDestination": destination,
        "finalLocation": location,
        "placeString": place_string,
        "contentCategory": clean_text(item.get("contentCategory")),
        "searchQuery": clean_text(item.get("searchQuery")),
    }
    return place_string, details


def main() -> None:
    args = parse_args()
    input_path = Path(args.input_json)
    payload = json.loads(input_path.read_text(encoding="utf-8"))
    if not isinstance(payload, list):
        raise SystemExit(f"Expected array in {input_path}")

    place_strings: list[str] = []
    details: list[dict[str, Any]] = []
    seen: set[str] = set()

    for item in payload:
        if not isinstance(item, dict):
            continue
        place_string, detail = choose_place_string(item)
        if not place_string:
            continue
        key = place_string.lower().strip()
        if key in seen:
            continue
        seen.add(key)
        place_strings.append(place_string)
        details.append(detail)

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    array_path = output_dir / f"tiktok_destination_location_array_{timestamp}.json"
    details_path = output_dir / f"tiktok_destination_location_details_{timestamp}.json"
    meta_path = output_dir / f"tiktok_destination_location_array_{timestamp}.meta.json"

    array_path.write_text(json.dumps(place_strings, ensure_ascii=False, indent=2), encoding="utf-8")
    details_path.write_text(json.dumps(details, ensure_ascii=False, indent=2), encoding="utf-8")
    meta = {
        "inputFile": str(input_path),
        "recordCount": len(place_strings),
        "generatedAt": datetime.now().astimezone().isoformat(),
        "outputFiles": {
            "array": str(array_path),
            "details": str(details_path),
        },
    }
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"Array items: {len(place_strings)}")
    print(f"Array JSON: {array_path}")
    print(f"Details JSON: {details_path}")
    print(f"Metadata: {meta_path}")


if __name__ == "__main__":
    main()
