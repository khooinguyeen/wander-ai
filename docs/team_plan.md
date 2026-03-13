# WanderAI — Team Plan & Directory Structure
**UniHack 2025 · 48-Hour Hackathon · 5-Person Team**

---

## Team Split

| Person | Role | Short description |
| :--- | :--- | :--- |
| **P1** | Backend / Agent Engineer | FastAPI server + LangChain agents + prompt engineering |
| **P2** | Data Pipeline Engineer | Apify scrapers + Google Maps enrichment + `sample_venues.json` |
| **P3** | Vector DB / ML Engineer | ChromaDB + embeddings + `vector_search` tool |
| **P4** | Frontend Engineer | React UI + chat panel + plan cards + Mapbox map |
| **P5** | Integration Lead | Shared contracts + env setup + boilerplate — **starts first, unblocks everyone** |

---

## Core Principle: Mock First, Integrate Later

Every person builds against **mock interfaces** from Hour 0. Real tools are swapped in as they become ready.
This means no one is blocked waiting for someone else.

```
P5 defines contracts (Hour 0:30)
    ↓
P2 ships sample_venues.json (Hour 0:45)  ←── most critical deliverable
    ↓                   ↓
P3 ingests into         P4 uses as mockApi data
ChromaDB (Hour 2:15)    (frontend dev fully unblocked)
    ↓
P1 swaps mock → real tools (Hour 3:00)
    ↓
Full integration (Hour 4:00)
```

---

## Directory Structure

