import os
import json
from typing import Any, Dict, List, Optional

import requests
from dotenv import load_dotenv


class FacebookSearchScraperClient:
    def __init__(
        self,
        apify_token: Optional[str] = None,   # input: Apify token
        actor_id: str = "apify~facebook-search-scraper",   # input: actor id
        timeout: int = 300,   # input: timeout in seconds
        auto_load_env: bool = True,   # input: load .env automatically
    ) -> None:
        if auto_load_env:
            load_dotenv()

        self.apify_token = apify_token or os.getenv("APIFY_TOKEN")
        if not self.apify_token:
            raise ValueError("Missing APIFY_TOKEN")

        self.actor_id = actor_id
        self.timeout = timeout
        self.base_url = "https://api.apify.com/v2/acts"

    @property
    def headers(self) -> Dict[str, str]:
        # output: headers used for API request
        return {
            "Authorization": f"Bearer {self.apify_token}",
            "Content-Type": "application/json",
        }

    def search(
        self,
        categories: List[str],                 # input: category keywords
        locations: Optional[List[str]] = None, # input: locations
        results_limit: int = 20,               # input: max results
    ) -> List[Dict[str, Any]]:
        """
        INPUT:
            categories = list of category/search strings
            locations = optional list of locations
            results_limit = max number of results

        OUTPUT:
            JSON response from Apify as Python list[dict]
        """

        # input JSON payload sent to actor
        payload: Dict[str, Any] = {
            "categories": categories,
            "resultsLimit": results_limit,
        }

        if locations:
            payload["locations"] = locations

        resp = requests.post(
            f"{self.base_url}/{self.actor_id}/run-sync-get-dataset-items",
            headers=self.headers,
            json=payload,
            timeout=self.timeout,
        )

        print("HTTP:", resp.status_code)
        print("Payload sent:")
        print(json.dumps(payload, indent=2, ensure_ascii=False))
        print("Response preview:")
        print(resp.text[:4000])

        resp.raise_for_status()
        data = resp.json()

        if not isinstance(data, list):
            raise ValueError("Unexpected response format from Apify")

        return data

    def search_single(
        self,
        category: str,                  # input: one category string
        location: Optional[str] = None, # input: one location string
        results_limit: int = 20,        # input: max results
    ) -> List[Dict[str, Any]]:
        """
        INPUT:
            category = one category/search string
            location = optional location
            results_limit = max number of results

        OUTPUT:
            same as search(): Python list[dict]
        """
        return self.search(
            categories=[category],
            locations=[location] if location else None,
            results_limit=results_limit,
        )

    @staticmethod
    def pretty_print(items: List[Dict[str, Any]], limit: int = 5) -> None:
        # output: pretty JSON to terminal
        print(json.dumps(items[:limit], indent=2, ensure_ascii=False))
        