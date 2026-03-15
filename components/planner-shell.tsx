"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useTheme } from "next-themes";
import {
  ArrowUpRight,
  Car,
  CheckCircle2,
  Circle,
  Clock3,
  Coffee,
  ExternalLink,
  Footprints,
  Loader2,
  LocateFixed,
  MapPin,
  MessageCircle,
  Moon,
  Route,
  Search,
  Sun,
  Train,
  UtensilsCrossed,
  Wine
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from "@/components/ui/tooltip";
import { AgentIcon, AgentIconWindy } from "@/components/agent-icon";
import { cn } from "@/lib/utils";
import { usePlaceDetails } from "@/lib/use-place-details";
import { usePlacePhoto } from "@/lib/use-place-photo";
import type {
  ChatMode,
  ItineraryResponse,
  PlannedStop,
  RecommendationItem,
  RecommendationsResponse,
  TravelMode,
  Venue,
  VenueCategory
} from "@/lib/types";
import { Star } from "lucide-react";

/* ── Lazy-loaded heavy components ─────────────────────────── */
const RouteMap = dynamic(
  () => import("@/components/route-map").then((mod) => mod.RouteMap),
  { ssr: false, loading: () => <div className="fallback-map" /> }
);

const LazyTikTokEmbed = dynamic(
  () => import("react-social-media-embed").then((mod) => mod.TikTokEmbed),
  { ssr: false, loading: () => <div className="h-[400px] animate-pulse rounded-lg bg-muted" /> }
);

const LazyYouTubeEmbed = dynamic(
  () => import("react-social-media-embed").then((mod) => mod.YouTubeEmbed),
  { ssr: false, loading: () => <div className="h-[300px] animate-pulse rounded-lg bg-muted" /> }
);

const HAS_GOOGLE_MAPS = Boolean(process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY);

const CATEGORY_ALL = "all" as const;
type CategoryFilter = VenueCategory | typeof CATEGORY_ALL;

const CATEGORIES: { value: CategoryFilter; label: string; icon: React.ReactNode }[] = [
  { value: "all", label: "All", icon: <MapPin className="size-3" /> },
  { value: "restaurant", label: "Food", icon: <UtensilsCrossed className="size-3" /> },
  { value: "cafe", label: "Cafes", icon: <Coffee className="size-3" /> },
  { value: "bar", label: "Bars", icon: <Wine className="size-3" /> },
  { value: "attraction", label: "Attractions", icon: <MapPin className="size-3" /> },
];

const SUGGESTIONS: Record<ChatMode, string[]> = {
  "route-planning": [
    "lowkey northside day with coffee and a lookout",
    "southside brunch then sunset for a date",
    "CBD fashion and food route for a visitor",
    "lunch and fashion stores around Fitzroy"
  ],
  recommendations: [
    "Recommend hidden cafes near Fitzroy",
    "Best rooftop bars in CBD for date night",
    "Top budget-friendly brunch spots in Carlton",
    "Cozy places in Brunswick with chill vibe"
  ]
};

const PLACEHOLDERS = [
  "Plan me a date night...",
  "Find somewhere cozy for brunch...",
  "What's good in Fitzroy?",
  "I want a hidden gem...",
  "Surprise me with a food crawl...",
  "Where should I take someone new to Melbourne?",
  "Something lowkey and vibes...",
  "Best sunset spot for tonight?",
  "Coffee then shopping, go...",
  "Build me the perfect Saturday...",
];

const RECOMMENDATION_PLACEHOLDERS = [
  "What vibe are you after?",
  "Which suburb should I focus on?",
  "Any budget range in mind?",
  "Want hidden gems or popular spots?",
  "Tell me area + mood and I'll narrow it down...",
];

const ROUTE_SWITCH_CONFIRM_PATTERN = /(switch|move).*(route planning)|route planning mode|confirm.*switch/i;
const AFFIRMATIVE_PATTERN = /^(yes|y|yeah|yep|yup|sure|ok|okay|go ahead|please do|do it|confirm|sounds good)\b/i;

const WELCOME_PROMPTS_ROUTE = [
  "Hey! What kind of day are you planning? Give me the vibe — brunch crawl, date day, shopping + coffee, whatever you're feeling.",
  "G'day! Planning a Melbourne day out? Tell me what you're in the mood for and I'll sort a route.",
  "What's the plan for today? Coffee and lookouts, food crawl, fashion stops — give me something to work with.",
  "Alright, let's build you a day. What are you keen for — lowkey eats, a shopping loop, sunset vibes?",
  "Hey! Where are we headed today? Drop me a vibe and I'll put together the route.",
  "Ready to plan something good. What's the brief — brunch and shopping, date day, local hidden gems?",
  "What sort of day are we building? Tell me the vibe and I'll find the spots.",
  "Let's get into it. What are you after today — food, fashion, scenic stuff, or a mix of everything?"
];

const WELCOME_PROMPTS_RECOMMENDATIONS = [
  "Hey! Keen for recommendations? Tell me the vibe and suburb, and I’ll narrow it down.",
  "G'day! What sort of places are you after — cozy cafes, bars, hidden gems, or something else?",
  "Let’s find your top picks. Share area, vibe, and budget if you’ve got them.",
  "Sweet, recommendation mode on. What are you in the mood for and where abouts?",
  "I can shortlist the best spots. Start with your vibe and preferred area."
];

function getRandomWelcome(mode: ChatMode) {
  const pool = mode === "recommendations" ? WELCOME_PROMPTS_RECOMMENDATIONS : WELCOME_PROMPTS_ROUTE;
  return pool[Math.floor(Math.random() * pool.length)];
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

/** Extract text content from a UIMessage */
function getMessageText(msg: { parts: Array<{ type: string; text?: string }> }): string {
  return msg.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text" && !!p.text)
    .map((p) => p.text)
    .join("");
}

/** Check if a part is the buildRoute tool (handles both static and dynamic tool parts) */
function isBuildRoutePart(p: Record<string, unknown>): boolean {
  if (p.type === "tool-buildRoute") return true;
  if (p.type === "dynamic-tool" && p.toolName === "buildRoute") return true;
  return false;
}

function isRetrieveLocationsPart(p: Record<string, unknown>): boolean {
  if (p.type === "tool-retrieveLocations") return true;
  if (p.type === "dynamic-tool" && p.toolName === "retrieveLocations") return true;
  return false;
}

function extractFitSignals(reason: string): string[] {
  const lower = reason.toLowerCase();
  const signals: string[] = [];

  const matchedPart = reason.match(/matched on ([^.]+)/i)?.[1];
  if (matchedPart) {
    for (const token of matchedPart.split("+").map((s) => s.trim()).filter(Boolean)) {
      signals.push(token);
    }
  }
  if (lower.includes("budget")) signals.push("budget-fit");
  if (lower.includes("walking-friendly")) signals.push("walk-friendly");
  if (lower.includes("driving-friendly")) signals.push("drive-friendly");
  if (lower.includes("transit-friendly")) signals.push("transit-friendly");

  return Array.from(new Set(signals)).slice(0, 4);
}

function similarityLevelLabel(score: number): "Very high" | "High" | "Medium" | "Low" {
  if (score >= 1.2) return "Very high";
  if (score >= 0.9) return "High";
  if (score >= 0.6) return "Medium";
  return "Low";
}

function getQuestionClarifierChips(lastAssistantText: string, mode: ChatMode): string[] {
  if (!lastAssistantText.includes("?")) return [];
  const text = lastAssistantText.toLowerCase();

  // Skip chips for broad confirmation/refinement questions.
  if (/anything else|look like what you had in mind|explore other options|different vibe|different area|route for your day|switch to route/.test(text)) {
    return [];
  }

  if (/coffee|cafe|matcha|espresso/.test(text)) {
    return [
      "Espresso-focused cafes",
      "Matcha and specialty drinks",
      "Pour-over coffee spots",
      "Quick takeaway coffee"
    ];
  }
  if (/lunch|dinner|eat|restaurant|cuisine/.test(text)) {
    return [
      "Japanese for lunch",
      "Italian casual dining",
      "Korean BBQ vibe",
      "Vegan-friendly options"
    ];
  }
  if (/budget|price|spend|cost/.test(text)) {
    return [
      "Budget-friendly",
      "Mid-range",
      "Premium splurge"
    ];
  }
  if (/start|starting|from where|where are you starting/.test(text)) {
    return [
      "Start from CBD",
      "Start from Fitzroy",
      "Start from Richmond",
      "Start from Brunswick"
    ];
  }
  if (/walk|driv|transit|public transport|get around|transport/.test(text)) {
    return [
      "I will be walking",
      "I will drive",
      "Public transport please"
    ];
  }

  if (mode === "recommendations" && /what are you in the mood|what kind of place|what vibe/.test(text)) {
    return [
      "Hidden cafes near Fitzroy",
      "Rooftop bars for date night",
      "Budget brunch spots",
      "Shopping + coffee combo"
    ];
  }

  return [];
}

function getRecommendationRefinementChips(
  queryText: string,
  results: RecommendationItem[]
): string[] {
  if (!queryText.trim() || results.length === 0) return [];

  const areaCounts = new Map<string, number>();
  for (const r of results) {
    const area = r.suburb ?? r.city ?? "Melbourne";
    areaCounts.set(area, (areaCounts.get(area) ?? 0) + 1);
  }

  const rankedAreas = Array.from(areaCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([area]) => area);

  const primaryArea = rankedAreas[0] ?? "CBD";
  const secondaryArea = rankedAreas[1] ?? null;

  const query = queryText.toLowerCase();
  const chips: string[] = [];

  chips.push(`Keep ${primaryArea} but make it budget-friendly`);
  chips.push(`Keep ${primaryArea} but make it premium`);

  if (/coffee|cafe|espresso|matcha/.test(query)) {
    chips.push(`Specialty coffee only in ${primaryArea}`);
    chips.push(`More hidden cafes around ${primaryArea}`);
  } else if (/brunch|lunch|dinner|restaurant|food/.test(query)) {
    chips.push(`Different cuisine options in ${primaryArea}`);
    chips.push(`More hidden food spots around ${primaryArea}`);
  } else {
    chips.push(`More hidden gems near ${primaryArea}`);
  }

  if (secondaryArea) {
    chips.push(`Try ${secondaryArea} instead of ${primaryArea}`);
    chips.push(`Split picks between ${primaryArea} and ${secondaryArea}`);
  } else {
    chips.push(`Try nearby suburbs instead of ${primaryArea}`);
  }

  chips.push("Switch to route planning with these picks");

  return Array.from(new Set(chips)).slice(0, 6);
}

function isBroadRefinementTurn(lastAssistantText: string): boolean {
  const text = lastAssistantText.toLowerCase();
  return /anything else|look like what you had in mind|explore other options|different vibe|different area|route for your day|switch to route/.test(text);
}

function inferModeFromText(text: string, currentMode: ChatMode, isFirstMessage: boolean): ChatMode {
  // Only infer on the very first user message — never flip mode mid-conversation
  if (!isFirstMessage) return currentMode;

  const routeIntent = /(route|itinerary|plan\s+(my|a)\s+day|day\s+plan|map\s+out|start\s+from|how\s+many\s+stops|stops?\s+for\s+the\s+day)/i;
  const recommendationIntent = /(recommend\s+me|what.*recommend|give.*recommendation|suggest.*place|find.*place|what.*near|hidden\s+gem)/i;

  if (routeIntent.test(text)) return "route-planning";
  if (recommendationIntent.test(text)) return "recommendations";
  return currentMode;
}

/* ── helpers for venues ───────────────────────────────────── */
function parseTags(raw: string): string[] {
  try { return JSON.parse(raw); } catch { return []; }
}

function priceLabel(level: number | null): string {
  if (level == null || level <= 0) return "";
  return "$".repeat(level);
}

/* ── Category icon helper ─────────────────────────────────── */
const CATEGORY_ICON_SM: Record<string, React.ReactNode> = {
  restaurant: <UtensilsCrossed className="size-3" />,
  cafe: <Coffee className="size-3" />,
  bar: <Wine className="size-3" />,
  attraction: <MapPin className="size-3" />,
  shopping: <MapPin className="size-3" />,
  other: <MapPin className="size-3" />,
};

/* ── Venue card (compact list item) ───────────────────────── */
function VenueCard({
  venue,
  active,
  onSelect
}: {
  venue: Venue;
  active: boolean;
  onSelect: (id: string) => void;
}) {
  const icon = CATEGORY_ICON_SM[venue.uiCategory] ?? <MapPin className="size-3" />;
  const { url: photoUrl, loaded: photoLoaded, ref: photoRef } = usePlacePhoto(venue.google_place_id);

  return (
    <div ref={photoRef}>
      <button
        type="button"
        onClick={() => onSelect(venue.id)}
        className={cn(
          "venue-card w-full text-left rounded-xl border overflow-hidden transition-all cursor-pointer",
          "grid grid-cols-[1fr_100px]",
          active
            ? "border-primary/40 bg-primary/8 shadow-sm"
            : "border-border/40 bg-card/40 hover:border-border/60 hover:bg-card/60"
        )}
      >
        {/* Text content */}
        <div className="p-3 space-y-1 min-w-0">
          <div className="flex items-center gap-1.5 text-muted-foreground/60">
            {icon}
            <span className="text-[0.6rem] capitalize">{venue.uiCategory}</span>
            {priceLabel(venue.price_level) && (
              <span className="text-[0.6rem]">{priceLabel(venue.price_level)}</span>
            )}
          </div>
          <h3 className="text-sm font-semibold truncate leading-tight">{venue.name}</h3>
          <p className="text-[0.7rem] text-muted-foreground/70 leading-relaxed line-clamp-2">
            {venue.description}
          </p>
        </div>

        {/* Photo */}
        <div className="relative h-full min-h-[90px]">
          {photoUrl ? (
            <img
              src={photoUrl}
              alt={venue.name}
              className="absolute inset-0 w-full h-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className={cn(
              "absolute inset-0 venue-card-placeholder",
              !photoLoaded && "animate-pulse"
            )}>
              <span className="absolute inset-0 grid place-items-center text-muted-foreground/15">
                {icon}
              </span>
            </div>
          )}
        </div>
      </button>
    </div>
  );
}

