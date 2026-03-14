from __future__ import annotations

"""Reduce Reddit scrape output to core post content plus comments."""

import argparse
import csv
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Keep only essential post fields and nested comments from a Reddit scrape JSON file."
    )
    parser.add_argument("input_json", help="Path to the Reddit scrape JSON file.")
    parser.add_argument(
        "--output-dir",
        default="output",
        help="Directory for cleaned outputs.",
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


def clean_comment(comment: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": comment.get("id"),
        "author": comment.get("author"),
        "body": comment.get("body"),
        "created_utc": comment.get("created_utc"),
        "created_iso": comment.get("created_iso"),
        "score": comment.get("score"),
        "parent_id": comment.get("parent_id"),
        "link_id": comment.get("link_id"),
        "permalink": comment.get("permalink"),
    }


def clean_post(post: dict[str, Any]) -> dict[str, Any]:
    comments = post.get("comments")
    cleaned_comments = []
    if isinstance(comments, list):
        cleaned_comments = [clean_comment(comment) for comment in comments if isinstance(comment, dict)]

    return {
        "id": post.get("id"),
        "title": post.get("title"),
        "selftext": post.get("selftext"),
        "subreddit": post.get("subreddit"),
        "author": post.get("author"),
        "created_utc": post.get("created_utc"),
        "created_iso": post.get("created_iso"),
        "score": post.get("score"),
        "num_comments": post.get("num_comments"),
        "commentsFetchedCount": post.get("commentsFetchedCount"),
        "permalink": post.get("permalink"),
        "url": post.get("url"),
        "searchQuery": post.get("searchQuery"),
        "searchSubreddit": post.get("searchSubreddit"),
        "comments": cleaned_comments,
    }


def main() -> None:
    args = parse_args()
    input_path = Path(args.input_json)
    payload = json.loads(input_path.read_text(encoding="utf-8"))
    if not isinstance(payload, list):
        raise SystemExit(f"Expected JSON array in {input_path}")

    cleaned = [clean_post(item) for item in payload if isinstance(item, dict)]

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    json_path = output_dir / f"reddit_posts_with_comments_{timestamp}.json"
    csv_path = output_dir / f"reddit_posts_with_comments_{timestamp}.csv"
    meta_path = output_dir / f"reddit_posts_with_comments_{timestamp}.meta.json"

    meta = {
        "inputFile": str(input_path),
        "postCount": len(cleaned),
        "postsWithComments": sum(1 for item in cleaned if item.get("comments")),
        "commentCount": sum(len(item.get("comments", [])) for item in cleaned),
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

    print(f"Posts saved: {len(cleaned)}")
    print(f"JSON: {json_path}")
    print(f"CSV: {csv_path}")
    print(f"Metadata: {meta_path}")


if __name__ == "__main__":
    main()
