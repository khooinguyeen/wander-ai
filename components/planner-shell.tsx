"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useTheme } from "next-themes";
import {
  ArrowUpRight,
  Car,
  CheckCircle2,
  Circle,
  Clock3,
  Footprints,
  Loader2,
  LocateFixed,
  Moon,
  Route,
  Search,
  Sun,
  Train,
  Waypoints
} from "lucide-react";

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton
} from "@/components/ai-elements/conversation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import spotsData from "@/data/melbourne-spots.sample.json";
import type {
  ItineraryResponse,
  PlannedStop,
  Spot,
  TravelMode
} from "@/lib/types";

const RouteMap = dynamic(
  () => import("@/components/route-map").then((mod) => mod.RouteMap),
  { ssr: false, loading: () => <div className="fallback-map" /> }
);

const PREVIEW_SPOTS = spotsData as Spot[];
const HAS_GOOGLE_MAPS = Boolean(process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY);

const SUGGESTIONS = [
  "lowkey northside day with coffee and a lookout",
  "southside brunch then sunset for a date",
  "CBD fashion and food route for a visitor",
  "lunch and fashion stores around Fitzroy"
];

const WELCOME_PROMPTS = [
  "Hey! What kind of day are you planning? Give me the vibe — brunch crawl, date day, shopping + coffee, whatever you're feeling.",
  "G'day! Planning a Melbourne day out? Tell me what you're in the mood for and I'll sort a route.",
  "What's the plan for today? Coffee and lookouts, food crawl, fashion stops — give me something to work with.",
  "Alright, let's build you a day. What are you keen for — lowkey eats, a shopping loop, sunset vibes?",
  "Hey! Where are we headed today? Drop me a vibe and I'll put together the route.",
  "Ready to plan something good. What's the brief — brunch and shopping, date day, local hidden gems?",
  "What sort of day are we building? Tell me the vibe and I'll find the spots.",
  "Let's get into it. What are you after today — food, fashion, scenic stuff, or a mix of everything?"
];

function getRandomWelcome() {
  return WELCOME_PROMPTS[Math.floor(Math.random() * WELCOME_PROMPTS.length)];
}

/* ── helpers ───────────────────────────────────────────────── */

function prettyMode(mode: TravelMode) {
  return mode.charAt(0).toUpperCase() + mode.slice(1);
}

function ModeIcon({ mode }: { mode: TravelMode }) {
  if (mode === "walking") return <Footprints className="size-3" />;
  if (mode === "transit") return <Train className="size-3" />;
  return <Car className="size-3" />;
}

/** Extract text content from a v5 UIMessage */
function getMessageText(msg: { parts: Array<{ type: string; text?: string }> }): string {
  return msg.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text" && !!p.text)
    .map((p) => p.text)
    .join("");
}

/* ── Floating pill menu ───────────────────────────────────── */
function FloatingPill() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <TooltipProvider delayDuration={200}>
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1 px-1.5 py-1 rounded-full border border-border/50 bg-background/80 backdrop-blur-xl shadow-lg">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              className="rounded-full"
              disabled
            >
              <Waypoints className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Scout Map</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              className="rounded-full"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            >
              {mounted && theme === "dark" ? (
                <Sun className="size-3.5" />
              ) : (
                <Moon className="size-3.5" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {mounted && theme === "dark" ? "Light mode" : "Dark mode"}
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}

/* ── Stop card ─────────────────────────────────────────────── */
function StopCard({
  stop,
  index,
  active,
  onSelect
}: {
  stop: PlannedStop;
  index: number;
  active: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(stop.spot.id)}
      className={cn(
        "grid grid-cols-[36px_1fr] gap-3 p-3 rounded-xl border text-left transition-all cursor-pointer",
        active
          ? "border-primary/40 bg-primary/8 shadow-sm"
          : "border-border/40 bg-transparent hover:bg-muted/40"
      )}
    >
      <div className="grid place-items-center size-9 rounded-lg bg-primary text-primary-foreground font-bold font-mono text-xs">
        {String(index + 1).padStart(2, "0")}
      </div>
      <div className="space-y-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[0.65rem] text-muted-foreground">
            {stop.arrivalTime}
          </span>
          <span className="text-[0.65rem] text-muted-foreground">
            {stop.legFromPreviousMinutes > 0
              ? `${stop.legFromPreviousMinutes} min · ${stop.legDistanceKm} km`
              : "Route start"}
          </span>
        </div>
        <h3 className="text-sm font-semibold truncate">{stop.spot.name}</h3>
        <p className="text-[0.65rem] text-muted-foreground">
          {stop.spot.area} · {stop.spot.kind} · {stop.spot.priceBand ?? "Free"}
        </p>
        <p className="text-[0.65rem] text-muted-foreground/70 leading-relaxed">
          {stop.reason}
        </p>
      </div>
    </button>
  );
}