function RecommendationPhotoPane({
  venue,
  fallbackIcon,
}: {
  venue: Venue | undefined;
  fallbackIcon: React.ReactNode;
}) {
  const placeId = venue?.google_place_id;
  const { url: photoUrl, loaded: photoLoaded, ref: photoRef } = usePlacePhoto(placeId);

  return (
    <div ref={photoRef} className="relative h-full min-h-[90px]">
      {photoUrl ? (
        <img
          src={photoUrl}
          alt={venue?.name ?? "Recommended place"}
          className="absolute inset-0 w-full h-full object-cover"
          loading="lazy"
        />
      ) : (
        <div className={cn(
          "absolute inset-0 venue-card-placeholder",
          !photoLoaded && "animate-pulse"
        )}>
          <span className="absolute inset-0 grid place-items-center text-muted-foreground/15">
            {fallbackIcon}
          </span>
        </div>
      )}
    </div>
  );
}

/* ── Windowed venue list grouped by suburb ────────────────── */
const VENUE_PAGE_SIZE = 30;

type SuburbGroup = { suburb: string; venues: Venue[] };

function groupBySuburb(venues: Venue[]): SuburbGroup[] {
  const map = new Map<string, Venue[]>();
  for (const v of venues) {
    const key = v.suburb !== "unknown" ? v.suburb : v.city;
    const arr = map.get(key);
    if (arr) arr.push(v);
    else map.set(key, [v]);
  }
  return Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([suburb, venues]) => ({ suburb, venues }));
}

