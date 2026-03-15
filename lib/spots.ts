import { getChromaClient, COLLECTION_NAME } from "@/lib/chroma";
import type { SearchResult, Spot, SpotKind, Venue, VenueCategory, VenueRaw } from "@/lib/types";

/* ── Normalise raw Google Places category string into a UI category ── */
export function normaliseCategory(raw: string): VenueCategory {
  const r = raw.toLowerCase();
  if (r.includes("restaurant") || r.includes("bakery") || r.includes("market") || (r.includes("food") && !r.includes("shopping"))) return "restaurant";
  if (r === "coffee" || r === "cafe" || r.includes("cafe")) return "cafe";
  if (r === "bar") return "bar";
  if (r.includes("clothing") || r.includes("shopping") || r.includes("beauty") || r.includes("home_goods")) return "shopping";
  if (r.includes("attraction") || r.includes("activity") || r.includes("entertainment") || r.includes("route") || r.includes("natural_feature") || r.includes("stadium") || r.includes("lodging") || r.includes("train_station")) return "attraction";
  return "other";
}

/** Hydrate raw JSON entries into full Venue objects with stable, unique ids.
 *  Deduplicates by google_place_id — keeps the entry with the longer description. */
export function hydrateVenues(raw: VenueRaw[]): Venue[] {
  const seen = new Map<string, Venue>();
  for (let i = 0; i < raw.length; i++) {
    const v = raw[i];
    const id = v.google_place_id ?? `venue_${i}`;
    const venue: Venue = { ...v, id, uiCategory: normaliseCategory(v.category) };
    const existing = seen.get(id);
    if (!existing || v.description.length > existing.description.length) {
      seen.set(id, venue);
    }
  }
  return Array.from(seen.values());
}

/* ── ChromaDB venue loading with in-memory cache ── */

let _cachedVenues: Venue[] | null = null;
let _cacheTimestamp = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/** Fetch all venues from ChromaDB and reconstruct VenueRaw objects.
 *  Paginates with offset/limit to work within ChromaDB cloud quota (max 300 per get). */
async function fetchVenuesFromChroma(): Promise<VenueRaw[]> {
  const client = getChromaClient();
  const collection = await client.getCollection({ name: COLLECTION_NAME });

  const PAGE_SIZE = 300;
  const total = await collection.count();
  const allIds: string[] = [];
  const allMetadatas: Record<string, unknown>[] = [];
  const allDocuments: (string | null)[] = [];

  for (let offset = 0; offset < total; offset += PAGE_SIZE) {
    const page = await collection.get({
      include: ["metadatas", "documents"],
      limit: PAGE_SIZE,
      offset,
    });
    allIds.push(...page.ids);
    allMetadatas.push(...(page.metadatas as Record<string, unknown>[]));
    allDocuments.push(...page.documents);
  }

  const venues: VenueRaw[] = [];

  for (let i = 0; i < allIds.length; i++) {
    const meta = (allMetadatas[i] ?? {}) as Record<string, unknown>;
    const doc = allDocuments[i] ?? "";

    // Extract description: prefer metadata field, otherwise parse from document
    let description = "";
    if (meta.description && typeof meta.description === "string") {
      description = meta.description;
    } else if (doc) {
      // Document format: "{name}. {description}. Category: ... Vibe: ... Tags: ... Location: ..."
      // Try to extract description between first ". " and ". Category:"
      const catIdx = doc.indexOf(". Category:");
      if (catIdx > 0) {
        const afterName = doc.indexOf(". ");
        if (afterName > 0 && afterName < catIdx) {
          description = doc.substring(afterName + 2, catIdx);
        }
      }
    }

    venues.push({
      name: String(meta.name ?? ""),
      description,
      category: String(meta.category ?? "other"),
      suburb: String(meta.suburb ?? "unknown"),
      city: String(meta.city ?? "Melbourne"),
      state: String(meta.state ?? "VIC"),
      country: String(meta.country ?? "Australia"),
      address: String(meta.address ?? ""),
      lat: Number(meta.lat ?? 0),
      lng: Number(meta.lng ?? 0),
      // ChromaDB ingest uses google_rating_count; app uses review_count
      review_count: meta.review_count != null
        ? Number(meta.review_count)
        : meta.google_rating_count != null && Number(meta.google_rating_count) !== -1
          ? Number(meta.google_rating_count)
          : null,
      price_level: meta.price_level != null && Number(meta.price_level) !== -1
        ? Number(meta.price_level)
        : null,
      vibe: meta.vibe && String(meta.vibe) !== "" ? String(meta.vibe) : null,
      tags: String(meta.tags ?? "[]"),
      opening_hours: String(meta.opening_hours ?? "[]"),
      website: meta.website ? String(meta.website) : null,
      google_maps_url: meta.google_maps_url ? String(meta.google_maps_url) : null,
      google_place_id: String(meta.google_place_id ?? allIds[i]),
      source_urls: String(meta.source_urls ?? "[]"),
    });
  }

  return venues;
}