```
wander-ai/
│
├── .env.example                          # P5 — all env vars template
├── .gitignore                            # P5
├── README.md                             # P5 — setup instructions
├── docker-compose.yml                    # P5 — ChromaDB + backend + frontend
│
├── docs/
│   ├── wander_ai.md                      # product spec (existing)
│   ├── architecture.puml                 # component diagram (existing)
│   ├── sequence.puml                     # sequence diagram (existing)
│   ├── team_plan.md                      # this file
│   └── contracts.md                      # P5 — REST API contract reference
│
├── backend/
│   ├── pyproject.toml                    # P5 — Python dependencies
│   ├── Dockerfile                        # P5
│   ├── .env.example                      # P5
│   └── app/
│       ├── __init__.py
│       ├── main.py                       # P1 — FastAPI app, CORS, router mounts
│       ├── config.py                     # P5 — pydantic Settings (reads .env)
│       │
│       ├── schemas/                      # ⚠️  FROZEN after Hour 0:30 — no changes without team sync
│       │   ├── __init__.py
│       │   ├── venue.py                  # P5 — VenueRecord, SocialMetadata, MapDetails
│       │   ├── chat.py                   # P5 — ChatRequest, ChatMessage, PreferenceBrief
│       │   └── plan.py                   # P5 — PlanOutput, Stop, PlanRequest
│       │
│       ├── routers/
│       │   ├── __init__.py
│       │   ├── health.py                 # P5 — GET /health
│       │   ├── chat.py                   # P1 — POST /api/chat (SSE stream)
│       │   └── plan.py                   # P1 — POST /api/plan (JSON)
│       │
│       ├── agents/
│       │   ├── __init__.py
│       │   ├── conversational.py         # P1 — onboarding Q&A → PreferenceBrief
│       │   ├── plan_generator.py         # P1 — venue candidates → PlanOutput
│       │   └── prompts.py                # P1 — all system prompts & prompt templates
│       │
│       ├── tools/
│       │   ├── __init__.py
│       │   ├── vector_search.py          # P3 — LangChain Tool: query → VenueRecord[]
│       │   ├── maps_enrich.py            # P2 — LangChain Tool: venue name → MapDetails
│       │   └── format_plan.py            # P1 — LangChain Tool: structured JSON output
│       │
│       ├── services/
│       │   ├── __init__.py
│       │   ├── chroma_client.py          # P3 — ChromaDB connection singleton
│       │   ├── embedding_service.py      # P3 — all-MiniLM-L6-v2 wrapper
│       │   └── maps_service.py           # P2 — Google Maps Places API client
│       │
│       ├── mocks/
│       │   ├── __init__.py
│       │   ├── mock_vector_search.py     # P3 — returns data from sample_venues.json
│       │   └── mock_maps_service.py      # P2 — returns hardcoded MapDetails
│       │
│       └── tests/
│           ├── __init__.py
│           ├── test_chat_router.py       # P1
│           ├── test_plan_router.py       # P1
│           ├── test_vector_search.py     # P3
│           └── test_maps_service.py      # P2
│
├── data_pipeline/
│   ├── requirements.txt                  # P2 — pipeline-specific deps
│   ├── README.md                         # P2 — how to run the pipeline
│   │
│   ├── schemas/
│   │   ├── __init__.py
│   │   └── venue_schema.py               # P2 — Pydantic model matching sample_venues.json exactly
│   │
│   ├── scrapers/
│   │   ├── __init__.py
│   │   ├── apify_tiktok.py               # P2
│   │   ├── apify_instagram.py            # P2
│   │   └── apify_youtube.py              # P2
│   │
│   ├── enrichment/
│   │   ├── __init__.py
│   │   └── google_maps_enricher.py       # P2 — takes raw venues, adds Maps details
│   │
│   ├── ingestion/
│   │   ├── __init__.py
│   │   └── chroma_ingestor.py            # P2 + P3 — JSON → embed → ChromaDB upsert
│   │
│   └── data/
│       ├── sample_venues.json            # P2 — ⚡ FIRST DELIVERABLE (target: Hour 0:45)
│       ├── raw/                          # gitignored — raw Apify outputs
│       └── enriched/                     # gitignored — post-enrichment records
│
└── frontend/
    ├── package.json                      # P5 — React, TS, Tailwind, Mapbox, Zustand
    ├── vite.config.ts                    # P5
    ├── tsconfig.json                     # P5
    ├── tailwind.config.ts                # P4
    ├── Dockerfile                        # P5
    ├── index.html                        # P4
    ├── .env.example                      # P5 — VITE_MAPBOX_TOKEN, VITE_API_BASE_URL
    │
    ├── public/
    │   ├── sample_venues.json            # copy of data_pipeline/data/sample_venues.json
    │   └── wander-logo.svg               # P4
    │
    └── src/
        ├── main.tsx                      # P4 — React entry point
        ├── App.tsx                       # P4 — root layout: split panel (chat | plan+map)
        │
        ├── types/                        # ⚠️  FROZEN after Hour 0:30 — mirrors backend schemas
        │   ├── api.ts                    # P5 — ChatRequest, SSEEvent, PlanOutput, Stop
        │   ├── venue.ts                  # P5 — VenueRecord, SocialMetadata, MapDetails
        │   └── chat.ts                   # P5 — ConversationState, ChatMessage
        │
        ├── api/
        │   ├── chatApi.ts                # P4 — real SSE client for /api/chat
        │   ├── planApi.ts                # P4 — real fetch client for /api/plan
        │   └── mockApi.ts                # P4 — mock responses, used until real API is ready
        │
        ├── components/
        │   ├── chat/
        │   │   ├── ChatPanel.tsx         # P4 — left panel container
        │   │   ├── MessageList.tsx       # P4 — scrollable conversation history
        │   │   ├── MessageBubble.tsx     # P4 — user vs agent message styling
        │   │   ├── ChatInput.tsx         # P4 — text input + send button
        │   │   └── TypingIndicator.tsx   # P4 — animated "WanderAI is thinking..."
        │   │
        │   ├── plan/
        │   │   ├── PlanPanel.tsx         # P4 — right panel: itinerary list
        │   │   ├── PlanHeader.tsx        # P4 — title, tagline, budget estimate
        │   │   ├── ItineraryCard.tsx     # P4 — single stop card
        │   │   └── SocialProofBadge.tsx  # P4 — platform icon + view count + link
        │   │
        │   └── map/
        │       ├── MapView.tsx           # P4 — Mapbox GL JS wrapper
        │       ├── VenueMarker.tsx       # P4 — numbered custom marker
        │       └── RouteLayer.tsx        # P4 — dashed route line between stops
        │
        ├── hooks/
        │   ├── useChat.ts                # P4 — conversation state + SSE subscription
        │   ├── usePlan.ts                # P4 — plan fetch + state management
        │   └── useMapbox.ts              # P4 — map init, markers, flyTo
        │
        ├── store/
        │   └── appStore.ts               # P4 — Zustand global state
        │
        └── styles/
            ├── globals.css               # P4 — Tailwind base + CSS variables
            └── mapbox-overrides.css      # P4 — dark theme for Mapbox popups/controls
```

---

## Interface Contracts (Frozen at Hour 0:30)

### Pydantic Schemas — `backend/app/schemas/`

