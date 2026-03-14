from __future__ import annotations

"""Scrape Reddit submissions using the official API, Pushshift, or both."""

import argparse
import csv
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv


OFFICIAL_TOKEN_URL = "https://www.reddit.com/api/v1/access_token"
OFFICIAL_SEARCH_URL = "https://oauth.reddit.com"
PUSHSHIFT_SEARCH_URL = "https://api.pushshift.io/reddit/search/submission/"
PULLPUSH_SEARCH_URL = "https://api.pullpush.io/reddit/search/submission/"

MELBOURNE_PRESET_QUERIES: list[str] = [
    "Melbourne restaurant recommendations",
    "Melbourne cafe recommendations",
    "Melbourne bar recommendations",
    "Melbourne brunch recommendations",
    "Melbourne coffee recommendations",
    "Melbourne cheap eats recommendations",
    "Melbourne food reviews",
    "Melbourne drink reviews",
    "Melbourne entertainment recommendations",
    "Melbourne things to do recommendations",
    "Melbourne live music recommendations",
    "Melbourne nightlife suggestions",
    "Melbourne shopping recommendations",
    "Melbourne market recommendations",
    "Melbourne boutique recommendations",
    "Melbourne vintage shopping recommendations",
]

MELBOURNE_PRESET_SUBREDDITS: list[str] = [
    "melbourne",
]

MELBOURNE_LOCATION_KEYWORDS: tuple[str, ...] = (
    "melbourne",
    "melb",
    "victoria",
    "vic",
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
)

PLACE_INTENT_KEYWORDS: tuple[str, ...] = (
    "food",
    "drink",
    "restaurant",
    "cafe",
    "coffee",
    "brunch",
    "bar",
    "cocktail",
    "pub",
    "brewery",
    "wine bar",
    "shopping",
    "shop",
    "market",
    "boutique",
    "store",
    "mall",
    "bookstore",
    "vintage",
    "op shop",
    "entertainment",
    "nightlife",
    "live music",
    "gig",
    "festival",
    "event",
    "things to do",
    "cinema",
    "arcade",
    "rooftop",
    "guide",
    "recommend",
    "recommendation",
    "review",
    "hidden gem",
    "must try",
)

RECOMMENDATION_INTENT_KEYWORDS: tuple[str, ...] = (
    "recommend",
    "recommendation",
    "recommendations",
    "review",
    "reviews",
    "suggest",
    "suggestion",
    "suggestions",
    "best",
    "good",
    "worth it",
    "must try",
    "hidden gem",
    "where should",
    "where can",
    "where to go",
    "where to eat",
    "what should i do",
    "things to do",
    "any good",
    "looking for",
)

EXCLUDED_SUBREDDITS: set[str] = {
    "bdsmpersonals",
    "r4r",
    "dirtyr4r",
    "foreveralonedating",
    "melbourneclassifieds",
    "melbournejobs",
    "melbournerealestate",
}

EXCLUDED_TEXT_KEYWORDS: tuple[str, ...] = (
    "m4f",
    "f4m",
    "r4r",
    "domme",
    "sub looking",
    "relationship",
    "dating",
    "roommate",
    "housemate",
    "lease transfer",
    "job opening",
    "hiring",
    "for sale",
    "selling",
    "wtb",
    "wts",
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Scrape Reddit submissions from the official API, Pushshift, or both."
    )
    parser.add_argument(
        "--source",
        choices=("reddit", "pushshift", "pullpush", "both"),
        default="both",
        help="Source to query.",
    )
    parser.add_argument(
        "--query",
        default="",
        help="Search query.",
    )
    parser.add_argument(
        "--preset",
        choices=("melbourne_lifestyle",),
        default="",
        help="Use a built-in multi-query preset instead of a single query.",
    )
    parser.add_argument(
        "--subreddit",
        default="",
        help="Optional subreddit filter.",
    )
    parser.add_argument(
        "--sort",
        default="new",
        choices=("relevance", "hot", "top", "new", "comments"),
        help="Official API sort order.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=100,
        help="Maximum number of items to request per source.",
    )
    parser.add_argument(
        "--output-dir",
        default="output",
        help="Directory for JSON/CSV/meta exports.",
    )
    parser.add_argument(
        "--include-comments",
        action="store_true",
        help="Fetch comments for each submission when supported by the source.",
    )
    parser.add_argument(
        "--max-comments-per-post",
        type=int,
        default=0,
        help="Optional cap on fetched comments per post. Use 0 for no explicit cap.",
    )
    parser.add_argument(
        "--comment-retry-secs",
        type=int,
        default=15,
        help="Seconds to wait before retrying PullPush comment requests after rate limiting.",
    )
    parser.add_argument(
        "--filter-melbourne-places",
        action="store_true",
        help="Keep only Melbourne place/activity/shopping related posts and remove generic chatter.",
    )
    parser.add_argument(
        "--only-with-comments",
        action="store_true",
        help="Keep only posts that have comments. With --include-comments, require fetched comment bodies.",
    )
    return parser.parse_args()


