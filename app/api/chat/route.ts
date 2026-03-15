import { google } from "@ai-sdk/google";
import { convertToModelMessages, stepCountIs, streamText, tool, type UIMessage } from "ai";
import { z } from "zod";

import { buildItinerary } from "@/lib/plan";
import { retrieveLocations } from "@/lib/location-retrieval";
import type { RecommendationPreferences, TravelMode } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const ROUTE_SYSTEM_PROMPT = `You are Scout, a Melbourne route-planning copilot.

Your job is to collect sharp preferences, then build a personalized route.

## Conversation rules
- Ask ONE question at a time. Keep messages short (1-2 sentences max).
- Be warm but concise. You're a local friend, not a customer service bot.
- Don't number your questions or say "question 1 of 4".
- Sound natural, like a text message from a friend who knows Melbourne well.

## Clarification strategy (adaptive)
1. Ask what they want to do first (for example: coffee, lunch, shopping, views).
2. If coffee is mentioned, ask subtype preference (espresso, filter, matcha, specialty, quick takeaway) and cafe vibe.
3. If lunch/dinner is mentioned, ask cuisine preference (for example Japanese, Italian, vegan, burgers) and any dietary constraints.
4. Always capture budget, start location, and transport mode before building.
5. Ask stop count only after intent is clear.
6. Ask only missing fields. If user already gave something, do not ask it again.

## When to call buildRoute
- Once you have enough to personalize: activity intent, start location, travel mode, and at least a rough budget, call buildRoute.
- Don't ask for confirmation — just build it.
- If the user gives you multiple pieces of info at once, great — skip ahead.
- If they stay vague after one follow-up, apply sensible defaults and build:
  - Start: "CBD"
  - Mode: "walking"
  - Budget: "mid"
  - Stops: 4

## After the route is built
- The tool will return the full itinerary. Give a brief excited summary (2-3 sentences).
- Mention the day theme and highlight 1-2 standout stops.
- Don't list every stop — the workspace panel shows that.
- If they want to tweak, ask what to change and rebuild.

## Style
- Use Australian casual English. "Reckon", "solid pick", "keen?" are fine.
- No emojis unless the user uses them first.
- Never say "I'm an AI" or "as a language model".`;

const RECOMMENDATIONS_SYSTEM_PROMPT = `You are Scout, a Melbourne recommendations copilot.

Your job is to run high-quality retrieval by clarifying intent, then call retrieveLocations.

## Conversation rules
- Ask ONE question at a time. Keep messages very short (1 sentence max).
- Be warm, casual, like a local friend.
- Only ask for info you're actually missing. Never ask for things you already know.

## Clarification depth rules
1. Always identify category/type and area/suburb first.
2. If category is coffee/cafe, ask subtype (espresso, matcha, specialty, brunch cafe, quick takeaway).
3. If category is lunch/dinner/restaurant, ask cuisine and dietary preference.
4. Ask budget and transport context when missing.
5. If user provides enough detail already, skip extra questions and retrieve immediately.

## When to call retrieveLocations
- Build a descriptive query and include structured preferences (category, vibe, budget, area, subtype/cuisine, start/transport when available).
- If user mentions multiple areas, pass them via targetAreas.
- Request topK 5 unless user asks for fewer.
- Always call retrieveLocations — never make up recommendations yourself.

## After results are shown
- Summarize why the chosen spots fit their preferences in 1-2 sentences.
- Offer to refine (different area, vibe, or category).
- If the user wants a full day route, offer to switch to Route Planning mode.

## Style
- Use Australian casual English.
- No emojis unless the user uses them first.
- Never say "I'm an AI" or "as a language model".`;

const chatRequestSchema = z.object({
  messages: z.array(z.any()),
  mode: z.enum(["route-planning", "recommendations"]).default("route-planning"),
});

