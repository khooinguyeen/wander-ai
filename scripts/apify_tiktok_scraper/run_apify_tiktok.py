from __future__ import annotations

"""Start a new Apify TikTok actor run and save the resulting dataset locally.

This script is the paid path: it triggers a fresh actor run using a
Melbourne-only search input, waits for the run to finish, then downloads the
run's default dataset and saves the filtered dataset as JSON and CSV.
"""

import argparse
import csv
import json
import os
import time
from datetime import datetime
from pathlib import Path
from typing import Any

from apify_client import ApifyClient
from dotenv import load_dotenv


MELBOURNE_QUERY_GROUPS: dict[str, list[str]] = {
    "food_drink": [
        "food review",
        "restaurant review",
        "cafe review",
        "brunch review",
        "breakfast guide",
        "lunch recommendation",
        "dinner recommendation",
        "dessert guide",
        "bakery guide",
        "coffee guide",
        "matcha guide",
        "cocktail bar review",
        "wine bar review",
        "bar recommendation",
        "drinks guide",
        "hidden gem food",
        "must try food",
        "cheap eats guide",
        "fine dining review",
        "date night restaurant",
    ],
    "entertainment": [
        "entertainment guide",
        "things to do",
        "weekend guide",
        "date night guide",
        "nightlife guide",
        "live music guide",
        "comedy club review",
        "cinema guide",
        "arcade review",
        "rooftop bar guide",
        "exhibition guide",
        "festival guide",
    ],
    "shopping": [
        "shopping guide",
        "shopping recommendation",
        "boutique review",
        "vintage shopping guide",
        "op shop guide",
        "market guide",
        "bookstore guide",
        "gift shop guide",
        "homewares shopping guide",
        "beauty shopping guide",
        "fashion shopping guide",
        "mall guide",
    ],
}

MELBOURNE_QUERY_PREFIXES: list[str] = [
    "Melbourne",
    "Melbourne CBD",
    "inner Melbourne",
]

MELBOURNE_KEYWORDS: tuple[str, ...] = (
    "melbourne",
    "melb",
    "victoria",
    "vic",
    "yarra",
    "fitzroy",
    "collingwood",
    "richmond",
    "carlton",
    "brunswick",
    "south yarra",
    "prahran",
    "st kilda",
    "docklands",
    "footscray",
    "hawthorn",
    "camberwell",
    "southbank",
    "northcote",
    "flemington",
    "coburg",
    "preston",
    "moonee ponds",
)

TARGET_CONTENT_KEYWORDS: dict[str, tuple[str, ...]] = {
    "food_drink": (
        "food",
        "drink",
        "restaurant",
        "cafe",
        "brunch",
        "breakfast",
        "lunch",
        "dinner",
        "dessert",
        "bakery",
        "coffee",
        "matcha",
        "cocktail",
        "bar",
        "wine",
        "brewery",
        "eat",
        "eats",
        "review",
        "recommendation",
        "guide",
    ),
    "entertainment": (
        "entertainment",
        "things to do",
        "date night",
        "nightlife",
        "live music",
        "comedy",
        "cinema",
        "arcade",
        "rooftop",
        "exhibition",
        "festival",
        "event",
        "guide",
        "review",
    ),
    "shopping": (
        "shopping",
        "shop",
        "boutique",
        "market",
        "mall",
        "store",
        "bookstore",
        "op shop",
        "vintage",
        "fashion",
        "beauty",
        "homewares",
        "gift",
        "review",
        "recommendation",
        "guide",
    ),
}


def build_search_queries() -> list[str]:
    """Build a broad Melbourne-only search list for the actor input."""
    queries: list[str] = []
    for prefix in MELBOURNE_QUERY_PREFIXES:
        for phrases in MELBOURNE_QUERY_GROUPS.values():
            for phrase in phrases:
                query = f"{prefix} {phrase}"
                if query not in queries:
                    queries.append(query)
    return queries


DEFAULT_ACTOR_INPUT: dict[str, Any] = {
    "searchQueries": build_search_queries(),
    "searchSection": "/video",
    "resultsPerPage": 100,
    "searchSorting": "0",
    "commentsPerPost": 50,
    "maxRepliesPerComment": 10,
    "proxyCountryCode": "AU",
    "shouldDownloadVideos": False,
    "shouldDownloadCovers": False,
    "shouldDownloadSlideshowImages": False,
    "shouldDownloadAvatars": False,
    "shouldDownloadMusicCovers": False,
}


