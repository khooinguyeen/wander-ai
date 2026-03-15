# Mappy AI

Melbourne discovery app — chat with an AI local guide to find food spots, cafes, bars, attractions and plan your perfect day route.

## Features

- **AI Chat** — Conversational planning powered by Claude. Describe your vibe and get personalized recommendations.
- **Interactive Map** — Google Maps with clustered venue markers, route visualization, and directions.
- **Route Planner** — Auto-generates a day itinerary with walking/driving/transit options.
- **Venue Database** — 500+ Melbourne venues sourced from social media and enriched with Google Maps data, stored in ChromaDB.

## Tech Stack

- **Frontend:** Next.js 15 (App Router), React 19, Tailwind CSS 4
- **AI:** Claude via Vercel AI SDK (`@ai-sdk/anthropic`)
- **Map:** Google Maps (`@vis.gl/react-google-maps`)
- **Database:** ChromaDB Cloud (vector search for venue retrieval)
- **Deployment:** Vercel

## Getting Started

```bash
npm install
cp .env.example .env.local
# Fill in your API keys in .env.local
npm run dev
```

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Claude API key |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Yes | Gemini API key (used for enrichment) |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Yes | Google Maps browser API key |
| `CHROMA_API_KEY` | Yes | ChromaDB Cloud API key |
| `CHROMA_TENANT` | Yes | ChromaDB tenant |
| `CHROMA_DATABASE` | Yes | ChromaDB database name |
| `CHROMA_COLLECTION` | Yes | ChromaDB collection name |
| `GEMINI_MODEL` | No | Override default Gemini model |

## Project Structure

```
app/
  api/
    chat/          # AI chat endpoint (Claude + tool use)
    plan/          # Itinerary generation
    venues/        # Venue listing from ChromaDB
    places/        # Google Maps place details & photos
  page.tsx         # Main app page
components/
  planner-shell.tsx  # Main UI shell
  route-map.tsx      # Google Maps with markers & directions
lib/
  plan.ts            # Route planning logic
  spots.ts           # Venue data layer
  location-retrieval.ts  # ChromaDB vector search
scripts/
  rednote_pipeline.py   # Social media scraping pipeline
```

## License

Private