const preferenceSchema = z.object({
  category: z.enum(["cafe", "restaurant", "bar", "attraction", "shopping"]).optional(),
  area: z.string().optional(),
  targetAreas: z.array(z.string()).max(4).optional(),
  vibe: z.string().optional(),
  coffeeStyle: z.string().optional(),
  cuisine: z.string().optional(),
  budget: z.enum(["budget", "mid", "premium"]).optional(),
  startLocation: z.string().optional(),
  transportMode: z.enum(["walking", "driving", "transit"]).optional(),
  dietary: z.string().optional(),
  partySize: z.number().int().min(1).max(20).optional(),
  timeWindow: z.string().optional(),
});

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = chatRequestSchema.safeParse(body);
  const messages: UIMessage[] = parsed.success ? parsed.data.messages : body.messages;
  const mode = parsed.success ? parsed.data.mode : "route-planning";

  const model = process.env.GEMINI_MODEL || "gemini-2.0-flash-lite";

  if (mode === "recommendations") {
    const result = streamText({
      model: google(model),
      system: RECOMMENDATIONS_SYSTEM_PROMPT,
      messages: await convertToModelMessages(messages),
      tools: {
        retrieveLocations: tool({
          description: "Retrieve the top matching Melbourne venues for the user's query. Always call this — never make up recommendations.",
          inputSchema: z.object({
            queryText: z.string().describe(
              "Descriptive search query combining category, area, and vibe e.g. 'hidden cafes near Fitzroy cozy' or 'rooftop bars CBD date night'"
            ),
            topK: z.number().int().min(1).max(5).default(5).describe("Number of results to return, max 5"),
            preferences: preferenceSchema.optional(),
          }),
          execute: async ({ queryText, topK, preferences }) => {
            try {
              return await retrieveLocations(queryText, topK ?? 5, preferences as RecommendationPreferences | undefined);
            } catch (err) {
              return { queryText, results: [], error: String(err) };
            }
          },
        }),
      },
      stopWhen: stepCountIs(5),
    });
    return result.toUIMessageStreamResponse();
  }

  // Route-planning mode
  const result = streamText({
    model: google(model),
    system: ROUTE_SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages),
    tools: {
      buildRoute: tool({
        description:
          "Build a Melbourne day route once you have the vibe/query, start location, travel mode, and number of stops.",
        inputSchema: z.object({
          query: z
            .string()
            .describe(
              "The user's trip brief / vibe description, e.g. 'lowkey northside day with coffee and a lookout'"
            ),
          startLocation: z
            .string()
            .describe("Starting suburb or landmark, e.g. 'Fitzroy' or 'Flinders Street Station'"),
          travelMode: z
            .enum(["walking", "driving", "transit"])
            .describe("How they want to travel between stops"),
          maxStops: z
            .number()
            .int()
            .min(2)
            .max(6)
            .describe("Number of stops to include in the route"),
          budget: z.enum(["budget", "mid", "premium"]).optional(),
          coffeeStyle: z.string().optional(),
          cuisine: z.string().optional(),
          dietary: z.string().optional(),
          timeWindow: z.string().optional(),
        }),
        execute: async (args) => {
          const raw = args as Record<string, unknown>;
          const query = (raw.query ?? raw.vibe ?? raw.trip_brief ?? "") as string;
          const startLocation = (raw.startLocation ?? raw.start_location ?? "CBD") as string;
          const travelMode = (raw.travelMode ?? raw.travel_mode ?? "walking") as TravelMode;
          const maxStops = Number(raw.maxStops ?? raw.max_stops ?? 4);

          const optionalIntent = [
            raw.budget ? `${raw.budget} budget` : "",
            raw.coffeeStyle ? `coffee style ${String(raw.coffeeStyle)}` : "",
            raw.cuisine ? `cuisine ${String(raw.cuisine)}` : "",
            raw.dietary ? `dietary ${String(raw.dietary)}` : "",
            raw.timeWindow ? `time ${String(raw.timeWindow)}` : "",
          ]
            .filter(Boolean)
            .join(" | ");

          const enrichedQuery = [query || "fun day out in Melbourne", optionalIntent]
            .filter(Boolean)
            .join(" | ");

          const itinerary = await buildItinerary({
            query: enrichedQuery,
            startLocation,
            travelMode,
            maxStops: Math.max(2, Math.min(6, maxStops))
          });
          return itinerary;
        }
      })
    },
    stopWhen: stepCountIs(3)
  });

  return result.toUIMessageStreamResponse();
}
