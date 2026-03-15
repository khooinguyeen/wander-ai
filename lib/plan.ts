import { google } from "@ai-sdk/google";
import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod";

import { getDirections } from "@/lib/directions";
import { buildGoogleMapsUrl } from "@/lib/routing";
import { getAllSpots, searchSpots, summarizeAreas } from "@/lib/spots";
import type { ItineraryResponse, PlannedStop, Spot, TravelMode } from "@/lib/types";

/* ── schemas ────────────────────────────────────────────────── */

const planRequestSchema = z.object({
  query: z.string().trim().min(3).max(280),
  startLocation: z.string().trim().max(120).optional().default(""),
  travelMode: z.enum(["walking", "driving", "transit"]).default("driving"),
  maxStops: z.number().int().min(2).max(6).default(4),
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

const PLANNER_SYSTEM = `You are a Melbourne route planner agent. Your job is to build the best possible day route from a database of curated Melbourne spots.

## Your process
1. First, call searchSpots to find candidates matching the user's vibe.
2. Review the results. Think about what mix of spots makes a great day.
3. Call getDirections between your planned stops to check real travel times.
4. If a leg is too long (>30 min walking, >20 min driving), consider reordering or swapping a spot.
5. Once you're happy with the plan, call finalizePlan with your final selection.

## Planning rules
- Keep the route geographically compact — don't zigzag across the city.
- Respect visit windows — don't schedule a brunch spot at 5 PM.
- Mix up stop kinds when the user's vibe calls for variety.
- If the user says "lowkey" or "hidden", favor spots with high hiddenGem signals.
- If they want "viral" or "trending", favor high viral signals.
- Infer a sensible start time: brunch/coffee → 9:30 AM, lunch → 11:30 AM, dinner/date → 5:30 PM, sunset → 3:30 PM.
- Each stop's duration should use the spot's idealVisitMinutes.

## Important
- You can call searchSpots multiple times with different queries to find the right mix.
- You MUST call getDirections at least once to validate travel times between consecutive stops.
- You MUST call finalizePlan exactly once at the end with your final plan.`;

/* ── build itinerary using Gemini agent ─────────────────────── */

export async function buildItinerary(request: PlanRequest): Promise<ItineraryResponse> {
  const allSpots = await getAllSpots();
  const spotsById = new Map(allSpots.map((s) => [s.id, s]));

  // Collect directions data as the agent calls getDirections
  const directionsCache: Record<string, { distanceKm: number; durationMinutes: number; summary: string }> = {};

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

    if (i > 0) {
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
