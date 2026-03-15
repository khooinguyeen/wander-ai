import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import { z } from "zod";

import { getDirections } from "@/lib/directions";
import { buildGoogleMapsUrl } from "@/lib/routing";
import { getAllSpots, searchSpots, summarizeAreas } from "@/lib/spots";
import type { ItineraryResponse, PlannedStop, Spot, TravelMode } from "@/lib/types";

/* ── schemas ────────────────────────────────────────────────── */

const planRequestSchema = z.object({
  query: z.string(),
  startLocation: z.string().optional(),
  travelMode: z.enum(["walking", "driving", "transit"]),
  maxStops: z.number().int().min(2).max(6),
  venueIds: z.array(z.string()).optional(),
  venueNames: z.array(z.string()).optional(),
});

type PlanRequest = z.infer<typeof planRequestSchema>;

const itineraryOutputSchema = z.object({
  dayTheme: z.string().describe("A catchy 3-8 word name for this day plan"),
  summary: z.string().describe("2-3 sentence description of the route"),
  routeRationale: z.string().describe("Why this route order makes sense"),
  stops: z.array(z.object({
    spotId: z.string().describe("The spot ID from the database"),
    reason: z.string().describe("Why this spot fits the plan, 1-2 sentences"),
    arrivalTime: z.string().describe("Arrival time like '9:30 AM'"),
    departureTime: z.string().describe("Departure time like '10:35 AM'"),
  })).min(2).max(6),
  backupSpotIds: z.array(z.string()).max(3).describe("IDs of backup spots that could be swapped in"),
});

/* ── planner system prompt ──────────────────────────────────── */

/* ── build itinerary programmatically ─────────────────────── */

