"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  ArrowUpRight,
  Bot,
  Car,
  CheckCircle2,
  Circle,
  Clock3,
  Footprints,
  Loader2,
  LocateFixed,
  Navigation,
  Route,
  Search,
  Train,
  User,
  Waypoints
} from "lucide-react";

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
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import spotsData from "@/data/melbourne-spots.sample.json";
import type { ItineraryResponse, PlannedStop, Spot, TravelMode } from "@/lib/types";

const RouteMap = dynamic(
  () => import("@/components/route-map").then((mod) => mod.RouteMap),
  { ssr: false, loading: () => <div className="fallback-map" /> }
);

const PROMPTS = [
  "lowkey northside day with coffee, a lookout, and one fashion stop",
  "southside brunch then sunset lookout for a date",
  "CBD fashion and food route for someone visiting Melbourne",
  "best lowkey fashion stores and lunch spots around Fitzroy"
];
const START_LOCATIONS = ["Collingwood", "Fitzroy", "CBD", "St Kilda"];
const STOP_OPTIONS = [3, 4, 5, 6];
const PREVIEW_SPOTS = spotsData as Spot[];
const HAS_GOOGLE_MAPS = Boolean(process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY);

type PlanPayload = { query: string; startLocation: string; travelMode: TravelMode; maxStops: number };
type ChatMessage = { id: string; role: "assistant" | "user"; title: string; body: string; meta?: string };
type IntakeStep = "query" | "startLocation" | "travelMode" | "maxStops" | "complete";
type WorkspacePhase = "idle" | "briefing" | "planning" | "ready" | "error";

const INITIAL_MESSAGES: ChatMessage[] = [
  { id: "welcome", role: "assistant", title: "Scout", body: "What kind of day are you planning? Give me the vibe, suburb, or a must-have stop.", meta: "I'll ask a few short questions, then build the route." }
];

function statLabel(mode: ItineraryResponse["queryMode"]) {
  return mode === "ai" ? "Gemini planned" : "Heuristic fallback";
}
function prettyMode(mode: TravelMode) {
  return mode.charAt(0).toUpperCase() + mode.slice(1);
}
function createMessage(input: Omit<ChatMessage, "id">): ChatMessage {
  return { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, ...input };
}
function buildAssistantMessage(it: ItineraryResponse): Omit<ChatMessage, "id"> {
  return {
    role: "assistant",
    title: it.dayTheme,
    body: `${it.summary} Stops: ${it.stops.map((s) => s.spot.name).join(" → ")}.`,
    meta: `${statLabel(it.queryMode)} · ${it.route.totalTravelMinutes} min · ${it.route.totalDistanceKm} km`
  };
}

function ModeIcon({ mode }: { mode: TravelMode }) {
  if (mode === "walking") return <Footprints className="size-3" />;
  if (mode === "transit") return <Train className="size-3" />;
  return <Car className="size-3" />;
}

function questionForStep(step: Exclude<IntakeStep, "complete">): Omit<ChatMessage, "id"> {
  const map: Record<typeof step, Omit<ChatMessage, "id">> = {
    query: { role: "assistant", title: "Scout", body: "What kind of day are you planning? Give me the vibe, suburb, or a must-have stop.", meta: "I'll ask a few short questions, then build the route." },
    startLocation: { role: "assistant", title: "Scout", body: "Where should the route start from?", meta: "A suburb or landmark is enough." },
    travelMode: { role: "assistant", title: "Scout", body: "How do you want to move between stops?", meta: "This shapes the route distances." },
    maxStops: { role: "assistant", title: "Scout", body: "How many stops should I keep it to?", meta: "I'll keep the route compact." }
  };
  return map[step];
}

/* ── Chat bubble ───────────────────────────────────────────── */
function ChatBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  return (
    <div className="flex gap-2.5 items-start">
      <div className={cn(
        "grid place-items-center size-7 rounded-lg shrink-0",
        isUser ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
      )}>
        {isUser ? <User className="size-3.5" /> : <Bot className="size-3.5" />}
      </div>
      <div className={cn(
        "flex-1 rounded-xl border px-3 py-2.5",
        isUser ? "bg-primary/8 border-primary/15" : "bg-card/50 border-border"
      )}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold">{message.title}</span>
          {message.meta && <span className="text-[0.68rem] text-muted-foreground">{message.meta}</span>}
        </div>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{message.body}</p>
      </div>
    </div>
  );
}

