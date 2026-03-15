import { google } from "@ai-sdk/google";
import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod";

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

function buildPlannerSystem(hasPreferences: boolean): string {
  const base = `You are a Melbourne route planner agent. Your job is to build the best possible day route from a database of curated Melbourne spots.

## Your process
1. First, search for candidates matching the user's vibe.${hasPreferences ? `
   - Use searchByPreferences FIRST — it uses the user's collected preferences (budget, dietary needs, interests, group type) for personalised semantic search.
   - Then use searchSpots for additional candidates or to fill specific gaps (e.g. you need a lookout but preferences returned mostly food).` : `
   - Use searchSpots to find candidates matching the user's vibe.`}
2. Review the results. Think about what mix of spots makes a great day.
3. Call getDirections between your planned stops to check real travel times.
4. If a leg is too long (>30 min walking, >20 min driving), consider reordering or swapping a spot.
5. Once you're happy with the plan, call finalizePlan with your final selection.

## Tour planning rules
- Build a COHESIVE tour — stops should flow naturally into each other (e.g. coffee → walk → brunch → shopping → lookout).
- Keep the route geographically compact — don't zigzag across the city.
- Respect visit windows — don't schedule a brunch spot at 5 PM.
- Mix up stop kinds when the user's vibe calls for variety.
- Consider the GROUP TYPE when selecting spots — a couple's date differs from a family outing.
- If the user says "lowkey" or "hidden", favor spots with high hiddenGem signals.
- If they want "viral" or "trending", favor high viral signals.
- Infer a sensible start time: brunch/coffee → 9:30 AM, lunch → 11:30 AM, dinner/date → 5:30 PM, sunset → 3:30 PM.
- Each stop's duration should use the spot's idealVisitMinutes.
- For BUDGET constraints: "$" = budget-friendly, "$$" = mid-range, "$$$" = premium.
- For DIETARY constraints: prioritize food spots that match (e.g. vegetarian, halal, gluten-free).

## Important
- You can call search tools multiple times with different queries to find the right mix.
- You MUST call getDirections at least once to validate travel times between consecutive stops.
- You MUST call finalizePlan exactly once at the end with your final plan.`;

  return base;
}

/* ── check if ChromaDB is configured ─────────────────────────── */

function isChromaConfigured(): boolean {
  return Boolean(
    process.env.CHROMA_API_KEY &&
    process.env.CHROMA_TENANT &&
    process.env.CHROMA_DATABASE,
  );
}

/* ── build itinerary using Gemini agent ─────────────────────── */

export async function buildItinerary(request: PlanRequest): Promise<ItineraryResponse> {
  const allSpots = getAllSpots();
  const spotsById = new Map(allSpots.map((s) => [s.id, s]));
  const useChroma = isChromaConfigured();
  const hasPreferences = Boolean(request.userPreferences);

  // Collect directions data as the agent calls getDirections
  const directionsCache: Record<string, { distanceKm: number; durationMinutes: number; summary: string }> = {};

  // Collect ChromaDB spots so assemblePlan can resolve IDs from both sources
  const chromaSpotsById = new Map<string, Spot>();

  const model = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite-preview";

  // Helper to format a spot for the agent response
  function formatSpotForAgent(s: Spot & { matchScore: number }) {
    return {
      id: s.id, name: s.name, kind: s.kind, area: s.area, suburb: s.suburb,
      address: s.address, categories: s.categories, vibeTags: s.vibeTags,
      description: s.description, priceBand: s.priceBand,
      idealVisitMinutes: s.idealVisitMinutes, visitWindows: s.visitWindows,
      signals: s.signals,
      socialProof: { mentions: s.socialProof.mentions, creatorCount: s.socialProof.creatorCount },
      matchScore: s.matchScore,
    };
  }

  // Core tools — always available
  const searchSpotsTool = tool({
    description: "Search the Melbourne spots database by keyword. Returns spots ranked by relevance to the query. You can filter by kind (food/lookout/fashion) and area.",
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

      // Try ChromaDB first for semantic search, fall back to in-memory
      let results: (Spot & { matchScore: number })[];

      if (useChroma) {
        try {
          results = await chromaSearch({
            query: fullQuery,
            area: args.area,
            maxResults: args.maxResults ?? 8,
          });
          for (const s of results) chromaSpotsById.set(s.id, s);
        } catch {
          results = searchSpots({
            query: fullQuery,
            startLocation: args.area,
            maxResults: args.maxResults ?? 8,
          });
        }
      } else {
        results = searchSpots({
          query: fullQuery,
          startLocation: args.area,
          maxResults: args.maxResults ?? 8,
        });
      }

      return results.map(formatSpotForAgent);
    },
  });

  const getDirectionsTool = tool({
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
  });

  const finalizePlanTool = tool({
    description: "Submit your final route plan. Call this exactly once when you are satisfied with the route.",
    inputSchema: itineraryOutputSchema,
    execute: async () => {
      return { status: "plan_received" };
    },
  });

  const searchByPreferencesTool = tool({
    description:
      "Search venues using the user's collected preferences (budget, vibe, dietary needs, interests, group type). Uses semantic/vector search for better personalised results. Use this FIRST before searchSpots.",
    inputSchema: z.object({
      focusQuery: z.string().optional().describe("Optional extra focus like 'brunch spots' or 'street art' to narrow results"),
      area: z.string().optional().describe("Optional area filter like 'Fitzroy', 'CBD'"),
      maxResults: z.number().optional().default(10).describe("Max results to return"),
    }),
    execute: async (args) => {
      const results = await chromaSearchByPreferences({
        preferences: request.userPreferences ?? {},
        baseQuery: args.focusQuery ?? request.query,
        area: args.area,
        maxResults: args.maxResults ?? 10,
      });
      for (const s of results) chromaSpotsById.set(s.id, s);
      return results.map(formatSpotForAgent);
    },
  });

  // Build tools object — conditionally include searchByPreferences
  const baseTools = {
    searchSpots: searchSpotsTool,
    getDirections: getDirectionsTool,
    finalizePlan: finalizePlanTool,
  };
  const tools = useChroma && hasPreferences
    ? { ...baseTools, searchByPreferences: searchByPreferencesTool }
    : baseTools;

  const { toolResults } = await generateText({
    model: google(model),
    system: buildPlannerSystem(useChroma && hasPreferences),
    prompt: JSON.stringify({
      userRequest: {
        query: request.query,
        startLocation: request.startLocation || "CBD",
        travelMode: request.travelMode,
        maxStops: request.maxStops,
        ...(request.userPreferences ? { preferences: request.userPreferences } : {}),
      },
      totalSpotsInDatabase: allSpots.length,
    }),
    tools,
    stopWhen: stepCountIs(10),
  });

  // Extract the finalizePlan call from tool results
  const finalizeCall = toolResults.find((r) => r.toolName === "finalizePlan");

  if (!finalizeCall) {
    throw new Error("Gemini planner did not call finalizePlan");
  }

  const plan = finalizeCall.input as z.infer<typeof itineraryOutputSchema>;

  // Merge ChromaDB spots into the lookup map so assemblePlan can resolve all IDs
  const mergedSpotsById = new Map([...spotsById, ...chromaSpotsById]);

  return assemblePlan(plan, request, mergedSpotsById, directionsCache);
}

/* ── assemble the final ItineraryResponse ───────────────────── */

function assemblePlan(
  plan: z.infer<typeof itineraryOutputSchema>,
  request: PlanRequest,
  spotsById: Map<string, Spot>,
  directionsCache: Record<string, { distanceKm: number; durationMinutes: number; summary: string }>,
): ItineraryResponse {
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

  const candidates = searchSpots({
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
