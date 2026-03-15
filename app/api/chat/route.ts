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
- Every question must be a single clause only.
- Never combine two asks in one sentence with "and", "or", commas, or follow-up clauses.
- If you need two details, ask one now and the other in the next turn.

## Clarification strategy (adaptive)
1. Ask one variable per turn in this strict order when missing: activity intent -> start location -> budget -> stop count.
2. If coffee is mentioned, ask coffee subtype in one question.
3. If lunch/dinner is mentioned, ask cuisine in one question.
4. Ask dietary preference in a separate follow-up question only when relevant.
5. Ask only missing fields. If user already gave something, do not ask it again.
6. Keep every question short and explicit, with one concrete variable.

## Structured intake fields (route)
- Required before buildRoute: intentQuery, startLocation, budgetBand.
- Optional refiners: stopCount, cuisineOrSubtype, dietary.
- Ask exactly one field per turn.
- Prefer direct templates:
  - intentQuery: "What kind of day are you after?"
  - startLocation: "Where are you starting from?"
  - budgetBand: "What's your budget range?"
  - stopCount: "How many stops do you want?"
  - cuisineOrSubtype: "Which cuisine are you craving?"
  - dietary: "Any dietary needs?"

## When to call buildRoute
- Once you have enough to personalize: activity intent, start location, and at least a rough budget, CALL buildRoute IMMEDIATELY in this same response — DO NOT write any summary text first.
- After the tool returns, THEN write your excited 2-3 sentence summary based on the actual result.
- NEVER write about a route being built, pinned, or ready without having called buildRoute first in this response. If you describe a route without the tool result, that is an error.
- Don't ask for confirmation — just build it.
- If the user gives you multiple pieces of info at once, great — skip ahead.
- If they stay vague after one follow-up, apply sensible defaults and build:
  - Start: "CBD"
  - Mode: "walking" (set silently; do not ask transport)
  - Budget: "mid"
  - Stops: 4

## After the route is built
- The tool will return the full itinerary. Give a brief excited summary (2-3 sentences).
- Mention the day theme and highlight 1-2 standout stops.
- Don't list every stop — the workspace panel shows that.
- If they want to tweak, ask what to change and rebuild.

## Route edits and swaps
- If a route already exists and the user asks to swap, replace, remove, add, or reorder stops, you MUST call buildRoute again in the same response.
- Keep prior constraints by default (start location, travel mode, stop count, budget) unless the user explicitly changes them.
- Apply the user's requested edit in the new query.
- Never claim a swap/update was completed unless buildRoute has returned in this response.

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
- Every question must be a single clause only.
- Never combine two asks in one sentence with "and", "or", commas, or follow-up clauses.
- If you need two details, ask one now and the other in the next turn.
- Ask one variable per turn in this strict order when missing: category -> area -> subtype/cuisine -> budget -> transport.
- Ask one variable per turn in this strict order when missing: category -> area -> subtype/cuisine -> budget.
- Do not ask suburb and coffee style in the same question.
- Avoid yes/no filler questions when you can directly ask for the missing variable.
- Never ask transportation questions in recommendations mode.
- Never ask questions outside app-relevant filters: category, suburb/area, subtype/cuisine, vibe, budget.

## Structured intake fields (recommendations)
- Required before retrieveLocations: category, area, and one of subtype/cuisine/vibe/budget.
- Optional refiners: budget, subtype/cuisine, vibe, dietary.
- Ask exactly one field per turn; do not combine fields.
- Prefer direct templates:
  - category: "What type of place do you want?"
  - area: "Which area should I focus on?"
  - subtype/cuisine: "Which cuisine or subtype do you want?"
  - vibe: "What vibe are you after?"
  - budget: "What's your budget range?"

## Clarification depth rules
1. Always identify category/type and area/suburb first.
2. If category is coffee/cafe, ask subtype (espresso, matcha, specialty, brunch cafe, quick takeaway).
3. If category is lunch/dinner/restaurant, ask cuisine and dietary preference.
4. Ask budget when missing.
5. If user already provides enough detail (category + area + either vibe or budget), skip extra questions and retrieve immediately.

## When to call retrieveLocations
- Build a descriptive query and include structured preferences (category, vibe, budget, area, subtype/cuisine; include start/transport only if user already gave them explicitly).
- If user mentions multiple areas, pass them via targetAreas.
- Request topK 5 unless user asks for fewer.
- Always call retrieveLocations — never make up recommendations yourself.

## After results are shown
- Use plain text only (no markdown, no bullets, no bold text, no numbered lists).
- Keep the response to 2 short sentences max.
- Summarize why the chosen spots fit their preferences, but do not list all spots in chat because the panel already shows details.
- Offer one concrete next refinement option in a single clause.
- Never suggest transport checks or transport options.
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

function isBuildRoutePart(part: Record<string, unknown>): boolean {
  if (part.type === "tool-buildRoute") return true;
  return part.type === "dynamic-tool" && part.toolName === "buildRoute";
}

function getLastUserText(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if ((msg.role as string) !== "user") continue;
    const text = (msg.parts ?? [])
      .filter((p): p is { type: "text"; text: string } => p.type === "text" && typeof p.text === "string")
      .map((p) => p.text)
      .join(" ")
      .trim();
    if (text) return text;
  }
  return "";
}

function getLastBuildRouteInput(messages: UIMessage[]): Record<string, unknown> | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    for (const part of messages[i].parts ?? []) {
      const p = part as Record<string, unknown>;
      if (isBuildRoutePart(p) && p.input && typeof p.input === "object") {
        return p.input as Record<string, unknown>;
      }
    }
  }
  return null;
}

function isRouteEditIntent(text: string): boolean {
  return /(swap|replace|change|update|remove|add|reorder|instead of|switch .* with|move .* to)/i.test(text);
}

function buildRouteSystemPrompt(
  latestUserText: string,
  previousInput: Record<string, unknown> | null
): string {
  if (!isRouteEditIntent(latestUserText) || !previousInput) return ROUTE_SYSTEM_PROMPT;

  const preserved = [
    previousInput.startLocation ? `startLocation=${String(previousInput.startLocation)}` : null,
    previousInput.travelMode ? `travelMode=${String(previousInput.travelMode)}` : null,
    previousInput.maxStops ? `maxStops=${String(previousInput.maxStops)}` : null,
    previousInput.budget ? `budget=${String(previousInput.budget)}` : null,
  ].filter(Boolean).join(", ");

  return `${ROUTE_SYSTEM_PROMPT}\n\n## Current turn priority\n- The latest user message is a route edit request.\n- Call buildRoute now in this response and apply the requested edit.\n- Preserve previous constraints unless changed by user: ${preserved || "(no prior constraints found)"}.`;
}

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = chatRequestSchema.safeParse(body);
  const messages: UIMessage[] = parsed.success ? parsed.data.messages : body.messages;
  const mode = parsed.success ? parsed.data.mode : "route-planning";
  const latestUserText = getLastUserText(messages);
  const lastBuildInput = getLastBuildRouteInput(messages);
  const routeSystemPrompt = buildRouteSystemPrompt(latestUserText, lastBuildInput);

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
    system: routeSystemPrompt,
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
          try {
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
          } catch (err) {
            console.error("[buildRoute] failed:", err);
            return { error: `Route building failed: ${String(err)}`, stops: [], candidates: [], backups: [] };
          }
        }
      })
    },
    stopWhen: stepCountIs(3)
  });

  return result.toUIMessageStreamResponse();
}
