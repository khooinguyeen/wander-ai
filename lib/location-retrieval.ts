/**
 * Venue retrieval using the local VENUES dataset.
 * Expands a request into multiple intent-aware queries, scores each venue,
 * then personalizes and diversifies top results across locations.
 */
import { VENUES } from "@/lib/spots";
import type {
  RecommendationItem,
  RecommendationPreferences,
  RecommendationsResponse,
  TravelMode,
} from "@/lib/types";

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "in", "at", "for", "near", "of",
  "to", "is", "are", "me", "my", "some", "i", "want", "find", "show",
  "best", "top", "can", "you", "would", "like", "cafes", "places",
  "spots", "restaurants", "bars", "café", "cafe",
]);

const PRICE_BY_BUDGET: Record<"budget" | "mid" | "premium", number[]> = {
  budget: [0, 1],
  mid: [2],
  premium: [3, 4],
};

function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

const CATEGORY_ALIASES: Record<string, string[]> = {
  cafe: ["cafe", "coffee", "brunch", "breakfast", "latte", "espresso", "matcha"],
  restaurant: ["restaurant", "food", "eat", "dinner", "lunch", "dine", "meal"],
  bar: ["bar", "drink", "cocktail", "beer", "wine", "rooftop", "pub"],
  attraction: ["attraction", "scenic", "view", "lookout", "history", "museum", "gallery", "nature"],
  shopping: ["shopping", "shop", "boutique", "fashion", "vintage", "clothing", "store", "market"],
};

function categoryScore(uiCategory: string, tokens: string[]): number {
  const aliases = CATEGORY_ALIASES[uiCategory] ?? [];
  return tokens.some((t) => aliases.includes(t)) ? 1.0 : 0;
}

function textOverlapScore(venueText: string, tokens: string[]): number {
  if (!tokens.length) return 0;
  const venueTokens = new Set(tokenise(venueText));
  const hits = tokens.filter((t) => venueTokens.has(t)).length;
  return hits / tokens.length;
}

function suburbScore(suburb: string, city: string, tokens: string[]): number {
  const suburbTokens = tokenise(suburb + " " + city);
  return tokens.some((t) => suburbTokens.includes(t)) ? 1.2 : 0;
}

function parseTags(raw: string): string[] {
  try {
    return JSON.parse(raw) as string[];
  } catch {
    return [];
  }
}

function uniqueStrings(values: Array<string | undefined | null>): string[] {
  return Array.from(
    new Set(values.map((v) => (v ?? "").trim()).filter(Boolean))
  );
}

function expandQueries(queryText: string, prefs?: RecommendationPreferences): string[] {
  const category = prefs?.category ?? "";
  const area = prefs?.area ?? "";
  const vibe = prefs?.vibe ?? "";
  const coffeeStyle = prefs?.coffeeStyle ?? "";
  const cuisine = prefs?.cuisine ?? "";
  const budget = prefs?.budget ? `${prefs.budget} budget` : "";
  const dietary = prefs?.dietary ?? "";

  const base = uniqueStrings([
    queryText,
    [category, area, vibe].join(" "),
    [category, area, coffeeStyle].join(" "),
    [category, area, cuisine].join(" "),
    [category, area, budget].join(" "),
    [category, area, vibe, dietary].join(" "),
  ]);

  const areaQueries = (prefs?.targetAreas ?? [])
    .flatMap((targetArea) =>
      uniqueStrings([
        [queryText, targetArea].join(" "),
        [category, targetArea, vibe].join(" "),
        [category, targetArea, coffeeStyle || cuisine].join(" "),
      ])
    );

  const expanded = uniqueStrings([...base, ...areaQueries]);
  return expanded.slice(0, 12);
}

function budgetBoost(priceLevel: number | null, budget?: RecommendationPreferences["budget"]): number {
  if (!budget) return 1;
  if (priceLevel == null) return 0.94;
  return PRICE_BY_BUDGET[budget].includes(priceLevel) ? 1.14 : 0.86;
}

function subtypeBoost(venueText: string, prefs?: RecommendationPreferences): number {
  const tokens = tokenise(venueText);
  const style = prefs?.coffeeStyle?.toLowerCase();
  const cuisine = prefs?.cuisine?.toLowerCase();
  if (style && tokens.some((t) => style.includes(t))) return 1.18;
  if (cuisine && tokens.some((t) => cuisine.includes(t))) return 1.18;
  if (style || cuisine) return 0.9;
  return 1;
}

function transportBoost(
  suburb: string,
  city: string,
  transportMode?: TravelMode,
  startLocation?: string
): number {
  if (!transportMode || !startLocation) return 1;
  const startTokens = new Set(tokenise(startLocation));
  const areaTokens = tokenise(`${suburb} ${city}`);
  const sameArea = areaTokens.some((t) => startTokens.has(t));
  if (transportMode === "walking") return sameArea ? 1.15 : 0.82;
  if (transportMode === "transit") return sameArea ? 1.08 : 0.9;
  return 1;
}

function buildReason(
  score: number,
  venueArea: string,
  matchedBy: string[],
  budget?: RecommendationPreferences["budget"],
  transportMode?: TravelMode
): string {
  const lead = score > 0.8
    ? "Excellent fit"
    : score > 0.5
      ? "Strong fit"
      : "Good option";
  const parts = [lead, `for ${venueArea}`];
  if (matchedBy.length > 0) parts.push(`matched on ${matchedBy.slice(0, 2).join(" + ")}`);
  if (budget) parts.push(`aligned with ${budget} budget`);
  if (transportMode) parts.push(`${transportMode}-friendly`);
  return parts.join(" ") + ".";
}