def resolve_queries(args: argparse.Namespace) -> list[str]:
    if args.preset == "melbourne_lifestyle":
        return MELBOURNE_PRESET_QUERIES
    query = args.query.strip()
    if query:
        return [query]
    raise SystemExit("Provide --query or use --preset melbourne_lifestyle.")


def resolve_subreddits(args: argparse.Namespace) -> list[str]:
    subreddit = args.subreddit.strip()
    if subreddit:
        return [subreddit]
    if args.preset == "melbourne_lifestyle":
        return MELBOURNE_PRESET_SUBREDDITS
    return [""]


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


def build_output_paths(output_dir: Path, timestamp: str) -> tuple[Path, Path, Path]:
    return (
        output_dir / f"reddit_scrape_{timestamp}.json",
        output_dir / f"reddit_scrape_{timestamp}.csv",
        output_dir / f"reddit_scrape_{timestamp}.meta.json",
    )


def build_checkpoint_paths(output_dir: Path, timestamp: str) -> tuple[Path, Path, Path]:
    return (
        output_dir / f"reddit_scrape_{timestamp}_checkpoint.json",
        output_dir / f"reddit_scrape_{timestamp}_checkpoint.csv",
        output_dir / f"reddit_scrape_{timestamp}_checkpoint.meta.json",
    )


