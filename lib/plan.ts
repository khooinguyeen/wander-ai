import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import { z } from "zod";

import { getModel } from "@/lib/ai-model";
import { chromaSearch, chromaSearchByPreferences } from "@/lib/chroma-search";
import { getDirections } from "@/lib/directions";
import { buildGoogleMapsUrl } from "@/lib/routing";
import { getAllSpots, searchSpots, summarizeAreas } from "@/lib/spots";
import type { ItineraryResponse, PlannedStop, Spot, TravelMode } from "@/lib/types";

/* ── schemas ────────────────────────────────────────────────── */

const userPreferencesSchema = z.object({
  budget: z.enum(["low", "medium", "high"]).optional(),
  dietaryNeeds: z.string().optional(),
  interests: z.array(z.string()).optional(),
  avoidCategories: z.array(z.string()).optional(),
  timeOfDay: z.enum(["morning", "afternoon", "evening", "full-day"]).optional(),
  vibe: z.string().optional(),
  groupType: z.string().optional(),
}).optional();

const planRequestSchema = z.object({
  query: z.string().trim().min(3).max(280),
  startLocation: z.string().trim().max(120).optional().default(""),
  travelMode: z.enum(["walking", "driving", "transit"]).default("driving"),
  maxStops: z.number().int().min(2).max(6).default(4),
  userPreferences: userPreferencesSchema,
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
  console.log("[plan] Starting programmatic route build:", request.query);

  // 1. Load all spots and try to match specific venue names from the query
  const allSpots = await getAllSpots();

  // Try to find venues mentioned by name in the query
  const queryLower = request.query.toLowerCase();
  const nameMatched: Spot[] = [];
  for (const spot of allSpots) {
    const nameLower = spot.name.toLowerCase();
    // Check if the venue name (or a significant part) appears in the query
    if (nameLower.length > 3 && queryLower.includes(nameLower)) {
      nameMatched.push(spot);
    }
  }
  console.log("[plan] Name-matched venues:", nameMatched.map(s => s.name));

  const model = process.env.GEMINI_MODEL || "gemini-2.0-flash-lite";

  let toolResults: Awaited<ReturnType<typeof generateText>>["toolResults"] = [];
  try {
    ({ toolResults } = await generateText({
      model: google(model),
      system: PLANNER_SYSTEM,
      prompt: JSON.stringify({
        userRequest: {
          query: request.query,
          startLocation: request.startLocation || "CBD",
          travelMode: request.travelMode,
          maxStops: request.maxStops,
        },
        totalSpotsInDatabase: allSpots.length,
      }),
    tools: {
      searchSpots: tool({
        description: "Search the Melbourne spots database. Returns spots ranked by relevance to the query. You can filter by kind (food/lookout/fashion) and area.",
        inputSchema: z.object({
          query: z.string().describe("Search query — vibe, cuisine, activity, etc."),
          area: z.string().optional().describe("Optional area filter like 'Fitzroy', 'CBD', 'South Melbourne'"),
          kind: z.enum(["food", "lookout", "fashion"]).optional().describe("Optional kind filter"),
          maxResults: z.number().optional().default(8).describe("Max results to return"),
        }),
        execute: async (args) => {
          let fullQuery = args.query;
          if (args.area) fullQuery += ` ${args.area}`;
          if (args.kind) fullQuery += ` ${args.kind}`;

          const results = await searchSpots({
            query: fullQuery,
            startLocation: args.area,
            maxResults: args.maxResults ?? 8,
          });

          return results.map((s) => ({
            id: s.id,
            name: s.name,
            kind: s.kind,
            area: s.area,
            suburb: s.suburb,
            address: s.address,
            categories: s.categories,
            vibeTags: s.vibeTags,
            description: s.description,
            priceBand: s.priceBand,
            idealVisitMinutes: s.idealVisitMinutes,
            visitWindows: s.visitWindows,
            signals: s.signals,
            socialProof: { mentions: s.socialProof.mentions, creatorCount: s.socialProof.creatorCount },
            matchScore: s.matchScore,
          }));
        },
      }),

      getDirections: tool({
        description: "Get real walking/driving/transit directions between two addresses using Google Maps. Use this to validate travel times between planned stops.",
        inputSchema: z.object({
          originAddress: z.string().describe("Starting address or place name"),
          destinationAddress: z.string().describe("Destination address or place name"),
          travelMode: z.enum(["walking", "driving", "transit"]).describe("Travel mode"),
        }),
        execute: async (args) => {
          const result = await getDirections(args);
          const cacheKey = `${args.originAddress}→${args.destinationAddress}`;
          directionsCache[cacheKey] = {
            distanceKm: result.distanceKm,
            durationMinutes: result.durationMinutes,
            summary: result.summary,
          };
          return result;
        },
      }),

      finalizePlan: tool({
        description: "Submit your final route plan. Call this exactly once when you are satisfied with the route.",
        inputSchema: itineraryOutputSchema,
        execute: async () => {
          return { status: "plan_received" };
        },
      }),
    },
      stopWhen: stepCountIs(8),
    }));
  } catch (err) {
    console.error("[buildItinerary] inner agent failed, using heuristic fallback:", err);
  }

  // Extract the finalizePlan call from tool results (may be empty if agent failed)
  const finalizeCall = toolResults.find((r) => r.toolName === "finalizePlan");

  if (finalizeCall) {
    const plan = finalizeCall.input as z.infer<typeof itineraryOutputSchema>;
    return assemblePlan(plan, request, spotsById, directionsCache);
  }

  // Heuristic fallback: pick top searchSpots results and assemble directly
  console.warn("[buildItinerary] using heuristic fallback — finalizePlan not called");
  return buildHeuristicItinerary(request, spotsById, directionsCache);
}

/* ── heuristic fallback when inner agent doesn't call finalizePlan ── */

function buildHeuristicItinerary(
  request: PlanRequest,
  spotsById: Map<string, Spot>,
  directionsCache: Record<string, { distanceKm: number; durationMinutes: number; summary: string }>,
): ItineraryResponse {
  const topSpots = searchSpots({
    query: request.query,
    startLocation: request.startLocation,
    maxResults: Math.max(request.maxStops * 3, 12),
  });

  const selected = topSpots.slice(0, request.maxStops);
  const startHour = 9;
  let clock = startHour * 60; // minutes since midnight

  const stops: z.infer<typeof itineraryOutputSchema>["stops"] = selected.map((spot) => {
    const arrival = `${Math.floor(clock / 60)}:${String(clock % 60).padStart(2, "0")} ${clock < 720 ? "AM" : "PM"}`;
    clock += spot.idealVisitMinutes;
    const depart = `${Math.floor(clock / 60)}:${String(clock % 60).padStart(2, "0")} ${clock < 720 ? "AM" : "PM"}`;
    clock += 20; // travel buffer
    return {
      spotId: spot.id,
      reason: `${spot.matchReason}. A great pick for ${request.query}.`,
      arrivalTime: arrival,
      departureTime: depart,
    };
  });

  const syntheticPlan: z.infer<typeof itineraryOutputSchema> = {
    dayTheme: `Melbourne ${request.query.split(" ").slice(0, 4).join(" ")} Day`,
    summary: `A curated ${selected.length}-stop route through ${summarizeAreas(selected)} based on your preferences.`,
    routeRationale: "Ordered by relevance and geographic compactness.",
    stops,
    backupSpotIds: topSpots.slice(request.maxStops, request.maxStops + 3).map((s) => s.id),
  };

  return assemblePlan(syntheticPlan, request, spotsById, directionsCache);
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
