"use client";

import dynamic from "next/dynamic";
import { useEffect, useState, useTransition } from "react";
import {
  ArrowUpRight,
  Bot,
  Car,
  Clock3,
  Footprints,
  LocateFixed,
  MapPinned,
  MessageSquareText,
  Navigation,
  Route,
  Search,
  Sparkles,
  Train,
  User,
  Waypoints
} from "lucide-react";

import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import spotsData from "@/data/melbourne-spots.sample.json";
import type { ItineraryResponse, PlannedStop, Spot, TravelMode } from "@/lib/types";

const RouteMap = dynamic(
  () => import("@/components/route-map").then((mod) => mod.RouteMap),
  {
    ssr: false,
    loading: () => <div className="map-loading">Loading map canvas...</div>
  }
);

const PROMPTS = [
  "lowkey northside day with coffee, a lookout, and one fashion stop",
  "southside brunch then sunset lookout for a date",
  "CBD fashion and food route for someone visiting Melbourne",
  "best lowkey fashion stores and lunch spots around Fitzroy"
];

const DEFAULT_QUERY = PROMPTS[0];
const PREVIEW_SPOTS = spotsData as Spot[];

type PlanPayload = {
  query: string;
  startLocation: string;
  travelMode: TravelMode;
  maxStops: number;
};

type ChatMessage = {
  id: string;
  role: "assistant" | "user";
  title: string;
  body: string;
  meta?: string;
};

const INITIAL_MESSAGES: ChatMessage[] = [
  {
    id: "welcome",
    role: "assistant",
    title: "Map copilot online",
    body: "Describe the day you want and I will turn the local spots dataset into a compact route with timing, order, and a map handoff.",
    meta: "Route-first planning over a seeded Melbourne dataset"
  }
];

function statLabel(mode: ItineraryResponse["queryMode"]) {
  return mode === "ai" ? "Gemini planned" : "Heuristic fallback";
}

function prettyMode(mode: TravelMode) {
  return mode.charAt(0).toUpperCase() + mode.slice(1);
}

function createMessage(input: Omit<ChatMessage, "id">): ChatMessage {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ...input
  };
}

function buildAssistantMessage(itinerary: ItineraryResponse): Omit<ChatMessage, "id"> {
  return {
    role: "assistant",
    title: itinerary.dayTheme,
    body: `${itinerary.summary} Stops: ${itinerary.stops.map((stop) => stop.spot.name).join(" -> ")}.`,
    meta: `${statLabel(itinerary.queryMode)} · ${itinerary.route.totalTravelMinutes} min · ${itinerary.route.totalDistanceKm} km`
  };
}

function TravelModeGlyph({ mode }: { mode: TravelMode }) {
  if (mode === "walking") {
    return <Footprints size={15} />;
  }
  if (mode === "transit") {
    return <Train size={15} />;
  }
  return <Car size={15} />;
}

function ChatBubble({ message }: { message: ChatMessage }) {
  return (
    <article className={cn("chat-bubble", message.role === "user" && "chat-bubble--user")}>
      <div className="chat-bubble__avatar">{message.role === "user" ? <User size={15} /> : <Bot size={15} />}</div>
      <div className="chat-bubble__body">
        <div className="chat-bubble__header">
          <strong>{message.title}</strong>
          {message.meta ? <span>{message.meta}</span> : null}
        </div>
        <p>{message.body}</p>
      </div>
    </article>
  );
}

function StopCard({
  stop,
  index,
  active,
  onSelect
}: {
  stop: PlannedStop;
  index: number;
  active: boolean;
  onSelect: (spotId: string) => void;
}) {
  return (
    <button type="button" className={cn("route-stop-card", active && "route-stop-card--active")} onClick={() => onSelect(stop.spot.id)}>
      <div className="route-stop-card__index">{String(index + 1).padStart(2, "0")}</div>
      <div className="route-stop-card__content">
        <div className="route-stop-card__topline">
          <p>{stop.arrivalTime}</p>
          <span>
            {stop.legFromPreviousMinutes > 0 ? `${stop.legFromPreviousMinutes} min · ${stop.legDistanceKm} km` : "Route start"}
          </span>
        </div>
        <h3>{stop.spot.name}</h3>
        <p className="route-stop-card__meta">
          {stop.spot.area} · {stop.spot.kind} · {stop.spot.priceBand ?? "Free"}
        </p>
        <p className="route-stop-card__reason">{stop.reason}</p>
      </div>
    </button>
  );
}