/* ── Stop card ─────────────────────────────────────────────── */
function StopCard({ stop, index, active, onSelect }: { stop: PlannedStop; index: number; active: boolean; onSelect: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(stop.spot.id)}
      className={cn(
        "grid grid-cols-[36px_1fr] gap-3 p-3 rounded-xl border text-left transition-colors cursor-pointer",
        active ? "border-primary/30 bg-primary/8" : "border-border bg-transparent hover:bg-muted/50"
      )}
    >
      <div className="grid place-items-center size-9 rounded-lg bg-linear-to-br from-primary to-primary/70 text-primary-foreground font-bold font-mono text-xs">
        {String(index + 1).padStart(2, "0")}
      </div>
      <div className="space-y-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">{stop.arrivalTime}</span>
          <span className="text-xs text-muted-foreground">
            {stop.legFromPreviousMinutes > 0 ? `${stop.legFromPreviousMinutes} min · ${stop.legDistanceKm} km` : "Route start"}
          </span>
        </div>
        <h3 className="text-sm font-semibold truncate">{stop.spot.name}</h3>
        <p className="text-xs text-muted-foreground">{stop.spot.area} · {stop.spot.kind} · {stop.spot.priceBand ?? "Free"}</p>
        <p className="text-xs text-muted-foreground/80 leading-relaxed">{stop.reason}</p>
      </div>
    </button>
  );
}

