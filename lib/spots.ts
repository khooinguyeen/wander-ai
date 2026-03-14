import venuesData from "@/venues.json";
import type { SearchResult, Spot, SpotKind, Venue } from "@/lib/types";

/** Convert a Venue into the Spot shape the planner expects */
function venueToSpot(v: Venue): Spot {
  const kindMap: Record<string, SpotKind> = { restaurant: "food", cafe: "food", bar: "food" };
  const tags: string[] = (() => { try { return JSON.parse(v.tags); } catch { return []; } })();

  return {
    id: v.id,
    name: v.name,
    kind: kindMap[v.category] ?? "food",
    area: v.suburb,
    suburb: v.suburb,
    city: v.city,
    neighbourhood: v.suburb,
    categories: [v.category],
    vibeTags: tags,
    description: v.description,
    whyItTrends: v.description,
    address: v.address,
    coordinates: { lat: v.lat, lng: v.lng },
    priceBand: v.price_level <= 1 ? "$" : v.price_level === 2 ? "$$" : "$$$",
    idealVisitMinutes: v.category === "cafe" ? 45 : v.category === "bar" ? 60 : 75,
    bestFor: [v.vibe, v.category],
    visitWindows: v.category === "cafe" ? ["morning", "afternoon"] : ["afternoon", "evening"],
    signals: {
      food: v.category === "restaurant" || v.category === "cafe" ? 0.8 : 0.3,
      scenic: v.vibe === "romantic" ? 0.7 : 0.3,
      fashion: 0,
      hiddenGem: tags.includes("hidden-gem") ? 0.8 : 0.3,
      viral: tags.includes("viral") ? 0.8 : 0.3,
    },
    socialProof: { mentions: 10, creatorCount: 3, lastScrapedAt: "2025-01-01" },
    sourcePosts: [],
  };
}

const spots: Spot[] = (venuesData as Venue[]).map(venueToSpot);

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

export function getAllSpots() {
  return spots;
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

export function searchSpots(input: {
  query: string;
  startLocation?: string;
  maxResults?: number;
}) {
  const maxResults = input.maxResults ?? 10;

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