**`venue.py`**
```python
class SocialMetadata(BaseModel):
    platform: Literal["tiktok", "instagram", "youtube"]
    source_url: HttpUrl
    view_count: int
    likes: Optional[int] = None
    caption: Optional[str] = None

class MapDetails(BaseModel):
    address: str
    phone: Optional[str] = None
    rating: Optional[float] = None        # Google rating 1.0–5.0
    price_level: Optional[int] = None     # 0–4
    opening_hours: Optional[list[str]] = None
    google_place_id: Optional[str] = None

class VenueRecord(BaseModel):
    venue_id: str                          # slug e.g. "mismatch-brewing-adelaide"
    name: str
    city: str                              # "Adelaide" | "Melbourne" | "Sydney"
    category: str                          # "cafe"|"bar"|"restaurant"|"park"|"activity"
    description: str
    lat: float
    lng: float
    social: SocialMetadata
    maps: Optional[MapDetails] = None
    tags: list[str] = []
```

**`chat.py`**
```python
class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str

class PreferenceBrief(BaseModel):
    vibe: str
    budget_pp: Optional[float] = None
    location: str
    group_size: int = 1
    duration_hours: Optional[float] = None
    extra_notes: Optional[str] = None

class ChatRequest(BaseModel):
    message: str
    session_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    history: list[ChatMessage] = []
```

**`plan.py`**
```python
class Stop(BaseModel):
    stop_number: int
    time_slot: str               # "7:00 PM"
    venue_name: str
    category: str
    description: str             # agent-written narrative
    tip: str                     # insider tip
    address: str
    lat: float
    lng: float
    social: SocialMetadata
    maps: Optional[MapDetails] = None
    duration_minutes: int = 60

class PlanOutput(BaseModel):
    plan_id: str
    title: str
    tagline: str
    stops: list[Stop]            # 3–5 stops ordered chronologically
    total_duration_hours: float
    budget_estimate_pp: float
    generated_at: str            # ISO timestamp
```

### REST API Contracts

**`POST /api/chat`** — returns SSE stream
```
Request:
  { "message": "chill spot CBD $40pp", "session_id": "uuid", "history": [] }

Each SSE event:
  data: {"type": "chunk", "content": "What kind of vibe are you after"}
  data: {"type": "done", "session_id": "abc", "is_complete": false}

Final event (onboarding complete):
  data: {"type": "done", "session_id": "abc", "is_complete": true,
         "preference_brief": {"vibe": "chill", "budget_pp": 40, "location": "CBD Adelaide",
                              "group_size": 3, "duration_hours": 3}}
```

**`POST /api/plan`** — returns JSON
```
Request:
  { "preference_brief": { "vibe": "chill", "budget_pp": 40, "location": "CBD Adelaide",
                          "group_size": 3, "duration_hours": 3 } }

Response: PlanOutput JSON
  {
    "plan_id": "uuid",
    "title": "A Chill Friday Night in Adelaide CBD",
    "tagline": "Hidden gems, zero tourists, maximum vibe",
    "stops": [ { "stop_number": 1, "time_slot": "6:00 PM", "venue_name": "...", ... } ],
    "total_duration_hours": 3.5,
    "budget_estimate_pp": 38.0,
    "generated_at": "2025-04-12T18:00:00Z"
  }
```

**`GET /health`**
```
{ "status": "ok", "chroma": "connected", "claude": "reachable" }
```

---

## `sample_venues.json` Schema

**File path:** `data_pipeline/data/sample_venues.json`
**Also copy to:** `frontend/public/sample_venues.json`

Target: **25 venues** — Adelaide (14), Melbourne (9), Sydney (2).
Mix: cafe / bar / restaurant / park / activity.

```json
[
  {
    "venue_id": "mismatch-brewing-adelaide",
    "name": "Mismatch Brewing Co",
    "city": "Adelaide",
    "category": "bar",
    "description": "Adelaide's most aesthetic brewery. Exposed brick, low lighting, and a rotating tap list. Featured in multiple TikToks for its hidden gem back-lane entrance on Gilbert Street.",
    "lat": -34.9285,
    "lng": 138.5999,
    "social": {
      "platform": "tiktok",
      "source_url": "https://www.tiktok.com/@adelaideguide/video/7234567890123",
      "view_count": 284000,
      "likes": 31200,
      "caption": "You HAVE to visit this hidden Adelaide brewery #adelaidehiddengems"
    },
    "maps": {
      "address": "25 Gilbert St, Adelaide SA 5000",
      "phone": "+61 8 8212 0099",
      "rating": 4.6,
      "price_level": 2,
      "opening_hours": [
        "Monday: Closed",
        "Friday: 3:00 PM – 12:00 AM",
        "Saturday: 12:00 PM – 12:00 AM",
        "Sunday: 12:00 PM – 9:00 PM"
      ],
      "google_place_id": "ChIJ_abc123"
    },
    "tags": ["hidden gem", "aesthetic", "brewery", "date night", "group friendly"]
  }
]
```

