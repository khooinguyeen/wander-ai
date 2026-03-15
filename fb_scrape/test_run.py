import json
from fb import FacebookSearchScraperClient


def main():
    client = FacebookSearchScraperClient()

    search_pairs = [
        ("Cafe", "Melbourne, Australia"),
        ("Restaurant", "Melbourne, Australia"),
        ("Pub", "Melbourne, Australia"),
        ("Bar", "Melbourne, Australia"),
        ("Event venue", "Melbourne, Australia"),
    ]

    all_results = []
    seen = set()

    for category, location in search_pairs:
        results = client.search_single(
            category=category,
            location=location,
            results_limit=100
        )

        for item in results:
            unique_key = item.get("pageId") or item.get("pageUrl") or item.get("facebookUrl")
            if unique_key and unique_key not in seen:
                seen.add(unique_key)
                all_results.append(item)

    with open("fb_melbourne_combined.json", "w", encoding="utf-8") as f:
        json.dump(all_results, f, indent=2, ensure_ascii=False)

    print(f"Saved {len(all_results)} unique results")
    client.pretty_print(all_results, limit=5)


if __name__ == "__main__":
    main()