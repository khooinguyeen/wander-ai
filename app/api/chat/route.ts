import { convertToModelMessages, stepCountIs, streamText, tool, type UIMessage } from "ai";
import { z } from "zod";

import { getModel } from "@/lib/ai-model";
import { buildItinerary } from "@/lib/plan";
import type { TravelMode, UserPreferences } from "@/lib/types";

export const maxDuration = 60;

const SYSTEM_PROMPT = `You are Scout, a Melbourne route-planning copilot.

Your job is to collect enough info from the user to plan a great personalised day route (tour), then call the buildRoute tool.

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

## Optional personalisation (ask naturally if the conversation flows there)
- **Budget** — budget-friendly, mid-range, or splurge?
- **Dietary needs** — vegetarian, halal, gluten-free, etc.
- **Group type** — solo, couple, friends, family?
- **Specific interests** — street art, vintage shopping, specialty coffee, etc.
- **Time of day** — morning, afternoon, evening, or full day?

Only ask 1-2 of these extras MAX and only if it feels natural. Don't interrogate the user.
If the user volunteers any of this info unprompted, capture it.

## When to call buildRoute
- Once you have the vibe + at least one other piece of info, fill in defaults and call buildRoute.
- Don't ask for confirmation — just build it.
- If the user gives you multiple pieces of info at once, great — skip ahead.
- Sensible defaults:
  - Start: "CBD"
  - Mode: "walking"
  - Stops: 4
- IMPORTANT: Err on the side of building the route sooner rather than asking more questions.
- Pass any collected preferences (budget, dietary, interests, group type) into the userPreferences field.

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

  const result = streamText({
    model: getModel(),
    system: SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages),
    tools: {
      buildRoute: tool({
        description:
          "Build a Melbourne day route / tour once you have the vibe/query, start location, travel mode, number of stops, and optionally user preferences for personalisation.",
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
          userPreferences: z
            .object({
              budget: z.enum(["low", "medium", "high"]).optional().describe("User's budget level"),
              dietaryNeeds: z.string().optional().describe("Dietary restrictions like 'vegetarian', 'halal'"),
              interests: z.array(z.string()).optional().describe("Specific interests like ['street art', 'specialty coffee']"),
              avoidCategories: z.array(z.string()).optional().describe("Categories to avoid"),
              timeOfDay: z.enum(["morning", "afternoon", "evening", "full-day"]).optional().describe("Preferred time of day"),
              vibe: z.string().optional().describe("Overall vibe like 'cozy', 'trendy', 'hidden gem'"),
              groupType: z.string().optional().describe("Group type like 'couple', 'friends', 'family', 'solo'"),
            })
            .optional()
            .describe("Personalised preferences collected from conversation — include any info the user shared about budget, dietary needs, interests, group type, etc."),
        }),
        execute: async (args) => {
          // Gemini sometimes sends snake_case despite schema — normalize
          const raw = args as Record<string, unknown>;
          const query = (raw.query ?? raw.vibe ?? raw.trip_brief ?? raw.coffee_lookout ?? "") as string;
          const startLocation = (raw.startLocation ?? raw.start_location ?? "CBD") as string;
          const travelMode = (raw.travelMode ?? raw.travel_mode ?? "walking") as TravelMode;
          const maxStops = Number(raw.maxStops ?? raw.max_stops ?? raw.number_of_stops ?? 4);

          // Extract user preferences (handle snake_case from Gemini)
          const rawPrefs = (raw.userPreferences ?? raw.user_preferences ?? undefined) as UserPreferences | undefined;

          const itinerary = await buildItinerary({
            query: query || "fun day out in Melbourne",
            startLocation,
            travelMode,
            maxStops: Math.max(2, Math.min(6, maxStops)),
            userPreferences: rawPrefs,
          });
          return itinerary;
        }
      })
    },
    stopWhen: stepCountIs(3)
  });

  return result.toUIMessageStreamResponse();
}
