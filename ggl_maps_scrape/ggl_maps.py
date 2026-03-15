import os
import json
from typing import Any, Dict, List, Optional

import requests
from dotenv import load_dotenv


class GooglePlacesClient:
    def __init__(
        self,
        api_key: Optional[str] = None,   # input: Google Maps API key
        timeout: int = 30,               # input: request timeout in seconds
        auto_load_env: bool = True,      # input: whether to auto-read .env
    ) -> None:
        # load .env file if requested
        if auto_load_env:
            load_dotenv()

        # input source: either constructor argument OR environment variable
        self.api_key = api_key or os.getenv("GOOGLE_MAPS_API_KEY")
        if not self.api_key:
            raise RuntimeError("Missing GOOGLE_MAPS_API_KEY")

        # save constructor inputs
        self.timeout = timeout
        self.search_url = "https://places.googleapis.com/v1/places:searchText"
        self.details_base_url = "https://places.googleapis.com/v1/places"

    def _search_headers(self) -> Dict[str, str]:
        """
        OUTPUT:
            request headers for the text search endpoint
        """
        return {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": self.api_key,
            "X-Goog-FieldMask": ",".join([
                "places.id",
                "places.displayName",
                "places.formattedAddress",
                "places.location",
                "places.types",
                "places.rating",
                "places.userRatingCount",
                "places.websiteUri",
                "places.googleMapsUri",
            ]),
        }

    def _details_headers(self) -> Dict[str, str]:
        """
        OUTPUT:
            request headers for the place details endpoint
        """
        return {
            "X-Goog-Api-Key": self.api_key,
            "X-Goog-FieldMask": ",".join([
                "id",
                "displayName",
                "reviews",
            ]),
        }

    def get_place_reviews(self, place_id: str) -> List[Dict[str, Any]]:
        """
        INPUT:
            place_id = one Google Place ID
            example:
            "ChIJN1t_tDeuEmsRUsoyG83frY4"

        OUTPUT:
            list of reviews as Python list[dict]
        """
        # input: place_id goes into the URL here
        url = f"{self.details_base_url}/{place_id}"

        # sends request to Google Place Details endpoint
        resp = requests.get(
            url,
            headers=self._details_headers(),
            timeout=self.timeout,
        )
        resp.raise_for_status()

        # output: raw JSON response from Google converted into Python dict
        data = resp.json()

        # output: cleaned review list
        reviews: List[Dict[str, Any]] = []

        for review in data.get("reviews", []):
            reviews.append({
                "rating": review.get("rating"),
                "text": review.get("text", {}).get("text"),
                "publish_time": review.get("publishTime"),
                "relative_publish_time": review.get("relativePublishTimeDescription"),
                "author_name": review.get("authorAttribution", {}).get("displayName"),
                "author_uri": review.get("authorAttribution", {}).get("uri"),
            })

        # output: returns list of review dictionaries
        return reviews

    def search_places(self, text_query: str, max_result_count: int = 10) -> List[Dict[str, Any]]:
        """
        INPUT:
            text_query = search keywords
            example:
            "hidden gem cafe in Adelaide"

            max_result_count = max number of search results

        OUTPUT:
            list of places as Python list[dict]
            each place includes basic info + reviews
        """
        # input: search text / keywords go here
        payload = {
            "textQuery": text_query,
            "maxResultCount": max_result_count,
        }

        # sends input JSON payload to Google Places Text Search endpoint
        resp = requests.post(
            self.search_url,
            headers=self._search_headers(),
            json=payload,   # input JSON sent to Google
            timeout=self.timeout,
        )
        resp.raise_for_status()

        # output: raw JSON response from Google converted into Python dict
        data = resp.json()

        # output: cleaned list of places
        results: List[Dict[str, Any]] = []

        for place in data.get("places", []):
            place_id = place.get("id")

            try:
                # input: place_id passed into review lookup
                reviews = self.get_place_reviews(place_id) if place_id else []
            except requests.HTTPError as e:
                print(f"Failed to fetch reviews for {place.get('displayName', {}).get('text')}: {e}")
                reviews = []

            results.append({
                "name": place.get("displayName", {}).get("text"),
                "location": place.get("formattedAddress"),
                "tags": place.get("types", []),
                "rating": place.get("rating"),
                "rating_count": place.get("userRatingCount"),
                "website": place.get("websiteUri"),
                "source_url": place.get("googleMapsUri"),
                "reviews": reviews,
            })

        # output: returns final JSON-style Python list[dict]
        return results

    @staticmethod
    def pretty_print(data: List[Dict[str, Any]], limit: Optional[int] = None) -> None:
        """
        INPUT:
            data = output from search_places() or get_place_reviews()
            limit = optional number of items to print

        OUTPUT:
            prints formatted JSON to terminal
        """
        if limit is not None:
            print(json.dumps(data[:limit], indent=2, ensure_ascii=False))
        else:
            print(json.dumps(data, indent=2, ensure_ascii=False))