def parse_args() -> argparse.Namespace:
    """Parse command-line options for launching a new actor run.

    Returns:
        argparse.Namespace: Parsed CLI options including output directory,
        actor override, timeout, and optional memory override.
    """
    parser = argparse.ArgumentParser(
        description="Run an Apify TikTok actor and save dataset results locally."
    )
    parser.add_argument(
        "--output-dir",
        default="output",
        help="Directory where run outputs will be stored.",
    )
    parser.add_argument(
        "--actor-id",
        default="",
        help="Override the actor ID from .env.",
    )
    parser.add_argument(
        "--timeout-secs",
        type=int,
        default=3600,
        help="Maximum time to wait for the actor run to finish.",
    )
    parser.add_argument(
        "--memory-mbytes",
        type=int,
        default=0,
        help="Optional memory override for the actor run.",
    )
    parser.add_argument(
        "--poll-secs",
        type=int,
        default=20,
        help="Seconds between local checkpoint polls while the actor is running.",
    )
    return parser.parse_args()


def normalize_text(value: Any) -> str:
    """Convert a value to lowercase text for keyword checks."""
    if value is None:
        return ""
    return str(value).strip().lower()


def contains_any_keyword(text: str, keywords: tuple[str, ...]) -> bool:
    """Return True when any keyword is present in the given text."""
    return any(keyword in text for keyword in keywords)


def extract_hashtag_names(item: dict[str, Any]) -> list[str]:
    """Extract hashtag names from the actor payload."""
    hashtags = item.get("hashtags")
    if not isinstance(hashtags, list):
        return []
    names: list[str] = []
    for hashtag in hashtags:
        if isinstance(hashtag, dict):
            name = normalize_text(hashtag.get("name"))
            if name:
                names.append(name)
    return names


def extract_destination_fields(item: dict[str, Any]) -> dict[str, Any]:
    """Expose destination fields directly from nested actor output."""
    location = item.get("locationMeta") if isinstance(item.get("locationMeta"), dict) else {}
    detailed_mentions = item.get("detailedMentions")
    first_mention = detailed_mentions[0] if isinstance(detailed_mentions, list) and detailed_mentions else {}
    if not isinstance(first_mention, dict):
        first_mention = {}

    destination_name = (
        location.get("locationName")
        or first_mention.get("nickName")
        or first_mention.get("name")
        or ""
    )
    destination_address = location.get("address") or ""
    destination_city = location.get("city") or ""

    source = ""
    if location.get("locationName"):
        source = "locationMeta"
    elif first_mention.get("nickName") or first_mention.get("name"):
        source = "detailedMentions"

    return {
        "destinationName": destination_name,
        "destinationAddress": destination_address,
        "destinationCity": destination_city,
        "destinationSource": source,
    }


def categorize_item(item: dict[str, Any]) -> str:
    """Assign the best matching target category to a dataset item."""
    searchable_parts = [
        normalize_text(item.get("text")),
        normalize_text(item.get("searchQuery")),
        normalize_text(item.get("destinationName")),
        normalize_text(item.get("destinationAddress")),
        normalize_text(item.get("destinationCity")),
        " ".join(extract_hashtag_names(item)),
    ]
    searchable_text = " ".join(part for part in searchable_parts if part)
    for category, keywords in TARGET_CONTENT_KEYWORDS.items():
        if contains_any_keyword(searchable_text, keywords):
            return category
    return ""


def is_melbourne_item(item: dict[str, Any]) -> tuple[bool, list[str]]:
    """Check whether an item is Melbourne-related using multiple signals."""
    reasons: list[str] = []
    searchable_fields = {
        "searchQuery": item.get("searchQuery"),
        "text": item.get("text"),
        "destinationName": item.get("destinationName"),
        "destinationAddress": item.get("destinationAddress"),
        "destinationCity": item.get("destinationCity"),
    }
    for field_name, value in searchable_fields.items():
        text = normalize_text(value)
        if text and contains_any_keyword(text, MELBOURNE_KEYWORDS):
            reasons.append(field_name)

    author_meta = item.get("authorMeta")
    if isinstance(author_meta, dict):
        for field_name in ("signature", "nickName"):
            text = normalize_text(author_meta.get(field_name))
            if text and contains_any_keyword(text, MELBOURNE_KEYWORDS):
                reasons.append(f"authorMeta.{field_name}")

    hashtag_text = " ".join(extract_hashtag_names(item))
    if hashtag_text and contains_any_keyword(hashtag_text, MELBOURNE_KEYWORDS):
        reasons.append("hashtags")

    return bool(reasons), reasons