def write_outputs(
    *,
    items: list[dict[str, Any]],
    meta: dict[str, Any],
    json_path: Path,
    csv_path: Path,
    meta_path: Path,
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


def log_progress(message: str) -> None:
    timestamp = datetime.now().strftime("%H:%M:%S")
    print(f"[{timestamp}] {message}", flush=True)


def normalize_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip().lower()


def contains_any_keyword(text: str, keywords: tuple[str, ...]) -> bool:
    return any(keyword in text for keyword in keywords)


def get_reddit_access_token() -> str:
    client_id = os.environ.get("REDDIT_CLIENT_ID", "").strip()
    client_secret = os.environ.get("REDDIT_CLIENT_SECRET", "").strip()
    username = os.environ.get("REDDIT_USERNAME", "").strip()
    password = os.environ.get("REDDIT_PASSWORD", "").strip()
    user_agent = os.environ.get("REDDIT_USER_AGENT", "").strip()

    missing = [
        name
        for name, value in {
            "REDDIT_CLIENT_ID": client_id,
            "REDDIT_CLIENT_SECRET": client_secret,
            "REDDIT_USERNAME": username,
            "REDDIT_PASSWORD": password,
            "REDDIT_USER_AGENT": user_agent,
        }.items()
        if not value
    ]
    if missing:
        raise SystemExit(f"Missing Reddit API env vars: {', '.join(missing)}")

    response = requests.post(
        OFFICIAL_TOKEN_URL,
        auth=(client_id, client_secret),
        data={
            "grant_type": "password",
            "username": username,
            "password": password,
        },
        headers={"User-Agent": user_agent},
        timeout=60,
    )
    response.raise_for_status()
    payload = response.json()
    token = payload.get("access_token", "")
    if not token:
        raise SystemExit(f"Reddit token response missing access_token: {payload}")
    return token


def normalize_official_item(post: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": post.get("id"),
        "title": post.get("title"),
        "selftext": post.get("selftext"),
        "subreddit": post.get("subreddit"),
        "author": post.get("author"),
        "created_utc": post.get("created_utc"),
        "created_iso": datetime.fromtimestamp(
            float(post.get("created_utc", 0)), tz=timezone.utc
        ).isoformat()
        if post.get("created_utc") is not None
        else "",
        "score": post.get("score"),
        "num_comments": post.get("num_comments"),
        "permalink": f"https://www.reddit.com{post.get('permalink', '')}",
        "url": post.get("url"),
        "over_18": post.get("over_18"),
        "is_self": post.get("is_self"),
        "link_flair_text": post.get("link_flair_text"),
        "source": "reddit",
        "searchQuery": "",
        "raw": post,
    }


def search_reddit_official(
    *,
    query: str,
    subreddit: str,
    sort: str,
    limit: int,
) -> list[dict[str, Any]]:
    token = get_reddit_access_token()
    user_agent = os.environ.get("REDDIT_USER_AGENT", "").strip()

    base_url = OFFICIAL_SEARCH_URL
    endpoint = f"/r/{subreddit}/search" if subreddit else "/search"
    response = requests.get(
        f"{base_url}{endpoint}",
        headers={
            "Authorization": f"bearer {token}",
            "User-Agent": user_agent,
        },
        params={
            "q": query,
            "sort": sort,
            "limit": min(limit, 100),
            "restrict_sr": bool(subreddit),
            "type": "link",
        },
        timeout=60,
    )
    response.raise_for_status()
    payload = response.json()
    children = payload.get("data", {}).get("children", [])
    items: list[dict[str, Any]] = []
    for child in children:
        data = child.get("data")
        if isinstance(data, dict):
            items.append(normalize_official_item(data))
    return items


def normalize_pushshift_item(post: dict[str, Any]) -> dict[str, Any]:
    created_utc = post.get("created_utc")
    created_iso = ""
    if created_utc is not None:
        created_iso = datetime.fromtimestamp(float(created_utc), tz=timezone.utc).isoformat()
    permalink = post.get("permalink") or ""
    if permalink and not permalink.startswith("http"):
        permalink = f"https://www.reddit.com{permalink}"

    return {
        "id": post.get("id"),
        "title": post.get("title"),
        "selftext": post.get("selftext"),
        "subreddit": post.get("subreddit"),
        "author": post.get("author"),
        "created_utc": created_utc,
        "created_iso": created_iso,
        "score": post.get("score"),
        "num_comments": post.get("num_comments"),
        "permalink": permalink,
        "url": post.get("full_link") or post.get("url"),
        "over_18": post.get("over_18"),
        "is_self": post.get("is_self"),
        "link_flair_text": post.get("link_flair_text"),
        "source": "pushshift",
        "searchQuery": "",
        "raw": post,
    }


def filter_melbourne_place_posts(items: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, int]]:
    filtered: list[dict[str, Any]] = []
    rejected_missing_location = 0
    rejected_missing_category = 0
    rejected_missing_recommendation_intent = 0
    rejected_excluded = 0

    for item in items:
        subreddit = normalize_text(item.get("subreddit"))
        title = normalize_text(item.get("title"))
        selftext = normalize_text(item.get("selftext"))
        permalink = normalize_text(item.get("permalink"))
        url = normalize_text(item.get("url"))
        flair = normalize_text(item.get("link_flair_text"))
        query = normalize_text(item.get("searchQuery"))
        searchable = " ".join(
            part for part in (title, selftext, permalink, url, flair, query, subreddit) if part
        )

        if subreddit in EXCLUDED_SUBREDDITS or contains_any_keyword(searchable, EXCLUDED_TEXT_KEYWORDS):
            rejected_excluded += 1
            continue

        if not contains_any_keyword(searchable, MELBOURNE_LOCATION_KEYWORDS):
            rejected_missing_location += 1
            continue

        if not contains_any_keyword(searchable, PLACE_INTENT_KEYWORDS):
            rejected_missing_category += 1
            continue

        if not contains_any_keyword(searchable, RECOMMENDATION_INTENT_KEYWORDS):
            rejected_missing_recommendation_intent += 1
            continue

        filtered.append(item)

    summary = {
        "filteredCount": len(filtered),
        "rejectedExcludedCount": rejected_excluded,
        "rejectedMissingLocationCount": rejected_missing_location,
        "rejectedMissingCategoryCount": rejected_missing_category,
        "rejectedMissingRecommendationIntentCount": rejected_missing_recommendation_intent,
    }
    return filtered, summary