export function PlannerShell() {
  const [query, setQuery] = useState(DEFAULT_QUERY);
  const [startLocation, setStartLocation] = useState("Collingwood");
  const [travelMode, setTravelMode] = useState<TravelMode>("driving");
  const [maxStops, setMaxStops] = useState(4);
  const [itinerary, setItinerary] = useState<ItineraryResponse | null>(null);
  const [activeStopId, setActiveStopId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>(INITIAL_MESSAGES);
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!itinerary?.stops.length) {
      return;
    }

    setActiveStopId(itinerary.stops[0].spot.id);
  }, [itinerary]);

  const activeStop = itinerary?.stops.find((stop) => stop.spot.id === activeStopId) ?? itinerary?.stops[0] ?? null;
  const activeStopIndex = activeStop ? itinerary?.stops.findIndex((stop) => stop.spot.id === activeStop.spot.id) ?? -1 : -1;

  async function fetchPlan(payload: PlanPayload) {
    const response = await fetch("/api/plan", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error || "Could not build itinerary.");
    }

    return (await response.json()) as ItineraryResponse;
  }

  function runPlan(overrides?: Partial<PlanPayload>) {
    const payload: PlanPayload = {
      query,
      startLocation,
      travelMode,
      maxStops,
      ...overrides
    };

    setError("");
    setMessages((current) => [
      ...current,
      createMessage({
        role: "user",
        title: payload.query,
        body: `Start near ${payload.startLocation || "the current area"} · ${prettyMode(payload.travelMode)} · ${payload.maxStops} stops`
      })
    ]);

    startTransition(() => {
      void fetchPlan(payload)
        .then((data) => {
          setItinerary(data);
          setMessages((current) => [...current, createMessage(buildAssistantMessage(data))]);
        })
        .catch((caughtError: unknown) => {
          const message = caughtError instanceof Error ? caughtError.message : "Could not build itinerary.";
          setError(message);
          setMessages((current) => [
            ...current,
            createMessage({
              role: "assistant",
              title: "Route unavailable",
              body: message,
              meta: "Check the local dataset or model configuration"
            })
          ]);
        });
    });
  }

  return (
    <main className="maps-shell">
      <section className="maps-stage">
        <div className="maps-map-frame">
          <RouteMap
            stops={itinerary?.stops ?? []}
            previewSpots={itinerary ? itinerary.candidates : PREVIEW_SPOTS}
            activeStopId={activeStopId}
            onSelectStop={setActiveStopId}
          />
        </div>
      </section>

      <aside className="maps-sidebar maps-sidebar--workspace">
        <div className="maps-brand">
          <div className="maps-brand__mark">
            <MapPinned size={18} />
          </div>
          <div>
            <p>Scout Map</p>
            <span>Apple Maps-inspired planner with route building on the left and chat on the right.</span>
          </div>
          <div className="maps-brand__badge">
            <Sparkles size={14} />
            Workspace live
          </div>
        </div>

        <section className="maps-card maps-card--composer">
          <div className="maps-card__header">
            <div>
              <p className="maps-kicker">Workspace</p>
              <h1>Build the route on the left. Read the plan on the map.</h1>
            </div>
            <div className="maps-status-pill">
              <LocateFixed size={14} />
              {startLocation}
            </div>
          </div>

          <div className="maps-inline-pills">
            <span>
              <TravelModeGlyph mode={travelMode} />
              {prettyMode(travelMode)}
            </span>
            <span>
              <Clock3 size={14} />
              {itinerary ? `${itinerary.route.totalTravelMinutes} min` : "Awaiting route"}
            </span>
            <span>
              <Route size={14} />
              {maxStops} stops
            </span>
          </div>

          <form
            className="maps-form"
            onSubmit={(event) => {
              event.preventDefault();
              runPlan();
            }}
          >
            <label className="maps-textarea">
              <span>
                <Search size={15} />
                Route request
              </span>
              <textarea
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Coffee, a lookout, and one fashion stop that still feels local"
                rows={4}
              />
            </label>

            <div className="maps-control-grid">
              <label className="maps-field">
                <span>Starting suburb</span>
                <input value={startLocation} onChange={(event) => setStartLocation(event.target.value)} placeholder="Collingwood" />
              </label>

              <label className="maps-field">
                <span>Travel mode</span>
                <select value={travelMode} onChange={(event) => setTravelMode(event.target.value as TravelMode)}>
                  <option value="driving">Driving</option>
                  <option value="walking">Walking</option>
                  <option value="transit">Transit</option>
                </select>
              </label>

              <label className="maps-field">
                <span>Stop count</span>
                <select value={maxStops} onChange={(event) => setMaxStops(Number(event.target.value))}>
                  <option value={3}>3 stops</option>
                  <option value={4}>4 stops</option>
                  <option value={5}>5 stops</option>
                  <option value={6}>6 stops</option>
                </select>
              </label>
            </div>

            <div className="maps-chip-row">
              {PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  className="maps-chip"
                  onClick={() => {
                    setQuery(prompt);
                    runPlan({ query: prompt });
                  }}
                >
                  {prompt}
                </button>
              ))}
            </div>

            <div className="maps-actions">
              <button className="maps-button maps-button--primary" type="submit" disabled={isPending}>
                <Navigation size={16} />
                {isPending ? "Building route..." : "Build route"}
              </button>

              <a className="maps-button maps-button--secondary" href={itinerary?.route.googleMapsUrl ?? "/docs"} target={itinerary ? "_blank" : undefined} rel="noreferrer">
                <ArrowUpRight size={16} />
                {itinerary ? "Open in Google Maps" : "Open dataset plan"}
              </a>
            </div>

            {error ? <p className="maps-error">{error}</p> : null}
          </form>
        </section>

        <section className="maps-card maps-card--results">
          <div className="maps-card__subheader">
            <div>
              <p className="maps-kicker">Route sheet</p>
              <h2>{itinerary ? itinerary.dayTheme : "Route results stay here."}</h2>
            </div>
            <span>{itinerary ? `${itinerary.stops.length} stops` : "Waiting"}</span>
          </div>

          <ScrollArea className="maps-scroll-shell">
            {itinerary ? (
              <div className="route-pane">
                <section className="route-pane__summary">
                  <div className="route-pane__title">
                    <div>
                      <p className="maps-kicker">Live route</p>
                      <h2>{itinerary.dayTheme}</h2>
                    </div>
                    <span>{statLabel(itinerary.queryMode)}</span>
                  </div>
                  <p>{itinerary.summary}</p>

                  <div className="metric-grid">
                    <article className="metric-card">
                      <span>Travel</span>
                      <strong>{itinerary.route.totalTravelMinutes} min</strong>
                    </article>
                    <article className="metric-card">
                      <span>Distance</span>
                      <strong>{itinerary.route.totalDistanceKm} km</strong>
                    </article>
                    <article className="metric-card">
                      <span>Area</span>
                      <strong>{itinerary.areaSummary}</strong>
                    </article>
                  </div>
                </section>

                <section className="route-pane__group">
                  <div className="route-pane__header">
                    <h3>Turn-by-turn stops</h3>
                    <span>{itinerary.stops.length} selected</span>
                  </div>
                  <div className="route-stop-list">
                    {itinerary.stops.map((stop, index) => (
                      <StopCard
                        key={stop.spot.id}
                        stop={stop}
                        index={index}
                        active={activeStop?.spot.id === stop.spot.id}
                        onSelect={setActiveStopId}
                      />
                    ))}
                  </div>
                </section>

                <section className="route-pane__group">
                  <div className="route-pane__header">
                    <h3>Backup picks</h3>
                    <span>Swap in if a stop is too busy</span>
                  </div>
                  <div className="mini-card-grid">
                    {itinerary.backups.map((spot) => (
                      <article key={spot.id} className="mini-card">
                        <p>{spot.kind}</p>
                        <strong>{spot.name}</strong>
                        <span>{spot.area}</span>
                      </article>
                    ))}
                  </div>
                </section>

                <section className="route-pane__group">
                  <div className="route-pane__header">
                    <h3>Top local matches</h3>
                    <span>Ranked before the route is assembled</span>
                  </div>
                  <div className="candidate-list">
                    {itinerary.candidates.slice(0, 6).map((candidate) => (
                      <article key={candidate.id} className="candidate-row">
                        <div>
                          <strong>{candidate.name}</strong>
                          <p>
                            {candidate.area} · {candidate.kind}
                          </p>
                        </div>
                        <span>{candidate.matchScore}</span>
                      </article>
                    ))}
                  </div>
                </section>
              </div>
            ) : (
              <div className="route-empty">
                <div className="route-empty__icon">
                  <Waypoints size={18} />
                </div>
                <h2>No route on deck yet.</h2>
                <p>Submit a chat-style request and the workspace will switch into a proper directions sheet with stops, alternates, and map pins.</p>
              </div>
            )}
          </ScrollArea>
        </section>
      </aside>

      <aside className="maps-chat-panel">
        <section className="maps-card maps-card--chat">
          <div className="maps-card__subheader maps-card__subheader--chat">
            <div>
              <p className="maps-kicker">Chat</p>
              <h2>Keep the route conversational.</h2>
            </div>
            <span className="maps-chat-count">
              <MessageSquareText size={14} />
              {messages.length}
            </span>
          </div>

          <ScrollArea className="maps-scroll-shell">
            <div className="chat-thread">
              {messages.map((message) => (
                <ChatBubble key={message.id} message={message} />
              ))}
            </div>
          </ScrollArea>
        </section>
      </aside>
    </main>
  );
}
