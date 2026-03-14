from __future__ import annotations

"""Combine Reddit scrape outputs into one deduplicated export."""

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from run_reddit_scraper import normalize_for_json, write_csv


OUTPUT_DIR = Path("output")
COMBINED_BASENAME = "reddit_scrape_combined"


def load_items(path: Path) -> list[dict[str, Any]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, list):
        raise ValueError(f"Expected JSON array in {path}")
    return [item for item in payload if isinstance(item, dict)]


def dedupe_key(item: dict[str, Any]) -> str:
    item_id = str(item.get("id") or "").strip()
    permalink = str(item.get("permalink") or "").strip()
    if item_id:
        return item_id
    if permalink:
        return permalink
    return json.dumps(normalize_for_json(item), ensure_ascii=False, sort_keys=True)


def combine_outputs() -> tuple[list[dict[str, Any]], dict[str, Any]]:
    combined: list[dict[str, Any]] = []
    seen: set[str] = set()
    source_counts: dict[str, int] = {}
    duplicate_count = 0

    json_files = sorted(
        path
        for path in OUTPUT_DIR.glob("reddit_scrape_*.json")
        if not path.name.endswith(".meta.json")
        and COMBINED_BASENAME not in path.name
    )

    for path in json_files:
        kept = 0
        for item in load_items(path):
            key = dedupe_key(item)
            if key in seen:
                duplicate_count += 1
                continue
            seen.add(key)
            enriched = dict(item)
            enriched["sourceFile"] = path.name
            combined.append(enriched)
            kept += 1
        source_counts[path.name] = kept

    meta = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "itemCount": len(combined),
        "duplicateCount": duplicate_count,
        "sourceCounts": source_counts,
    }
    return combined, meta


def main() -> None:
    items, meta = combine_outputs()

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
