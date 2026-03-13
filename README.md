# WanderAI

AI-powered outing planner that surfaces hidden gems from TikTok, Instagram, and YouTube.

## Quick Start

### Prerequisites
- Python 3.11+
- Node 18+
- Docker (for ChromaDB)

### 1. Environment setup
```bash
cp .env.example .env
# Fill in: ANTHROPIC_API_KEY, GOOGLE_MAPS_API_KEY, MAPBOX_TOKEN, APIFY_API_TOKEN
```

### 2. Backend
```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
uvicorn app.main:app --reload --port 8000
```

### 3. Frontend
```bash
cd frontend
npm install
cp .env.example .env.local
# Fill in: VITE_MAPBOX_TOKEN
npm run dev
```

### 4. ChromaDB (Docker)
```bash
docker compose up chroma -d
```

### 5. Ingest sample data into ChromaDB
```bash
cd data_pipeline
pip install -r requirements.txt
python ingestion/chroma_ingestor.py
```

### All-in-one (Docker Compose)
```bash
docker compose up --build
```

---

## Development: USE_MOCK_TOOLS=true

Set `USE_MOCK_TOOLS=true` in `.env` to run the backend without ChromaDB or Google Maps API.
The mock tools return data from `data_pipeline/data/sample_venues.json`.

---

## Team Ownership

| Module | Owner |
|---|---|
| `backend/app/schemas/` + `frontend/src/types/` | P5 (frozen — no changes without team sync) |
| `backend/app/routers/`, `backend/app/agents/` | P1 |
| `data_pipeline/`, `backend/app/tools/maps_enrich.py` | P2 |
| `backend/app/services/chroma_*`, `backend/app/tools/vector_search.py` | P3 |
| `frontend/src/` | P4 |

---

## API Reference

See `docs/contracts.md` for full request/response shapes.

| Endpoint | Method | Description |
|---|---|---|
| `/health` | GET | Liveness check |
| `/api/chat` | POST | SSE streaming chat (onboarding agent) |
| `/api/plan` | POST | Generate multi-stop itinerary |
