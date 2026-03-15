import { anthropic } from "@ai-sdk/anthropic";
import { convertToModelMessages, stepCountIs, streamText, tool, type UIMessage } from "ai";
import { z } from "zod";

import { retrieveLocationsFromChroma } from "@/lib/location-retrieval";
import { buildItinerary } from "@/lib/plan";
import type { TravelMode } from "@/lib/types";

export const maxDuration = 60;
export const runtime = "nodejs";

const SYSTEM_PROMPT = `You are Mappy, a Melbourne route-planning copilot.

Your job is to help users discover places and plan day routes in Melbourne.

## Conversation rules
- Ask ONE question at a time. Keep messages short (1-2 sentences max).
- Be warm but concise. You're a local friend, not a customer service bot.
- Don't number your questions or say "question 1 of 4".
- Sound natural, like a text message from a friend who knows Melbourne well.

## Opening flow
The very first message the user sees is: "Hey! Are you looking to find some cool places, or plan out your day?"
Wait for the user to respond. They will pick one of two paths:

### Path A: "Find cool places" (explore / browse)
- Ask what kind of places they're after (cafes, bars, hidden gems, food, shopping, etc.)
- Call filterPlaces with their intent. The results will appear in the places panel for them.
- Summarise the top 3-5 results conversationally — mention names, vibes, and areas.
- Let them keep exploring ("Want to narrow it down?" / "Any particular area?").

### Path B: "Plan my day" (route planning)
This is a guided step-by-step flow. After each question you ask, call filterPlaces so the user can see relevant recommendations in the places panel as you go.

**Step 1 — Vibe:** Ask what kind of day they're planning (food crawl, date day, shopping + coffee, chill vibes, etc.).
After they answer, call filterPlaces with their vibe to show matching spots. Then say something like "Here are some spots that fit — have a look at the places panel. Which ones catch your eye?" or "Any of those look good?".

**Step 2 — Pick spots:** The user will mention spot names they like, or say "those look good" / "surprise me". Take note of their picks. If they want more variety (e.g. "also a lookout" or "add a bar"), call filterPlaces again with the new query and let them pick more.

**Step 3 — Logistics:** Once they've picked spots or told you to surprise them, ask where they're starting from and how they want to get around (walking/driving/transit). Keep it casual: "Where are you coming from? Walking, driving, or catching the tram?"

**Step 4 — Build:** Call buildRoute with:
- query: a description capturing their vibe AND the specific spot names they picked (e.g. "brunch date day hitting Higher Ground, Lune, and a lookout")
- startLocation, travelMode, maxStops based on what they told you.

If the user is vague or says "surprise me" at any point, fill in sensible defaults and keep moving.

## Tools

### filterPlaces
Search the venue database using semantic search (RAG). Calling this updates the places panel with matching results.
IMPORTANT: Call this proactively — after the user describes their vibe, after they ask for a different category, etc.
After calling, present a friendly summary of the top 3-5 results. Remember the venue IDs from the results — you'll need them for buildRoute.

### buildRoute
Build a Melbourne day route connecting specific venues. You MUST pass the venue IDs (the "id" field from filterPlaces results) in the venueIds array.
Example: if filterPlaces returned venues with IDs like "ChIJ7WOBhx9D1moRxd_W_xx0Nmo", pass those exact IDs to buildRoute.

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
          "Build a Melbourne day route connecting specific venues by their IDs. Use the venue IDs from filterPlaces results.",
        inputSchema: z.object({
          venueIds: z
            .array(z.string())
            .describe("Google Place IDs of venues to include, from filterPlaces results"),
          query: z
            .string()
            .describe("Brief vibe description for the route theme"),
          startLocation: z
            .string()
            .describe("Starting suburb or landmark"),
          travelMode: z
            .enum(["walking", "driving", "transit"])
            .describe("How they want to travel between stops"),
        }),
        execute: async (args) => {
          const itinerary = await buildItinerary({
            query: args.query || "day out in Melbourne",
            startLocation: args.startLocation || "CBD",
            travelMode: args.travelMode as TravelMode,
            maxStops: Math.max(2, args.venueIds?.length ?? 4),
            venueIds: args.venueIds,
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
    stopWhen: stepCountIs(50)
  });

  return result.toUIMessageStreamResponse();
}
