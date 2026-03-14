from __future__ import annotations

"""Combine existing output datasets into one Melbourne-focused export."""

import json
from datetime import datetime
from pathlib import Path
from typing import Any

from run_apify_tiktok import (
    categorize_item,
    extract_destination_fields,
    normalize_for_json,
    write_csv,
)


OUTPUT_DIR = Path("output")
COMBINED_BASENAME = "apify_tiktok_melbourne_combined"


def load_json_items(path: Path) -> list[dict[str, Any]]:
    """Load a JSON array from disk."""
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, list):
        raise ValueError(f"Expected a JSON array in {path}")
    return [item for item in payload if isinstance(item, dict)]


def has_melbourne_location(item: dict[str, Any]) -> bool:
    """Require Melbourne to appear in the explicit location fields only."""
    location = item.get("locationMeta")
    if not isinstance(location, dict):
        return False
    searchable = " ".join(
        str(location.get(key, "")).strip().lower()
        for key in ("locationName", "address", "city")
    )
    return "melbourne" in searchable


def enrich_legacy_item(item: dict[str, Any], source_file: str) -> dict[str, Any]:
    """Add the normalized fields used by the newer runner output."""
    enriched = dict(item)
    enriched.update(extract_destination_fields(enriched))
    if "contentCategory" not in enriched or not enriched["contentCategory"]:
        enriched["contentCategory"] = categorize_item(enriched)
    enriched["sourceFile"] = source_file
    return enriched


def combine_datasets() -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Combine current Melbourne runs with Melbourne-only legacy items."""
    combined: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    source_counts: dict[str, int] = {}
    duplicate_count = 0
    legacy_filtered_out = 0

    json_files = sorted(
        path
        for path in OUTPUT_DIR.glob("*.json")
        if not path.name.endswith(".meta.json")
        and COMBINED_BASENAME not in path.name
    )

    for path in json_files:
        items = load_json_items(path)
        kept_for_file = 0
        for item in items:
            if path.name.startswith("apify_run_"):
                if not has_melbourne_location(item):
                    legacy_filtered_out += 1
                    continue
                item = enrich_legacy_item(item, path.name)
            else:
                item = dict(item)
                item["sourceFile"] = path.name

            item_id = str(item.get("id", "")).strip()
            dedupe_key = item_id or item.get("webVideoUrl") or json.dumps(
                normalize_for_json(item),
                ensure_ascii=False,
                sort_keys=True,
            )
            if dedupe_key in seen_ids:
                duplicate_count += 1
                continue

            seen_ids.add(dedupe_key)
            kept_for_file += 1
            combined.append(item)

        source_counts[path.name] = kept_for_file

    meta = {
        "generatedAt": datetime.now().isoformat(),
        "outputFileBase": COMBINED_BASENAME,
        "itemCount": len(combined),
        "sourceCounts": source_counts,
        "duplicateCount": duplicate_count,
        "legacyFilteredOutCount": legacy_filtered_out,
    }
    return combined, meta


def main() -> None:
    """Write the combined Melbourne dataset in JSON, CSV, and metadata form."""
    items, meta = combine_datasets()

    json_path = OUTPUT_DIR / f"{COMBINED_BASENAME}.json"
    csv_path = OUTPUT_DIR / f"{COMBINED_BASENAME}.csv"
    meta_path = OUTPUT_DIR / f"{COMBINED_BASENAME}.meta.json"

    json_path.write_text(
        json.dumps(normalize_for_json(items), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    write_csv(items, csv_path)
    meta_path.write_text(
        json.dumps(normalize_for_json(meta), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print(f"Combined items: {len(items)}")
    print(f"JSON: {json_path}")
    print(f"CSV: {csv_path}")
    print(f"Metadata: {meta_path}")


if __name__ == "__main__":
    main()