function VenueList({
  venues,
  selectedVenueId,
  onSelect,
}: {
  venues: Venue[];
  selectedVenueId: string | null;
  onSelect: (id: string) => void;
}) {
  const [visible, setVisible] = useState(VENUE_PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setVisible(VENUE_PAGE_SIZE); }, [venues]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible((prev) => Math.min(prev + VENUE_PAGE_SIZE, venues.length));
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [venues.length]);

  const groups = useMemo(() => groupBySuburb(venues.slice(0, visible)), [venues, visible]);

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <div key={group.suburb}>
          <div className="suburb-header sticky top-0 z-10 flex items-center gap-2 px-1 py-1.5 mb-1.5">
            <MapPin className="size-3 text-primary/60" />
            <span className="text-[0.7rem] font-semibold tracking-wide uppercase text-primary/80">
              {group.suburb}
            </span>
            <span className="text-[0.6rem] text-muted-foreground/50">{group.venues.length}</span>
          </div>
          <div className="space-y-2">
            {group.venues.map((venue) => (
              <VenueCard
                key={venue.id}
                venue={venue}
                active={selectedVenueId === venue.id}
                onSelect={onSelect}
              />
            ))}
          </div>
        </div>
      ))}
      {visible < venues.length && (
        <div ref={sentinelRef} className="flex justify-center py-2">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      )}
    </div>
  );
}

/* ── Social embed helpers ───────────────────────────────── */
type SocialLink = { platform: "tiktok" | "instagram" | "youtube" | "google-maps"; url: string; embedUrl: string | null };

function parseSocialUrls(raw: string): SocialLink[] {
  let urls: string[];
  try { urls = JSON.parse(raw); } catch { return []; }

  return urls.map((url) => {
    if (url.includes("tiktok.com")) {
      // https://www.tiktok.com/@user/video/1234567890
      const match = url.match(/video\/(\d+)/);
      return {
        platform: "tiktok" as const,
        url,
        embedUrl: match ? `https://www.tiktok.com/embed/v2/${match[1]}` : null,
      };
    }
    if (url.includes("instagram.com")) {
      // https://www.instagram.com/p/ABC123/ or /reel/ABC123/
      const match = url.match(/\/(p|reels?)\/([\w-]+)/);
      return {
        platform: "instagram" as const,
        url,
        embedUrl: match ? `https://www.instagram.com/reel/${match[2]}/embed/` : null,
      };
    }
    if (url.includes("youtube.com") || url.includes("youtu.be")) {
      const match = url.match(/(?:v=|youtu\.be\/)([^&?/]+)/);
      return {
        platform: "youtube" as const,
        url,
        embedUrl: match ? `https://www.youtube.com/embed/${match[1]}` : null,
      };
    }
    if (url.includes("maps.google")) {
      return { platform: "google-maps" as const, url, embedUrl: null };
    }
    return { platform: "google-maps" as const, url, embedUrl: null };
  });
}

