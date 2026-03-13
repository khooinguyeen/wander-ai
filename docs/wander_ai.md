# WanderAI - AI-Powered Outing & Discovery Agent
**UniHack 2025 · 48-Hour Hackathon Project**
**Team Strengths:** ML / AI · Backend & Data Engineering

## 1. Overview
**WanderAI** is an AI-powered conversational agent that plans personalised outings — whether you're looking for a quiet solo workspace, a fun group hangout, or a romantic date — by surfacing hidden gems discovered on TikTok, Instagram, and YouTube, rather than relying solely on static algorithms. 

Most AI tools recommend the same popular spots trained on static datasets. WanderAI is different: it taps into real-time social signals from people actively sharing their favourite local discoveries online, combining visual social proof with robust Google Maps data.

## 2. The Problem
Planning a good outing is surprisingly hard. Existing solutions have clear limitations:
* ChatGPT and other LLMs suggest well-known places from training data — often tourist traps or outdated recommendations.
* Google Maps rankings favour popularity and ad spend over genuine uniqueness.
* Discovery apps like Yelp and TripAdvisor surface the same top-reviewed spots everyone already knows.
* **The result:** People end up at the same crowded venues, planning feels like a chore, and genuinely special local spots go undiscovered.

## 3. Our Solution
WanderAI is a three-part system:

**3.1 Conversational Onboarding Agent**
A chat-based agent that collects user preferences naturally — not through a boring form. It asks about vibe, budget, location, and group size, then builds a personalised brief.

**3.2 Multi-Source Data Pipeline**
Venue data and reviews are scraped from TikTok, Instagram, and YouTube using Apify, extracting transcripts, hashtags, and engagement metrics. This rich social context is then enriched with practical details (hours, exact address, phone) via the Google Maps API. Content is embedded and stored in a vector database (ChromaDB) so the agent can query semantically.

**3.3 Interactive Plan Output**
The agent generates a structured plan with multiple stops, displayed on an interactive Mapbox map with custom markers and a route line. Each venue card includes the originating TikTok, Instagram, or YouTube link as social proof.

## 4. Feature Roadmap

| Feature | Description | Priority |
| :--- | :--- | :--- |
| Conversational Agent | Chat-based onboarding collecting vibe, budget, location, duration | MVP |
| Plan Generation | Structured multi-stop plan from social-sourced venue data | MVP |
| Interactive Map | Mapbox GL JS with numbered markers, route line, and popups | MVP |
| Multi-Platform Source Links | Each venue links to the original TikTok/IG/YouTube video as social proof | MVP |
| Weather-Aware | Auto-check weather and prioritise indoor/outdoor spots accordingly | Post-MVP |
| Group Sync Mode | Multiple users input preferences; agent negotiates a balanced plan | Post-MVP |
| Trending Score | Rank venues combining Google Rating, Social Views, and Recency | Post-MVP |

## 5. Technical Architecture
The system is designed to be stable for hackathon demos. Live scraping is avoided during the demo; data is pre-scraped and cached in a vector database.

| Layer | Tool / Service | Why |
| :--- | :--- | :--- |
| **Scraping** | Apify | Managed TikTok, Instagram, & YouTube scraping with anti-block proxy handling. |
| **Vector DB** | ChromaDB | Embeds and stores scraped venue text and video transcripts. Enables semantic search. |
| **Data Enrichment** | Google Maps API | Adds address, opening hours, phone, and price level to venues. |
| **LLM / Agent** | Claude API (Sonnet) | Powers the conversational agent and synthesises the plan. |
| **Agent Framework** | LangGraph / LangChain | Orchestrates tool use: query vector DB, call Maps API, format output. |
| **Backend API** | Python FastAPI | Robust REST API to serve vector search results and handle LLM requests. |
| **Mapping** | Mapbox GL JS | Interactive map with dark style, custom markers, and dashed route line. |
| **Frontend** | React & Tailwind CSS | Dynamic single-page application with a split-panel UI: chat agent on the left, plan/map on the right. |

## 6. Data Pipeline
The pipeline runs in two phases:
1.  **Pre-hackathon:** Scrape venues and reviews in target cities (Adelaide, Melbourne, Sydney) using Apify actors for TikTok, Instagram, and YouTube. Extract descriptions, transcripts, and view counts.
2.  **Enrichment & Embedding:** Pass venue names to Google Maps API to retrieve standard operational data. Embed combined records as text using a sentence transformer model and store in ChromaDB.
3.  **At query time:** The agent embeds the user's preference summary and performs a nearest-neighbour search in ChromaDB.

## 7. Competitive Differentiation

| Feature | WanderAI | ChatGPT | Google Maps | Yelp |
| :--- | :--- | :--- | :--- | :--- |
| **TikTok/IG/YouTube Data** | Yes | No | No | No |
| **Conversational Planning** | Yes | Yes | No | No |
| **Hidden Gems Focus** | Yes | No | No | No |
| **Interactive Map + Route** | Yes | No | Yes | No |
| **Social Proof (Source Link)**| Yes | No | No | No |

> **Our moat:** Combining multi-platform social media data with Google Maps operational accuracy is the defensible differentiator. 

## 8. Hackathon Demo Flow
1.  **User types:** *"Looking for a chill spot to hang out with 3 friends in the CBD, $40pp"*.
2.  **Agent responds:** Asks 2-3 natural follow-up questions.
3.  **Loading:** *"Searching social platforms for hidden gems..."* animation appears.
4.  **Plan appears:** Structured output with times, descriptions, and social view counts.
5.  **Interactive Map:** Shows stops and route visually.
6.  **The Wow Moment:** Clicking a venue shows the original YouTube vlog or TikTok video link as proof.

## 9. Post-Hackathon Vision
* **Booking Integration:** Direct booking via OpenTable or Resy API.
* **Group Sync Mode:** Finding a plan that satisfies the whole friend group.
* **User Profiles:** Memory of past outings improves recommendations.
* **City Expansion:** Scale the scraping pipeline to cover any city globally.

**WanderAI**
*Find somewhere they haven't been. Find somewhere everyone doesn't know.*