def filter_only_with_comments(
    items: list[dict[str, Any]],
    *,
    require_fetched_comments: bool,
) -> tuple[list[dict[str, Any]], dict[str, int]]:
    filtered: list[dict[str, Any]] = []
    rejected_no_comments = 0

    for item in items:
        if require_fetched_comments:
            comments = item.get("comments")
            if isinstance(comments, list) and len(comments) > 0:
                filtered.append(item)
            else:
                rejected_no_comments += 1
            continue

        num_comments = item.get("num_comments")
        try:
            count = int(num_comments or 0)
        except (TypeError, ValueError):
            count = 0
        if count > 0:
            filtered.append(item)
        else:
            rejected_no_comments += 1

    summary = {
        "filteredCount": len(filtered),
        "rejectedNoCommentsCount": rejected_no_comments,
    }
    return filtered, summary


def normalize_comment(comment: dict[str, Any], *, source: str) -> dict[str, Any]:
    created_utc = comment.get("created_utc")
    created_iso = ""
    if created_utc is not None:
        created_iso = datetime.fromtimestamp(float(created_utc), tz=timezone.utc).isoformat()

    parent_id = str(comment.get("parent_id") or "")
    link_id = str(comment.get("link_id") or "")
    if parent_id.startswith("t1_") or parent_id.startswith("t3_"):
        parent_id = parent_id[3:]
    if link_id.startswith("t3_"):
        link_id = link_id[3:]

    return {
        "id": comment.get("id"),
        "author": comment.get("author"),
        "body": comment.get("body"),
        "created_utc": created_utc,
        "created_iso": created_iso,
        "score": comment.get("score"),
        "parent_id": parent_id,
        "link_id": link_id,
        "permalink": (
            f"https://www.reddit.com{comment.get('permalink', '')}"
            if comment.get("permalink")
            else ""
        ),
        "source": source,
        "raw": comment,
    }


def search_pushshift(
    *,
    query: str,
    subreddit: str,
    limit: int,
) -> list[dict[str, Any]]:
    params: dict[str, Any] = {
        "q": query,
        "size": min(limit, 500),
        "sort": "desc",
        "sort_type": "created_utc",
    }
    if subreddit:
        params["subreddit"] = subreddit

    response = requests.get(
        PUSHSHIFT_SEARCH_URL,
        params=params,
        headers={"User-Agent": "python:reddit_scraper:v1.0"},
        timeout=60,
    )
    response.raise_for_status()
    payload = response.json()
    data = payload.get("data", [])
    items: list[dict[str, Any]] = []
    for post in data:
        if isinstance(post, dict):
            items.append(normalize_pushshift_item(post))
    return items


def search_pullpush(
    *,
    query: str,
    subreddit: str,
    limit: int,
) -> list[dict[str, Any]]:
    params: dict[str, Any] = {
        "q": query,
        "size": min(limit, 500),
        "sort": "desc",
        "sort_type": "created_utc",
    }
    if subreddit:
        params["subreddit"] = subreddit

    response = requests.get(
        PULLPUSH_SEARCH_URL,
        params=params,
        headers={"User-Agent": "python:reddit_scraper:v1.0"},
        timeout=60,
    )
    response.raise_for_status()
    payload = response.json()
    data = payload.get("data", [])
    items: list[dict[str, Any]] = []
    for post in data:
        if isinstance(post, dict):
            normalized = normalize_pushshift_item(post)
            normalized["source"] = "pullpush"
            items.append(normalized)
    return items


