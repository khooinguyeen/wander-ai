# RedNote research

This is the research-backed starting point for scraping RedNote / Xiaohongshu content for the Melbourne route app.

## What the official sources imply

- Xiaohongshu publishes app deeplink docs for note detail pages and search-result pages, which confirms that note detail pages are a stable consumer surface worth targeting for shared URLs.
- Xiaohongshu's `robots.txt` currently disallows crawlers from `/explore`, `/discovery/item`, and search pages, which means direct search-engine style crawling is the wrong starting point.
- The public open-platform material appears to focus on merchant or product APIs rather than a public consumer-content feed.

Practical implication:

- Start from manually collected share URLs, creator profile exports, or compliant third-party exports.
- Do not begin with a blind crawler over RedNote search pages.

## What to scrape in v1

Scrape only the fields that improve routing quality:

- Canonical note URL and note ID
- Title and description text
- Author name or handle
- Post timestamp if present
- Cover image URL and media URLs
- Hashtags or tag list
- Engagement counts: likes, comments, shares, saves or collects
- IP or city location text if present
- Any POI or location block that points to a venue or lookout

These fields are enough to:

- identify Melbourne places
- score virality vs lowkey signals
- attach proof back to the original note
- geocode the place into the app dataset

## What not to scrape first

Skip these in v1:

- comments at scale
- full media downloads
- private or login-only content
- follower graphs
- anything user-sensitive beyond public post metadata

Comments are useful later, but they add a lot of noise and rate-limit risk before the place-resolution pipeline is stable.

## Discovery strategy

Use RedNote first, but collect URLs indirectly:

1. Search manually in the app or browser with the queries in `data/rednote_melbourne_queries.json`.
2. Save shared note URLs or pasted share text into `data/rednote_seed_urls.txt`.
3. Run the pipeline to normalize URLs, fetch public note data, and resolve Melbourne places.

## Source-backed notes

Official sources:

- Xiaohongshu deeplink docs: note detail and search-result deeplinks
- Xiaohongshu robots.txt: search and note pages are disallowed for crawlers

Community sources, used as implementation hints rather than official guarantees:

- Community extractor docs indicate web scraping is usually based on initial-state data embedded in the note page and on redirecting `xhslink` share URLs to canonical note URLs.
- Third-party note-detail docs expose fields such as `title`, `desc`, `interact_info.liked_count`, `share_count`, `collected_count`, and `ip_location`, which are the same kinds of fields worth preserving in our normalized raw-post store.
