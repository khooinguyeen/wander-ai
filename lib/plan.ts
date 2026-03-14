import { google } from "@ai-sdk/google";
import { generateText, Output } from "ai";
import { z } from "zod";

import { buildGoogleMapsUrl, scheduleStops } from "@/lib/routing";
import { inferDesiredKinds, searchSpots, summarizeAreas } from "@/lib/spots";
import type { ItineraryResponse, SearchResult, Spot, TravelMode } from "@/lib/types";

const planRequestSchema = z.object({
  query: z.string().trim().min(3).max(280),
  startLocation: z.string().trim().max(120).optional().default(""),
  travelMode: z.enum(["walking", "driving", "transit"]).default("driving"),
  maxStops: z.number().int().min(2).max(6).default(4)
});

const blueprintSchema = z.object({
  dayTheme: z.string().min(3).max(80),
  summary: z.string().min(20).max(320),
  routeRationale: z.string().min(20).max(280),
  selectedStops: z
    .array(
      z.object({
        spotId: z.string(),
        reason: z.string().min(8).max(180)
      })
    )
    .min(2)
    .max(6),
  backupSpotIds: z.array(z.string()).max(3).default([])
});

type PlanRequest = z.infer<typeof planRequestSchema>;
type Blueprint = z.infer<typeof blueprintSchema>;

function buildTheme(spots: Spot[]) {
  const area = summarizeAreas(spots);
  const kinds = [...new Set(spots.map((spot) => spot.kind))];
  if (kinds.length === 1) {
    return `${area} ${kinds[0]} run`;
  }
  return `${area} mixed route`;
}

function buildFallbackReason(spot: SearchResult, query: string) {
  const desiredKinds = inferDesiredKinds(query);
  if (desiredKinds.includes("lookout") && spot.kind === "lookout") {
    return `${spot.name} gives the route a scenic reset without drifting too far off-brief.`;
  }
  if (desiredKinds.includes("fashion") && spot.kind === "fashion") {
    return `${spot.name} adds a shopping stop that feels local rather than mall-generic.`;
  }
  if (spot.kind === "food") {
    return `${spot.name} is a strong food anchor with consistent social proof and easy route fit.`;
  }
  return `${spot.name} matches the request and keeps the route compact around ${spot.area}.`;
}

function buildHeuristicBlueprint(request: PlanRequest, candidates: SearchResult[]): Blueprint {
  const selected: SearchResult[] = [];
  const desiredKinds = inferDesiredKinds(request.query);

  for (const kind of desiredKinds) {
    const match = candidates.find((candidate) => candidate.kind === kind && !selected.some((item) => item.id === candidate.id));
    if (match) {
      selected.push(match);
    }
  }

  const anchorArea = selected[0]?.area ?? candidates[0]?.area;
  const compactCandidates = candidates.filter(
    (candidate) => candidate.area === anchorArea && !selected.some((item) => item.id === candidate.id)
  );

  for (const candidate of compactCandidates) {
    if (selected.length >= request.maxStops) {
      break;
    }
    selected.push(candidate);
  }

  for (const candidate of candidates) {
    if (selected.length >= request.maxStops) {
      break;
    }
    if (!selected.some((item) => item.id === candidate.id)) {
      selected.push(candidate);
    }
  }

  const finalSelection = selected.slice(0, request.maxStops);

  return {
    dayTheme: buildTheme(finalSelection),
    summary: `A compact ${summarizeAreas(finalSelection)} route that leans into ${finalSelection
      .map((spot) => spot.kind)
      .filter((value, index, array) => array.indexOf(value) === index)
      .join(", ")} without wasting time on cross-city zigzags.`,
    routeRationale: `Starts with the strongest match, then keeps the rest of the day clustered around ${summarizeAreas(
      finalSelection
    )}.`,
    selectedStops: finalSelection.map((spot) => ({
      spotId: spot.id,
      reason: buildFallbackReason(spot, request.query)
    })),
    backupSpotIds: candidates
      .filter((candidate) => !finalSelection.some((selectedSpot) => selectedSpot.id === candidate.id))
      .slice(0, 3)
      .map((candidate) => candidate.id)
  };
}