def request_with_pullpush_retry(
    *,
    url: str,
    params: dict[str, Any],
    retry_wait_secs: int,
    max_attempts: int = 4,
) -> requests.Response:
    last_error: requests.HTTPError | None = None
    for attempt in range(1, max_attempts + 1):
        response = requests.get(
            url,
            params=params,
            headers={"User-Agent": "python:reddit_scraper:v1.0"},
            timeout=60,
        )
        if response.status_code != 429:
            response.raise_for_status()
            return response

        last_error = requests.HTTPError(
            f"429 Client Error: Too Many Requests for url: {response.url}",
            response=response,
        )
        if attempt == max_attempts:
            break
        log_progress(
            f"PullPush rate limited on comments (attempt {attempt}/{max_attempts}). "
            f"Sleeping {retry_wait_secs} seconds before retry."
        )
        time.sleep(max(retry_wait_secs, 1))

    if last_error is not None:
        raise last_error
    raise SystemExit("Unexpected PullPush retry state.")


def fetch_pullpush_comments_for_post(
    *,
    submission_id: str,
    subreddit: str,
    max_comments: int,
    retry_wait_secs: int,
) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    after: int | None = None

    while True:
        remaining = 100
        if max_comments > 0:
            remaining = min(remaining, max_comments - len(items))
            if remaining <= 0:
                break

        params: dict[str, Any] = {
            "link_id": submission_id,
            "size": remaining,
            "sort": "asc",
            "sort_type": "created_utc",
        }
        if subreddit:
            params["subreddit"] = subreddit
        if after is not None:
            params["after"] = after

        response = request_with_pullpush_retry(
            url=PULLPUSH_SEARCH_URL.replace("/submission/", "/comment/"),
            params=params,
            retry_wait_secs=retry_wait_secs,
        )
        payload = response.json()
        batch = payload.get("data", [])
        if not isinstance(batch, list) or not batch:
            break

        added_in_batch = 0
        max_created_utc = after
        for comment in batch:
            if not isinstance(comment, dict):
                continue
            comment_id = str(comment.get("id") or "").strip()
            if not comment_id or comment_id in seen_ids:
                continue
            seen_ids.add(comment_id)
            items.append(normalize_comment(comment, source="pullpush"))
            added_in_batch += 1
            created_utc = comment.get("created_utc")
            if created_utc is not None:
                created_int = int(created_utc)
                if max_created_utc is None or created_int > max_created_utc:
                    max_created_utc = created_int

        if added_in_batch == 0:
            break
        if len(batch) < remaining:
            break
        if max_created_utc is None:
            break
        after = max_created_utc

    return items


def fetch_reddit_comments_for_post(
    *,
    token: str,
    user_agent: str,
    subreddit: str,
    submission_id: str,
    max_comments: int,
) -> list[dict[str, Any]]:
    endpoint = f"{OFFICIAL_SEARCH_URL}/r/{subreddit}/comments/{submission_id}"
    response = requests.get(
        f"{endpoint}.json",
        headers={
            "Authorization": f"bearer {token}",
            "User-Agent": user_agent,
        },
        params={
            "limit": 500,
            "depth": 10,
            "sort": "top",
        },
        timeout=60,
    )
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, list) or len(payload) < 2:
        return []

    comments_listing = payload[1].get("data", {}).get("children", [])
    items: list[dict[str, Any]] = []

    def walk(nodes: list[dict[str, Any]]) -> None:
        for node in nodes:
            kind = node.get("kind")
            data = node.get("data")
            if kind != "t1" or not isinstance(data, dict):
                continue
            items.append(normalize_comment(data, source="reddit"))
            if max_comments > 0 and len(items) >= max_comments:
                return
            replies = data.get("replies")
            if isinstance(replies, dict):
                children = replies.get("data", {}).get("children", [])
                if isinstance(children, list):
                    walk(children)
                    if max_comments > 0 and len(items) >= max_comments:
                        return

    walk(comments_listing if isinstance(comments_listing, list) else [])
    return items