/** Load venues from ChromaDB (cached for 1 hour) */
export async function getVenues(): Promise<Venue[]> {
  const now = Date.now();
  if (_cachedVenues && now - _cacheTimestamp < CACHE_TTL_MS) {
    return _cachedVenues;
  }

  const raw = await fetchVenuesFromChroma();
  _cachedVenues = hydrateVenues(raw);
  _cacheTimestamp = now;
  console.log(`[spots] Loaded ${_cachedVenues.length} venues from ChromaDB`);
  return _cachedVenues;
}

/** Convert a Venue into the Spot shape the planner expects */
function venueToSpot(v: Venue): Spot {
  const kindMap: Record<VenueCategory, SpotKind> = {
    restaurant: "food", cafe: "food", bar: "food",
    attraction: "lookout", shopping: "fashion", other: "food",
  };
  const tags: string[] = (() => { try { return JSON.parse(v.tags); } catch { return []; } })();
  const vibe = v.vibe ?? "";

  return {
    id: v.id,
    name: v.name,
    kind: kindMap[v.uiCategory],
    area: v.suburb !== "unknown" ? v.suburb : v.city,
    suburb: v.suburb !== "unknown" ? v.suburb : v.city,
    city: v.city,
    neighbourhood: v.suburb !== "unknown" ? v.suburb : v.city,
    categories: [v.uiCategory],
    vibeTags: tags,
    description: v.description,
    whyItTrends: v.description,
    address: v.address,
    coordinates: { lat: v.lat, lng: v.lng },
    priceBand: v.price_level == null ? null : v.price_level <= 1 ? "$" : v.price_level === 2 ? "$$" : "$$$",
    idealVisitMinutes: v.uiCategory === "cafe" ? 45 : v.uiCategory === "bar" ? 60 : v.uiCategory === "attraction" ? 60 : 75,
    bestFor: [vibe, v.uiCategory].filter(Boolean),
    visitWindows: v.uiCategory === "cafe" ? ["morning", "afternoon"] : v.uiCategory === "attraction" ? ["morning", "afternoon", "evening"] : ["afternoon", "evening"],
    signals: {
      food: v.uiCategory === "restaurant" || v.uiCategory === "cafe" ? 0.8 : 0.3,
      scenic: v.uiCategory === "attraction" || vibe === "scenic" ? 0.8 : vibe === "romantic" ? 0.7 : 0.3,
      fashion: v.uiCategory === "shopping" ? 0.8 : 0,
      hiddenGem: tags.includes("hidden-gem") || tags.includes("hidden gem") ? 0.8 : 0.3,
      viral: tags.includes("viral") || (v.review_count != null && v.review_count > 5000) ? 0.8 : 0.3,
    },
    socialProof: { mentions: v.review_count ?? 0, creatorCount: 3, lastScrapedAt: "2025-01-01" },
    sourcePosts: [],
  };
}

const KIND_KEYWORDS: Record<SpotKind, string[]> = {
  food: ["food", "eat", "brunch", "coffee", "cafe", "dinner", "lunch", "dessert", "restaurant", "bar"],
  lookout: ["lookout", "view", "sunset", "scenic", "walk", "quiet", "lowkey", "river", "photo"],
  fashion: ["fashion", "store", "shopping", "vintage", "boutique", "streetwear", "designer", "outfit"]
};

const LOWKEY_WORDS = ["lowkey", "hidden", "under the radar", "quiet", "secret"];
const VIRAL_WORDS = ["viral", "trending", "popular", "famous"];

