import os
from typing import Any, Dict, List, Optional

import requests
from dotenv import load_dotenv


class GooglePlacesEnricher:
    def __init__(
        self,
        api_key: Optional[str] = None,
        timeout: int = 30,
        auto_load_env: bool = True,
    ) -> None:
        if auto_load_env:
            load_dotenv()

        self.api_key = api_key or os.getenv("GOOGLE_MAPS_API_KEY")
        if not self.api_key:
            raise RuntimeError("Missing GOOGLE_MAPS_API_KEY")

        self.timeout = timeout
        self.search_url = "https://places.googleapis.com/v1/places:searchText"
        self.details_base_url = "https://places.googleapis.com/v1/places"

    def _search_headers(self) -> Dict[str, str]:
        return {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": self.api_key,
            "X-Goog-FieldMask": ",".join([
                "places.id",
                "places.displayName",
                "places.formattedAddress",
            ]),
        }

    def _details_headers(self) -> Dict[str, str]:
        return {
            "X-Goog-Api-Key": self.api_key,
            "X-Goog-FieldMask": ",".join([
                "id",
                "displayName",
                "formattedAddress",
                "location",
                "rating",
                "googleMapsUri",
                "regularOpeningHours",
                "currentOpeningHours",
            ]),
        }

    def build_query(self, item: Dict[str, Any]) -> str:
        title = (item.get("title") or "").strip()
        address = (item.get("address") or "").strip()

        if title and address:
            return f"{title}, {address}"
        return title or address

    def search_place_id(self, query: str) -> Optional[str]:
        if not query:
            return None

        payload = {
            "textQuery": query,
            "maxResultCount": 1,
        }

        resp = requests.post(
            self.search_url,
            headers=self._search_headers(),
            json=payload,
            timeout=self.timeout,
        )
        resp.raise_for_status()

        data = resp.json()
        places = data.get("places", [])
        if not places:
            return None

        return places[0].get("id")

    def get_place_details(self, place_id: str) -> Dict[str, Any]:
        resp = requests.get(
            f"{self.details_base_url}/{place_id}",
            headers=self._details_headers(),
            timeout=self.timeout,
        )
        resp.raise_for_status()
        return resp.json()

    def enrich_item_in_place(self, item: Dict[str, Any]) -> bool:
        query = self.build_query(item)
        item["google_query"] = query

        if not query:
            item["google_match_found"] = False
            return False

        try:
            place_id = self.search_place_id(query)
            if not place_id:
                item["google_match_found"] = False
                return False

            details = self.get_place_details(place_id)
            location = details.get("location", {})

            item["google_match_found"] = True
            item["google_place_id"] = details.get("id")
            item["google_name"] = details.get("displayName", {}).get("text")
            item["google_address"] = details.get("formattedAddress")
            item["google_maps_url"] = details.get("googleMapsUri")
            item["google_rating"] = details.get("rating")
            item["lat"] = location.get("latitude")
            item["lon"] = location.get("longitude")
            item["regular_opening_hours"] = details.get("regularOpeningHours")
            item["current_opening_hours"] = details.get("currentOpeningHours")
            return True

        except requests.HTTPError as e:
            item["google_match_found"] = False
            item["google_error"] = str(e)
            return False

    def enrich_all_in_place(self, items: List[Dict[str, Any]]) -> Dict[str, int]:
        enriched_count = 0
        not_enrichable_count = 0

        for item in items:
            ok = self.enrich_item_in_place(item)
            if ok:
                enriched_count += 1
            else:
                not_enrichable_count += 1

        return {
            "total": len(items),
            "enriched": enriched_count,
            "not_enrichable": not_enrichable_count,
        }