/* ── v5 chat transport (stable ref) ────────────────────────── */
const chatTransport = new DefaultChatTransport({ api: "/api/chat" });

/* ── Main shell ────────────────────────────────────────────── */
export function PlannerShell() {
  const [activeStopId, setActiveStopId] = useState<string | null>(null);
  const [welcomeMsg] = useState(getRandomWelcome);
  const [input, setInput] = useState("");
  const { resolvedTheme } = useTheme();

  // v5 useChat — transport-based, sendMessage API
  const { messages, sendMessage, status } = useChat({
    transport: chatTransport,
    messages: [
      {
        id: "welcome",
        role: "assistant",
        parts: [{ type: "text", text: welcomeMsg }]
      }
    ]
  });

  const isBusy = status === "submitted" || status === "streaming";

  // Extract itinerary from tool parts (v5: type is "tool-buildRoute")
  const itinerary = useMemo<ItineraryResponse | null>(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      for (const part of messages[i].parts) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const p = part as any;
        if (p.type === "tool-buildRoute" && p.state === "output-available") {
          return p.output as ItineraryResponse;
        }
      }
    }
    return null;
  }, [messages]);

  // Extract plan params from tool input
  const planParams = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      for (const part of messages[i].parts) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const p = part as any;
        if (p.type === "tool-buildRoute" && p.input) {
          return p.input as {
            query?: string;
            startLocation?: string;
            travelMode?: TravelMode;
            maxStops?: number;
          };
        }
      }
    }
    return null;
  }, [messages]);

  // Is the tool currently executing?
  const isPlanning = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      for (const part of messages[i].parts) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const p = part as any;
        if (
          p.type === "tool-buildRoute" &&
          (p.state === "input-available" || p.state === "input-streaming")
        ) {
          return true;
        }
      }
    }
    return false;
  }, [messages]);

  useEffect(() => {
    if (itinerary?.stops.length) setActiveStopId(itinerary.stops[0].spot.id);
  }, [itinerary]);

  const activeStop =
    itinerary?.stops.find((s) => s.spot.id === activeStopId) ??
    itinerary?.stops[0] ??
    null;

  const workspacePhase = itinerary
    ? "ready"
    : isPlanning
      ? "planning"
      : planParams
        ? "briefing"
        : messages.length > 1
          ? "briefing"
          : "idle";

  const query = planParams?.query ?? "";
  const startLocation = planParams?.startLocation ?? "";
  const travelMode: TravelMode = planParams?.travelMode ?? "driving";
  const maxStops = planParams?.maxStops ?? 4;

  const steps = [
    {
      label: "Capturing brief",
      detail: query || "Chatting to understand the vibe.",
      done: workspacePhase !== "idle",
      active: workspacePhase === "idle"
    },
    {
      label: "Locking start point",
      detail: startLocation || "AI is still asking.",
      done: !!startLocation,
      active: !startLocation && workspacePhase === "briefing"
    },
    {
      label: "Ranking spots",
      detail: itinerary
        ? `${itinerary.candidates.length} matches.`
        : isPlanning
          ? "Searching the dataset..."
          : "After intake.",
      done: workspacePhase === "ready",
      active: workspacePhase === "planning"
    },
    {
      label: "Projecting route",
      detail: itinerary
        ? "Stops and route synced."
        : HAS_GOOGLE_MAPS
          ? "Google Maps ready."
          : "Set API key for map.",
      done: workspacePhase === "ready",
      active: false
    }
  ];

  // Only show messages that have visible text
  const visibleMessages = messages.filter((m) => {
    const text = getMessageText(m);
    return text.trim().length > 0;
  });

  // Send handler
  function handleSend() {
    const text = input.trim();
    if (!text || isBusy) return;
    setInput("");
    sendMessage({ text });
  }

  return (
    <main className="shell">
      {/* map */}
      <div className="map-canvas">
        <RouteMap
          stops={itinerary?.stops ?? []}
          previewSpots={itinerary ? itinerary.candidates : PREVIEW_SPOTS}
          activeStopId={activeStopId}
          onSelectStop={setActiveStopId}
          startLocation={startLocation}
          travelMode={travelMode}
          colorScheme={resolvedTheme === "dark" ? "DARK" : "LIGHT"}
        />
      </div>

      {/* floating pill menu */}
      <FloatingPill />

      {/* ── LEFT: workspace ────────────────────────────────── */}
      <aside className="glass-panel glass-panel--left">
        <div className="shrink-0 px-5 pt-5 pb-3">
          <p className="text-[0.6rem] font-semibold tracking-[0.12em] uppercase text-primary/80 mb-1">
            Workspace
          </p>
          <h1 className="text-base font-bold tracking-tight leading-snug">
            {itinerary ? itinerary.dayTheme : "Route will take shape here"}
          </h1>
        </div>

        <div className="flex flex-wrap gap-1.5 px-5 pb-3">
          {[
            { icon: <Search className="size-3" />, text: query || "Vibe pending" },
            { icon: <LocateFixed className="size-3" />, text: startLocation || "Start pending" },
            { icon: <ModeIcon mode={travelMode} />, text: prettyMode(travelMode) },
            { icon: <Route className="size-3" />, text: `${maxStops} stops` },
            ...(itinerary
              ? [{ icon: <Clock3 className="size-3" />, text: `${itinerary.route.totalTravelMinutes} min` }]
              : [])
          ].map((b, i) => (
            <Badge key={i} variant="secondary" className="gap-1 text-[0.65rem]">
              {b.icon}
              {b.text}
            </Badge>
          ))}
        </div>

        <ScrollArea className="flex-1 min-h-0">
          <div className="p-5 space-y-5">
            <Card className="border-border/30 bg-card/40 shadow-none">
              <CardHeader className="pb-3 px-4 pt-4">
                <CardDescription className="text-[0.6rem] font-semibold tracking-[0.12em] uppercase text-primary/80">
                  Planning stages
                </CardDescription>
                <CardTitle className="text-sm font-semibold">
                  {isPlanning
                    ? "Ranking, sequencing, projecting..."
                    : itinerary
                      ? "Route complete"
                      : "Live progress"}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-0">
                {steps.map((s) => (
                  <div key={s.label} className="flex gap-2.5 py-2.5">
                    <div className="shrink-0 mt-0.5">
                      {s.done ? (
                        <CheckCircle2 className="size-4 text-emerald-500" />
                      ) : s.active ? (
                        <Loader2 className="size-4 text-primary animate-spin" />
                      ) : (
                        <Circle className="size-4 text-muted-foreground/30" />
                      )}
                    </div>
                    <div>
                      <p className="text-sm font-medium">{s.label}</p>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        {s.detail}
                      </p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            {itinerary ? (
              <>
                <Card className="border-border/30 bg-card/40 shadow-none">
                  <CardHeader className="px-4 pt-4 pb-2">
                    <CardDescription className="text-[0.6rem] font-semibold tracking-[0.12em] uppercase text-primary/80">
                      Route
                    </CardDescription>
                    <CardTitle className="text-sm font-semibold">
                      {itinerary.dayTheme}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {itinerary.summary}
                    </p>
                    <div className="grid grid-cols-3 gap-2 mt-3">
                      {[
                        { label: "Travel", value: `${itinerary.route.totalTravelMinutes} min` },
                        { label: "Distance", value: `${itinerary.route.totalDistanceKm} km` },
                        { label: "Area", value: itinerary.areaSummary }
                      ].map((m) => (
                        <div key={m.label} className="rounded-lg bg-muted/50 p-2.5">
                          <span className="text-[0.6rem] text-muted-foreground">{m.label}</span>
                          <strong className="block text-sm font-mono mt-0.5">{m.value}</strong>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                {activeStop && (
                  <div className="text-xs text-muted-foreground space-y-0.5">
                    <p className="text-[0.6rem] font-semibold tracking-[0.12em] uppercase text-primary/80">
                      Highlighted
                    </p>
                    <p className="text-sm font-semibold text-foreground">
                      {activeStop.spot.name}
                    </p>
                    <p>
                      {activeStop.arrivalTime} · {activeStop.spot.area} ·{" "}
                      {activeStop.spot.address}
                    </p>
                  </div>
                )}

                <div>
                  <div className="flex items-center justify-between mb-2.5">
                    <h3 className="text-sm font-semibold">Stops</h3>
                    <span className="text-xs text-muted-foreground">
                      {itinerary.stops.length} selected
                    </span>
                  </div>
                  <div className="space-y-2">
                    {itinerary.stops.map((s, i) => (
                      <StopCard
                        key={s.spot.id}
                        stop={s}
                        index={i}
                        active={activeStop?.spot.id === s.spot.id}
                        onSelect={setActiveStopId}
                      />
                    ))}
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2.5">
                    <h3 className="text-sm font-semibold">Backups</h3>
                    <span className="text-xs text-muted-foreground">Swap if needed</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {itinerary.backups.map((sp) => (
                      <Card key={sp.id} className="border-border/30 bg-card/30 shadow-none py-0">
                        <CardContent className="p-3 space-y-0.5">
                          <p className="text-[0.6rem] text-muted-foreground">{sp.kind}</p>
                          <p className="text-xs font-semibold">{sp.name}</p>
                          <p className="text-[0.6rem] text-muted-foreground">{sp.area}</p>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2.5">
                    <h3 className="text-sm font-semibold">Top matches</h3>
                    <span className="text-xs text-muted-foreground">Pre-route ranking</span>
                  </div>
                  <div className="space-y-1.5">
                    {itinerary.candidates.slice(0, 6).map((c) => (
                      <div
                        key={c.id}
                        className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-border/20"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-semibold truncate">{c.name}</p>
                          <p className="text-[0.65rem] text-muted-foreground">
                            {c.area} · {c.kind}
                          </p>
                        </div>
                        <Badge variant="outline" className="shrink-0 font-mono text-[0.6rem]">
                          {c.matchScore}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>

                <Button size="sm" className="w-full" asChild>
                  <a
                    href={itinerary.route.googleMapsUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ArrowUpRight className="size-3.5" />
                    Open in Google Maps
                  </a>
                </Button>
              </>
            ) : (
              <div className="grid gap-3 py-10 justify-items-start">
                <div className="grid place-items-center size-9 rounded-xl bg-primary/15 text-primary">
                  <Waypoints className="size-4" />
                </div>
                <h2 className="text-base font-bold">No route on deck yet</h2>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Chat with Scout on the right. Once it has enough info it will
                  build the route automatically.
                </p>
              </div>
            )}
          </div>
        </ScrollArea>
      </aside>

      {/* ── RIGHT: chat ────────────────────────────────────── */}
      <aside className="glass-panel glass-panel--right flex flex-col">
        {/* conversation */}
        <Conversation className="flex-1 min-h-0">
          <ConversationContent className="gap-4 px-5 py-5">
            {visibleMessages.map((m) => {
              const isUser = (m.role as string) === "user";
              return isUser ? (
                <div key={m.id} className="chat-msg flex justify-end">
                  <div className="max-w-[85%] rounded-2xl rounded-br-md bg-secondary/80 px-4 py-2.5">
                    <p className="text-sm leading-relaxed text-secondary-foreground">
                      {getMessageText(m)}
                    </p>
                  </div>
                </div>
              ) : (
                <div key={m.id} className="chat-msg flex items-start gap-2.5">
                  <div className="shrink-0 mt-1 grid place-items-center size-6 rounded-full bg-primary/15">
                    <Waypoints className="size-3 text-primary" />
                  </div>
                  <div className="min-w-0 max-w-[90%] pt-0.5">
                    <p className="text-sm leading-relaxed text-foreground">
                      {getMessageText(m)}
                    </p>
                  </div>
                </div>
              );
            })}

            {isBusy && visibleMessages[visibleMessages.length - 1]?.role !== "assistant" && (
              <div className="chat-msg flex items-start gap-2.5">
                <div className="shrink-0 mt-1 grid place-items-center size-6 rounded-full bg-primary/15">
                  <Waypoints className="size-3 text-primary" />
                </div>
                <div className="flex items-center gap-2 pt-1 text-sm text-muted-foreground">
                  <span className="chat-dots flex gap-0.5">
                    <span className="chat-dot" />
                    <span className="chat-dot" />
                    <span className="chat-dot" />
                  </span>
                </div>
              </div>
            )}
          </ConversationContent>
          <ConversationScrollButton className="bottom-2" />
        </Conversation>

        {/* composer */}
        <div className="shrink-0 px-4 pb-4 pt-2 space-y-2.5">
          {messages.length <= 1 && (
            <div className="flex flex-wrap gap-1.5 px-1">
              {SUGGESTIONS.map((s, i) => (
                <button
                  key={s}
                  type="button"
                  className="chat-suggestion rounded-full border border-border/30 px-3 py-1.5 text-[0.65rem] text-muted-foreground hover:bg-muted/30 hover:text-foreground transition-all duration-200"
                  style={{ animationDelay: `${i * 60}ms` }}
                  onClick={() => {
                    sendMessage({ text: s });
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
            className="flex items-end gap-2 rounded-2xl border border-border/30 px-4 py-3 transition-colors focus-within:border-border/60"
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Message Scout..."
              rows={1}
              disabled={isBusy}
              className="flex-1 min-h-[1.4rem] max-h-28 resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground/40 outline-none"
              style={{ fieldSizing: "content" } as React.CSSProperties}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
            />
            <button
              type="submit"
              disabled={isBusy || !input.trim()}
              className="shrink-0 grid place-items-center size-7 rounded-lg bg-foreground/90 text-background disabled:opacity-20 hover:bg-foreground transition-all duration-150"
            >
              <ArrowUpRight className="size-3.5" />
            </button>
          </form>
        </div>
      </aside>
    </main>
  );
}