def attach_comments_to_posts(
    *,
    posts: list[dict[str, Any]],
    source: str,
    subreddit: str,
    max_comments_per_post: int,
    retry_wait_secs: int,
    after_post_callback: Any = None,
) -> list[dict[str, Any]]:
    if source == "pullpush":
        for index, post in enumerate(posts, start=1):
            submission_id = str(post.get("id") or "").strip()
            if not submission_id:
                post["comments"] = []
                post["commentsFetchedCount"] = 0
                continue
            try:
                comments = fetch_pullpush_comments_for_post(
                    submission_id=submission_id,
                    subreddit=subreddit,
                    max_comments=max_comments_per_post,
                    retry_wait_secs=retry_wait_secs,
                )
            except requests.HTTPError as exc:
                response = exc.response
                status_code = response.status_code if response is not None else "unknown"
                log_progress(
                    f"Skipping comments for post {submission_id} after PullPush error {status_code}."
                )
                comments = []
            post["comments"] = comments
            post["commentsFetchedCount"] = len(comments)
            log_progress(
                f"Comments fetched for post {index}/{len(posts)} ({submission_id}): {len(comments)}"
            )
            if after_post_callback is not None:
                after_post_callback()
        return posts

    if source == "reddit":
        token = get_reddit_access_token()
        user_agent = os.environ.get("REDDIT_USER_AGENT", "").strip()
        for post in posts:
            submission_id = str(post.get("id") or "").strip()
            post_subreddit = str(post.get("subreddit") or subreddit).strip()
            if not submission_id or not post_subreddit:
                post["comments"] = []
                post["commentsFetchedCount"] = 0
                continue
            comments = fetch_reddit_comments_for_post(
                token=token,
                user_agent=user_agent,
                subreddit=post_subreddit,
                submission_id=submission_id,
                max_comments=max_comments_per_post,
            )
            post["comments"] = comments
            post["commentsFetchedCount"] = len(comments)
            if after_post_callback is not None:
                after_post_callback()
        return posts

    return posts


def dedupe_items(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    deduped: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in items:
        dedupe_key = str(item.get("id") or item.get("permalink") or "").strip()
        if not dedupe_key:
            dedupe_key = json.dumps(normalize_for_json(item), ensure_ascii=False, sort_keys=True)
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)
        deduped.append(item)
    return deduped


def build_run_meta(
    *,
    args: argparse.Namespace,
    queries: list[str],
    subreddits: list[str],
    source_counts: dict[str, int],
    filter_summary: dict[str, int],
    items: list[dict[str, Any]],
    deduped_items: list[dict[str, Any]],
    phase: str,
) -> dict[str, Any]:
    return {
        "query": args.query,
        "queries": queries,
        "preset": args.preset,
        "subreddit": args.subreddit,
        "subreddits": subreddits,
        "source": args.source,
        "sort": args.sort,
        "limit": args.limit,
        "includeComments": args.include_comments,
        "maxCommentsPerPost": args.max_comments_per_post,
        "filterMelbournePlaces": args.filter_melbourne_places,
        "onlyWithComments": args.only_with_comments,
        "filterSummary": filter_summary,
        "sourceCounts": source_counts,
        "combinedCount": len(items),
        "dedupedCount": len(deduped_items),
        "phase": phase,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
    }


def write_checkpoint(
    *,
    args: argparse.Namespace,
    queries: list[str],
    subreddits: list[str],
    source_counts: dict[str, int],
    filter_summary: dict[str, int],
    items: list[dict[str, Any]],
    json_path: Path,
    csv_path: Path,
    meta_path: Path,
    phase: str,
) -> None:
    deduped_items = dedupe_items(items)
    meta = build_run_meta(
        args=args,
        queries=queries,
        subreddits=subreddits,
        source_counts=source_counts,
        filter_summary=filter_summary,
        items=items,
        deduped_items=deduped_items,
        phase=phase,
    )
    write_outputs(
        items=deduped_items,
        meta=meta,
        json_path=json_path,
        csv_path=csv_path,
        meta_path=meta_path,
    )


