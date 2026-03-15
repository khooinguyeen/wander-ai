import { anthropic } from "@ai-sdk/anthropic";
import { convertToModelMessages, stepCountIs, streamText, tool, type UIMessage } from "ai";
import { z } from "zod";

import { retrieveLocationsFromChroma } from "@/lib/location-retrieval";
import { buildItinerary } from "@/lib/plan";
import type { TravelMode } from "@/lib/types";

export const maxDuration = 60;
export const runtime = "nodejs";

const SYSTEM_PROMPT = `You are Scout, a Melbourne route-planning copilot.

Your job is to help users plan day routes AND find/recommend places in Melbourne. You must figure out what they want:

- **Recommendations / browsing** — "good matcha in CBD", "best brunch spots", "any hidden bars?", "show me cafes in Fitzroy"
  → Use filterPlaces immediately. Don't ask extra questions unless truly needed.
- **Route planning** — "plan me a day out", "build a route", "food crawl through northside", "date day itinerary"
  → Gather info and use buildRoute.

If ambiguous, lean toward filterPlaces for quick answers. Only use buildRoute when they clearly want a multi-stop day plan.

## Conversation rules
- Ask ONE question at a time. Keep messages short (1-2 sentences max).
- Be warm but concise. You're a local friend, not a customer service bot.
- Sound natural, like a text message from a friend who knows Melbourne well.

## Tools

### filterPlaces
Use this for recommendations, finding places, browsing, or any "what's good" type question.
This searches a real venue database using semantic search. Call it right away when the user asks about places — don't ask clarifying questions unless you genuinely need them.
After calling, you'll get back matching venues with details. Present a friendly summary of the top 3-5 in your response — mention names, why they're great, and area. Keep it conversational.

### buildRoute
Use this to build a full day route. You need:
1. **Vibe / trip brief** — what kind of day?
2. **Start location** — suburb or landmark
3. **Travel mode** — walking, driving, or transit
4. **Number of stops** — 2-6

Once you have enough info, call buildRoute. Fill in defaults if vague (CBD, walking, 4 stops).

## Style
- Use Australian casual English. "Reckon", "solid pick", "keen?" are fine.
- No emojis unless the user uses them first.
- Never say "I'm an AI" or "as a language model".`;

const chatRequestSchema = z.object({
  messages: z.array(z.custom<UIMessage>()),
});

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = chatRequestSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: "Invalid chat payload." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { messages } = parsed.data;

  const result = streamText({
    model: anthropic("claude-haiku-4-5-20251001"),
    system: SYSTEM_PROMPT,
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
            .describe("Number of stops to include in the route")
        }),
        execute: async (args) => {
          const raw = args as Record<string, unknown>;
          const query = (raw.query ?? raw.vibe ?? raw.trip_brief ?? "") as string;
          const startLocation = (raw.startLocation ?? raw.start_location ?? "CBD") as string;
          const travelMode = (raw.travelMode ?? raw.travel_mode ?? "walking") as TravelMode;
          const maxStops = Number(raw.maxStops ?? raw.max_stops ?? 4);

          const itinerary = await buildItinerary({
            query: query || "fun day out in Melbourne",
            startLocation,
            travelMode,
            maxStops: Math.max(2, Math.min(6, maxStops))
          });
          return itinerary;
        }
      }),
      filterPlaces: tool({
        description:
          "Search the venue database using semantic search and filter the places list on the map. Returns top matching venues with details for you to summarize.",
        inputSchema: z.object({
          query: z
            .string()
            .describe("What the user is looking for, e.g. 'cozy cafes in Fitzroy', 'hidden gem bars', 'best brunch spots'"),
          area: z
            .string()
            .optional()
            .describe("Optional area/suburb to focus on, e.g. 'Fitzroy', 'CBD', 'Brunswick'"),
        }),
        execute: async ({ query, area }) => {
          try {
            const result = await retrieveLocationsFromChroma({
              intent: query,
              clarification: area,
              topK: 8,
            });
            return {
              action: "filter",
              venues: result.results.map(r => ({
                id: r.id,
                name: r.name,
                suburb: r.suburb,
                category: r.category,
                vibe: r.vibe,
                tags: r.tags,
                score: r.score,
                reason: r.reason,
              })),
              venueIds: result.results.map(r => r.id),
              searchQuery: query,
            };
          } catch (error) {
            return {
              action: "filter",
              venues: [],
              venueIds: [],
              searchQuery: query,
              error: error instanceof Error ? error.message : "Search failed",
            };
          }
        }
      }),
    },
    stopWhen: stepCountIs(3)
  });

  return result.toUIMessageStreamResponse();
}
