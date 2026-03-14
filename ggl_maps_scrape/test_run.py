from ggl_maps import GooglePlacesClient
import json


def main():
    client = GooglePlacesClient()

    search_queries = [
        "hidden gem cafe in Melbourne",
        "best cafe in Melbourne",
        "specialty coffee in Melbourne",
        "brunch cafe in Melbourne",
        "local cafe in Melbourne",
        "hidden gem restaurants in Melbourne",
        "best restaurants in Melbourne",
        "galleries in Melbourne",
        "Events in Melbourne",
        "galleries in Melbourne",
        "pubs in Melbourne",
        "bars in Melbourne",
        "shopping in Melbourne",
        "thrift shops in Melbourne",
        "entertainment in Melbourne",
    ]

    all_results = []
    seen = set()

    for query in search_queries:
        print(f"Searching: {query}")

        results = client.search_places(
            text_query=query,
            max_result_count=100
        )

        for item in results:
            # deduplicate by source_url first, then name + location
            unique_key = (
                item.get("source_url")
                or f"{item.get('name')}|{item.get('location')}"
            )

            if unique_key not in seen:
                seen.add(unique_key)
                all_results.append(item)

    with open("results_combined.json", "w", encoding="utf-8") as f:
        json.dump(all_results, f, indent=2, ensure_ascii=False)

    print(f"Saved {len(all_results)} unique results to results_combined.json")
    client.pretty_print(all_results)


if __name__ == "__main__":
    main()