**Minimum required fields** (others can be `null` initially):
`venue_id`, `name`, `city`, `category`, `description`, `lat`, `lng`,
`social.platform`, `social.source_url`, `social.view_count`

---

## Per-Person Task Plan

### P5 — Integration Lead
> Goal: Unblock everyone within the first 30 minutes.

| Time | Task | Output |
| :--- | :--- | :--- |
| 0:00–0:20 | Create full directory skeleton, all empty `__init__.py` | All folders exist, `git init`, first commit |
| 0:20–0:40 | Write `backend/app/schemas/` (venue.py, chat.py, plan.py) | Pydantic contracts ready |
| 0:20–0:40 | Write `frontend/src/types/` (venue.ts, api.ts, chat.ts) | TypeScript contracts ready |
| 0:40–1:00 | Write `config.py`, all `.env.example` files | Env setup clear for everyone |
| 1:00–1:30 | Write `docs/contracts.md`, `README.md` with setup steps | Onboarding doc done |
| 1:30–2:30 | `package.json` + Vite + Tailwind scaffold; `pyproject.toml` | `npm run dev` and `uvicorn` start clean |
| 2:30–4:00 | `docker-compose.yml`, `/health` endpoint, Dockerfile × 2 | Full stack starts with one command |
| 4:00+ | Integration support — fix type mismatches, help with CORS, wiring | |

**Key deliverable:** At Hour 0:30, announce "schemas frozen, everyone pull."

---

### P2 — Data Pipeline Engineer
> Goal: Ship `sample_venues.json` ASAP — it unblocks P3 and P4.

| Time | Task | Output |
| :--- | :--- | :--- |
| 0:00–0:45 | ⚡ **Handwrite `sample_venues.json`** — 25 venues, real names, real coords | Most critical deliverable of the hackathon |
| 0:45–1:00 | Announce in team chat: "sample_venues.json committed" | P3 + P4 can start using it |
| 0:45–1:15 | `data_pipeline/schemas/venue_schema.py` — validate every record in the file | Pydantic validation passes for all 25 |
| 1:15–2:00 | `backend/app/services/maps_service.py` — Google Maps Places API client | Test with 2–3 real venues, confirm response shape |
| 2:00–2:30 | `data_pipeline/enrichment/google_maps_enricher.py` — batch enrich raw venues | Enriched records ready |
| 2:30–3:30 | `backend/app/tools/maps_enrich.py` — LangChain Tool wrapping maps_service | Tool P1 can call |
| 3:30–3:45 | `backend/app/mocks/mock_maps_service.py` — returns `maps` field from sample_venues.json | P1 can use immediately if Maps API isn't ready |
| 3:45–4:00 | Announce "maps_enrich tool ready, swap mock in plan_generator.py" | P1 integrates |
| 4:00+ | Apify scrapers (`apify_tiktok.py`, etc.) — background runs for real data | 200+ real venues by Hour 8 |

**Key deliverable:** `sample_venues.json` at Hour 0:45.

---

### P3 — Vector DB / ML Engineer
> Goal: Provide a working `vector_search` LangChain tool and a mock version.

| Time | Task | Output |
| :--- | :--- | :--- |
| 0:00–0:30 | `backend/app/services/chroma_client.py` — ChromaDB connection + collection setup | Local ChromaDB running |
| 0:30–1:00 | `backend/app/services/embedding_service.py` — `all-MiniLM-L6-v2` wrapper | `embed(text) -> list[float]` working |
| 1:00–1:45 | `data_pipeline/ingestion/chroma_ingestor.py` — load JSON → embed → upsert | Waits for P2's `sample_venues.json` (Hour 0:45) |
| 1:45–2:15 | Run ingestor with 25 sample venues, verify with test queries | Semantic search returning relevant venues |
| 2:15–3:00 | `backend/app/tools/vector_search.py` — LangChain Tool: query string → top-k `VenueRecord[]` | Tool P1 can call in agents |
| 3:00–3:30 | `backend/app/mocks/mock_vector_search.py` — 5 hardcoded venues from sample data | P1 can develop agents without waiting for ChromaDB |
| 3:00–3:30 | Announce "mock_vector_search ready, P1 can start agents now" | |
| 3:30–4:00 | `tests/test_vector_search.py`, tune embedding query (concatenate vibe + location + category hint) | Tests pass |
| 4:00+ | Swap P1's mock for real tool when ChromaDB confirmed working | |

