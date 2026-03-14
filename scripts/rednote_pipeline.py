#!/usr/bin/env python3
"""
RedNote-first Melbourne ingestion pipeline.

This script starts from public RedNote share URLs, fetches note metadata from
the public web surface when available, extracts Melbourne place candidates,
geocodes them, and writes a normalized spots export for the app.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import time
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup
from geopy.exc import GeocoderServiceError, GeocoderTimedOut, GeocoderUnavailable
from geopy.geocoders import Nominatim

OUTPUT_DIR = Path("data")
DEFAULT_HEADERS = {
    "user-agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"
    ),
    "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
}
URL_PATTERN = re.compile(
    r"https?://(?:www\.)?(?:xhslink\.com|xiaohongshu\.com|www\.xiaohongshu\.com)[^\s<>\"]+",
    re.IGNORECASE,
)
HASHTAG_PATTERN = re.compile(r"#([\w\u4e00-\u9fff]+)")
NOTE_ID_PATTERN = re.compile(r"/(?:explore|discovery/item)/([a-zA-Z0-9]+)")
SHORT_LINK_HOSTS = {"xhslink.com", "www.xhslink.com"}

FOOD_WORDS = {
    "coffee",
    "cafe",
    "caffeine",
    "brunch",
    "bakery",
    "dessert",
    "restaurant",
    "dinner",
    "lunch",
    "eat",
    "food",
    "espresso",
    "探店",
    "咖啡",
    "面包",
    "甜品",
    "餐厅",
    "吃",
    "早午餐",
}
LOOKOUT_WORDS = {
    "lookout",
    "sunset",
    "view",
    "scenic",
    "walk",
    "beach",
    "river",
    "park",
    "机位",
    "日落",
    "观景",
    "景点",
    "散步",
    "海边",
}
FASHION_WORDS = {
    "fashion",
    "boutique",
    "store",
    "vintage",
    "shopping",
    "streetwear",
    "designer",
    "clothes",
    "穿搭",
    "服装",
    "买手店",
    "逛街",
    "古着",
}
LOWKEY_WORDS = {"hidden", "lowkey", "quiet", "secret", "小众", "隐藏", "安静"}
VIRAL_WORDS = {"viral", "trending", "must", "排队", "爆火", "热门", "打卡"}
SCENIC_WORDS = {"sunset", "skyline", "view", "ocean", "river", "日落", "风景", "观景", "海边"}

MELBOURNE_SUBURBS = [
    "Melbourne",
    "CBD",
    "Carlton",
    "Fitzroy",
    "Collingwood",
    "Richmond",
    "Brunswick",
    "Northcote",
    "South Melbourne",
    "Southbank",
    "St Kilda",
    "Elwood",
    "Prahran",
    "Windsor",
    "Docklands",
    "Footscray",
    "Fairfield",
    "Abbotsford",
    "Toorak",
    "South Yarra",
    "Mount Dandenong",
    "墨尔本",
    "卡尔顿",
    "菲茨罗伊",
    "科林伍德",
    "里士满",
    "布伦瑞克",
    "圣基尔达",
]
AREA_BY_SUBURB = {
    "Melbourne": "CBD",
    "CBD": "CBD",
    "Carlton": "CBD North",
    "Fitzroy": "Fitzroy / Collingwood",
    "Collingwood": "Fitzroy / Collingwood",
    "Richmond": "Inner East",
    "Brunswick": "Northside",
    "Northcote": "Northside",
    "South Melbourne": "Southside",
    "Southbank": "Southside",
    "St Kilda": "Southside",
    "Elwood": "Southside",
    "Prahran": "Southside",
    "Windsor": "Southside",
    "Docklands": "CBD West",
    "Footscray": "Inner West",
    "Fairfield": "Northside",
    "Abbotsford": "Inner East",
    "Toorak": "Inner South-East",
    "South Yarra": "Inner South-East",
    "Mount Dandenong": "Outer East",
}


@dataclass
class RawRedNotePost:
    platform: str
    source_url: str
    canonical_url: str
    note_id: str
    fetched_at: str
    title: str
    description: str
    author_name: str
    author_handle: str
    posted_at: str
    hashtags: list[str]
    keyword_tags: list[str]
    like_count: int | None
    comment_count: int | None
    share_count: int | None
    save_count: int | None
    ip_location: str
    poi_name: str
    poi_address: str
    cover_image_url: str
    media_urls: list[str]
    notes: list[str]
    raw_payload: dict[str, Any]


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "unknown"


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def parse_count(value: Any) -> int | None:
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return int(value)

    text = str(value).strip().lower().replace(",", "")
    match = re.match(r"(\d+(?:\.\d+)?)\s*([wk万]?)", text)
    if not match:
        digits = re.sub(r"[^\d]", "", text)
        return int(digits) if digits else None

    amount = float(match.group(1))
    suffix = match.group(2)
    if suffix == "k":
        amount *= 1_000
    elif suffix in {"w", "万"}:
        amount *= 10_000
    return int(amount)


def unique_list(values: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    items: list[str] = []
    for value in values:
        cleaned = normalize_text(value)
        if cleaned and cleaned not in seen:
            seen.add(cleaned)
            items.append(cleaned)
    return items


def coerce_string_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return unique_list(re.split(r"[,\n/|]", value))
    if isinstance(value, list):
        return unique_list(str(item) for item in value)
    return []


def extract_balanced_json(text: str, marker: str) -> dict[str, Any] | None:
    marker_index = text.find(marker)
    if marker_index < 0:
        return None

    start = text.find("{", marker_index)
    if start < 0:
        return None

    depth = 0
    in_string = False
    escape = False

    for index in range(start, len(text)):
        char = text[index]
        if in_string:
            if escape:
                escape = False
            elif char == "\\":
                escape = True
            elif char == '"':
                in_string = False
            continue

        if char == '"':
            in_string = True
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                candidate = text[start : index + 1]
                try:
                    return json.loads(candidate)
                except json.JSONDecodeError:
                    return None
    return None


def walk_json(node: Any) -> Iterable[Any]:
    if isinstance(node, dict):
        yield node
        for value in node.values():
            yield from walk_json(value)
    elif isinstance(node, list):
        for item in node:
            yield from walk_json(item)


def find_first_key(node: Any, keys: set[str]) -> Any:
    for item in walk_json(node):
        if isinstance(item, dict):
            for key, value in item.items():
                if key in keys and value not in (None, "", [], {}):
                    return value
    return None


def find_all_matching_dicts(node: Any, keys: set[str]) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for item in walk_json(node):
        if isinstance(item, dict) and any(key in item for key in keys):
            results.append(item)
    return results


def resolve_public_url(url: str, session: requests.Session) -> str:
    try:
        response = session.get(url, headers=DEFAULT_HEADERS, timeout=20, allow_redirects=True)
        return response.url
    except requests.RequestException:
        return url


def canonicalize_rednote_url(url: str, session: requests.Session) -> tuple[str, str]:
    parsed = urlparse(url.strip())
    resolved = url
    if parsed.netloc.lower() in SHORT_LINK_HOSTS:
        resolved = resolve_public_url(url, session)
        parsed = urlparse(resolved)

    match = NOTE_ID_PATTERN.search(parsed.path)
    if match:
        note_id = match.group(1)
        return f"https://www.xiaohongshu.com/explore/{note_id}", note_id

    return resolved, ""


def extract_urls_from_text(text: str) -> list[str]:
    return [match.group(0).rstrip(").,") for match in URL_PATTERN.finditer(text)]


def load_seed_urls(path: Path) -> list[str]:
    if not path.exists():
        return []

    values: list[str] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        urls = extract_urls_from_text(stripped)
        if urls:
            values.extend(urls)
        else:
            values.append(stripped)
    return unique_list(values)


def extract_meta_content(soup: BeautifulSoup, *, name: str | None = None, prop: str | None = None) -> str:
    selector = None
    if name:
        selector = soup.find("meta", attrs={"name": name})
    elif prop:
        selector = soup.find("meta", attrs={"property": prop})
    return normalize_text(selector.get("content", "")) if selector else ""


def fetch_note_html(url: str, session: requests.Session) -> tuple[str, str]:
    response = session.get(url, headers=DEFAULT_HEADERS, timeout=20)
    response.raise_for_status()
    return response.url, response.text


def extract_state_payloads(html: str, soup: BeautifulSoup) -> list[dict[str, Any]]:
    payloads: list[dict[str, Any]] = []
    for marker in [
        "window.__INITIAL_STATE__",
        "window.__INITIAL_SSR_STATE__",
        "window.__INITIAL_DATA__",
        "__INITIAL_STATE__",
    ]:
        payload = extract_balanced_json(html, marker)
        if payload:
            payloads.append(payload)

    for script in soup.find_all("script", attrs={"type": "application/ld+json"}):
        text = script.string or script.get_text()
        if not text:
            continue
        try:
            payloads.append(json.loads(text))
        except json.JSONDecodeError:
            continue

    return payloads


def guess_handle(author_name: str) -> str:
    if not author_name:
        return ""
    compact = re.sub(r"\s+", "", author_name)
    return f"@{compact}"


def normalize_media_urls(values: Iterable[str]) -> list[str]:
    return unique_list(value for value in values if value and value.startswith("http"))


def is_inaccessible_post(post: RawRedNotePost) -> bool:
    blocked_markers = [
        "你访问的页面不见了",
        "当前笔记暂时无法浏览",
        "page not found",
    ]
    blocked_url_parts = ["/404", "error_code=300031"]
    title = post.title.lower()
    canonical_url = post.canonical_url.lower()

    return any(marker.lower() in title for marker in blocked_markers) or any(
        marker in canonical_url for marker in blocked_url_parts
    )


def build_raw_post(
    source_url: str,
    canonical_url: str,
    note_id: str,
    html: str,
) -> RawRedNotePost:
    soup = BeautifulSoup(html, "html.parser")
    payloads = extract_state_payloads(html, soup)
    combined_payload = payloads[0] if payloads else {}

    note_card = find_first_key(combined_payload, {"note_card", "noteCard"}) or {}
    user_block = find_first_key(combined_payload, {"user", "author", "user_info", "author_info"}) or {}
    interact_info = find_first_key(combined_payload, {"interact_info", "interactInfo"}) or {}
    location_block = find_first_key(combined_payload, {"poi", "poi_info", "location", "poiInfo"}) or {}

    title = normalize_text(
        note_card.get("title")
        if isinstance(note_card, dict)
        else ""
    ) or extract_meta_content(soup, prop="og:title") or normalize_text(soup.title.string if soup.title else "")
    description = normalize_text(
        note_card.get("desc")
        if isinstance(note_card, dict)
        else ""
    ) or extract_meta_content(soup, name="description") or extract_meta_content(soup, prop="og:description")
    keyword_tags = extract_meta_content(soup, name="keywords").split(",")

    author_name = ""
    if isinstance(user_block, dict):
        author_name = normalize_text(
            str(
                user_block.get("nickname")
                or user_block.get("name")
                or user_block.get("user_name")
                or user_block.get("author_name")
                or ""
            )
        )

    author_handle = normalize_text(
        str(find_first_key(combined_payload, {"red_id", "user_id", "author_handle"}) or "")
    )
    if author_handle and not author_handle.startswith("@"):
        author_handle = f"@{author_handle}"
    if not author_handle:
        author_handle = guess_handle(author_name)

    cover_image_url = extract_meta_content(soup, prop="og:image")
    media_urls = [cover_image_url]

    if isinstance(note_card, dict):
        image_list = note_card.get("image_list") or note_card.get("images") or []
        for image in image_list:
            if isinstance(image, dict):
                media_urls.extend(
                    [
                        str(image.get("url_default", "")),
                        str(image.get("url", "")),
                        str(image.get("info_list", [{}])[-1].get("url", "")) if image.get("info_list") else "",
                    ]
                )
        video_info = note_card.get("video") or note_card.get("video_info") or {}
        if isinstance(video_info, dict):
            media_urls.extend(
                [
                    str(video_info.get("media", {}).get("stream", {}).get("h264", [{}])[0].get("master_url", ""))
                    if isinstance(video_info.get("media"), dict)
                    else "",
                    str(video_info.get("image", {}).get("thumbnail_url", ""))
                    if isinstance(video_info.get("image"), dict)
                    else "",
                ]
            )

    hashtags = HASHTAG_PATTERN.findall(f"{title} {description}")

    poi_name = ""
    poi_address = ""
    if isinstance(location_block, dict):
        poi_name = normalize_text(str(location_block.get("name") or location_block.get("poi_name") or ""))
        poi_address = normalize_text(str(location_block.get("address") or location_block.get("poi_address") or ""))

    notes = []
    if not payloads:
        notes.append("Public page did not expose structured JSON; metadata came from meta tags only.")
    if not note_id:
        fallback_note_id = find_first_key(combined_payload, {"note_id", "noteId"})
        note_id = normalize_text(str(fallback_note_id or ""))

    return RawRedNotePost(
        platform="rednote",
        source_url=source_url,
        canonical_url=canonical_url,
        note_id=note_id,
        fetched_at=now_iso(),
        title=title,
        description=description,
        author_name=author_name,
        author_handle=author_handle,
        posted_at=normalize_text(str(find_first_key(combined_payload, {"time", "publish_time", "last_update_time"}) or "")),
        hashtags=unique_list(hashtags),
        keyword_tags=unique_list(keyword_tags),
        like_count=parse_count(interact_info.get("liked_count") if isinstance(interact_info, dict) else None),
        comment_count=parse_count(interact_info.get("comment_count") if isinstance(interact_info, dict) else None),
        share_count=parse_count(interact_info.get("share_count") if isinstance(interact_info, dict) else None),
        save_count=parse_count(
            interact_info.get("collected_count") if isinstance(interact_info, dict) else None
        ),
        ip_location=normalize_text(str(find_first_key(combined_payload, {"ip_location"}) or "")),
        poi_name=poi_name,
        poi_address=poi_address,
        cover_image_url=cover_image_url,
        media_urls=normalize_media_urls(media_urls),
        notes=notes,
        raw_payload=combined_payload if isinstance(combined_payload, dict) else {},
    )


def guess_kind(text: str) -> str:
    normalized = text.lower()
    food_hits = sum(1 for word in FOOD_WORDS if word in normalized)
    lookout_hits = sum(1 for word in LOOKOUT_WORDS if word in normalized)
    fashion_hits = sum(1 for word in FASHION_WORDS if word in normalized)
    scores = {"food": food_hits, "lookout": lookout_hits, "fashion": fashion_hits}
    best_kind = max(scores, key=scores.get)
    return best_kind if scores[best_kind] > 0 else "food"


def extract_suburb(text: str) -> str:
    for suburb in MELBOURNE_SUBURBS:
        if suburb.lower() in text.lower():
            return suburb
    return ""


def guess_categories(text: str, kind: str) -> list[str]:
    normalized = text.lower()
    categories: list[str] = []
    if kind == "food":
        for keyword in ["coffee", "cafe", "brunch", "bakery", "dessert", "restaurant", "dinner", "lunch"]:
            if keyword in normalized:
                categories.append(keyword)
    if kind == "lookout":
        for keyword in ["sunset", "lookout", "walk", "beach", "park", "scenic"]:
            if keyword in normalized:
                categories.append(keyword)
    if kind == "fashion":
        for keyword in ["fashion", "boutique", "vintage", "shopping", "streetwear", "designer"]:
            if keyword in normalized:
                categories.append(keyword)
    return unique_list(categories or [kind])


def guess_vibe_tags(text: str) -> list[str]:
    normalized = text.lower()
    vibe_tags: list[str] = []
    for keyword in ["lowkey", "hidden", "viral", "date", "quiet", "architectural", "sunset", "streetwear"]:
        if keyword in normalized:
            vibe_tags.append(keyword)
    for keyword in ["小众", "隐藏", "爆火", "日落", "安静"]:
        if keyword in text:
            vibe_tags.append(keyword)
    return unique_list(vibe_tags)


def gemini_extract_places(post: RawRedNotePost) -> list[dict[str, Any]]:
    api_key = os.getenv("GOOGLE_GENERATIVE_AI_API_KEY")
    if not api_key:
        return []

    model = os.getenv("GEMINI_MODEL", "gemini-2.5-flash-lite")
    prompt = {
        "task": "Extract Melbourne place candidates from a RedNote note.",
        "rules": [
            "Return a JSON array only.",
            "Each item must include name, suburb, kind, categories, vibe_tags, description, why_it_trends, confidence.",
            "Use only places that are explicitly referenced or strongly implied by the note.",
            "kind must be one of food, lookout, fashion.",
            "Ignore vague city mentions with no specific physical place."
        ],
        "note": {
            "title": post.title,
            "description": post.description,
            "hashtags": post.hashtags,
            "keyword_tags": post.keyword_tags,
            "poi_name": post.poi_name,
            "poi_address": post.poi_address,
            "ip_location": post.ip_location,
            "author": post.author_name,
            "canonical_url": post.canonical_url
        }
    }

    response = requests.post(
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
        params={"key": api_key},
        headers={"Content-Type": "application/json"},
        json={
            "contents": [{"parts": [{"text": json.dumps(prompt, ensure_ascii=False)}]}],
            "generationConfig": {
                "temperature": 0.1,
                "responseMimeType": "application/json"
            }
        },
        timeout=30,
    )
    response.raise_for_status()
    payload = response.json()
    text = (
        payload.get("candidates", [{}])[0]
        .get("content", {})
        .get("parts", [{}])[0]
        .get("text", "[]")
    )

    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return []

    return parsed if isinstance(parsed, list) else []


def heuristic_extract_places(post: RawRedNotePost) -> list[dict[str, Any]]:
    text = " ".join(
        [
            post.title,
            post.description,
            " ".join(post.hashtags),
            " ".join(post.keyword_tags),
            post.poi_name,
            post.poi_address,
            post.ip_location,
        ]
    )
    place_name = normalize_text(post.poi_name)
    if not place_name:
        mention = re.search(r"@([A-Za-z0-9 '&\-.]+)", f"{post.title} {post.description}")
        if mention:
            place_name = normalize_text(mention.group(1))

    if not place_name and len(post.title) <= 80:
        place_name = post.title.split("#")[0].strip()

    if not place_name:
        return []

    kind = guess_kind(text)
    return [
        {
            "name": place_name,
            "suburb": extract_suburb(text),
            "kind": kind,
            "categories": guess_categories(text, kind),
            "vibe_tags": guess_vibe_tags(text),
            "description": normalize_text(post.description or post.title),
            "why_it_trends": normalize_text(post.title or post.description),
            "confidence": 0.45,
        }
    ]


def should_use_gemini(post: RawRedNotePost, extractor: str) -> bool:
    if extractor == "gemini":
        return True
    if extractor == "heuristic":
        return False

    # Auto mode: spend a Gemini call only when the post lacks direct POI cues.
    if post.poi_name or post.poi_address:
        return False

    text = " ".join([post.title, post.description, " ".join(post.hashtags), " ".join(post.keyword_tags)])
    has_suburb = bool(extract_suburb(text))
    has_domain_keywords = any(word in text.lower() for word in FOOD_WORDS | LOOKOUT_WORDS | FASHION_WORDS)
    return not (has_suburb and has_domain_keywords)


def geocode_place(
    geocoder: Nominatim,
    name: str,
    suburb: str,
    fallback_address: str,
) -> dict[str, Any] | None:
    queries = [
        ", ".join(part for part in [name, suburb, "Melbourne VIC", "Australia"] if part),
        ", ".join(part for part in [fallback_address, "Melbourne VIC", "Australia"] if part),
        ", ".join(part for part in [name, "Melbourne VIC", "Australia"] if part),
    ]

    for query in unique_list(queries):
        try:
            location = geocoder.geocode(query, exactly_one=True, country_codes="au", addressdetails=True)
        except (GeocoderTimedOut, GeocoderUnavailable, GeocoderServiceError):
            time.sleep(1.2)
            continue

        if location:
            address = location.raw.get("address", {})
            suburb_value = (
                address.get("suburb")
                or address.get("city_district")
                or address.get("town")
                or address.get("city")
                or suburb
                or "Melbourne"
            )
            return {
                "address": location.address,
                "lat": location.latitude,
                "lng": location.longitude,
                "suburb": suburb_value,
                "neighbourhood": address.get("neighbourhood") or address.get("quarter") or suburb_value,
            }
    return None


def infer_price_band(kind: str, categories: list[str], text: str) -> str | None:
    normalized = text.lower()
    if kind == "lookout":
        return None
    if "designer" in categories or "fine dining" in normalized:
        return "$$$"
    if "streetwear" in categories or "vintage" in categories:
        return "$$"
    return "$$" if kind in {"food", "fashion"} else None


def infer_visit_minutes(kind: str) -> int:
    return {"food": 75, "lookout": 40, "fashion": 40}.get(kind, 45)


def infer_visit_windows(kind: str, categories: list[str], text: str) -> list[str]:
    normalized = text.lower()
    if kind == "lookout":
        if "sunset" in normalized or "日落" in text:
            return ["16:30-19:30"]
        return ["10:00-18:00"]
    if kind == "fashion":
        return ["11:00-18:00"]
    if "brunch" in categories or "早午餐" in text:
        return ["08:00-12:30"]
    if "dinner" in categories or "餐厅" in text:
        return ["17:30-21:30"]
    return ["10:00-15:00", "17:00-20:00"]


def build_signals(kind: str, text: str, mentions: int) -> dict[str, float]:
    normalized = text.lower()
    food = 0.9 if kind == "food" else 0.05
    scenic = 0.92 if kind == "lookout" else 0.08
    fashion = 0.92 if kind == "fashion" else 0.06
    hidden = 0.72 if any(word in normalized for word in LOWKEY_WORDS) or any(word in text for word in LOWKEY_WORDS) else 0.4
    if mentions > 4:
        hidden = max(0.15, hidden - 0.12)
    viral = min(0.96, 0.3 + math.log1p(mentions) / 3.0)
    if any(word in normalized for word in VIRAL_WORDS) or any(word in text for word in VIRAL_WORDS):
        viral = min(0.98, viral + 0.18)
    if any(word in normalized for word in SCENIC_WORDS) or any(word in text for word in SCENIC_WORDS):
        scenic = max(scenic, 0.88)
    return {
        "food": round(food, 2),
        "scenic": round(scenic, 2),
        "fashion": round(fashion, 2),
        "hiddenGem": round(hidden, 2),
        "viral": round(viral, 2),
    }


def build_spots(
    candidates: list[dict[str, Any]],
    raw_posts_by_url: dict[str, RawRedNotePost],
    geocoder: Nominatim,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for candidate in candidates:
        key = slugify(f"{candidate['name']} {candidate.get('suburb', '')}")
        grouped[key].append(candidate)

    spots: list[dict[str, Any]] = []
    unresolved: list[dict[str, Any]] = []

    for key, group in grouped.items():
        top = sorted(group, key=lambda item: item.get("confidence", 0), reverse=True)[0]
        geocoded = geocode_place(
            geocoder=geocoder,
            name=top["name"],
            suburb=top.get("suburb", ""),
            fallback_address=top.get("poi_address", ""),
        )
        if not geocoded:
            unresolved.append(
                {
                    "key": key,
                    "name": top["name"],
                    "suburb": top.get("suburb", ""),
                    "source_urls": unique_list(item["source_url"] for item in group),
                }
            )
            continue

        kind_counts = Counter(item["kind"] for item in group if item.get("kind"))
        kind = kind_counts.most_common(1)[0][0] if kind_counts else "food"
        source_urls = unique_list(item["source_url"] for item in group)
        source_posts = [raw_posts_by_url[url] for url in source_urls if url in raw_posts_by_url]
        combined_text = " ".join(
            [
                top.get("description", ""),
                top.get("why_it_trends", ""),
                " ".join(top.get("categories", [])),
                " ".join(top.get("vibe_tags", [])),
                " ".join(post.description for post in source_posts),
                " ".join(post.title for post in source_posts),
            ]
        )
        suburb = geocoded["suburb"]
        area = AREA_BY_SUBURB.get(suburb, top.get("area") or suburb)
        creator_count = len({post.author_handle or post.author_name for post in source_posts if post.author_handle or post.author_name})
        mentions = len(source_posts)
        categories = unique_list(value for item in group for value in item.get("categories", []))
        vibe_tags = unique_list(value for item in group for value in item.get("vibe_tags", []))
        best_for = unique_list(value for item in group for value in item.get("best_for", []) + item.get("categories", [])[:2])
        if not best_for:
            best_for = categories[:3]

        spots.append(
            {
                "id": slugify(f"{top['name']}-{suburb}"),
                "name": top["name"],
                "kind": kind,
                "area": area,
                "suburb": suburb,
                "city": "Melbourne",
                "neighbourhood": geocoded["neighbourhood"] or area,
                "categories": categories or [kind],
                "vibeTags": vibe_tags,
                "description": top.get("description") or normalize_text(source_posts[0].description if source_posts else top["name"]),
                "whyItTrends": top.get("why_it_trends") or top.get("description") or top["name"],
                "address": geocoded["address"],
                "coordinates": {
                    "lat": round(geocoded["lat"], 6),
                    "lng": round(geocoded["lng"], 6),
                },
                "priceBand": infer_price_band(kind, categories, combined_text),
                "idealVisitMinutes": infer_visit_minutes(kind),
                "bestFor": best_for,
                "visitWindows": infer_visit_windows(kind, categories, combined_text),
                "signals": build_signals(kind, combined_text, mentions),
                "socialProof": {
                    "mentions": mentions,
                    "creatorCount": creator_count,
                    "lastScrapedAt": now_iso(),
                },
                "sourcePosts": [
                    {
                        "platform": "rednote",
                        "url": post.canonical_url or post.source_url,
                        "creatorHandle": post.author_handle or post.author_name,
                        "caption": normalize_text(post.description or post.title),
                        "postedAt": post.posted_at or post.fetched_at,
                    }
                    for post in source_posts
                ],
            }
        )

    return spots, unresolved


def write_json_records(records: Any, latest_name: str) -> Path:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    timestamped_path = OUTPUT_DIR / f"{latest_name.rsplit('.', 1)[0]}_{timestamp}.json"
    latest_path = OUTPUT_DIR / latest_name
    serialized = json.dumps(records, indent=2, ensure_ascii=False)
    timestamped_path.write_text(serialized, encoding="utf-8")
    latest_path.write_text(serialized, encoding="utf-8")
    return latest_path


def scrape_raw_posts(urls: list[str], session: requests.Session) -> tuple[list[RawRedNotePost], list[dict[str, str]]]:
    posts: list[RawRedNotePost] = []
    failures: list[dict[str, str]] = []

    for url in urls:
        canonical_url, note_id = canonicalize_rednote_url(url, session)
        try:
            final_url, html = fetch_note_html(canonical_url, session)
            post = build_raw_post(url, final_url, note_id, html)
            if is_inaccessible_post(post):
                failures.append(
                    {
                        "url": url,
                        "canonical_url": final_url,
                        "reason": "RedNote note was not publicly accessible and resolved to a blocked/404 page.",
                    }
                )
            else:
                posts.append(post)
        except requests.RequestException as exc:
            failures.append(
                {
                    "url": url,
                    "canonical_url": canonical_url,
                    "reason": str(exc),
                }
            )
        time.sleep(0.6)

    return posts, failures


def extract_candidates(posts: list[RawRedNotePost], extractor: str) -> list[dict[str, Any]]:
    extracted: list[dict[str, Any]] = []
    for post in posts:
        llm_candidates = []
        if should_use_gemini(post, extractor):
            try:
                llm_candidates = gemini_extract_places(post)
            except requests.RequestException:
                llm_candidates = []

        candidates = llm_candidates or heuristic_extract_places(post)
        for candidate in candidates:
            name = normalize_text(str(candidate.get("name", "")))
            if not name:
                continue
            kind = candidate.get("kind") if candidate.get("kind") in {"food", "lookout", "fashion"} else guess_kind(name)
            extracted.append(
                {
                    "source_url": post.canonical_url or post.source_url,
                    "note_id": post.note_id,
                    "name": name,
                    "suburb": normalize_text(str(candidate.get("suburb", ""))) or extract_suburb(post.description),
                    "kind": kind,
                    "categories": coerce_string_list(candidate.get("categories")) or guess_categories(post.description + post.title, kind),
                    "vibe_tags": coerce_string_list(candidate.get("vibe_tags")) or guess_vibe_tags(post.description + post.title),
                    "description": normalize_text(str(candidate.get("description", ""))) or normalize_text(post.description or post.title),
                    "why_it_trends": normalize_text(str(candidate.get("why_it_trends", ""))) or normalize_text(post.title),
                    "best_for": coerce_string_list(candidate.get("best_for")),
                    "confidence": float(candidate.get("confidence", 0.5)),
                    "poi_address": post.poi_address,
                }
            )
    return extracted


def load_raw_posts_from_file(path: Path) -> list[RawRedNotePost]:
    items = json.loads(path.read_text(encoding="utf-8"))
    return [RawRedNotePost(**item) for item in items]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="RedNote-first Melbourne ingestion pipeline.")
    parser.add_argument(
        "--urls-file",
        default="data/rednote_seed_urls.txt",
        help="Text file with one RedNote URL or share-text block per line.",
    )
    parser.add_argument(
        "--input-raw-json",
        default="",
        help="Skip live fetching and read raw RedNote posts from an existing JSON file.",
    )
    parser.add_argument(
        "--skip-geocode",
        action="store_true",
        help="Extract raw posts and candidates only.",
    )
    parser.add_argument(
        "--extractor",
        choices=["auto", "heuristic", "gemini"],
        default="auto",
        help="How to extract place candidates from raw RedNote notes. Default: auto.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    session = requests.Session()
    session.headers.update(DEFAULT_HEADERS)

    if args.input_raw_json:
        raw_posts = load_raw_posts_from_file(Path(args.input_raw_json))
        failures: list[dict[str, str]] = []
    else:
        urls = load_seed_urls(Path(args.urls_file))
        if not urls:
            print("No RedNote seed URLs found.")
            print("Add URLs to data/rednote_seed_urls.txt or use --input-raw-json.")
            return 1
        raw_posts, failures = scrape_raw_posts(urls, session)

    raw_records = [asdict(post) for post in raw_posts]
    raw_path = write_json_records(raw_records, "rednote_raw_posts_latest.json")
    failures_path = write_json_records(failures, "rednote_failures_latest.json")

    candidates = extract_candidates(raw_posts, args.extractor)
    candidates_path = write_json_records(candidates, "rednote_candidate_mentions_latest.json")

    if args.skip_geocode:
        print(f"Saved raw posts to {raw_path}")
        print(f"Saved failures to {failures_path}")
        print(f"Saved candidates to {candidates_path}")
        return 0

    geocoder = Nominatim(user_agent=os.getenv("GEOCODER_USER_AGENT", "unihack-rednote-scout"))
    raw_posts_by_url = {post.canonical_url or post.source_url: post for post in raw_posts}
    spots, unresolved = build_spots(candidates, raw_posts_by_url, geocoder)
    spots_path = write_json_records(spots, "melbourne-spots.rednote_latest.json")
    unresolved_path = write_json_records(unresolved, "rednote_unresolved_latest.json")

    print(f"Saved raw posts to {raw_path}")
    print(f"Saved failures to {failures_path}")
    print(f"Saved candidate mentions to {candidates_path}")
    print(f"Saved normalized spots to {spots_path}")
    print(f"Saved unresolved candidates to {unresolved_path}")
    print(f"Raw posts: {len(raw_posts)} | candidates: {len(candidates)} | spots: {len(spots)} | failures: {len(failures)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