/* ── Main shell ────────────────────────────────────────────── */
export function PlannerShell() {
  const [query, setQuery] = useState("");
  const [startLocation, setStartLocation] = useState("");
  const [travelMode, setTravelMode] = useState<TravelMode>("driving");
  const [maxStops, setMaxStops] = useState(4);
  const [chatInput, setChatInput] = useState("");
  const [chatStep, setChatStep] = useState<IntakeStep>("query");
  const [workspacePhase, setWorkspacePhase] = useState<WorkspacePhase>("idle");
  const [itinerary, setItinerary] = useState<ItineraryResponse | null>(null);
  const [activeStopId, setActiveStopId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>(INITIAL_MESSAGES);
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (itinerary?.stops.length) setActiveStopId(itinerary.stops[0].spot.id); }, [itinerary]);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const activeStop = itinerary?.stops.find((s) => s.spot.id === activeStopId) ?? itinerary?.stops[0] ?? null;
  const canSubmit = chatInput.trim().length >= 2;

  async function fetchPlan(p: PlanPayload) {
    const res = await fetch("/api/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(p) });
    if (!res.ok) { const b = (await res.json().catch(() => null)) as { error?: string } | null; throw new Error(b?.error || "Could not build itinerary."); }
    return (await res.json()) as ItineraryResponse;
  }

  function append(entries: Array<Omit<ChatMessage, "id">>) {
    setMessages((cur) => [...cur, ...entries.map(createMessage)]);
  }

  function runPlan(p: PlanPayload) {
    setError(""); setWorkspacePhase("planning"); setItinerary(null); setActiveStopId(null);
    startTransition(() => {
      void fetchPlan(p)
        .then((d) => { setItinerary(d); setWorkspacePhase("ready"); append([buildAssistantMessage(d)]); })
        .catch((e: unknown) => {
          const m = e instanceof Error ? e.message : "Could not build itinerary.";
          setError(m); setWorkspacePhase("error");
          append([{ role: "assistant", title: "Route unavailable", body: m, meta: "Check config" }]);
        });
    });
  }

  function reset() {
    setQuery(""); setStartLocation(""); setTravelMode("driving"); setMaxStops(4); setChatInput(""); setChatStep("query");
    setWorkspacePhase("idle"); setItinerary(null); setActiveStopId(null); setError(""); setMessages(INITIAL_MESSAGES);
  }

  function handleTextAnswer() {
    const a = chatInput.trim(); if (!a) return;
    if (chatStep === "query") { setQuery(a); setChatInput(""); setChatStep("startLocation"); setWorkspacePhase("briefing"); append([{ role: "user", title: "Trip brief", body: a }, questionForStep("startLocation")]); return; }
    if (chatStep === "startLocation") { setStartLocation(a); setChatInput(""); setChatStep("travelMode"); setWorkspacePhase("briefing"); append([{ role: "user", title: "Starting point", body: a }, questionForStep("travelMode")]); }
  }

  function handleMode(m: TravelMode) {
    setTravelMode(m); setChatStep("maxStops"); setWorkspacePhase("briefing");
    append([{ role: "user", title: "Travel mode", body: prettyMode(m) }, questionForStep("maxStops")]);
  }

  function handleStops(n: number) {
    const p: PlanPayload = { query, startLocation, travelMode, maxStops: n };
    setMaxStops(n); setChatStep("complete");
    append([
      { role: "user", title: "Stop count", body: `${n} stops` },
      { role: "assistant", title: "Working it out", body: "Enough info. Watch the workspace while I rank spots and build the route.", meta: HAS_GOOGLE_MAPS ? "Google Maps ready" : "Map key missing" }
    ]);
    runPlan(p);
  }

  function handleChip(opt: string) {
    if (chatStep === "query") { setQuery(opt); setChatInput(""); setChatStep("startLocation"); setWorkspacePhase("briefing"); append([{ role: "user", title: "Trip brief", body: opt }, questionForStep("startLocation")]); }
    else { setStartLocation(opt); setChatInput(""); setChatStep("travelMode"); setWorkspacePhase("briefing"); append([{ role: "user", title: "Starting point", body: opt }, questionForStep("travelMode")]); }
  }

  const steps = [
    { label: "Capturing brief", detail: query || "Waiting for first answer.", done: workspacePhase !== "idle", active: workspacePhase === "idle" },
    { label: "Locking start point", detail: startLocation || "Next answer fills this.", done: !!startLocation, active: !startLocation && workspacePhase === "briefing" },
    { label: "Ranking spots", detail: itinerary ? `${itinerary.candidates.length} matches.` : isPending ? "Searching..." : "After intake.", done: workspacePhase === "ready", active: workspacePhase === "planning" },
    { label: "Projecting route", detail: itinerary ? "Synced." : HAS_GOOGLE_MAPS ? "Maps ready." : "Set API key for map.", done: workspacePhase === "ready", active: workspacePhase === "error" }
  ];

  return (
    <main className="shell">
      {/* map */}
      <div className="map-canvas">
        <RouteMap stops={itinerary?.stops ?? []} previewSpots={itinerary ? itinerary.candidates : PREVIEW_SPOTS} activeStopId={activeStopId} onSelectStop={setActiveStopId} startLocation={startLocation} travelMode={travelMode} />
      </div>

      {/* ── LEFT: workspace ────────────────────────────────── */}
      <aside className="glass-panel glass-panel--left">
        {/* header */}
        <div className="shrink-0 px-5 pt-5 pb-3">
          <p className="text-[0.65rem] font-bold tracking-[0.14em] uppercase text-primary mb-1">Workspace</p>
          <h1 className="text-base font-bold tracking-tight leading-snug">{itinerary ? itinerary.dayTheme : "Route will take shape here"}</h1>
        </div>

        {/* status pills */}
        <div className="flex flex-wrap gap-1.5 px-5 pb-3">
          <Badge variant="secondary" className="gap-1 text-[0.7rem] bg-muted/60"><Search className="size-3" />{query || "Vibe pending"}</Badge>
          <Badge variant="secondary" className="gap-1 text-[0.7rem] bg-muted/60"><LocateFixed className="size-3" />{startLocation || "Start pending"}</Badge>
          <Badge variant="secondary" className="gap-1 text-[0.7rem] bg-muted/60"><ModeIcon mode={travelMode} />{prettyMode(travelMode)}</Badge>
          <Badge variant="secondary" className="gap-1 text-[0.7rem] bg-muted/60"><Route className="size-3" />{maxStops} stops</Badge>
          {itinerary && <Badge variant="secondary" className="gap-1 text-[0.7rem] bg-muted/60"><Clock3 className="size-3" />{itinerary.route.totalTravelMinutes} min</Badge>}
        </div>

        <Separator className="bg-border/40" />

        {/* scrollable body */}
        <ScrollArea className="flex-1 min-h-0">
          <div className="p-5 space-y-5">
            {/* planning stages */}
            <Card className="border-border/40 bg-card/30 shadow-none">
              <CardHeader className="pb-3 px-4 pt-4">
                <CardDescription className="text-[0.65rem] font-bold tracking-[0.14em] uppercase text-primary">Planning stages</CardDescription>
                <CardTitle className="text-sm">{workspacePhase === "planning" ? "Ranking, sequencing, projecting..." : "Live progress"}</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-0">
                {steps.map((s, i) => (
                  <div key={s.label} className={cn("flex gap-2.5 py-2.5", i > 0 && "border-t border-border/30")}>
                    <div className="shrink-0 mt-0.5">
                      {s.done ? <CheckCircle2 className="size-4 text-emerald-400" /> : s.active ? <Loader2 className="size-4 text-primary animate-spin" /> : <Circle className="size-4 text-muted-foreground/40" />}
                    </div>
                    <div>
                      <p className="text-sm font-medium">{s.label}</p>
                      <p className="text-xs text-muted-foreground leading-relaxed">{s.detail}</p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            {error && <p className="text-sm text-destructive">{error}</p>}

            {/* results */}
            {itinerary ? (
              <>
                {/* summary */}
                <Card className="border-border/40 bg-card/30 shadow-none">
                  <CardHeader className="px-4 pt-4 pb-2">
                    <CardDescription className="text-[0.65rem] font-bold tracking-[0.14em] uppercase text-primary">Route</CardDescription>
                    <CardTitle className="text-sm">{itinerary.dayTheme}</CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    <p className="text-xs text-muted-foreground leading-relaxed">{itinerary.summary}</p>
                    <div className="grid grid-cols-3 gap-2 mt-3">
                      {[
                        { label: "Travel", value: `${itinerary.route.totalTravelMinutes} min` },
                        { label: "Distance", value: `${itinerary.route.totalDistanceKm} km` },
                        { label: "Area", value: itinerary.areaSummary }
                      ].map((m) => (
                        <div key={m.label} className="rounded-lg bg-muted/40 p-2.5">
                          <span className="text-[0.65rem] text-muted-foreground">{m.label}</span>
                          <strong className="block text-sm font-mono mt-0.5">{m.value}</strong>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                {/* highlighted stop */}
                {activeStop && (
                  <div className="text-xs text-muted-foreground space-y-0.5">
                    <p className="text-[0.65rem] font-bold tracking-[0.14em] uppercase text-primary">Highlighted</p>
                    <p className="text-sm font-semibold text-foreground">{activeStop.spot.name}</p>
                    <p>{activeStop.arrivalTime} · {activeStop.spot.area} · {activeStop.spot.address}</p>
                  </div>
                )}

                {/* stops */}
                <div>
                  <div className="flex items-center justify-between mb-2.5">
                    <h3 className="text-sm font-semibold">Stops</h3>
                    <span className="text-xs text-muted-foreground">{itinerary.stops.length} selected</span>
                  </div>
                  <div className="space-y-2">
                    {itinerary.stops.map((s, i) => (
                      <StopCard key={s.spot.id} stop={s} index={i} active={activeStop?.spot.id === s.spot.id} onSelect={setActiveStopId} />
                    ))}
                  </div>
                </div>

                {/* backups */}
                <div>
                  <div className="flex items-center justify-between mb-2.5">
                    <h3 className="text-sm font-semibold">Backups</h3>
                    <span className="text-xs text-muted-foreground">Swap if needed</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {itinerary.backups.map((sp) => (
                      <Card key={sp.id} className="border-border/40 bg-card/20 shadow-none py-0">
                        <CardContent className="p-3 space-y-0.5">
                          <p className="text-[0.65rem] text-muted-foreground">{sp.kind}</p>
                          <p className="text-xs font-semibold">{sp.name}</p>
                          <p className="text-[0.65rem] text-muted-foreground">{sp.area}</p>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>

                {/* candidates */}
                <div>
                  <div className="flex items-center justify-between mb-2.5">
                    <h3 className="text-sm font-semibold">Top matches</h3>
                    <span className="text-xs text-muted-foreground">Pre-route ranking</span>
                  </div>
                  <div className="space-y-1.5">
                    {itinerary.candidates.slice(0, 6).map((c) => (
                      <div key={c.id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-border/30">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold truncate">{c.name}</p>
                          <p className="text-[0.7rem] text-muted-foreground">{c.area} · {c.kind}</p>
                        </div>
                        <Badge variant="outline" className="shrink-0 font-mono text-[0.65rem]">{c.matchScore}</Badge>
                      </div>
                    ))}
                  </div>
                </div>

                {/* actions */}
                <div className="flex gap-2">
                  <Button size="sm" className="flex-1" asChild>
                    <a href={itinerary.route.googleMapsUrl} target="_blank" rel="noreferrer">
                      <ArrowUpRight className="size-3.5" />Google Maps
                    </a>
                  </Button>
                  <Button size="sm" variant="outline" className="flex-1" onClick={reset}>Plan another</Button>
                </div>
              </>
            ) : (
              <div className="grid gap-3 py-10 justify-items-start">
                <div className="grid place-items-center size-9 rounded-xl bg-primary/15 text-primary">
                  <Waypoints className="size-4" />
                </div>
                <h2 className="text-base font-bold">No route on deck yet</h2>
                <p className="text-sm text-muted-foreground leading-relaxed">Answer the guided chat on the right and the workspace will fill with the route.</p>
              </div>
            )}
          </div>
        </ScrollArea>
      </aside>

      {/* ── RIGHT: chat ────────────────────────────────────── */}
      <aside className="glass-panel glass-panel--right">
        {/* header */}
        <div className="shrink-0 px-5 pt-5 pb-3">
          <p className="text-[0.65rem] font-bold tracking-[0.14em] uppercase text-primary mb-1">Chat</p>
          <h1 className="text-base font-bold tracking-tight">Guided copilot</h1>
          <p className="text-xs text-muted-foreground mt-1">One question at a time. The workspace fills as you answer.</p>
        </div>
        <Separator className="bg-border/40" />

        {/* messages */}
        <ScrollArea className="flex-1 min-h-0">
          <div className="p-5 space-y-3">
            {messages.map((m) => <ChatBubble key={m.id} message={m} />)}
            <div ref={chatEndRef} />
          </div>
        </ScrollArea>

        {/* composer */}
        <Separator className="bg-border/40" />
        <div className="shrink-0 p-4 space-y-3">
          {(chatStep === "query" || chatStep === "startLocation") && (
            <form onSubmit={(e) => { e.preventDefault(); handleTextAnswer(); }} className="space-y-3">
              <label className="grid gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">{chatStep === "query" ? "Describe the day" : "Enter start point"}</span>
                <textarea
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  rows={chatStep === "query" ? 2 : 1}
                  placeholder={chatStep === "query" ? "Coffee, a lookout, and a fashion stop that feels local" : "Collingwood"}
                  className="w-full rounded-xl border border-border bg-muted/40 px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none resize-none focus:border-primary/40 focus:ring-2 focus:ring-primary/10 transition-colors"
                />
              </label>

              <div className="flex gap-1.5 overflow-x-auto scrollbar-none pb-0.5">
                {(chatStep === "query" ? PROMPTS : START_LOCATIONS).map((opt) => (
                  <Button key={opt} type="button" variant="outline" size="xs" className="shrink-0 rounded-full" onClick={() => handleChip(opt)}>{opt}</Button>
                ))}
              </div>

              <Button type="submit" size="sm" className="w-full" disabled={!canSubmit}>
                <Navigation className="size-3.5" />Next
              </Button>
            </form>
          )}

          {chatStep === "travelMode" && (
            <div className="grid grid-cols-3 gap-2">
              {(["driving", "walking", "transit"] as TravelMode[]).map((m) => (
                <Button key={m} variant="outline" size="sm" className="flex-col gap-1 h-auto py-3" onClick={() => handleMode(m)}>
                  <ModeIcon mode={m} />
                  <span className="text-xs font-semibold">{prettyMode(m)}</span>
                  <span className="text-[0.65rem] text-muted-foreground">{m === "driving" ? "Cross-city" : m === "walking" ? "Local" : "Mixed"}</span>
                </Button>
              ))}
            </div>
          )}

          {chatStep === "maxStops" && (
            <div className="grid grid-cols-2 gap-2">
              {STOP_OPTIONS.map((n) => (
                <Button key={n} variant="outline" size="sm" className="flex-col gap-0.5 h-auto py-3" onClick={() => handleStops(n)}>
                  <span className="text-sm font-bold">{n} stops</span>
                  <span className="text-[0.65rem] text-muted-foreground">{n <= 4 ? "Compact" : "More variety"}</span>
                </Button>
              ))}
            </div>
          )}

          {chatStep === "complete" && (
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" size="sm" onClick={reset}>Plan another</Button>
              <Button size="sm" asChild disabled={!itinerary}>
                <a href={itinerary?.route.googleMapsUrl ?? "#"} target={itinerary ? "_blank" : undefined} rel="noreferrer">
                  {itinerary ? "Open in Maps" : "Building..."}
                </a>
              </Button>
            </div>
          )}
        </div>
      </aside>
    </main>
  );
}
