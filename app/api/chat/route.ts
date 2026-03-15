import { google } from "@ai-sdk/google";
import { convertToModelMessages, stepCountIs, streamText, tool, type UIMessage } from "ai";
import { z } from "zod";

import { retrieveLocationsFromChroma } from "@/lib/location-retrieval";
import { buildItinerary } from "@/lib/plan";
import type { ChatMode, TravelMode } from "@/lib/types";

export const maxDuration = 60;
export const runtime = "nodejs";

const ROUTE_SYSTEM_PROMPT = `You are Scout, a Melbourne route-planning copilot.

Your job in this mode is to build a full day route. Do not stay in recommendations-only mode.

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
- If they say something vague like "surprise me", "you pick", or give partial info, fill in sensible defaults and just build the route:
  - Start: "CBD"
  - Mode: "walking"
  - Stops: 4
- IMPORTANT: Err on the side of building the route sooner. If you have a vibe and at least one other piece of info, fill in defaults for the rest and call buildRoute.

## Style
- Use Australian casual English. "Reckon", "solid pick", "keen?" are fine.
- No emojis unless the user uses them first.
- Never say "I'm an AI" or "as a language model".`;

const RECOMMENDATIONS_SYSTEM_PROMPT = `You are Scout, a Melbourne venue recommendation copilot.

Your job in this mode is to narrow down preferences, then recommend the top 5 places.

## Conversation rules
- Ask ONE question at a time. Keep messages short (1-2 sentences max).
- Be warm but concise. You're a local friend, not a customer service bot.
- Don't number your questions.

## Clarifying dimensions
- Area/suburb (where in Melbourne)
- Vibe/atmosphere (cozy, lively, romantic, casual, etc.)
- Budget (cheap, mid-range, premium)

## Flow for recommendations
- Ask only for missing clarifiers.
- Once you have intent + enough clarifiers, call retrieveLocations.
- Return the top 5 results and explain in plain language why they match.
- If user asks to refine, ask one follow-up and call retrieveLocations again.

## Route intent in recommendations mode
- If the user asks for a full route/itinerary, ask for confirmation to switch modes first.
- Do not pretend to switch automatically.
- Tell them you can switch to Route Planning mode after they confirm.

## Style
- Use Australian casual English. "Reckon", "solid pick", "keen?" are fine.
- No emojis unless the user uses them first.
- Never say "I'm an AI" or "as a language model".`;

const chatRequestSchema = z.object({
  messages: z.array(z.custom<UIMessage>()),
  mode: z.enum(["route-planning", "recommendations"]).optional().default("route-planning"),
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

  const { messages } = parsed.data as { messages: UIMessage[]; mode: ChatMode };
  const mode: ChatMode = parsed.data.mode;

  const model = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite-preview";

  if (mode === "recommendations") {
    const result = streamText({
      model: google(model),
      system: RECOMMENDATIONS_SYSTEM_PROMPT,
      messages: await convertToModelMessages(messages),
      tools: {
        retrieveLocations: tool({
          description:
            "Retrieve matching Melbourne locations from Chroma Cloud using intent + optional clarification.",
          inputSchema: z.object({
            intent: z
              .string()
              .describe(
                "Core user request, e.g. 'hidden matcha cafes' or 'romantic rooftop bars'"
              ),
            clarification: z
              .string()
              .optional()
              .describe("Optional preferences like suburb, vibe, budget, or constraints"),
            topK: z
              .number()
              .int()
              .min(1)
              .max(20)
              .optional()
              .describe("How many matches to return"),
          }),
          execute: async ({ intent, clarification, topK }) => {
            try {
              return await retrieveLocationsFromChroma({
                intent,
                clarification,
                topK: Math.max(1, Math.min(5, topK ?? 5)),
              });
            } catch (error) {
              const message = error instanceof Error ? error.message : "Unable to retrieve recommendations right now.";
              return {
                queryText: "",
                results: [],
                error: message,
              };
            }
          },
        }),
      },
      stopWhen: stepCountIs(5)
    });

    return result.toUIMessageStreamResponse();
  }

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
            .describe("Number of stops to include in the route")
        }),
        execute: async (args) => {
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
      }),
    },
    stopWhen: stepCountIs(3)
  });

  return result.toUIMessageStreamResponse();
}