function SocialEmbeds({ links }: { links: SocialLink[] }) {
  const embeddable = links.filter((l) => l.platform !== "google-maps");
  if (embeddable.length === 0) return null;

  return (
    <div className="space-y-2">
      <p className="text-[0.6rem] font-semibold tracking-[0.12em] uppercase text-muted-foreground">
        Featured on
      </p>
      <div className="flex flex-col gap-2">
        {embeddable.map((link) => (
          <div key={link.url} className="rounded-lg overflow-hidden">
            {link.platform === "tiktok" ? (
              <LazyTikTokEmbed url={link.url} width="100%" />
            ) : link.platform === "instagram" && link.embedUrl ? (
              <iframe
                src={link.embedUrl}
                className="w-full border-0"
                style={{ minHeight: 600 }}
                allow="encrypted-media; autoplay; fullscreen"
                loading="lazy"
              />
            ) : link.platform === "youtube" ? (
              <LazyYouTubeEmbed url={link.url} width="100%" />
            ) : (
              <a
                href={link.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 px-3 py-2.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <span className="capitalize font-medium">{link.platform}</span>
                <ExternalLink className="size-3 ml-auto" />
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Venue detail card (shown when a venue is selected) ──── */
const CATEGORY_COLORS: Record<string, string> = {
  restaurant: "oklch(0.7 0.18 50)",
  cafe: "oklch(0.65 0.18 310)",
  bar: "oklch(0.65 0.16 255)",
  attraction: "oklch(0.65 0.16 150)",
  shopping: "oklch(0.65 0.16 340)",
  other: "oklch(0.6 0.12 230)",
};
const CATEGORY_ICON: Record<string, React.ReactNode> = {
  restaurant: <UtensilsCrossed className="size-5" />,
  cafe: <Coffee className="size-5" />,
  bar: <Wine className="size-5" />,
  attraction: <MapPin className="size-5" />,
  shopping: <MapPin className="size-5" />,
  other: <MapPin className="size-5" />,
};

function VenueDetail({
  venue,
  onClose
}: {
  venue: Venue;
  onClose: () => void;
}) {
  const tags = parseTags(venue.tags);
  const socialLinks = parseSocialUrls(venue.source_urls);
  const accentColor = CATEGORY_COLORS[venue.uiCategory] ?? "oklch(0.65 0.16 255)";
  const icon = CATEGORY_ICON[venue.uiCategory] ?? <MapPin className="size-5" />;

  // Fetch live Place details (photos, rating, hours, reviews) via Place ID
  const { data: place, loading: placeLoading } = usePlaceDetails(venue.google_place_id);

  const liveHours = place?.currentOpeningHours?.weekdayDescriptions;
  const fallbackHours: string[] = (() => { try { return JSON.parse(venue.opening_hours); } catch { return []; } })();
  const hours = liveHours ?? (fallbackHours.length > 0 ? fallbackHours : undefined);

  return (
    <div className="venue-detail rounded-2xl overflow-hidden">
      {/* Photo carousel from Google Places */}
      {place?.photos && place.photos.length > 0 ? (
        <div className="flex gap-0.5 overflow-x-auto scrollbar-hide">
          {place.photos.map((photo, i) => (
            <img
              key={i}
              src={photo.url}
              alt={`${venue.name} photo ${i + 1}`}
              className="h-36 w-auto object-cover flex-shrink-0"
              loading="lazy"
            />
          ))}
        </div>
      ) : placeLoading ? (
        <div className="h-36 animate-pulse bg-muted" />
      ) : null}

      {/* Header */}
      <div className="px-4 pt-3 pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-3">
            <div
              className="grid place-items-center size-9 rounded-full"
              style={{ background: accentColor }}
            >
              <span className="text-white">{icon}</span>
            </div>
            <div>
              <h3 className="text-sm font-bold leading-tight">{venue.name}</h3>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="text-[0.65rem] text-muted-foreground capitalize">{venue.uiCategory}</span>
                <span className="text-[0.65rem] text-muted-foreground/50">·</span>
                <span className="text-[0.65rem] text-muted-foreground">{venue.suburb !== "unknown" ? venue.suburb : venue.city}</span>
                {priceLabel(venue.price_level) && (
                  <>
                    <span className="text-[0.65rem] text-muted-foreground/50">·</span>
                    <span className="text-[0.65rem] text-muted-foreground">{priceLabel(venue.price_level)}</span>
                  </>
                )}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 grid place-items-center size-6 rounded-full hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
          >
            <span className="text-xs">✕</span>
          </button>
        </div>

        {/* Rating + open/closed from Google Places */}
        {place && (
          <div className="flex items-center gap-3 mt-2">
            {place.rating != null && (
              <span className="flex items-center gap-1 text-[0.65rem] font-medium">
                <Star className="size-3 fill-amber-400 text-amber-400" />
                {place.rating.toFixed(1)}
                {place.userRatingCount != null && (
                  <span className="text-muted-foreground font-normal">({place.userRatingCount.toLocaleString()})</span>
                )}
              </span>
            )}
            {place.currentOpeningHours?.openNow != null && (
              <span className={cn(
                "text-[0.6rem] font-semibold px-1.5 py-0.5 rounded-full",
                place.currentOpeningHours.openNow
                  ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                  : "bg-red-500/15 text-red-600 dark:text-red-400"
              )}>
                {place.currentOpeningHours.openNow ? "Open now" : "Closed"}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Body */}
      <div className="px-4 pb-4 pt-1 space-y-3">
        <p className="text-xs text-muted-foreground/80 leading-relaxed">
          {place?.editorialSummary?.text ?? venue.description}
        </p>

        {/* Vibe + tags */}
        <div className="flex flex-wrap gap-1">
          {venue.vibe && (
            <Badge variant="secondary" className="text-[0.6rem] font-medium capitalize">
              {venue.vibe}
            </Badge>
          )}
          {tags.map((tag) => (
            <Badge key={tag} variant="outline" className="text-[0.6rem] font-normal opacity-80">
              {tag}
            </Badge>
          ))}
        </div>

        {/* Google reviews */}
        {place?.reviews && place.reviews.length > 0 && (
          <div className="space-y-2">
            <p className="text-[0.6rem] font-semibold tracking-[0.12em] uppercase text-muted-foreground">
              Reviews
            </p>
            {place.reviews.map((review, i) => (
              <div key={i} className="text-[0.65rem] rounded-lg bg-muted/40 p-2.5 space-y-1">
                <div className="flex items-center gap-1.5">
                  <span className="flex items-center gap-0.5">
                    {Array.from({ length: review.rating }, (_, j) => (
                      <Star key={j} className="size-2.5 fill-amber-400 text-amber-400" />
                    ))}
                  </span>
                  {review.authorAttribution?.displayName && (
                    <span className="text-muted-foreground">{review.authorAttribution.displayName}</span>
                  )}
                  <span className="text-muted-foreground/60 ml-auto">{review.relativePublishTimeDescription}</span>
                </div>
                {review.text?.text && (
                  <p className="text-muted-foreground/80 line-clamp-3">{review.text.text}</p>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Social embeds */}
        <SocialEmbeds links={socialLinks} />

        {/* Meta row */}
        <div className="flex items-center gap-3 text-[0.6rem] text-muted-foreground/70">
          <span className="flex items-center gap-1">
            <MapPin className="size-2.5" />
            {venue.suburb !== "unknown" ? venue.suburb : venue.city}
          </span>
          {hours && hours.length > 0 && (
            <details className="group inline">
              <summary className="cursor-pointer hover:text-foreground transition-colors flex items-center gap-1">
                <Clock3 className="size-2.5" />
                Hours
                <span className="group-open:rotate-180 transition-transform text-[0.5rem]">▾</span>
              </summary>
              <div className="mt-1.5 space-y-0.5 absolute z-10 bg-popover border border-border/40 rounded-lg p-2.5 shadow-lg text-[0.6rem]">
                {hours.map((h) => (
                  <p key={h} className="text-muted-foreground/80">{h}</p>
                ))}
              </div>
            </details>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          {(place?.websiteUri ?? venue.website) && (
            <Button size="sm" variant="outline" className="text-[0.65rem] flex-1 h-7 rounded-full" asChild>
              <a href={(place?.websiteUri ?? venue.website)!} target="_blank" rel="noreferrer">
                <ExternalLink className="size-3" />
                Website
              </a>
            </Button>
          )}
          <Button size="sm" className="text-[0.65rem] flex-1 h-7 rounded-full" asChild>
            <a
              href={place?.googleMapsUri ?? venue.google_maps_url ?? `https://www.google.com/maps/search/?api=1&query=${venue.lat},${venue.lng}`}
              target="_blank"
              rel="noreferrer"
            >
              <ArrowUpRight className="size-3" />
              Directions
            </a>
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ── Floating pill menu (center) ──────────────────────────── */
function FloatingPill({
  activeCategory,
  onCategoryChange,
  searchQuery,
  onSearchChange,
}: {
  activeCategory: CategoryFilter;
  onCategoryChange: (cat: CategoryFilter) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
}) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <div className="floating-pill absolute top-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1 px-2 py-1.5">
      {CATEGORIES.map((cat) => (
        <button
          key={cat.value}
          type="button"
          onClick={() => onCategoryChange(cat.value)}
          className={cn(
            "flex items-center gap-1 px-2.5 py-1 rounded-full text-[0.65rem] font-medium transition-all duration-150",
            activeCategory === cat.value
              ? "bg-secondary text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
          )}
        >
          {cat.icon}
          {cat.label}
        </button>
      ))}

      <div className="h-4 w-px bg-border mx-0.5" />

      <div className="pill-search flex items-center gap-1.5 rounded-full px-2.5 py-1">
        <Search className="size-3 text-muted-foreground/50 shrink-0" />
        <input
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape") onSearchChange(""); }}
          placeholder="Search..."
          className="bg-transparent text-[0.65rem] text-foreground placeholder:text-muted-foreground/40 outline-none w-24"
        />
      </div>

      <div className="h-4 w-px bg-border mx-0.5" />

      <button
        type="button"
        className="rounded-full p-1 text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-all"
        onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      >
        {mounted && theme === "dark" ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
      </button>
    </div>
  );
}

/* ── Panel open button (visible when closed, hidden when open) ── */
function PanelOpenButton({
  side,
  open,
  onToggle,
  icon,
}: {
  side: "left" | "right";
  open: boolean;
  onToggle: () => void;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "panel-open-btn fixed top-4 z-30 grid place-items-center size-10 rounded-full cursor-pointer",
        "transition-all duration-300",
        side === "left" ? "left-4" : "right-4",
        open && "panel-open-btn--hidden"
      )}
      aria-label={`Open ${side} panel`}
    >
      {icon}
    </button>
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

/* ── Main shell ────────────────────────────────────────────── */
export function PlannerShell() {
  const [chatMode, setChatMode] = useState<ChatMode>("route-planning");
  const activeMode = chatMode;
  const [venues, setVenues] = useState<Venue[]>([]);
  const [activeStopId, setActiveStopId] = useState<string | null>(null);
  const [welcomeByMode] = useState<Record<ChatMode, string>>(() => ({
    "route-planning": getRandomWelcome("route-planning"),
    recommendations: getRandomWelcome("recommendations"),
  }));
  const [input, setInput] = useState("");
  const [pendingModeSwitchMessage, setPendingModeSwitchMessage] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [venueSearch, setVenueSearch] = useState("");
  const [selectedVenueId, setSelectedVenueId] = useState<string | null>(null);
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);
  const { resolvedTheme } = useTheme();
  const [introPhase, setIntroPhase] = useState<
    "welcome" | "windy" | "map" | "chat" | "typing" | "done"
  >("welcome");
  const [typedChars, setTypedChars] = useState(0);
  const welcomeMsg = welcomeByMode[chatMode];

  /* Lazy-load venues from API instead of bundling 283KB JSON into client */
  useEffect(() => {
    fetch("/api/venues")
      .then((r) => r.json())
      .then((data: Venue[]) => setVenues(data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const t0 = setTimeout(() => setIntroPhase("windy"), 1500);
    const t1 = setTimeout(() => setIntroPhase("map"), 2200);
    const t2 = setTimeout(() => { setIntroPhase("chat"); setRightOpen(true); }, 3000);
    const t3 = setTimeout(() => setIntroPhase("typing"), 3500);
    return () => { clearTimeout(t0); clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, []);

  useEffect(() => {
    if (introPhase !== "typing") return;
    const len = welcomeMsg.length;
    const interval = setInterval(() => {
      setTypedChars((prev) => {
        if (prev >= len) { clearInterval(interval); return prev; }
        return prev + 1;
      });
    }, 8);
    return () => clearInterval(interval);
  }, [introPhase, welcomeMsg]);

  useEffect(() => {
    if (typedChars > 0 && typedChars >= welcomeMsg.length) {
      const t = setTimeout(() => { setIntroPhase("done"); setLeftOpen(true); }, 400);
      return () => clearTimeout(t);
    }
  }, [typedChars, welcomeMsg.length]);

  const selectedVenue = useMemo(
    () => selectedVenueId ? venues.find((v) => v.id === selectedVenueId) ?? null : null,
    [selectedVenueId, venues]
  );

  const filteredVenues = useMemo(() => {
    let result = venues;
    if (categoryFilter !== "all") result = result.filter((v) => v.uiCategory === categoryFilter);
    if (venueSearch.trim()) {
      const q = venueSearch.toLowerCase();
      result = result.filter((v) =>
        v.name.toLowerCase().includes(q) ||
        v.suburb.toLowerCase().includes(q) ||
        v.city.toLowerCase().includes(q) ||
        (v.vibe ?? "").toLowerCase().includes(q) ||
        v.tags.toLowerCase().includes(q)
      );
    }
    return result;
  }, [categoryFilter, venueSearch, venues]);

  const activeTransport = useMemo(
    () => new DefaultChatTransport({ api: "/api/chat", body: { mode: chatMode } }),
    [chatMode]
  );

  // v5 useChat — transport-based, sendMessage API
  const { messages, sendMessage, status } = useChat({
    id: "planner-shared",
    transport: activeTransport,
    messages: [
      {
        id: "welcome",
        role: "assistant",
        parts: [{ type: "text", text: welcomeMsg }]
      }
    ]
  });

  const isBusy = status === "submitted" || status === "streaming";

  // Extract itinerary from tool parts (handles both static "tool-buildRoute" and "dynamic-tool")
  const itinerary = useMemo<ItineraryResponse | null>(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      for (const part of messages[i].parts) {
        const p = part as any;
        if (isBuildRoutePart(p) && p.state === "output-available" && p.output) {
          const out = p.output as ItineraryResponse & { error?: string };
          // If the tool returned a structured error, skip this result
          if (out.error && (!out.stops || out.stops.length === 0)) return null;
          return out;
        }
      }
    }
    return null;
  }, [messages]);

  const routeBuildError = useMemo<string | null>(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      for (const part of messages[i].parts) {
        const p = part as any;
        if (isBuildRoutePart(p)) {
          if (p.state === "output-error") return p.errorText ?? "Route building failed.";
          if (p.state === "output-available" && p.output?.error && (!p.output.stops || p.output.stops.length === 0)) {
            return p.output.error;
          }
        }
      }
    }
    return null;
  }, [messages]);

  // Extract plan params from tool input
  const planParams = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      for (const part of messages[i].parts) {

        const p = part as any;
        if (isBuildRoutePart(p) && p.input) {
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

  const recommendations = useMemo<RecommendationsResponse | null>(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      for (const part of messages[i].parts) {
        const p = part as any;
        if (isRetrieveLocationsPart(p) && p.state === "output-available" && p.output) {
          return p.output as RecommendationsResponse;
        }
      }
    }
    return null;
  }, [messages]);

  const recommendationVenueIds = useMemo(
    () => (recommendations?.results ?? []).slice(0, 5).map((r) => r.id),
    [recommendations]
  );

  const recommendationVenueLookup = useMemo(() => {
    const map = new Map<string, Venue>();
    for (const venue of venues) {
      map.set(venue.id, venue);
    }
    return map;
  }, [venues]);

  const mapVenues = useMemo(() => {
    if (activeMode !== "recommendations") return filteredVenues;
    if (recommendationVenueIds.length === 0) return [];
    return recommendationVenueIds
      .map((id) => recommendationVenueLookup.get(id))
      .filter((v): v is Venue => !!v);
  }, [activeMode, filteredVenues, recommendationVenueIds, recommendationVenueLookup]);

  const topRecommendationVenueId = useMemo(
    () => (activeMode === "recommendations" ? recommendationVenueIds[0] ?? null : null),
    [activeMode, recommendationVenueIds]
  );

  // Is the tool currently executing?
  const isPlanning = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      for (const part of messages[i].parts) {

        const p = part as any;
        if (
          isBuildRoutePart(p) &&
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

  const highlightedVenue = useMemo(
    () => (activeStop ? venues.find((v) => v.id === activeStop.spot.id) ?? null : null),
    [activeStop, venues]
  );

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

  const placeholder = useMemo(() => {
    const pool = chatMode === "recommendations" ? RECOMMENDATION_PLACEHOLDERS : PLACEHOLDERS;
    return pool[Math.floor(Math.random() * pool.length)];
  }, [chatMode]);

  const lastAssistantText = useMemo(() => {
    for (let i = visibleMessages.length - 1; i >= 0; i--) {
      if ((visibleMessages[i].role as string) === "assistant") {
        return getMessageText(visibleMessages[i]);
      }
    }
    return "";
  }, [visibleMessages]);

  const questionClarifierChips = useMemo(
    () => getQuestionClarifierChips(lastAssistantText, chatMode),
    [lastAssistantText, chatMode]
  );

  const refinementChips = useMemo(() => {
    if (chatMode !== "recommendations") return [];
    const isQuestion = lastAssistantText.includes("?");
    if (isQuestion && !isBroadRefinementTurn(lastAssistantText)) return [];
    return getRecommendationRefinementChips(
      recommendations?.queryText ?? "",
      recommendations?.results ?? []
    );
  }, [chatMode, lastAssistantText, recommendations]);

  const dedupedActiveChips = useMemo(() => {
    const chips = questionClarifierChips.length > 0 ? questionClarifierChips : refinementChips;
    const seed = new Set(
      SUGGESTIONS[chatMode].map((s) => s.toLowerCase().replace(/\s+/g, " ").trim())
    );
    return chips.filter((chip) => {
      const normalized = chip.toLowerCase().replace(/\s+/g, " ").trim();
      if (seed.has(normalized)) return false;
      seed.add(normalized);
      return true;
    });
  }, [questionClarifierChips, refinementChips, chatMode]);

  const hasUserMessage = useMemo(
    () => visibleMessages.some((m) => (m.role as string) === "user"),
    [visibleMessages]
  );

  const isAssistantTurn = useMemo(() => {
    const last = visibleMessages[visibleMessages.length - 1];
    return !!last && (last.role as string) === "assistant";
  }, [visibleMessages]);

  const shouldShowActionChips =
    !isBusy &&
    hasUserMessage &&
    isAssistantTurn &&
    dedupedActiveChips.length > 0;

  useEffect(() => {
    if (!pendingModeSwitchMessage) return;
    sendMessage({ text: pendingModeSwitchMessage });
    setPendingModeSwitchMessage(null);
  }, [chatMode, pendingModeSwitchMessage, sendMessage]);

  useEffect(() => {
    if (chatMode === "recommendations") {
      setActiveStopId(null);
    } else {
      setSelectedVenueId(null);
    }
  }, [chatMode]);

  // Send handler
  function handleSend() {
    const text = input.trim();
    if (!text || isBusy) return;
    setInput("");

    const inferredMode = inferModeFromText(text, chatMode, !hasUserMessage);
    if (inferredMode !== chatMode) {
      setPendingModeSwitchMessage(text);
      setChatMode(inferredMode);
      return;
    }

    if (
      chatMode === "recommendations" &&
      AFFIRMATIVE_PATTERN.test(text.toLowerCase()) &&
      ROUTE_SWITCH_CONFIRM_PATTERN.test(lastAssistantText.toLowerCase())
    ) {
      setPendingModeSwitchMessage(text);
      setChatMode("route-planning");
      return;
    }

    sendMessage({ text });
  }

  return (
    <main className="shell">
      {/* welcome overlay */}
      {/* welcome overlay */}
      {(introPhase === "welcome" || introPhase === "windy" || introPhase === "map") && (
        <div className={cn(
          "intro-overlay",
          introPhase === "map" && "intro-overlay--exit"
        )}>
          <div className="intro-overlay__glow" />
          <div className="intro-overlay__agent">
            {introPhase === "windy" ? (
              <AgentIconWindy className="intro-overlay__icon" />
            ) : (
              <AgentIcon className="intro-overlay__icon" />
            )}
          </div>
          <p className="intro-overlay__name">Mappy</p>
        </div>
      )}


      {/* map */}
      <div className={`map-canvas${(introPhase === "welcome" || introPhase === "windy") ? " intro-map-hidden" : " intro-map"}`}>
        <RouteMap
          stops={itinerary?.stops ?? []}
          previewSpots={itinerary ? itinerary.candidates : []}
          venues={mapVenues}
          topRecommendationVenueId={topRecommendationVenueId}
          activeStopId={activeStopId}
          selectedVenueId={selectedVenueId}
          onSelectStop={setActiveStopId}
          onSelectVenue={setSelectedVenueId}
          startLocation={startLocation}
          travelMode={travelMode}
          colorScheme={resolvedTheme === "dark" ? "DARK" : "LIGHT"}
        />
      </div>

      {/* floating pill menu */}
      <div className={introPhase === "welcome" || introPhase === "windy" || introPhase === "map" ? "hidden" : ""}>
        <FloatingPill
          activeCategory={categoryFilter}
          onCategoryChange={setCategoryFilter}
          searchQuery={venueSearch}
          onSearchChange={setVenueSearch}
        />

        {/* Panel open buttons — visible when closed, hidden when open */}
        <PanelOpenButton side="left" open={leftOpen} onToggle={() => setLeftOpen(true)} icon={<MapPin className="size-4" />} />
        <PanelOpenButton side="right" open={rightOpen} onToggle={() => setRightOpen(true)} icon={<MessageCircle className="size-4" />} />
      </div>

      {/* ── LEFT: workspace ────────────────────────────────── */}
      <aside className={`glass-panel glass-panel--left ${leftOpen ? "" : "glass-panel--collapsed-left"}`}>
        <button
          type="button"
          onClick={() => setLeftOpen(false)}
          className="panel-close-corner panel-close-corner--left"
          aria-label="Close places panel"
        >
          <ArrowUpRight className="size-2.5 rotate-[-90deg]" />
        </button>
        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide">
          <div className="p-5 space-y-5">

            {chatMode === "recommendations" ? (
              <>
                {recommendations?.error ? (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
                    <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">Recommendations unavailable</p>
                    <p className="text-xs text-amber-700/90 dark:text-amber-200/90 mt-1.5">
                      {recommendations.error}
                    </p>
                    <p className="text-xs text-amber-700/80 dark:text-amber-200/80 mt-1">
                      Check your Chroma environment variables in `.env.local`.
                    </p>
                  </div>
                ) : recommendations?.results?.length ? (
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold">Top 5 places</h3>
                      <span className="text-xs text-muted-foreground">{recommendations.results.length} results</span>
                    </div>
                    <p className="text-[0.7rem] text-muted-foreground">Search: {recommendations.queryText}</p>
                    {recommendations.results.slice(0, 5).map((result, i) => (
                      <div key={`${result.id}-${i}`} className="space-y-1.5">
                        {(() => {
                          const venueMeta = recommendationVenueLookup.get(result.id);
                          const icon = venueMeta ? (CATEGORY_ICON_SM[venueMeta.uiCategory] ?? <MapPin className="size-3" />) : <MapPin className="size-3" />;
                          const area = result.suburb ?? result.city ?? "Melbourne";
                          const level = similarityLevelLabel(result.score);
                          const fitSignals = extractFitSignals(result.reason);
                          return (
                            <div className={cn(
                              "venue-card w-full rounded-xl border border-border/40 bg-card/40 overflow-hidden transition-all hover:border-border/60 hover:bg-card/60",
                              i === 0 && "border-primary/60 bg-primary/8 shadow-[0_0_0_1px_oklch(0.68_0.16_252/0.45)]"
                            )}>
                              <div className="grid grid-cols-[1fr_100px]">
                                <button
                                  type="button"
                                  onClick={() => setSelectedVenueId(result.id)}
                                  className="p-3 space-y-1 text-left min-w-0"
                                >
                                  <div className="flex flex-wrap items-center gap-1.5 text-muted-foreground/60 min-w-0">
                                    {icon}
                                    <span className="text-[0.6rem] capitalize">{result.category ?? venueMeta?.uiCategory ?? "place"}</span>
                                    {venueMeta && priceLabel(venueMeta.price_level) && (
                                      <span className="text-[0.6rem]">{priceLabel(venueMeta.price_level)}</span>
                                    )}
                                    {i === 0 && (
                                      <Badge variant="secondary" className="text-[0.58rem] font-semibold">Top pick</Badge>
                                    )}
                                  </div>
                                  <h3 className="text-sm font-semibold leading-tight break-words line-clamp-2">{result.name}</h3>
                                  <p className="text-[0.65rem] text-muted-foreground">{area}</p>
                                  <p className="text-[0.65rem] text-muted-foreground/80 leading-relaxed break-words line-clamp-3">{result.reason}</p>
                                  <div className="flex flex-wrap items-center gap-1.5 pt-0.5 min-w-0">
                                    <Badge variant="outline" className="text-[0.6rem]">Similarity: {level}</Badge>
                                    {fitSignals.slice(0, 2).map((signal) => (
                                      <Badge key={`${result.id}-${signal}`} variant="secondary" className="text-[0.6rem] font-medium capitalize">
                                        {signal.replace("-", " ")}
                                      </Badge>
                                    ))}
                                  </div>
                                </button>
                                <RecommendationPhotoPane venue={venueMeta} fallbackIcon={icon} />
                              </div>

                              <div className="px-3 pb-3 flex flex-wrap items-center gap-2">
                                {result.googleMapsUrl && (
                                  <Button size="sm" variant="outline" className="h-7 text-[0.65rem]" asChild>
                                    <a href={result.googleMapsUrl} target="_blank" rel="noreferrer">
                                      <ArrowUpRight className="size-3" />
                                      Maps
                                    </a>
                                  </Button>
                                )}
                                {result.website && (
                                  <Button size="sm" variant="outline" className="h-7 text-[0.65rem]" asChild>
                                    <a href={result.website} target="_blank" rel="noreferrer">
                                      <ExternalLink className="size-3" />
                                      Website
                                    </a>
                                  </Button>
                                )}
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-xl border border-border/30 bg-card/30 p-4">
                    <p className="text-sm font-semibold">No recommendations yet</p>
                    <p className="text-xs text-muted-foreground mt-1.5">
                      Tell me what you are after and I will narrow it down with a couple quick questions.
                    </p>
                  </div>
                )}
              </>
            ) : itinerary ? (
              <>
                {/* Route overview */}
                <Card className="border-primary/20 bg-primary/5 shadow-none">
                  <CardHeader className="px-4 pt-4 pb-2">
                    <CardDescription className="text-[0.6rem] font-semibold tracking-[0.12em] uppercase text-primary/80">
                      Your route
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

                {/* Highlighted stop - reuse original venue detail card */}
                {highlightedVenue ? (
                  <VenueDetail
                    venue={highlightedVenue}
                    onClose={() => setActiveStopId(null)}
                  />
                ) : activeStop ? (
                  <Card className="border-border/30 bg-card/40 shadow-none">
                    <CardContent className="p-4 space-y-1">
                      <p className="text-[0.6rem] font-semibold tracking-[0.12em] uppercase text-primary/80">
                        Highlighted
                      </p>
                      <p className="text-sm font-semibold text-foreground">{activeStop.spot.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {activeStop.arrivalTime} &middot; {activeStop.spot.area}
                      </p>
                    </CardContent>
                  </Card>
                ) : null}

                {/* Stops timeline */}
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

                {/* Backups */}
                {itinerary.backups.length > 0 && (
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
                )}

                {/* Top matches */}
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
                            {c.area} &middot; {c.kind}
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
            ) : routeBuildError ? (
              <div className="rounded-xl border border-destructive/30 bg-destructive/8 p-4 space-y-2">
                <p className="text-sm font-semibold text-destructive">Route build failed</p>
                <p className="text-xs text-muted-foreground leading-relaxed">{routeBuildError}</p>
                <p className="text-xs text-muted-foreground/60">Tell me to try again and I&apos;ll rebuild the route.</p>
              </div>
            ) : isPlanning ? (
              <div className="grid gap-4 py-8 justify-items-center text-center">
                <div className="grid place-items-center size-12 rounded-2xl bg-primary/15 text-primary animate-pulse">
                  <Route className="size-5" />
                </div>
                <div className="space-y-1.5">
                  <h2 className="text-base font-bold">Building your route</h2>
                  <p className="text-sm text-muted-foreground leading-relaxed max-w-[260px]">
                    Searching {venues.length}+ spots, ranking matches,
                    and projecting the best sequence...
                  </p>
                </div>
                <div className="flex gap-1.5 mt-2">
                  <span className="planning-dot size-2 rounded-full bg-primary/60" />
                  <span className="planning-dot size-2 rounded-full bg-primary/60" style={{ animationDelay: "0.2s" }} />
                  <span className="planning-dot size-2 rounded-full bg-primary/60" style={{ animationDelay: "0.4s" }} />
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {selectedVenue && (
                  <VenueDetail
                    venue={selectedVenue}
                    onClose={() => setSelectedVenueId(null)}
                  />
                )}

                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">
                    {categoryFilter === "all" ? "All places" : CATEGORIES.find(c => c.value === categoryFilter)?.label}
                  </h3>
                  <span className="text-xs text-muted-foreground">
                    {filteredVenues.length} spots
                  </span>
                </div>
                <VenueList
                  venues={filteredVenues}
                  selectedVenueId={selectedVenueId}
                  onSelect={setSelectedVenueId}
                />
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* ── RIGHT: chat ────────────────────────────────────── */}
      <aside className={`glass-panel glass-panel--right flex flex-col ${rightOpen ? "" : "glass-panel--collapsed-right"}`}>
        <button
          type="button"
          onClick={() => setRightOpen(false)}
          className="panel-close-corner panel-close-corner--right"
          aria-label="Close chat panel"
        >
          <ArrowUpRight className="size-2.5" />
        </button>
        <div className="shrink-0 px-4 pt-4 pb-2">
          <div className="inline-flex rounded-full border border-border/40 bg-muted/30 px-3 py-1.5 text-[0.68rem] text-muted-foreground">
            Adaptive mode: {chatMode === "route-planning" ? "Route planning" : "Recommendations"}
          </div>
        </div>
        {/* conversation */}
        <Conversation className="flex-1 min-h-0">
          <ConversationContent className="gap-5 px-5 py-5">
            {visibleMessages.map((m) => {
              const isUser = (m.role as string) === "user";
              return isUser ? (
                <div key={m.id} className="chat-msg flex justify-end">
                  <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-primary/15 px-3.5 py-2">
                    <p className="text-[15px] leading-[1.6] text-foreground">
                      {getMessageText(m)}
                    </p>
                  </div>
                </div>
              ) : (
                <div key={m.id} className="chat-msg flex items-start gap-3">
                  <div className="shrink-0 mt-0.5 grid place-items-center size-7">
                    {m.id === "welcome" && (introPhase === "chat" || introPhase === "typing") ? (
                      <AgentIconWindy className="size-6" />
                    ) : (
                      <AgentIcon className="size-6" />
                    )}
                  </div>
                  {m.id === "welcome" && introPhase === "chat" ? (
                    <div className="leaf-wind h-7 mt-1">
                      <span className="leaf-wind__leaf">🍃</span>
                      <span className="leaf-wind__leaf">🍃</span>
                      <span className="leaf-wind__leaf">🍃</span>
                    </div>
                  ) : (
                    <div className="min-w-0 flex-1">
                      <p className={cn(
                        "text-[15px] leading-[1.7] text-foreground",
                        m.id === "welcome" && introPhase === "typing" && "intro-typewriter"
                      )}>
                        {m.id === "welcome" && introPhase === "typing"
                          ? welcomeMsg.slice(0, typedChars)
                          : getMessageText(m)}
                      </p>
                    </div>
                  )}
                </div>
              );
            })}

            {isBusy && visibleMessages[visibleMessages.length - 1]?.role !== "assistant" && (
              <div className="chat-msg flex items-start gap-3">
                <div className="shrink-0 mt-0.5 grid place-items-center size-7">
                  <AgentIconWindy className="size-6" />
                </div>
                <div className="leaf-wind h-7 mt-1">
                  <span className="leaf-wind__leaf">🍃</span>
                  <span className="leaf-wind__leaf">🍃</span>
                  <span className="leaf-wind__leaf">🍃</span>
                </div>
              </div>
            )}
          </ConversationContent>
          <ConversationScrollButton className="bottom-2" />
        </Conversation>

        {/* composer */}
        <div className="shrink-0 px-4 pb-4 pt-2 space-y-2.5">
          {messages.length <= 1 && (
            <div className="flex flex-col gap-2 px-1">
              {SUGGESTIONS[chatMode].map((s, i) => (
                <button
                  key={s}
                  type="button"
                  className="chat-suggestion text-left rounded-xl border border-border/30 px-4 py-2.5 text-[13px] text-muted-foreground hover:bg-muted/30 hover:text-foreground transition-all duration-200"
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

          {shouldShowActionChips && (
            <div className="flex flex-wrap gap-1.5 px-1">
              {dedupedActiveChips.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  className="rounded-full border border-border/35 px-3 py-1.5 text-[0.68rem] text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
                  onClick={() => {
                    sendMessage({ text: chip });
                  }}
                >
                  {chip}
                </button>
              ))}
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
            className="composer-box rounded-2xl border-2 border-border/30 bg-muted/10 transition-all focus-within:border-primary/50 focus-within:shadow-[0_0_0_3px_oklch(0.65_0.16_255/0.15)]"
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={placeholder}
              rows={1}
              disabled={isBusy}
              className="block w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-[15px] text-foreground placeholder:text-muted-foreground/50 outline-none"
              style={{ fieldSizing: "content" } as React.CSSProperties}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
            />
            <div className="flex items-center justify-end gap-2 px-3 pb-2.5">
              <button
                type="submit"
                disabled={isBusy || !input.trim()}
                className="shrink-0 grid place-items-center size-7 rounded-full bg-foreground/20 text-foreground disabled:opacity-15 hover:bg-foreground/30 transition-all"
              >
                <ArrowUpRight className="size-3.5" />
              </button>
            </div>
          </form>
        </div>
      </aside>
    </main>
  );
}