export async function buildItinerary(request: PlanRequest): Promise<ItineraryResponse> {
  console.log("[plan] Starting route build:", request.query, "venueIds:", request.venueIds);

  // 1. Load all spots
  const allSpots = await getAllSpots();
  const allSpotsById = new Map(allSpots.map((s) => [s.id, s]));

  // 2. Resolve venues — prioritise explicit IDs, then name match, then search
  let candidates: Spot[] = [];

  if (request.venueIds?.length) {
    // Direct ID lookup — most reliable
    for (const id of request.venueIds) {
      const spot = allSpotsById.get(id);
      if (spot) candidates.push(spot);
    }
    console.log("[plan] ID-matched:", candidates.map(s => s.name));
  }

  if (request.venueNames?.length && candidates.length < request.maxStops) {
    // Fuzzy name match
    const existingIds = new Set(candidates.map(s => s.id));
    for (const name of request.venueNames) {
      const nameLower = name.toLowerCase();
      const match = allSpots.find(s => !existingIds.has(s.id) && s.name.toLowerCase().includes(nameLower));
      if (match) { candidates.push(match); existingIds.add(match.id); }
    }
    console.log("[plan] After name-match:", candidates.map(s => s.name));
  }

  // Fill remaining with search if needed
  if (candidates.length < request.maxStops) {
    const existingIds = new Set(candidates.map(s => s.id));
    const searchResults = await searchSpots({
      query: `${request.query} ${request.startLocation || "Melbourne"}`,
      startLocation: request.startLocation,
      maxResults: request.maxStops * 3,
    });
    for (const s of searchResults) {
      if (!existingIds.has(s.id)) { candidates.push(s); existingIds.add(s.id); }
      if (candidates.length >= request.maxStops * 2) break;
    }
  }

  if (candidates.length === 0) {
    throw new Error("No matching spots found for your request");
  }

  const spotsById = new Map(candidates.map((s) => [s.id, s]));

  // 3. Pick spots — if IDs were given, use them in order; otherwise nearest-neighbour
  const picked: Spot[] = [];
  const remaining: Spot[] = [];

  if (request.venueIds?.length) {
    // Use the ID-matched spots in the given order
    for (const id of request.venueIds) {
      const spot = allSpotsById.get(id);
      if (spot) picked.push(spot);
    }
    // Any extra candidates become remaining
    const pickedIds = new Set(picked.map(s => s.id));
    for (const s of candidates) {
      if (!pickedIds.has(s.id)) remaining.push(s);
    }
  } else {
    remaining.push(...candidates.slice(0, Math.max(request.maxStops * 2, 8)));
  }

  // Only do nearest-neighbour if we don't already have picked spots
  let currentLat = -37.8136; // Melbourne CBD default
  let currentLng = 144.9631;

  for (let i = picked.length; i < request.maxStops && remaining.length > 0; i++) {
    // Find nearest unvisited spot
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let j = 0; j < remaining.length; j++) {
      const s = remaining[j];
      const d = haversine(currentLat, currentLng, s.coordinates.lat, s.coordinates.lng);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = j;
      }
    }
    const chosen = remaining.splice(bestIdx, 1)[0];
    picked.push(chosen);
    currentLat = chosen.coordinates.lat;
    currentLng = chosen.coordinates.lng;
  }

  // 3. Fetch real directions between consecutive stops
  const directionsCache: Record<string, { distanceKm: number; durationMinutes: number; summary: string }> = {};
  for (let i = 0; i < picked.length; i++) {
    const originAddr = i === 0
      ? (request.startLocation || "Melbourne CBD")
      : picked[i - 1].address;
    const destAddr = picked[i].address;
    try {
      const result = await getDirections({
        originAddress: originAddr,
        destinationAddress: destAddr,
        travelMode: request.travelMode,
      });
      directionsCache[`${originAddr}→${destAddr}`] = {
        distanceKm: result.distanceKm,
        durationMinutes: result.durationMinutes,
        summary: result.summary,
      };
    } catch {
      // Haversine fallback
    }
  }

  // 4. Compute arrival/departure times
  const startHour = request.query.match(/dinner|date/i) ? 17.5
    : request.query.match(/lunch/i) ? 11.5
    : request.query.match(/sunset/i) ? 15.5
    : 9.5;

  let currentMinutes = startHour * 60;
  const stops: z.infer<typeof itineraryOutputSchema>["stops"] = [];

  for (let i = 0; i < picked.length; i++) {
    const spot = picked[i];
    const originAddr = i === 0 ? (request.startLocation || "Melbourne CBD") : picked[i - 1].address;
    const cached = directionsCache[`${originAddr}→${spot.address}`];
    const travelMin = cached?.durationMinutes ?? 10;

    currentMinutes += i === 0 ? 0 : travelMin;
    const arrivalTime = formatTime(currentMinutes);
    const departureTime = formatTime(currentMinutes + spot.idealVisitMinutes);

    stops.push({
      spotId: spot.id,
      reason: `Top match for "${request.query}" — ${spot.vibeTags.slice(0, 2).join(", ")} vibe in ${spot.area}`,
      arrivalTime,
      departureTime,
    });

    currentMinutes += spot.idealVisitMinutes;
  }

  // 5. Generate theme & summary with a lightweight Claude call
  let dayTheme = `${request.query.slice(0, 40)} day`;
  let summary = `A ${picked.length}-stop ${request.travelMode} route through ${[...new Set(picked.map(s => s.area))].join(", ")}.`;

  try {
    const { text } = await generateText({
      model: anthropic("claude-haiku-4-5-20251001"),
      prompt: `Given these Melbourne stops: ${picked.map(s => s.name).join(", ")} for a "${request.query}" trip.
Reply with EXACTLY two lines, nothing else:
Line 1: A catchy route name, max 6 words, no markdown, no hashtags
Line 2: A one-sentence summary of the route`,
      maxOutputTokens: 60,
    });
    const lines = text.trim().split("\n").map(s => s.replace(/^#+\s*/, "").trim()).filter(Boolean);
    if (lines[0]) dayTheme = lines[0];
    if (lines[1]) summary = lines[1];
  } catch {
    // Use defaults
  }

  const backupIds = remaining.slice(0, 3).map(s => s.id);

  const plan = { dayTheme, summary, routeRationale: "", stops, backupSpotIds: backupIds };
  return assemblePlan(plan, request, spotsById, directionsCache);
}

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

/* ── assemble the final ItineraryResponse ───────────────────── */

async function assemblePlan(
  plan: z.infer<typeof itineraryOutputSchema>,
  request: PlanRequest,
  spotsById: Map<string, Spot>,
  directionsCache: Record<string, { distanceKm: number; durationMinutes: number; summary: string }>,
): Promise<ItineraryResponse> {
  const plannedStops: PlannedStop[] = [];
  let totalDistanceKm = 0;
  let totalTravelMinutes = 0;

  for (let i = 0; i < plan.stops.length; i++) {
    const entry = plan.stops[i];
    const spot = spotsById.get(entry.spotId);
    if (!spot) continue;

    let legDistanceKm = 0;
    let legMinutes = 0;

    if (i === 0 && request.startLocation) {
      // Leg from start location to first stop
      const startKey = `${request.startLocation}→${spot.address}`;
      const cached = directionsCache[startKey];
      if (cached) {
        legDistanceKm = cached.distanceKm;
        legMinutes = cached.durationMinutes;
      } else {
        // Try to fetch directions for this leg
        try {
          const result = await getDirections({
            originAddress: request.startLocation,
            destinationAddress: spot.address,
            travelMode: request.travelMode,
          });
          legDistanceKm = result.distanceKm;
          legMinutes = result.durationMinutes;
        } catch {
          // Fallback: estimate ~10 min for start leg
          legDistanceKm = 0.5;
          legMinutes = 8;
        }
      }
      totalDistanceKm += legDistanceKm;
      totalTravelMinutes += legMinutes;
    } else if (i > 0) {
      const prevSpot = spotsById.get(plan.stops[i - 1].spotId);
      if (prevSpot) {
        // Try to find cached directions
        const cacheKey = `${prevSpot.address}→${spot.address}`;
        const cached = directionsCache[cacheKey];
        if (cached) {
          legDistanceKm = cached.distanceKm;
          legMinutes = cached.durationMinutes;
        } else {
          // Haversine fallback for legs where directions weren't fetched
          const R = 6371;
          const dLat = ((spot.coordinates.lat - prevSpot.coordinates.lat) * Math.PI) / 180;
          const dLng = ((spot.coordinates.lng - prevSpot.coordinates.lng) * Math.PI) / 180;
          const a =
            Math.sin(dLat / 2) ** 2 +
            Math.cos((prevSpot.coordinates.lat * Math.PI) / 180) *
            Math.cos((spot.coordinates.lat * Math.PI) / 180) *
            Math.sin(dLng / 2) ** 2;
          legDistanceKm = Number((R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))).toFixed(1));
          const speed = request.travelMode === "walking" ? 4.8 : request.travelMode === "transit" ? 18 : 26;
          legMinutes = Math.max(6, Math.round((legDistanceKm / speed) * 60));
        }
        totalDistanceKm += legDistanceKm;
        totalTravelMinutes += legMinutes;
      }
    }

    plannedStops.push({
      spot,
      arrivalTime: entry.arrivalTime,
      departureTime: entry.departureTime,
      reason: entry.reason,
      legFromPreviousMinutes: legMinutes,
      legDistanceKm: Number(legDistanceKm.toFixed(1)),
    });
  }

  const selectedSpots = plannedStops.map((s) => s.spot);
  const backups = plan.backupSpotIds
    .map((id) => spotsById.get(id))
    .filter((s): s is Spot => Boolean(s))
    .filter((s) => !selectedSpots.some((sel) => sel.id === s.id))
    .slice(0, 3);

  const candidates = await searchSpots({
    query: request.query,
    startLocation: request.startLocation,
    maxResults: Math.max(request.maxStops * 3, 10),
  });

  return {
    query: request.query,
    queryMode: "ai",
    dayTheme: plan.dayTheme,
    areaSummary: summarizeAreas(selectedSpots),
    summary: plan.summary,
    routeRationale: plan.routeRationale,
    travelMode: request.travelMode,
    route: {
      googleMapsUrl: buildGoogleMapsUrl(selectedSpots, request.travelMode, request.startLocation),
      totalDistanceKm: Number(totalDistanceKm.toFixed(1)),
      totalTravelMinutes,
    },
    stops: plannedStops,
    backups,
    candidates,
  };
}

export function parsePlanRequest(input: unknown) {
  return planRequestSchema.parse(input);
}

export type { PlanRequest, TravelMode };
