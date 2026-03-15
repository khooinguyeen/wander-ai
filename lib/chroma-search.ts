/**
 * ChromaDB vector search layer.
 * Queries the hosted "venues" collection and maps results back to Spot objects
 * compatible with the planning engine.
 */

import { getVenuesCollection } from "@/lib/chroma";
import { normaliseCategory } from "@/lib/spots";
import type { Spot, SpotKind, VenueCategory } from "@/lib/types";
import type { UserPreferences } from "@/lib/types";

/* ── helpers ─────────────────────────────────────────────────── */

const KIND_MAP: Record<VenueCategory, SpotKind> = {
  restaurant: "food",
  cafe: "food",
  bar: "food",
  attraction: "lookout",
  shopping: "fashion",
  other: "food",
};

function chromaMetaToSpot(
  id: string,
  meta: Record<string, unknown>,
  document: string,
  score: number,
): Spot {
  const category = normaliseCategory((meta.category as string) ?? "other");
  const tags: string[] = (() => {
    try {
      return JSON.parse((meta.tags as string) ?? "[]");
    } catch {
      return [];
    }
  })();
  const vibe = (meta.vibe as string) ?? "";
  const priceLevel = meta.price_level as number | null;
  const reviewCount =
    (meta.google_rating_count as number | null) ??
    (meta.review_count as number | null) ??
    0;

  return {
    id,
    name: (meta.name as string) ?? "",
    kind: KIND_MAP[category],
    area: (meta.suburb as string) !== "unknown" ? (meta.suburb as string) : (meta.city as string) ?? "Melbourne",
    suburb: (meta.suburb as string) ?? "Melbourne",
    city: (meta.city as string) ?? "Melbourne",
    neighbourhood: (meta.suburb as string) !== "unknown" ? (meta.suburb as string) : (meta.city as string) ?? "Melbourne",
    categories: [category],
    vibeTags: tags,
    description: document || ((meta.description as string) ?? ""),
    whyItTrends: document || "",
    address: (meta.address as string) ?? "",
    coordinates: {
      lat: (meta.lat as number) ?? 0,
      lng: (meta.lng as number) ?? 0,
    },
    priceBand:
      priceLevel == null || priceLevel < 0
        ? null
        : priceLevel <= 1
          ? "$"
          : priceLevel === 2
            ? "$$"
            : "$$$",
    idealVisitMinutes:
      category === "cafe" ? 45 : category === "bar" ? 60 : category === "attraction" ? 60 : 75,
    bestFor: [vibe, category].filter(Boolean),
    visitWindows:
      category === "cafe"
        ? ["morning", "afternoon"]
        : category === "attraction"
          ? ["morning", "afternoon", "evening"]
          : ["afternoon", "evening"],
    signals: {
      food: category === "restaurant" || category === "cafe" ? 0.8 : 0.3,
      scenic: category === "attraction" || vibe === "scenic" ? 0.8 : vibe === "romantic" ? 0.7 : 0.3,
      fashion: category === "shopping" ? 0.8 : 0,
      hiddenGem: tags.includes("hidden-gem") || tags.includes("hidden gem") ? 0.8 : 0.3,
      viral:
        tags.includes("viral") || (reviewCount != null && reviewCount > 5000)
          ? 0.8
          : 0.3,
    },
    socialProof: {
      mentions: reviewCount ?? 0,
      creatorCount: 3,
      lastScrapedAt: "2025-01-01",
    },
    sourcePosts: [],
  };
}

/* ── build query string from preferences ─────────────────────── */

function buildPreferenceQuery(prefs: UserPreferences, baseQuery?: string): string {
  const parts: string[] = [];

  if (baseQuery) parts.push(baseQuery);
  if (prefs.interests?.length) parts.push(prefs.interests.join(" "));
  if (prefs.vibe) parts.push(prefs.vibe);
  if (prefs.dietaryNeeds) parts.push(prefs.dietaryNeeds);
  if (prefs.budget) {
    const budgetMap = { low: "budget-friendly affordable", medium: "mid-range", high: "premium upscale" };
    parts.push(budgetMap[prefs.budget]);
  }
  if (prefs.groupType) parts.push(prefs.groupType);

  return parts.join(" ") || "best spots in Melbourne";
}

/* ── build ChromaDB where filter ─────────────────────────────── */

function buildWhereFilter(params: {
  area?: string;
  budget?: "low" | "medium" | "high";
}): any {
  const conditions: Record<string, unknown>[] = [];

  if (params.area) {
    conditions.push({ suburb: { $eq: params.area } });
  }

  if (params.budget) {
    const priceMap = { low: 1, medium: 2, high: 3 };
    conditions.push({ price_level: { $lte: priceMap[params.budget] } });
  }

  if (conditions.length === 0) return undefined;
  if (conditions.length === 1) return conditions[0];
  return { $and: conditions };
}

/* ── public search functions ─────────────────────────────────── */

/**
 * Semantic search via ChromaDB embeddings.
 * Returns Spot[] ranked by vector similarity to the query.
 */
export async function chromaSearch(params: {
  query: string;
  area?: string;
  maxResults?: number;
}): Promise<(Spot & { matchScore: number })[]> {
  const collection = await getVenuesCollection();
  const nResults = params.maxResults ?? 8;

  const results = await collection.query({
    queryTexts: [params.query],
    nResults,
    where: params.area ? { suburb: { $eq: params.area } } : undefined,
  });

  if (!results.ids?.[0]) return [];

  return results.ids[0].map((id, i) => {
    const meta = (results.metadatas?.[0]?.[i] ?? {}) as Record<string, unknown>;
    const doc = results.documents?.[0]?.[i] ?? "";
    const distance = results.distances?.[0]?.[i] ?? 1;
    // ChromaDB returns distances — lower = more similar. Convert to a 0-100 score.
    const score = Math.max(0, 100 - distance * 50);

    return {
      ...chromaMetaToSpot(id, meta, doc, score),
      matchScore: Number(score.toFixed(1)),
    };
  });
}

/**
 * Search ChromaDB using structured user preferences.
 * Builds a rich semantic query from the preference fields.
 */
export async function chromaSearchByPreferences(params: {
  preferences: UserPreferences;
  baseQuery?: string;
  area?: string;
  maxResults?: number;
}): Promise<(Spot & { matchScore: number })[]> {
  const collection = await getVenuesCollection();
  const nResults = params.maxResults ?? 10;
  const queryText = buildPreferenceQuery(params.preferences, params.baseQuery);

  const whereFilter = buildWhereFilter({
    area: params.area,
    budget: params.preferences.budget,
  });

  const results = await collection.query({
    queryTexts: [queryText],
    nResults,
    where: whereFilter,
  });

  if (!results.ids?.[0]) return [];

  return results.ids[0].map((id, i) => {
    const meta = (results.metadatas?.[0]?.[i] ?? {}) as Record<string, unknown>;
    const doc = results.documents?.[0]?.[i] ?? "";
    const distance = results.distances?.[0]?.[i] ?? 1;
    const score = Math.max(0, 100 - distance * 50);

    return {
      ...chromaMetaToSpot(id, meta, doc, score),
      matchScore: Number(score.toFixed(1)),
    };
  });
}
