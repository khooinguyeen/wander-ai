from __future__ import annotations

"""Download dataset output from an existing Apify actor run.

This script is the non-paid recovery path: it does not start a new scrape.
Instead, it looks up a previously completed or running Apify run by `run_id`,
resolves the run's default dataset, and saves the dataset locally as JSON/CSV.
"""

import argparse
import csv
import json
import os
from datetime import datetime
from pathlib import Path
from typing import Any

from apify_client import ApifyClient
from dotenv import load_dotenv


def parse_args() -> argparse.Namespace:
    """Parse command-line options for downloading an existing run.

    Returns:
        argparse.Namespace: Parsed CLI options containing the target run ID and
        output directory.
    """
    parser = argparse.ArgumentParser(
        description="Download dataset items from an existing Apify actor run without starting a new run."
    )
    parser.add_argument("run_id", help="Existing Apify run ID.")
    parser.add_argument(
        "--output-dir",
        default="output",
        help="Directory where downloaded files will be stored.",
    )
    return parser.parse_args()


def normalize_for_json(value: Any) -> Any:
    """Recursively convert API values into JSON-serializable data.

    Parameters:
        value: Any value returned by the Apify client for run metadata or
            dataset items.

    Returns:
        A JSON-safe structure. This avoids failures when Apify returns Python
        `datetime` instances for fields like `startedAt` or `finishedAt`.
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


def flatten_value(value: Any) -> str | int | float | bool | None:
    """Convert nested values into CSV-safe scalar strings.

    Parameters:
        value: A dataset value returned by Apify.

    Returns:
        A scalar CSV cell value. Complex structures are serialized to JSON
        strings so no information is discarded during export.
    """
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, datetime):
        return value.isoformat()
    return json.dumps(normalize_for_json(value), ensure_ascii=False)


def write_csv(items: list[dict[str, Any]], path: Path) -> None:
    """Write dataset items to CSV using the union of all discovered keys.

    Parameters:
        items: Dataset records returned for the existing run.
        path: Destination CSV file path.

    The actor output schema can vary between items, so the header is built from
    every key seen across the entire dataset before rows are written.
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


def main() -> None:
    """Fetch an existing Apify run and export its dataset locally.

    The script reads `APIFY_TOKEN`, fetches the run specified by `run_id`,
    checks that the run has a `defaultDatasetId`, downloads that dataset, and
    writes metadata, JSON, and CSV files under the requested output directory.
    """
    load_dotenv()
    args = parse_args()

    token = os.environ.get("APIFY_TOKEN", "").strip()
    if not token:
        raise SystemExit("Missing APIFY_TOKEN in .env or environment.")

    client = ApifyClient(token)
    run = client.run(args.run_id).get()
    if not run:
        raise SystemExit(f"Run not found: {args.run_id}")

    dataset_id = run.get("defaultDatasetId")
    if not dataset_id:
        raise SystemExit(f"Run {args.run_id} has no default dataset: {run}")

    # Download the existing run output only; this does not start a new actor run.
    # `clean=True` strips some Apify-specific envelope fields from each item.
    items = list(client.dataset(dataset_id).list_items(clean=True).items)

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

    meta = {
        "runId": args.run_id,
        "actorId": run.get("actId"),
        "status": run.get("status"),
        "defaultDatasetId": dataset_id,
        "itemCount": len(items),
        "startedAt": run.get("startedAt"),
        "finishedAt": run.get("finishedAt"),
    }

    meta_path = output_dir / f"apify_run_{args.run_id}_{timestamp}.meta.json"
    json_path = output_dir / f"apify_run_{args.run_id}_{timestamp}.json"
    csv_path = output_dir / f"apify_run_{args.run_id}_{timestamp}.csv"

    meta_path.write_text(json.dumps(normalize_for_json(meta), ensure_ascii=False, indent=2), encoding="utf-8")
    json_path.write_text(json.dumps(normalize_for_json(items), ensure_ascii=False, indent=2), encoding="utf-8")
    write_csv(items, csv_path)

    print(f"Run ID: {args.run_id}")
    print(f"Dataset ID: {dataset_id}")
    print(f"Items saved: {len(items)}")
    print(f"Metadata: {meta_path}")
    print(f"JSON: {json_path}")
    print(f"CSV: {csv_path}")


if __name__ == "__main__":
    main()
