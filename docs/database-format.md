# Database format

For the MVP, keep the data as one normalized JSON array named `spots`.

Each record should contain:

- `id`: stable slug, never derived from the current title only.
- `name`: public-facing location name.
- `kind`: one of `food`, `lookout`, or `fashion`.
- `area`, `suburb`, `city`, `neighbourhood`: route planning fields.
- `categories`: searchable labels like `brunch`, `streetwear`, `sunset`.
- `vibeTags`: softer tags like `lowkey`, `date-night`, `architectural`.
- `description`: short operational summary.
- `whyItTrends`: what creators keep pointing out.
- `address`, `coordinates`: required for mapping and route handoff.
- `priceBand`: `$`, `$$`, `$$$`, or `null`.
- `idealVisitMinutes`: how long the stop normally takes.
- `bestFor`: visit intents such as `coffee`, `shopping`, `sunset`.
- `visitWindows`: time windows like `08:00-11:30`.
- `signals`: numeric scores from `0` to `1` for `food`, `scenic`, `fashion`, `hiddenGem`, `viral`.
- `socialProof`: aggregate evidence like mention count, creator count, and last scrape timestamp.
- `sourcePosts`: the original social posts used to justify the record.

Example:

```json
{
  "id": "somebuddy-loves-you",
  "name": "Somebuddy Loves You",
  "kind": "fashion",
  "area": "Collingwood",
  "suburb": "Collingwood",
  "city": "Melbourne",
  "neighbourhood": "Smith Street",
  "categories": ["fashion", "boutique", "independent labels"],
  "vibeTags": ["cool", "indie", "giftable"],
  "description": "Compact boutique with playful brand mix and a street-conscious feel.",
  "whyItTrends": "Frequently lands in Fitzroy-Collingwood shopping edits.",
  "address": "397 Smith Street, Fitzroy VIC",
  "coordinates": { "lat": -37.79853, "lng": 144.98522 },
  "priceBand": "$$",
  "idealVisitMinutes": 35,
  "bestFor": ["shopping", "gifts", "fashion detour"],
  "visitWindows": ["11:00-18:00"],
  "signals": {
    "food": 0.06,
    "scenic": 0.08,
    "fashion": 0.91,
    "hiddenGem": 0.74,
    "viral": 0.66
  },
  "socialProof": {
    "mentions": 58,
    "creatorCount": 21,
    "lastScrapedAt": "2026-03-10T08:00:00Z"
  },
  "sourcePosts": [
    {
      "platform": "instagram",
      "url": "https://www.instagram.com/p/example/",
      "creatorHandle": "@fitzroystops",
      "caption": "If you want one Collingwood boutique that does not feel generic, start here.",
      "postedAt": "2026-02-21T05:20:00Z"
    }
  ]
}
```

When you outgrow the JSON file, split it into:

- `spots`
- `spot_categories`
- `spot_tags`
- `spot_sources`
- `spot_scores`
- `spot_opening_windows`

That maps cleanly into Postgres later without changing the frontend contract.