type ScoredCandidate = {
  venue: (typeof VENUES)[number];
  tags: string[];
  score: number;
  queryHits: number;
  matchedBy: string[];
};

function diversifyByLocation(candidates: ScoredCandidate[], topK: number): ScoredCandidate[] {
  const byAreaCount = new Map<string, number>();
  const chosen: ScoredCandidate[] = [];

  for (const candidate of candidates) {
    const area = candidate.venue.suburb !== "unknown" ? candidate.venue.suburb : candidate.venue.city;
    const count = byAreaCount.get(area) ?? 0;
    if (count >= 2) continue;
    chosen.push(candidate);
    byAreaCount.set(area, count + 1);
    if (chosen.length >= topK) return chosen;
  }

  for (const candidate of candidates) {
    if (chosen.length >= topK) break;
    if (!chosen.some((c) => c.venue.id === candidate.venue.id)) {
      chosen.push(candidate);
    }
  }
  return chosen;
}

export async function retrieveLocations(
  queryText: string,
  topK = 5,
  preferences?: RecommendationPreferences
): Promise<RecommendationsResponse> {
  if (!queryText.trim()) {
    return { queryText, results: [], error: "Empty query" };
  }

  const queries = expandQueries(queryText, preferences);
  const queryTokenSets = queries.map((q) => tokenise(q));

  const requestedCategory = preferences?.category;
  const preferredAreaTokens = new Set(tokenise(preferences?.area ?? ""));

  const scored = VENUES.map((venue) => {
    const tags = parseTags(venue.tags);
    const area = venue.suburb !== "unknown" ? venue.suburb : venue.city;
    const text = [
      venue.name,
      venue.description,
      venue.vibe ?? "",
      tags.join(" "),
      venue.suburb,
      venue.city,
      venue.category,
    ].join(" ");

    let bestScore = 0;
    let accumulated = 0;
    let queryHits = 0;
    const matchedBy = new Set<string>();

    for (const tokens of queryTokenSets) {
      const cat = categoryScore(venue.uiCategory, tokens) * 0.32;
      const overlap = textOverlapScore(text, tokens) * 0.36;
      const locality = suburbScore(venue.suburb, venue.city, tokens) * 0.2;
      const vibeHit = tokens.some((t) => tokenise((venue.vibe ?? "") + " " + tags.join(" ")).includes(t)) ? 0.12 : 0;
      const perQuery = cat + overlap + locality + vibeHit;

      if (perQuery > 0) {
        queryHits += 1;
        accumulated += perQuery;
      }
      if (cat > 0) matchedBy.add("category");
      if (locality > 0) matchedBy.add("location");
      if (overlap > 0) matchedBy.add("intent");
      if (vibeHit > 0) matchedBy.add("vibe");
      if (perQuery > bestScore) bestScore = perQuery;
    }

    let baseScore = bestScore * 0.6 + accumulated * 0.25 + Math.min(queryHits, 4) * 0.04;
    if (requestedCategory && venue.uiCategory !== requestedCategory) baseScore *= 0.8;
    if (preferredAreaTokens.size > 0) {
      const areaTokens = tokenise(area);
      const areaMatch = areaTokens.some((t) => preferredAreaTokens.has(t));
      baseScore *= areaMatch ? 1.12 : 0.9;
    }

    const personalized =
      budgetBoost(venue.price_level, preferences?.budget) *
      subtypeBoost(text, preferences) *
      transportBoost(venue.suburb, venue.city, preferences?.transportMode, preferences?.startLocation);

    const finalScore = baseScore * personalized;

    return {
      venue,
      tags,
      score: finalScore,
      queryHits,
      matchedBy: Array.from(matchedBy),
    } satisfies ScoredCandidate;
  });

  const sorted = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
  const top = diversifyByLocation(sorted, Math.max(1, Math.min(5, topK)));

  if (!top.length) {
    // Fallback: return top-rated venues by review_count
    const fallback = [...VENUES]
      .sort((a, b) => (b.review_count ?? 0) - (a.review_count ?? 0))
      .slice(0, topK);

    return {
      queryText,
      results: fallback.map((v) => {
        const tags: string[] = (() => { try { return JSON.parse(v.tags); } catch { return []; } })();
        return {
          id: v.id,
          name: v.name,
          city: v.city,
          suburb: v.suburb !== "unknown" ? v.suburb : null,
          category: v.uiCategory,
          vibe: v.vibe,
          address: v.address,
          website: v.website,
          googleMapsUrl: v.google_maps_url,
          tags,
          score: 0.5,
          reason: `Popular ${v.uiCategory} in ${v.suburb !== "unknown" ? v.suburb : v.city} when exact matches are limited.`,
        };
      }),
    };
  }

  const results: RecommendationItem[] = top.map(({ venue, tags, score }) => {
    const area = venue.suburb !== "unknown" ? venue.suburb : venue.city;
    const matched = sorted.find((c) => c.venue.id === venue.id)?.matchedBy ?? [];

    return {
      id: venue.id,
      name: venue.name,
      city: venue.city,
      suburb: venue.suburb !== "unknown" ? venue.suburb : null,
      category: venue.uiCategory,
      vibe: venue.vibe,
      address: venue.address,
      website: venue.website,
      googleMapsUrl: venue.google_maps_url,
      tags,
      score,
      reason: buildReason(score, area, matched, preferences?.budget, preferences?.transportMode),
    };
  });

  return { queryText, results };
}