function normalize(input: string) {
  return input.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function tokenize(input: string) {
  return normalize(input)
    .split(" ")
    .filter((token) => token.length > 1);
}

function includesPhrase(text: string, phrase: string) {
  return normalize(text).includes(normalize(phrase));
}

function buildSearchText(spot: Spot) {
  return normalize(
    [
      spot.name,
      spot.kind,
      spot.area,
      spot.suburb,
      spot.neighbourhood,
      spot.categories.join(" "),
      spot.vibeTags.join(" "),
      spot.description,
      spot.whyItTrends,
      spot.bestFor.join(" ")
    ].join(" ")
  );
}

export async function getAllSpots(): Promise<Spot[]> {
  const venues = await getVenues();
  return venues.map(venueToSpot);
}

export function inferDesiredKinds(query: string) {
  const normalizedQuery = normalize(query);
  const selectedKinds = (Object.entries(KIND_KEYWORDS) as [SpotKind, string[]][])
    .filter(([, keywords]) => keywords.some((keyword) => normalizedQuery.includes(keyword)))
    .map(([kind]) => kind);

  return selectedKinds.length > 0 ? selectedKinds : (["food", "lookout", "fashion"] as SpotKind[]);
}

function scoreSpotAgainstQuery(spot: Spot, query: string, startLocation?: string) {
  const searchText = buildSearchText(spot);
  const queryTokens = tokenize(query);
  const desiredKinds = inferDesiredKinds(query);
  let score = 0;
  const reasons: string[] = [];

  for (const token of queryTokens) {
    if (searchText.includes(token)) {
      score += token.length >= 5 ? 7 : 4;
    }
  }

  if (desiredKinds.includes(spot.kind)) {
    score += 14;
    reasons.push(`${spot.kind} intent match`);
  } else {
    score -= 5;
  }

  if (LOWKEY_WORDS.some((word) => includesPhrase(query, word))) {
    score += spot.signals.hiddenGem * 18;
    if (spot.signals.hiddenGem >= 0.6) {
      reasons.push("strong hidden-gem signal");
    }
  }

  if (VIRAL_WORDS.some((word) => includesPhrase(query, word))) {
    score += spot.signals.viral * 10;
  }

  if (includesPhrase(query, "sunset") || includesPhrase(query, "view")) {
    score += spot.signals.scenic * 18;
  }

  if (includesPhrase(query, "coffee") || includesPhrase(query, "brunch")) {
    score += spot.signals.food * 10;
  }

  if (includesPhrase(query, "fashion") || includesPhrase(query, "store") || includesPhrase(query, "shopping")) {
    score += spot.signals.fashion * 12;
  }

  if (startLocation) {
    const normalizedStart = normalize(startLocation);
    if (
      searchText.includes(normalizedStart) ||
      normalize(spot.area).includes(normalizedStart) ||
      normalize(spot.suburb).includes(normalizedStart)
    ) {
      score += 12;
      reasons.push(`close to ${startLocation}`);
    }
  }

  score += spot.socialProof.mentions / 20;

  return {
    score: Number(score.toFixed(1)),
    reason: reasons[0] ?? `matched ${spot.area} ${spot.kind} route`
  };
}

export async function searchSpots(input: {
  query: string;
  startLocation?: string;
  maxResults?: number;
}): Promise<SearchResult[]> {
  const maxResults = input.maxResults ?? 10;
  const spots = await getAllSpots();

  return spots
    .map((spot) => {
      const { score, reason } = scoreSpotAgainstQuery(spot, input.query, input.startLocation);

      return {
        ...spot,
        matchScore: score,
        matchReason: reason
      } satisfies SearchResult;
    })
    .sort((left, right) => right.matchScore - left.matchScore)
    .slice(0, maxResults);
}

export function summarizeAreas(selected: Spot[]) {
  const uniqueAreas = [...new Set(selected.map((spot) => spot.area))];
  if (uniqueAreas.length === 0) {
    return "Melbourne";
  }
  if (uniqueAreas.length === 1) {
    return uniqueAreas[0];
  }
  if (uniqueAreas.length === 2) {
    return `${uniqueAreas[0]} + ${uniqueAreas[1]}`;
  }
  return `${uniqueAreas.slice(0, 2).join(" + ")} + more`;
}