async function buildGeminiBlueprint(request: PlanRequest, candidates: SearchResult[]) {
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
  const { output } = await generateText({
    model: google(model),
    output: Output.object({
      schema: blueprintSchema,
      name: "MelbourneDayPlan",
      description: "A compact day route chosen only from the provided Melbourne candidate spots."
    }),
    system: [
      "You are a Melbourne route planner.",
      "Build a practical day plan from the provided candidate spots only.",
      "Use only spotId values that appear in the candidate list.",
      "Keep the route geographically compact unless the request explicitly asks for a big destination.",
      "If the user asks for lowkey or hidden, prioritize higher hiddenGem signals over raw popularity."
    ].join(" "),
    prompt: JSON.stringify(
      {
        request,
        candidates: candidates.map((candidate) => ({
          spotId: candidate.id,
          name: candidate.name,
          kind: candidate.kind,
          area: candidate.area,
          suburb: candidate.suburb,
          categories: candidate.categories,
          vibeTags: candidate.vibeTags,
          description: candidate.description,
          whyItTrends: candidate.whyItTrends,
          priceBand: candidate.priceBand,
          visitWindows: candidate.visitWindows,
          signals: candidate.signals,
          socialProof: candidate.socialProof,
          matchScore: candidate.matchScore
        }))
      },
      null,
      2
    )
  });

  return output;
}

function finalizeBlueprint(input: {
  blueprint: Blueprint;
  request: PlanRequest;
  candidates: SearchResult[];
  queryMode: "ai" | "heuristic";
}): ItineraryResponse {
  const selectedSpots: Spot[] = [];
  const reasonsById: Record<string, string> = {};

  for (const entry of input.blueprint.selectedStops) {
    const match = input.candidates.find((candidate) => candidate.id === entry.spotId);
    if (match && !selectedSpots.some((spot) => spot.id === match.id)) {
      selectedSpots.push(match);
      reasonsById[match.id] = entry.reason;
    }
  }

  if (selectedSpots.length < 2) {
    const fallback = buildHeuristicBlueprint(input.request, input.candidates);
    return finalizeBlueprint({
      blueprint: fallback,
      request: input.request,
      candidates: input.candidates,
      queryMode: "heuristic"
    });
  }

  const backups = input.blueprint.backupSpotIds
    .map((spotId) => input.candidates.find((candidate) => candidate.id === spotId))
    .filter((spot): spot is SearchResult => Boolean(spot))
    .filter((spot) => !selectedSpots.some((selectedSpot) => selectedSpot.id === spot.id))
    .slice(0, 3);

  const schedule = scheduleStops({
    spots: selectedSpots,
    reasonsById,
    query: input.request.query,
    travelMode: input.request.travelMode
  });

  return {
    query: input.request.query,
    queryMode: input.queryMode,
    dayTheme: input.blueprint.dayTheme,
    areaSummary: summarizeAreas(selectedSpots),
    summary: input.blueprint.summary,
    routeRationale: input.blueprint.routeRationale,
    travelMode: input.request.travelMode,
    route: {
      googleMapsUrl: buildGoogleMapsUrl(selectedSpots, input.request.travelMode, input.request.startLocation),
      totalDistanceKm: schedule.totalDistanceKm,
      totalTravelMinutes: schedule.totalTravelMinutes
    },
    stops: schedule.plannedStops,
    backups,
    candidates: input.candidates
  };
}

export function parsePlanRequest(input: unknown) {
  return planRequestSchema.parse(input);
}

export async function buildItinerary(request: PlanRequest): Promise<ItineraryResponse> {
  const candidates = searchSpots({
    query: request.query,
    startLocation: request.startLocation,
    maxResults: Math.max(request.maxStops * 3, 8)
  });

  const fallbackBlueprint = buildHeuristicBlueprint(request, candidates);

  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return finalizeBlueprint({
      blueprint: fallbackBlueprint,
      request,
      candidates,
      queryMode: "heuristic"
    });
  }

  try {
    const blueprint = await buildGeminiBlueprint(request, candidates);
    return finalizeBlueprint({
      blueprint,
      request,
      candidates,
      queryMode: "ai"
    });
  } catch {
    return finalizeBlueprint({
      blueprint: fallbackBlueprint,
      request,
      candidates,
      queryMode: "heuristic"
    });
  }
}

export type { PlanRequest, TravelMode };