def enrich_and_filter_items(items: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Keep only Melbourne target content and expose destination columns."""
    filtered: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    rejected_non_melbourne = 0
    rejected_non_target = 0
    duplicate_count = 0

    for item in items:
        enriched = dict(item)
        enriched.update(extract_destination_fields(enriched))
        is_melbourne, melbourne_reasons = is_melbourne_item(enriched)
        if not is_melbourne:
            rejected_non_melbourne += 1
            continue

        content_category = categorize_item(enriched)
        if not content_category:
            rejected_non_target += 1
            continue

        item_id = str(enriched.get("id", "")).strip()
        if item_id and item_id in seen_ids:
            duplicate_count += 1
            continue
        if item_id:
            seen_ids.add(item_id)

        enriched["contentCategory"] = content_category
        enriched["melbourneMatchReasons"] = melbourne_reasons
        filtered.append(enriched)

    summary = {
        "rawItemCount": len(items),
        "filteredItemCount": len(filtered),
        "rejectedNonMelbourneCount": rejected_non_melbourne,
        "rejectedNonTargetCount": rejected_non_target,
        "duplicateCount": duplicate_count,
    }
    return filtered, summary


def flatten_value(value: Any) -> str | int | float | bool | None:
    """Convert nested values into CSV-safe scalar strings.

    Parameters:
        value: A dataset value returned by Apify. This may be a primitive,
            datetime, list, or nested dictionary.

    Returns:
        A scalar value suitable for CSV writing. Complex values are serialized
        to JSON strings so they fit into a single CSV cell.
    """
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, datetime):
        return value.isoformat()
    return json.dumps(value, ensure_ascii=False)


def normalize_for_json(value: Any) -> Any:
    """Recursively convert non-JSON-native values into serializable ones.

    Parameters:
        value: Any Python object returned from the Apify client.

    Returns:
        A JSON-serializable structure. Datetimes become ISO 8601 strings and
        unknown objects fall back to `str(value)` to avoid export failures.
    """
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, list):
        return [normalize_for_json(item) for item in value]
    if isinstance(value, dict):
        return {key: normalize_for_json(item) for key, item in value.items()}
    return str(value)


def write_csv(items: list[dict[str, Any]], path: Path) -> None:
    """Write dataset items to CSV using the union of all discovered keys.

    Parameters:
        items: Dataset records returned by the Apify actor.
        path: Destination CSV file path.

    The actor can return items with slightly different shapes, so this function
    first builds a complete header from every key seen across all rows.
    """
    # Build a stable header from the union of keys returned by the dataset items.
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


def write_outputs(
    *,
    items: list[dict[str, Any]],
    meta: dict[str, Any],
    meta_path: Path,
    json_path: Path,
    csv_path: Path,
) -> None:
    """Write metadata, JSON, and CSV files for the current snapshot."""
    meta_path.write_text(
        json.dumps(normalize_for_json(meta), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    json_path.write_text(
        json.dumps(normalize_for_json(items), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    write_csv(items, csv_path)


def checkpoint_outputs(
    *,
    run_id: str,
    actor_id: str,
    dataset_id: str,
    run_input: dict[str, Any],
    raw_items: list[dict[str, Any]],
    run_snapshot: dict[str, Any],
    meta_path: Path,
    json_path: Path,
    csv_path: Path,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Persist a checkpoint of the current run state and filtered items."""
    items, filter_summary = enrich_and_filter_items(raw_items)
    run_meta = {
        "actorId": actor_id,
        "runId": run_id,
        "status": run_snapshot.get("status"),
        "statusMessage": run_snapshot.get("statusMessage"),
        "defaultDatasetId": dataset_id,
        "itemCount": len(items),
        "rawItemCount": len(raw_items),
        "finishedAt": run_snapshot.get("finishedAt"),
        "startedAt": run_snapshot.get("startedAt"),
        "input": run_input,
        "filterSummary": filter_summary,
        "checkpointedAt": datetime.now().isoformat(),
    }
    write_outputs(
        items=items,
        meta=run_meta,
        meta_path=meta_path,
        json_path=json_path,
        csv_path=csv_path,
    )
    return items, run_meta


def log_progress(message: str) -> None:
    """Print progress messages immediately so polling does not look frozen."""
    timestamp = datetime.now().strftime("%H:%M:%S")
    print(f"[{timestamp}] {message}", flush=True)


def main() -> None:
    """Run the actor, download its dataset, and write local export files.

    The script reads `APIFY_TOKEN` and `APIFY_ACTOR_ID` from the environment,
    starts a new actor run with `DEFAULT_ACTOR_INPUT`, checkpoints partial
    dataset results while the run is in progress, then saves final outputs.
    """
    load_dotenv()
    args = parse_args()

    token = os.environ.get("APIFY_TOKEN", "").strip()
    actor_id = args.actor_id or os.environ.get("APIFY_ACTOR_ID", "").strip()
    if not token:
        raise SystemExit("Missing APIFY_TOKEN in .env or environment.")
    if not actor_id:
        raise SystemExit("Missing APIFY_ACTOR_ID in .env or --actor-id.")
    run_input = DEFAULT_ACTOR_INPUT
    client = ApifyClient(token)
    actor_client = client.actor(actor_id)

    # `start()` lets us checkpoint partial output instead of waiting for the end.
    start_kwargs: dict[str, Any] = {
        "run_input": run_input,
    }
    if args.memory_mbytes > 0:
        start_kwargs["memory_mbytes"] = args.memory_mbytes

    run = actor_client.start(**start_kwargs)
    if run is None:
        raise SystemExit("Actor run did not return a run object.")

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    run_id = str(run.get("id") or "").strip()
    if not run_id:
        raise SystemExit(f"Actor run did not include an id: {run}")
    log_progress(f"Run started: {run_id}")

    checkpoint_prefix = f"apify_tiktok_run_{run_id}_checkpoint"
    checkpoint_meta_path = output_dir / f"{checkpoint_prefix}.meta.json"
    checkpoint_json_path = output_dir / f"{checkpoint_prefix}.json"
    checkpoint_csv_path = output_dir / f"{checkpoint_prefix}.csv"

    raw_items: list[dict[str, Any]] = []
    dataset_offset = 0
    dataset_id = str(run.get("defaultDatasetId") or "").strip()
    final_run: dict[str, Any] = dict(run)
    deadline = time.time() + args.timeout_secs

    while True:
        if time.time() > deadline:
            raise SystemExit(
                f"Timed out after {args.timeout_secs} seconds. "
                f"Latest checkpoint remains at {checkpoint_json_path}"
            )

        latest_run = client.run(run_id).get()
        if latest_run:
            final_run = latest_run

        status = str(final_run.get("status") or "UNKNOWN").upper()
        status_message = str(final_run.get("statusMessage") or "").strip()

        if not dataset_id:
            dataset_id = str(final_run.get("defaultDatasetId") or "").strip()
            if dataset_id:
                log_progress(f"Dataset available: {dataset_id}")

        if status_message:
            log_progress(
                f"Run status: {status} | raw items: {len(raw_items)} | {status_message}"
            )
        else:
            log_progress(f"Run status: {status} | raw items: {len(raw_items)}")

        if dataset_id:
            page = client.dataset(dataset_id).list_items(
                offset=dataset_offset,
                limit=1000,
                clean=True,
            )
            new_items = list(page.items)
            if new_items:
                raw_items.extend(new_items)
                dataset_offset += len(new_items)
                filtered_items, _ = checkpoint_outputs(
                    run_id=run_id,
                    actor_id=actor_id,
                    dataset_id=dataset_id,
                    run_input=run_input,
                    raw_items=raw_items,
                    run_snapshot=final_run,
                    meta_path=checkpoint_meta_path,
                    json_path=checkpoint_json_path,
                    csv_path=checkpoint_csv_path,
                )
                log_progress(
                    "Fetched "
                    f"{len(new_items)} new items, total raw items {len(raw_items)}, "
                    f"filtered items {len(filtered_items)}. "
                    f"Checkpoint saved to {checkpoint_json_path}"
                )
            else:
                log_progress("No new items yet. Waiting for next poll.")

        if status in {"SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"}:
            log_progress(f"Run finished with status {status}.")
            break

        log_progress(f"Sleeping {max(args.poll_secs, 1)} seconds before next poll.")
        time.sleep(max(args.poll_secs, 1))

    if not dataset_id:
        raise SystemExit(f"Actor run finished without a default dataset: {final_run}")

    items, run_meta = checkpoint_outputs(
        run_id=run_id,
        actor_id=actor_id,
        dataset_id=dataset_id,
        run_input=run_input,
        raw_items=raw_items,
        run_snapshot=final_run,
        meta_path=checkpoint_meta_path,
        json_path=checkpoint_json_path,
        csv_path=checkpoint_csv_path,
    )

    meta_path = output_dir / f"apify_tiktok_run_{timestamp}.meta.json"
    json_path = output_dir / f"apify_tiktok_run_{timestamp}.json"
    csv_path = output_dir / f"apify_tiktok_run_{timestamp}.csv"
    write_outputs(
        items=items,
        meta=run_meta,
        meta_path=meta_path,
        json_path=json_path,
        csv_path=csv_path,
    )

    print(f"Run ID: {run_id}")
    print(f"Dataset ID: {dataset_id}")
    print(f"Raw items fetched: {len(raw_items)}")
    print(f"Filtered Melbourne items saved: {len(items)}")
    print(f"Checkpoint metadata: {checkpoint_meta_path}")
    print(f"Checkpoint JSON: {checkpoint_json_path}")
    print(f"Checkpoint CSV: {checkpoint_csv_path}")
    print(f"Metadata: {meta_path}")
    print(f"JSON: {json_path}")
    print(f"CSV: {csv_path}")


if __name__ == "__main__":
    main()