def search_source_queries(
    *,
    source: str,
    queries: list[str],
    subreddits: list[str],
    sort: str,
    limit: int,
) -> tuple[list[dict[str, Any]], dict[str, int]]:
    items: list[dict[str, Any]] = []
    query_counts: dict[str, int] = {}
    per_query_limit = max(1, limit)

    for subreddit in subreddits:
        subreddit_label = f"r/{subreddit}" if subreddit else "all"
        for query in queries:
            log_progress(f"Searching {source} in {subreddit_label} for query: {query}")
            if source == "reddit":
                batch = search_reddit_official(
                    query=query,
                    subreddit=subreddit,
                    sort=sort,
                    limit=per_query_limit,
                )
            elif source == "pushshift":
                batch = search_pushshift(
                    query=query,
                    subreddit=subreddit,
                    limit=per_query_limit,
                )
            elif source == "pullpush":
                batch = search_pullpush(
                    query=query,
                    subreddit=subreddit,
                    limit=per_query_limit,
                )
            else:
                raise SystemExit(f"Unsupported source: {source}")

            query_counts[f"{subreddit_label}::{query}"] = len(batch)
            for item in batch:
                item["searchQuery"] = query
                item["searchSubreddit"] = subreddit
            items.extend(batch)
            log_progress(f"{source} query returned {len(batch)} items.")

    return items, query_counts


