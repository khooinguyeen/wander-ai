import { google } from "@ai-sdk/google";
import { convertToModelMessages, streamText, tool, type UIMessage } from "ai";
import { z } from "zod";

import { buildItinerary } from "@/lib/plan";
import type { TravelMode } from "@/lib/types";

export const maxDuration = 60;

const SYSTEM_PROMPT = `You are Scout, a Melbourne route-planning copilot.

Your job is to collect enough info from the user to plan a great day route, then call the buildRoute tool.

## Conversation rules
- Ask ONE question at a time. Keep messages short (1-2 sentences max).
- Be warm but concise. You're a local friend, not a customer service bot.
- Don't number your questions or say "question 1 of 4".
- Sound natural, like a text message from a friend who knows Melbourne well.

## Information you need (in roughly this order)
1. **Vibe / trip brief** — what kind of day? (food crawl, date, shopping + coffee, etc.)
2. **Start location** — where are they starting from? (suburb or landmark)
3. **Travel mode** — walking, driving, or transit?
4. **Number of stops** — how many stops? (suggest 3-5 unless they have a preference)

## When to call buildRoute
- Once you have all 4 pieces of info, call buildRoute immediately.
- Don't ask for confirmation — just build it.
- If the user gives you multiple pieces of info at once, great — skip ahead.
- If they say something like "surprise me" for any field, use sensible defaults:
  - Start: "CBD"
  - Mode: "walking"
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

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";

  const result = streamText({
    model: google(model),
    system: SYSTEM_PROMPT,
    messages: convertToModelMessages(messages),
    tools: {
      buildRoute: tool({
        description:
          "Build a Melbourne day route once you have the vibe/query, start location, travel mode, and number of stops.",
        parameters: z.object({
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
          // Gemini sometimes sends snake_case despite schema — normalize
          const raw = args as Record<string, unknown>;
          const query = (raw.query ?? raw.vibe ?? raw.trip_brief ?? raw.coffee_lookout ?? "") as string;
          const startLocation = (raw.startLocation ?? raw.start_location ?? "CBD") as string;
          const travelMode = (raw.travelMode ?? raw.travel_mode ?? "walking") as TravelMode;
          const maxStops = Number(raw.maxStops ?? raw.max_stops ?? raw.number_of_stops ?? 4);

          const itinerary = await buildItinerary({
            query: query || "fun day out in Melbourne",
            startLocation,
            travelMode,
            maxStops: Math.max(2, Math.min(6, maxStops))
          });
          return itinerary;
        }
      })
    },
    maxSteps: 3
  });

  return result.toUIMessageStreamResponse();
}