**Key deliverable:** `mock_vector_search.py` at Hour 3:00, then real tool at Hour 3:30.

---

### P1 — Backend / Agent Engineer
> Goal: Working `/api/chat` SSE + `/api/plan` endpoints using mocks initially.

| Time | Task | Output |
| :--- | :--- | :--- |
| 0:00–0:30 | `app/main.py` — FastAPI app, CORS, router mounts, `/health` returns 200 | Server starts, health check passes |
| 0:30–1:00 | Stub `/api/chat` returning a hardcoded 3-chunk SSE stream | Test end-to-end SSE parsing with P4 |
| 1:00–2:00 | `agents/conversational.py` using `mock_vector_search` | Multi-turn Q&A, detects completion, emits `PreferenceBrief` |
| 2:00–2:45 | `agents/plan_generator.py` using `mock_vector_search` + `mock_maps_service` | Candidates → valid `PlanOutput` JSON |
| 2:45–3:15 | `routers/plan.py` fully wired, test with curl | `POST /api/plan` returns real `PlanOutput` |
| 3:15–3:30 | Real SSE streaming in `routers/chat.py` via `StreamingResponse` | Typewriter effect works end-to-end |
| 3:30–4:00 | `agents/prompts.py` — tune system prompt, test edge cases | Agent asks 2–3 questions, not 10 |
| 4:00+ | Swap mocks for real tools as P2/P3 complete them | Full pipeline integrated |

**Sync at Hour 0:30:** Confirm SSE parsing works with P4 before building more.

---

### P4 — Frontend Engineer
> Goal: Full UI built against mock data, ready to swap in real API.

| Time | Task | Output |
| :--- | :--- | :--- |
| 0:00–0:30 | Vite scaffold from P5's `package.json`, import types, blank split-panel renders | `npm run dev` shows layout |
| 0:30–1:00 | `api/mockApi.ts` — fake SSE stream + hardcoded `PlanOutput` from sample data | All UI work unblocked |
| 1:00–2:00 | `ChatPanel` → `MessageList` → `MessageBubble` + `useChat` hook wired to mockApi | Streaming typewriter animation works |
| 2:00–3:00 | `PlanPanel` → `PlanHeader` + `ItineraryCard` × N + `SocialProofBadge` + `usePlan` | All 3 mock stops render correctly |
| 3:00–4:00 | `MapView.tsx` — Mapbox dark style, numbered markers, dashed route, flyTo on plan load | Map renders with mock stops |
| 4:00–5:00 | Wire real `chatApi.ts` + `planApi.ts` (swap out mockApi) | End-to-end with real backend |
| 5:00+ | Polish — loading states, error states, mobile layout, animations | Demo-ready UI |

**Sync at Hour 2:00:** SSE smoke test with P1's real backend stub before adding more UI.

---

## Team Sync Schedule

| Time | Who | Topic |
| :--- | :--- | :--- |
| **Hour 0:30** | P5 → All | "Schemas are frozen. Everyone pull. No field renames without team verbal sync." |
| **Hour 0:45** | P2 → All | "`sample_venues.json` committed. P3: start ingestor. P4: copy to `frontend/public/`." |
| **Hour 2:00** | P1 + P4 | SSE smoke test — confirm streaming parse works end-to-end |
| **Hour 3:00** | P3 → P1 | "Real `vector_search` tool ready. Swap mock in `conversational.py`." |
| **Hour 3:00** | P2 → P1 | "Real `maps_enrich` tool ready. Swap mock in `plan_generator.py`." |
| **Hour 4:00** | All | Full integration check — backend + frontend end-to-end |
| **Hour 6:00** | P1 + P4 | Final contract lock — confirm `PlanOutput` JSON ↔ TypeScript type alignment |
| **Hour 8:00+** | P2 | Load real Apify data — replaces 25 sample venues with 200+ real venues |

---

## The One Critical Rule

> **No one changes `backend/app/schemas/` or `frontend/src/types/` after Hour 0:30 without a verbal sync with P1 and P4 first.**
>
> Field name drift is the #1 cause of lost hours in hackathons.
> A rename in `plan.py` cascades to the agent output, the API response, and every frontend component.
