import json
from enrich import GooglePlacesEnricher


def main():
    input_file = "fb_melbourne_combined.json"
    output_file = "fb_melbourne_combined_enriched.json"
    failed_file = "fb_melbourne_not_enrichable.json"

    with open(input_file, "r", encoding="utf-8") as f:
        fb_results = json.load(f)

    enricher = GooglePlacesEnricher()
    stats = enricher.enrich_all_in_place(fb_results)

    # save all items, including both enriched and unenrichable
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(fb_results, f, indent=2, ensure_ascii=False)

    # keep only items that failed enrichment
    not_enrichable = [
        item for item in fb_results
        if not item.get("google_match_found", False)
    ]

    with open(failed_file, "w", encoding="utf-8") as f:
        json.dump(not_enrichable, f, indent=2, ensure_ascii=False)

    print(f"Saved enriched data to: {output_file}")
    print(f"Saved not enrichable data to: {failed_file}")
    print(f"Total data points: {stats['total']}")
    print(f"Enriched: {stats['enriched']}")
    print(f"Not enrichable: {stats['not_enrichable']}")


if __name__ == "__main__":
    main()