def main() -> None:
    load_dotenv()
    args = parse_args()
    queries = resolve_queries(args)
    subreddits = resolve_subreddits(args)

    items: list[dict[str, Any]] = []
    source_counts: dict[str, int] = {}
    filter_summary: dict[str, int] = {}

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    checkpoint_json_path, checkpoint_csv_path, checkpoint_meta_path = build_checkpoint_paths(
        output_dir, timestamp
    )
    json_path, csv_path, meta_path = build_output_paths(output_dir, timestamp)

    def save_checkpoint(phase: str) -> None:
        write_checkpoint(
            args=args,
            queries=queries,
            subreddits=subreddits,
            source_counts=source_counts,
            filter_summary=filter_summary,
            items=items,
            json_path=checkpoint_json_path,
            csv_path=checkpoint_csv_path,
            meta_path=checkpoint_meta_path,
            phase=phase,
        )
        log_progress(f"Checkpoint saved: {checkpoint_json_path}")

    if args.source in {"reddit", "both"}:
        reddit_items, reddit_query_counts = search_source_queries(
            source="reddit",
            queries=queries,
            subreddits=subreddits,
            sort=args.sort,
            limit=args.limit,
        )
        items.extend(reddit_items)
        save_checkpoint("reddit_posts")
        if args.include_comments:
            reddit_items = attach_comments_to_posts(
                posts=reddit_items,
                source="reddit",
                subreddit=subreddits[0],
                max_comments_per_post=args.max_comments_per_post,
                retry_wait_secs=args.comment_retry_secs,
                after_post_callback=lambda: save_checkpoint("reddit_comments"),
            )
        source_counts["reddit"] = len(reddit_items)
        source_counts.update({f"reddit::{k}": v for k, v in reddit_query_counts.items()})
        save_checkpoint("reddit_posts")

    if args.source in {"pushshift", "both"}:
        try:
            pushshift_items, pushshift_query_counts = search_source_queries(
                source="pushshift",
                queries=queries,
                subreddits=subreddits,
                sort=args.sort,
                limit=args.limit,
            )
            items.extend(pushshift_items)
            save_checkpoint("pushshift_posts")
            if args.include_comments:
                pushshift_items = attach_comments_to_posts(
                    posts=pushshift_items,
                    source="pullpush",
                    subreddit=subreddits[0],
                    max_comments_per_post=args.max_comments_per_post,
                    retry_wait_secs=args.comment_retry_secs,
                    after_post_callback=lambda: save_checkpoint("pushshift_comments"),
                )
            source_counts["pushshift"] = len(pushshift_items)
            source_counts.update({f"pushshift::{k}": v for k, v in pushshift_query_counts.items()})
            save_checkpoint("pushshift_posts")
        except requests.HTTPError as exc:
            response = exc.response
            status_code = response.status_code if response is not None else "unknown"
            if str(status_code) in {"401", "403"}:
                print(
                    "Pushshift access was denied "
                    f"(HTTP {status_code}). Falling back to PullPush.",
                    flush=True,
                )
                pullpush_items, pullpush_query_counts = search_source_queries(
                    source="pullpush",
                    queries=queries,
                    subreddits=subreddits,
                    sort=args.sort,
                    limit=args.limit,
                )
                items.extend(pullpush_items)
                save_checkpoint("pullpush_posts")
                if args.include_comments:
                    pullpush_items = attach_comments_to_posts(
                        posts=pullpush_items,
                        source="pullpush",
                        subreddit=subreddits[0],
                        max_comments_per_post=args.max_comments_per_post,
                        retry_wait_secs=args.comment_retry_secs,
                        after_post_callback=lambda: save_checkpoint("pullpush_comments"),
                    )
                source_counts["pullpush"] = len(pullpush_items)
                source_counts.update({f"pullpush::{k}": v for k, v in pullpush_query_counts.items()})
                save_checkpoint("pullpush_posts")
            else:
                raise

    if args.source == "pullpush":
        pullpush_items, pullpush_query_counts = search_source_queries(
            source="pullpush",
            queries=queries,
            subreddits=subreddits,
            sort=args.sort,
            limit=args.limit,
        )
        items.extend(pullpush_items)
        save_checkpoint("pullpush_posts")
        if args.include_comments:
            pullpush_items = attach_comments_to_posts(
                posts=pullpush_items,
                source="pullpush",
                subreddit=subreddits[0],
                max_comments_per_post=args.max_comments_per_post,
                retry_wait_secs=args.comment_retry_secs,
                after_post_callback=lambda: save_checkpoint("pullpush_comments"),
            )
        source_counts["pullpush"] = len(pullpush_items)
        source_counts.update({f"pullpush::{k}": v for k, v in pullpush_query_counts.items()})
        save_checkpoint("pullpush_posts")

    if args.filter_melbourne_places:
        items, filter_summary = filter_melbourne_place_posts(items)
        log_progress(
            "Melbourne place filter kept "
            f"{filter_summary.get('filteredCount', len(items))} items."
        )
        save_checkpoint("filtered")

    if args.only_with_comments:
        comment_filter_summary: dict[str, int]
        items, comment_filter_summary = filter_only_with_comments(
            items,
            require_fetched_comments=args.include_comments,
        )
        filter_summary.update(comment_filter_summary)
        log_progress(
            "Comment-only filter kept "
            f"{comment_filter_summary.get('filteredCount', len(items))} items."
        )
        save_checkpoint("comments_only")

    deduped_items = dedupe_items(items)
    meta = build_run_meta(
        args=args,
        queries=queries,
        subreddits=subreddits,
        source_counts=source_counts,
        filter_summary=filter_summary,
        items=items,
        deduped_items=deduped_items,
        phase="completed",
    )
    write_outputs(
        items=deduped_items,
        meta=meta,
        json_path=json_path,
        csv_path=csv_path,
        meta_path=meta_path,
    )

    print(f"Items saved: {len(deduped_items)}")
    print(f"Checkpoint JSON: {checkpoint_json_path}")
    print(f"Checkpoint CSV: {checkpoint_csv_path}")
    print(f"Checkpoint Metadata: {checkpoint_meta_path}")
    print(f"JSON: {json_path}")
    print(f"CSV: {csv_path}")
    print(f"Metadata: {meta_path}")


if __name__ == "__main__":
    main()
