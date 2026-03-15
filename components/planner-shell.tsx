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
  ItineraryResponse,
  PlannedStop,
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

const SUGGESTIONS = [
  "Find me some cool places",
  "Plan my day out",
  "Show me hidden gems",
  "I need brunch spots",
  "Best cafes nearby",
  "Build me a date day",
  "Where's good for sunset?",
  "Surprise me with something fun",
];

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

const welcomeMsgS = [
  "Hey! Are you looking to find some cool places, or plan out your day?",
  "G'day! Want to discover somewhere new, or plan a full day out?",
  "Hey there! Keen to explore some spots, or want me to plan your day?",
  "What's the vibe — browsing for cool places, or planning a whole day out?",
  "Hey! Looking to find some gems, or want me to map out your day?",
  "Alright, what are we doing — finding cool spots or building a day plan?",
  "Hey! Want to explore what's around, or plan out where to go today?",
  "G'day! Are we hunting for places, or planning the full route today?",
];

function getRandomWelcome() {
  return welcomeMsgS[Math.floor(Math.random() * welcomeMsgS.length)];
}

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
  shopping: <ShoppingBag className="size-3" />,
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
        <div className="p-3.5 space-y-1 min-w-0">
          <div className="flex items-center gap-1.5 text-muted-foreground/60">
            {icon}
            <span className="text-[0.7rem] capitalize">{venue.uiCategory}</span>
            {priceLabel(venue.price_level) && (
              <span className="text-[0.7rem]">{priceLabel(venue.price_level)}</span>
            )}
          </div>
          <h3 className="text-[0.85rem] font-semibold truncate leading-snug">{venue.name}</h3>
          <p className="text-xs text-muted-foreground/70 leading-relaxed line-clamp-2">
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
          <div className="suburb-header sticky top-0 z-10 flex items-center gap-2 px-1 py-2 mb-1.5">
            <MapPin className="size-3 text-primary/60" />
            <span className="section-label text-primary/80">
              {group.suburb}
            </span>
            <span className="text-xs text-muted-foreground/40">{group.venues.length}</span>
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
type SocialLink = { platform: "tiktok" | "instagram" | "youtube" | "facebook" | "google-maps"; url: string; embedUrl: string | null };

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
    <div className="space-y-2.5">
      <p className="section-label">
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
const CATEGORY_ROUTE_ANIM_COLORS: Record<string, string> = {
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
  shopping: <ShoppingBag className="size-5" />,
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
  const accentColor = CATEGORY_ROUTE_ANIM_COLORS[venue.uiCategory] ?? "oklch(0.65 0.16 255)";
  const icon = CATEGORY_ICON[venue.uiCategory] ?? <MapPin className="size-5" />;

  // Fetch live Place details (photos, rating, hours, reviews) via Place ID
  const { data: place, loading: placeLoading } = usePlaceDetails(venue.google_place_id);

  const liveHours = place?.currentOpeningHours?.weekdayDescriptions;
  const fallbackHours: string[] = (() => { try { return JSON.parse(venue.opening_hours); } catch { return []; } })();
  const hours = liveHours ?? (fallbackHours.length > 0 ? fallbackHours : undefined);

  return (
    <div className="venue-detail">
      {/* Photo carousel from Google Places */}
      {place?.photos && place.photos.length > 0 ? (
        <div className="flex gap-0.5 overflow-x-auto scrollbar-hide">
          {place.photos.map((photo, i) => (
            <img
              key={i}
              src={photo.url}
              alt={`${venue.name} photo ${i + 1}`}
              className="h-44 w-auto object-cover flex-shrink-0"
              loading="lazy"
            />
          ))}
        </div>
      ) : placeLoading ? (
        <div className="h-44 animate-pulse bg-muted" />
      ) : null}

      {/* Header */}
      <div className="px-5 pt-4 pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-3">
            <div
              className="grid place-items-center size-10 rounded-xl"
              style={{ background: accentColor }}
            >
              <span className="text-white">{icon}</span>
            </div>
            <div>
              <h3 className="heading-serif text-base leading-tight">{venue.name}</h3>
              <div className="flex items-center gap-1.5 mt-1">
                <span className="text-xs text-muted-foreground capitalize">{venue.uiCategory}</span>
                <span className="text-xs text-muted-foreground/40">·</span>
                <span className="text-xs text-muted-foreground">{venue.suburb !== "unknown" ? venue.suburb : venue.city}</span>
                {priceLabel(venue.price_level) && (
                  <>
                    <span className="text-xs text-muted-foreground/40">·</span>
                    <span className="text-xs text-muted-foreground">{priceLabel(venue.price_level)}</span>
                  </>
                )}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 grid place-items-center size-7 rounded-lg hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
          >
            <span className="text-sm">✕</span>
          </button>
        </div>

        {/* Rating + open/closed from Google Places */}
        {place && (
          <div className="flex items-center gap-3 mt-2.5">
            {place.rating != null && (
              <span className="flex items-center gap-1.5 text-xs font-medium">
                <Star className="size-3.5 fill-amber-400 text-amber-400" />
                {place.rating.toFixed(1)}
                {place.userRatingCount != null && (
                  <span className="text-muted-foreground font-normal">({place.userRatingCount.toLocaleString()})</span>
                )}
              </span>
            )}
            {place.currentOpeningHours?.openNow != null && (
              <span className={cn(
                "text-[0.7rem] font-medium px-2 py-0.5 rounded-md",
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
      <div className="px-5 pb-5 pt-1 space-y-4">
        <p className="text-[0.8rem] text-muted-foreground/90 leading-[1.7]">
          {place?.editorialSummary?.text ?? venue.description}
        </p>

        {/* Vibe + tags */}
        <div className="flex flex-wrap gap-1.5">
          {venue.vibe && (
            <Badge variant="secondary" className="text-[0.7rem] font-medium capitalize rounded-md px-2 py-0.5">
              {venue.vibe}
            </Badge>
          )}
          {tags.map((tag) => (
            <Badge key={tag} variant="outline" className="text-[0.7rem] font-normal rounded-md px-2 py-0.5 opacity-80">
              {tag}
            </Badge>
          ))}
        </div>

        {/* Google reviews */}
        {place?.reviews && place.reviews.length > 0 && (
          <div className="space-y-2">
            <p className="section-label">
              Reviews
            </p>
            {place.reviews.map((review, i) => (
              <div key={i} className="text-[0.75rem] rounded-xl border border-border/30 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="grid place-items-center size-6 rounded-full bg-primary/15 text-[0.6rem] font-bold text-primary shrink-0">
                      {review.authorAttribution?.displayName?.[0]?.toUpperCase() ?? "?"}
                    </span>
                    <div className="flex flex-col">
                      {review.authorAttribution?.displayName && (
                        <span className="font-semibold text-foreground text-[0.75rem] leading-tight">{review.authorAttribution.displayName}</span>
                      )}
                      <span className="text-muted-foreground text-[0.65rem] leading-tight">{review.relativePublishTimeDescription}</span>
                    </div>
                  </div>
                  <span className="flex items-center gap-0.5 shrink-0">
                    {Array.from({ length: review.rating }, (_, j) => (
                      <Star key={j} className="size-2.5 fill-amber-400 text-amber-400" />
                    ))}
                  </span>
                </div>
                {review.text?.text && (
                  <p className="text-secondary-foreground leading-[1.55] line-clamp-3">{review.text.text}</p>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Social embeds */}
        <SocialEmbeds links={socialLinks} />

        {/* Meta row */}
        <div className="flex items-center gap-3 text-xs text-muted-foreground/70">
          <span className="flex items-center gap-1.5">
            <MapPin className="size-3" />
            {venue.suburb !== "unknown" ? venue.suburb : venue.city}
          </span>
          {hours && hours.length > 0 && (
            <details className="group inline">
              <summary className="cursor-pointer hover:text-foreground transition-colors flex items-center gap-1.5">
                <Clock3 className="size-3" />
                Hours
                <span className="group-open:rotate-180 transition-transform text-[0.6rem]">▾</span>
              </summary>
              <div className="mt-2 space-y-0.5 absolute z-10 bg-popover border border-border/40 rounded-xl p-3 shadow-lg text-xs">
                {hours.map((h) => (
                  <p key={h} className="text-muted-foreground/80 leading-relaxed">{h}</p>
                ))}
              </div>
            </details>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          {(place?.websiteUri ?? venue.website) && (
            <Button size="sm" variant="outline" className="text-xs flex-1 h-8 rounded-lg" asChild>
              <a href={(place?.websiteUri ?? venue.website)!} target="_blank" rel="noreferrer">
                <ExternalLink className="size-3.5" />
                Website
              </a>
            </Button>
          )}
          <Button size="sm" className="text-xs flex-1 h-8 rounded-lg" asChild>
            <a
              href={place?.googleMapsUri ?? venue.google_maps_url ?? `https://www.google.com/maps/search/?api=1&query=${venue.lat},${venue.lng}`}
              target="_blank"
              rel="noreferrer"
            >
              <ArrowUpRight className="size-3.5" />
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

/* ── Route building animation ──────────────────────────────── */
const ROUTE_ANIM_COLORS = ["#4f8cf9", "#f97316", "#22c55e", "#a855f7", "#ec4899", "#facc15"];

/** Animated dots-and-lines showing the actual venues being route-optimised.
 *  Maps real lat/lng to SVG coordinates and cycles through different orderings. */
function RouteAnimation({ venues, className }: { venues?: Venue[]; className?: string }) {
  const canvasRef = useRef<SVGSVGElement>(null);

  // Convert real venues to SVG nodes, or fall back to generic Melbourne dots
  const { nodes, labels } = useMemo(() => {
    const spots = venues && venues.length >= 2 ? venues.slice(0, 8) : null;

    if (!spots) {
      return {
        nodes: [
          { x: 50, y: 15 }, { x: 80, y: 25 }, { x: 90, y: 50 },
          { x: 72, y: 78 }, { x: 42, y: 85 }, { x: 15, y: 62 },
          { x: 20, y: 35 }, { x: 52, y: 48 },
        ],
        labels: [] as string[],
      };
    }

    // Project lat/lng to SVG space with padding
    const lats = spots.map(v => v.lat);
    const lngs = spots.map(v => v.lng);
    const PAD = 12;
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const rangeLat = maxLat - minLat || 0.01;
    const rangeLng = maxLng - minLng || 0.01;

    return {
      nodes: spots.map(v => ({
        x: PAD + ((v.lng - minLng) / rangeLng) * (100 - PAD * 2),
        // Flip Y: higher lat = lower y in SVG
        y: PAD + ((maxLat - v.lat) / rangeLat) * (80 - PAD * 2),
      })),
      labels: spots.map(v => {
        // Short name: first 12 chars
        const name = v.name.length > 14 ? v.name.slice(0, 12) + "..." : v.name;
        return name;
      }),
    };
  }, [venues]);

  // Generate route permutations
  const routes = useMemo(() => {
    const n = nodes.length;
    const indices = Array.from({ length: n }, (_, i) => i);
    const perms: number[][] = [];

    // Original order
    perms.push([...indices]);
    // Reverse
    perms.push([...indices].reverse());

    // Nearest-neighbour from different starts
    for (let start = 0; start < n && perms.length < 6; start++) {
      const remaining = [...indices];
      const order: number[] = [];
      let cur = remaining.splice(start, 1)[0];
      order.push(cur);
      while (remaining.length > 0) {
        let best = 0;
        let bestDist = Infinity;
        for (let j = 0; j < remaining.length; j++) {
          const d = Math.hypot(nodes[remaining[j]].x - nodes[cur].x, nodes[remaining[j]].y - nodes[cur].y);
          if (d < bestDist) { bestDist = d; best = j; }
        }
        cur = remaining.splice(best, 1)[0];
        order.push(cur);
      }
      const key = order.join(",");
      if (!perms.some(p => p.join(",") === key)) perms.push(order);
    }

    // Random shuffles
    for (let i = 0; i < 20 && perms.length < 6; i++) {
      const shuffled = [...indices].sort(() => Math.random() - 0.5);
      const key = shuffled.join(",");
      if (!perms.some(p => p.join(",") === key)) perms.push(shuffled);
    }

    return perms.slice(0, 6);
  }, [nodes]);

  useEffect(() => {
    const svg = canvasRef.current;
    if (!svg || routes.length === 0 || nodes.length === 0) return;

    let animId: number;
    const startTime = performance.now();
    const PHASE_DURATION = 2500;
    const DRAW_DURATION = 1800;

    const animate = (now: number) => {
      const elapsed = now - startTime;
      const phase = Math.floor(elapsed / PHASE_DURATION) % routes.length;
      const drawProgress = Math.min(1, (elapsed % PHASE_DURATION) / DRAW_DURATION);
      const color = ROUTE_ANIM_COLORS[phase % ROUTE_ANIM_COLORS.length];

      let html = "";

      // Draw all faded previous routes as ghost lines
      for (let pi = 0; pi < routes.length; pi++) {
        if (pi === phase) continue;
        const ghostAlpha = 0.06;
        const r = routes[pi];
        if (!r) continue;
        for (let i = 0; i < r.length - 1; i++) {
          const from = nodes[r[i]];
          const to = nodes[r[i + 1]];
          html += `<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" stroke="oklch(0.65 0.16 255 / ${ghostAlpha})" stroke-width="1" stroke-linecap="round" />`;
        }
      }

      // Draw current route (animated)
      const route = routes[phase % Math.max(1, routes.length)];
      if (!route) { animId = requestAnimationFrame(animate); return; }
      for (let i = 0; i < route.length - 1; i++) {
        const segProgress = drawProgress * (route.length - 1) - i;
        if (segProgress <= 0) continue;

        const from = nodes[route[i]];
        const to = nodes[route[i + 1]];
        const t = Math.min(1, segProgress);

        const x2 = from.x + (to.x - from.x) * t;
        const y2 = from.y + (to.y - from.y) * t;

        html += `<line x1="${from.x}" y1="${from.y}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-opacity="0.6" />`;

        // Travel dot
        if (t > 0.15 && t < 0.9) {
          const dotT = (t * 2.5) % 1;
          const dx = from.x + (to.x - from.x) * dotT;
          const dy = from.y + (to.y - from.y) * dotT;
          html += `<circle cx="${dx}" cy="${dy}" r="2.5" fill="${color}" opacity="0.9" />`;
        }
      }

      // Draw nodes + labels
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        const nodeIdx = route.indexOf(i);
        const reached = nodeIdx >= 0 && nodeIdx / (route.length - 1) <= drawProgress;
        const isFirst = nodeIdx === 0;

        // Glow ring for first node
        if (isFirst) {
          html += `<circle cx="${n.x}" cy="${n.y}" r="9" fill="${color}" opacity="0.1" class="route-anim-pulse" />`;
        }

        // Dot
        const r = isFirst ? 4.5 : 3.5;
        const dotColor = reached ? color : "oklch(0.65 0.16 255 / 0.3)";
        html += `<circle cx="${n.x}" cy="${n.y}" r="${r}" fill="${dotColor}" />`;

        // Ring for reached nodes
        if (reached && !isFirst) {
          html += `<circle cx="${n.x}" cy="${n.y}" r="${r + 2.5}" fill="none" stroke="${color}" stroke-width="1" opacity="0.3" />`;
        }

        // Label
        if (labels[i]) {
          const labelOpacity = reached ? 0.8 : 0.35;
          html += `<text x="${n.x}" y="${n.y + (n.y > 60 ? -7 : 10)}" text-anchor="middle" font-size="3.2" font-family="system-ui, sans-serif" font-weight="${reached ? "600" : "400"}" fill="oklch(0.35 0.05 255 / ${labelOpacity})">${labels[i]}</text>`;
        }
      }

      // Phase indicator dots at the bottom
      for (let i = 0; i < routes.length; i++) {
        const dotX = 50 - (routes.length - 1) * 3 + i * 6;
        const isCurrent = i === phase;
        html += `<circle cx="${dotX}" cy="92" r="${isCurrent ? 2 : 1.2}" fill="${isCurrent ? ROUTE_ANIM_COLORS[i % ROUTE_ANIM_COLORS.length] : "oklch(0.65 0.16 255 / 0.2)"}" />`;
      }

      svg.innerHTML = html;
      animId = requestAnimationFrame(animate);
    };

    animId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animId);
  }, [nodes, labels, routes, ROUTE_ANIM_COLORS]);

  return (
    <svg
      ref={canvasRef}
      viewBox="0 0 100 96"
      className={cn("route-build-anim", className)}
      style={{ width: "100%", maxWidth: 300, aspectRatio: "100/96" }}
    />
  );
}

/* ── Stop card ─────────────────────────────────────────────── */
function StopCard({
  stop,
  index,
  active,
  onSelect,
  startLocation
}: {
  stop: PlannedStop;
  index: number;
  active: boolean;
  onSelect: (id: string) => void;
  startLocation?: string;
}) {
  const legLabel = index === 0 && startLocation
    ? stop.legFromPreviousMinutes > 0
      ? `${stop.legFromPreviousMinutes} min from ${startLocation}`
      : `From ${startLocation}`
    : stop.legFromPreviousMinutes > 0
      ? `${stop.legFromPreviousMinutes} min · ${stop.legDistanceKm} km`
      : "Route start";

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
      <div className="grid place-items-center size-9 rounded-lg bg-primary text-primary-foreground font-semibold font-mono text-xs">
        {String(index + 1).padStart(2, "0")}
      </div>
      <div className="space-y-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {stop.arrivalTime}
          </span>
          <span className="text-xs text-muted-foreground">
            {legLabel}
          </span>
        </div>
        <h3 className="text-[0.85rem] font-semibold truncate">{stop.spot.name}</h3>
        <p className="text-xs text-muted-foreground">
          {stop.spot.area} · {stop.spot.kind} · {stop.spot.priceBand ?? "Free"}
        </p>
        <p className="text-xs text-muted-foreground/70 leading-[1.6]">
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
  const [aiFilterActive, setAiFilterActive] = useState(false);
  const [aiFilteredIds, setAiFilteredIds] = useState<Set<string> | null>(null);
  const [selectedVenueId, setSelectedVenueId] = useState<string | null>(null);
  const leftScrollRef = useRef<HTMLDivElement>(null);
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);
  const [mobileTab, setMobileTab] = useState<"places" | "chat">("chat");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  /* ── Mobile panel drag-to-resize ──────────────────────── */
  const PANEL_MIN_H = 8;
  const PANEL_MAX_H = 85; // cap below the search icon
  const PANEL_DEFAULT_H = 52;
  const PANEL_COLLAPSE_THRESHOLD = 15; // below this → collapse entirely
  const [panelHeight, setPanelHeight] = useState(PANEL_DEFAULT_H);
  const [panelCollapsed, setPanelCollapsed] = useState(false);

  const handleSelectVenue = useCallback((id: string) => {
    setSelectedVenueId(id);
    leftScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    // If mobile panel is collapsed, expand it to Places
    if (panelCollapsed) {
      setPanelCollapsed(false);
      setPanelHeight(PANEL_DEFAULT_H);
      setMobileTab("places");
    }
  }, [panelCollapsed, PANEL_DEFAULT_H]);
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef({ startY: 0, startH: PANEL_DEFAULT_H });

  const onDragStart = useCallback((e: React.PointerEvent) => {
    setIsDragging(true);
    dragRef.current = { startY: e.clientY, startH: panelHeight };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [panelHeight]);

  const onDragMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging) return;
    const deltaY = dragRef.current.startY - e.clientY;
    const deltaDvh = (deltaY / window.innerHeight) * 100;
    setPanelHeight(Math.min(PANEL_MAX_H, Math.max(PANEL_MIN_H, dragRef.current.startH + deltaDvh)));
  }, [isDragging]);

  const onDragEnd = useCallback(() => {
    if (!isDragging) return;
    setIsDragging(false);
    setPanelHeight(prev => {
      if (prev < PANEL_COLLAPSE_THRESHOLD) {
        setPanelCollapsed(true);
        return 0;
      }
      if (prev > 80) return PANEL_MAX_H;
      return prev;
    });
  }, [isDragging, PANEL_COLLAPSE_THRESHOLD]);

  const expandPanel = useCallback((tab: "places" | "chat") => {
    setMobileTab(tab);
    setPanelCollapsed(false);
    setPanelHeight(PANEL_DEFAULT_H);
  }, [PANEL_DEFAULT_H]);
  const { resolvedTheme, theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
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
    // AI RAG filter takes priority — show only matched venue IDs
    if (aiFilterActive && aiFilteredIds) {
      return venues.filter((v) => aiFilteredIds.has(v.id));
    }
    let result = venues;
    if (categoryFilter !== "all") result = result.filter((v) => v.uiCategory === categoryFilter);
    if (venueSearch.trim()) {
      const words = venueSearch.toLowerCase().split(/\s+/).filter(w => w.length > 1);
      if (words.length > 0) {
        result = result.filter((v) => {
          const haystack = `${v.name} ${v.suburb} ${v.city} ${v.vibe ?? ""} ${v.tags} ${v.description ?? ""}`.toLowerCase();
          return words.some(w => haystack.includes(w));
        });
      }
    }
    return result;
  }, [categoryFilter, venueSearch, venues]);

  const activeTransport = useMemo(
    () => new DefaultChatTransport({ api: "/api/chat" }),
    []
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

  // Detect if the tool errored (e.g. quota exceeded)
  const toolError = useMemo<string | null>(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      for (const part of messages[i].parts) {
        const p = part as any;
        if (isBuildRoutePart(p) && p.state === "error" && p.errorText) {
          return p.errorText as string;
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
    : toolError
      ? "error"
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

  const handleReset = useCallback(() => {
    setMessages([{
      id: "welcome",
      role: "assistant",
      parts: [{ type: "text", text: welcomeMsg }]
    }]);
    setInput("");
    setActiveStopId(null);
    setActiveCategories(new Set());
    setActivePlatforms(new Set());
    setVenueSearch("");
    setAiFilterActive(false);
    setAiFilteredIds(null);
    setSelectedVenueId(null);
    setMobileMenuOpen(false);
    setShownSuggestions([...SUGGESTIONS].sort(() => Math.random() - 0.5).slice(0, 4));
  }, [welcomeMsg, setMessages]);

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
          <p className="intro-overlay__name font-serif">Mappy</p>
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
          onSelectVenue={handleSelectVenue}
          onDeselectVenue={() => setSelectedVenueId(null)}
          startLocation={startLocation}
          travelMode={travelMode}
          colorScheme={resolvedTheme === "dark" ? "DARK" : "LIGHT"}
          isPlanning={isPlanning}
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

        {/* Mobile theme toggle removed — now inside mobile menu overlay */}
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
        <div ref={leftScrollRef} className="flex-1 min-h-0 overflow-y-auto scrollbar-hide">
          {/* Venue detail — flush at top, outside padded content */}
          {!itinerary && !isPlanning && selectedVenue && (
            <VenueDetail
              venue={selectedVenue}
              onClose={() => setSelectedVenueId(null)}
            />
          )}

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
                  <CardHeader className="px-5 pt-5 pb-2">
                    <CardDescription className="section-label text-primary/80">
                      Your route
                    </CardDescription>
                    <CardTitle className="heading-serif text-base">
                      {itinerary.dayTheme}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-5 pb-5">
                    <p className="text-[0.8rem] text-muted-foreground leading-[1.7]">
                      {itinerary.summary}
                    </p>
                    <div className="grid grid-cols-3 gap-2.5 mt-4">
                      {[
                        { label: "Travel", value: `${itinerary.route.totalTravelMinutes} min` },
                        { label: "Distance", value: `${itinerary.route.totalDistanceKm} km` },
                        { label: "Area", value: itinerary.areaSummary }
                      ].map((m) => (
                        <div key={m.label} className="rounded-xl bg-muted/50 p-3">
                          <span className="text-xs text-muted-foreground">{m.label}</span>
                          <strong className="block text-sm font-mono mt-1">{m.value}</strong>
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
                    <CardContent className="p-5 space-y-1.5">
                      <p className="section-label text-primary/80">
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
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="heading-serif text-[0.95rem]">Stops</h3>
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
                        startLocation={startLocation}
                      />
                    ))}
                  </div>
                </div>

                {/* Backups */}
                {itinerary.backups.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="heading-serif text-[0.95rem]">Backups</h3>
                      <span className="text-xs text-muted-foreground">Swap if needed</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2.5">
                      {itinerary.backups.map((sp) => (
                        <Card key={sp.id} className="border-border/30 bg-card/30 shadow-none py-0">
                          <CardContent className="p-3.5 space-y-0.5">
                            <p className="text-xs text-muted-foreground">{sp.kind}</p>
                            <p className="text-[0.8rem] font-semibold">{sp.name}</p>
                            <p className="text-xs text-muted-foreground">{sp.area}</p>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </div>
                )}

                {/* Top matches */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="heading-serif text-[0.95rem]">Top matches</h3>
                    <span className="text-xs text-muted-foreground">Pre-route ranking</span>
                  </div>
                  <div className="space-y-2">
                    {itinerary.candidates.slice(0, 6).map((c) => (
                      <div
                        key={c.id}
                        className="flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl border border-border/20"
                      >
                        <div className="min-w-0">
                          <p className="text-[0.8rem] font-semibold truncate">{c.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {c.area} &middot; {c.kind}
                          </p>
                        </div>
                        <Badge variant="outline" className="shrink-0 font-mono text-xs rounded-md">
                          {c.matchScore}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>

                <Button size="sm" className="w-full rounded-xl" asChild>
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
              <div className="grid gap-4 py-6 justify-items-center text-center">
                <RouteAnimation venues={filteredVenues} />
                <div className="space-y-2">
                  <h2 className="heading-serif text-lg">Building your route</h2>
                  <p className="text-[0.85rem] text-muted-foreground leading-[1.7] max-w-[260px]">
                    Searching {venues.length}+ spots, ranking matches,
                    and projecting the best sequence...
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">
                    {categoryFilter === "all" ? "All places" : CATEGORIES.find(c => c.value === categoryFilter)?.label}
                  </h3>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {filteredVenues.length} spots
                    </span>
                    {aiFilterActive && (
                      <button
                        type="button"
                        onClick={() => {
                          setAiFilterActive(false);
                          setAiFilteredIds(null);
                          setVenueSearch("");
                          setActiveCategories(new Set());
                        }}
                        className="text-[0.65rem] text-primary hover:text-primary/80 font-medium transition-colors"
                      >
                        Show all
                      </button>
                    )}
                  </div>
                </div>
                <VenueList
                  venues={filteredVenues}
                  selectedVenueId={selectedVenueId}
                  onSelect={handleSelectVenue}
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
              {shownSuggestions.map((s, i) => (
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
              rows={3}
              disabled={isBusy}
              className="block w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-[15px] text-foreground placeholder:text-muted-foreground/50 outline-none min-h-[4.5rem]"
              style={{ fieldSizing: "content" } as React.CSSProperties}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
            />
            <div className="flex items-center justify-end gap-2 px-3 pb-2.5">
              {messages.length > 1 && (
                <button
                  type="button"
                  onClick={handleReset}
                  className="shrink-0 grid place-items-center size-7 rounded-full text-muted-foreground/50 hover:text-foreground hover:bg-muted/30 transition-all"
                  title="Reset"
                >
                  <RotateCcw className="size-3.5" />
                </button>
              )}
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

      {/* ── MOBILE: expandable filter menu ──────────────── */}
      <div className={cn("mobile-menu-overlay", mobileMenuOpen && "mobile-menu-overlay--open")}>
        <div className="mobile-menu-overlay__content">
          <div className="mobile-menu-overlay__row">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.value}
                type="button"
                onClick={() => toggleCategory(cat.value)}
                className={cn(
                  "grid place-items-center size-8 rounded-full transition-all duration-150",
                  activeCategories.has(cat.value)
                    ? "bg-secondary text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                )}
                title={cat.value}
              >
                {cat.icon}
              </button>
            ))}
          </div>
          <div className="mobile-menu-overlay__row">
            {PLATFORMS.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => togglePlatform(p.value)}
                className={cn(
                  "grid place-items-center size-8 rounded-full transition-all duration-150",
                  activePlatforms.has(p.value)
                    ? "bg-secondary text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                )}
                title={p.value}
              >
                {p.icon}
              </button>
            ))}
          </div>
          <div className="mobile-menu-overlay__search">
            <Search className="size-3.5 text-muted-foreground/50 shrink-0" />
            <input
              value={venueSearch}
              onChange={(e) => setVenueSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") setVenueSearch(""); }}
              placeholder="Search places..."
              className="bg-transparent text-[0.75rem] text-foreground placeholder:text-muted-foreground/40 outline-none flex-1"
            />
          </div>
          <button
            type="button"
            className="mobile-menu-overlay__theme"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            {mounted && theme === "dark" ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
            <span>{mounted && theme === "dark" ? "Light mode" : "Dark mode"}</span>
          </button>
        </div>
        {/* Tap outside to close */}
        <div className="mobile-menu-overlay__backdrop" onClick={() => setMobileMenuOpen(false)} />
      </div>

      {/* ── MOBILE: floating menu button ───────────────── */}
      <button
        type="button"
        className="mobile-menu-btn"
        onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        aria-label="Toggle filters menu"
      >
        <Search className="size-4" />
      </button>

      {/* ── MOBILE: floating tab pill ────────────────── */}
      <div
        className={cn("mobile-tab-pill", isDragging && "mobile-tab-pill--dragging")}
        style={{ bottom: panelCollapsed ? "12px" : `calc(${panelHeight}dvh + 8px)` }}
      >
        <button
          type="button"
          className={cn("mobile-tab-pill__btn", !panelCollapsed && mobileTab === "places" && "mobile-tab-pill__btn--active")}
          onClick={() => expandPanel("places")}
        >
          <MapPin className="size-3.5" />
          Places
        </button>
        <button
          type="button"
          className={cn("mobile-tab-pill__btn", !panelCollapsed && mobileTab === "chat" && "mobile-tab-pill__btn--active")}
          onClick={() => expandPanel("chat")}
        >
          <AgentIcon className="size-4" />
          Mappy
        </button>
      </div>

      {/* ── MOBILE: single bottom panel ────────────────── */}
      <div
        className={cn("mobile-panel", isDragging && "mobile-panel--dragging", panelCollapsed && "mobile-panel--collapsed")}
        style={{ height: panelCollapsed ? "0px" : `${panelHeight}dvh` }}
      >
        {/* Drag handle */}
        <div
          className="mobile-panel__drag-handle"
          onPointerDown={onDragStart}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragEnd}
        >
          <div className="mobile-panel__drag-knob" />
        </div>

        {/* Panel content */}
        <div className="mobile-panel__body scrollbar-hide">
          {mobileTab === "places" ? (
            /* ── Places content (mirrors left panel) ── */
            <div ref={leftScrollRef} className="flex-1 min-h-0 overflow-y-auto scrollbar-hide">
              {!itinerary && !isPlanning && selectedVenue && (
                <VenueDetail
                  venue={selectedVenue}
                  onClose={() => setSelectedVenueId(null)}
                />
              )}
              <div className="p-4 space-y-4">
                {itinerary ? (
                  <>
                    <Card className="border-primary/20 bg-primary/5 shadow-none">
                      <CardHeader className="px-4 pt-4 pb-2">
                        <CardDescription className="section-label text-primary/80">Your route</CardDescription>
                        <CardTitle className="heading-serif text-base">{itinerary.dayTheme}</CardTitle>
                      </CardHeader>
                      <CardContent className="px-4 pb-4">
                        <p className="text-[0.8rem] text-muted-foreground leading-[1.7]">{itinerary.summary}</p>
                      </CardContent>
                    </Card>
                    <div className="space-y-2">
                      {itinerary.stops.map((s, i) => (
                        <StopCard key={s.spot.id} stop={s} index={i} active={activeStop?.spot.id === s.spot.id} onSelect={setActiveStopId} startLocation={startLocation} />
                      ))}
                    </div>
                    <Button size="sm" className="w-full rounded-xl" asChild>
                      <a href={itinerary.route.googleMapsUrl} target="_blank" rel="noreferrer">
                        <ArrowUpRight className="size-3.5" /> Open in Google Maps
                      </a>
                    </Button>
                  </>
                ) : isPlanning ? (
                  <div className="grid gap-3 py-4 justify-items-center text-center">
                    <RouteAnimation venues={filteredVenues} className="max-w-[200px]" />
                    <p className="text-[0.85rem] text-muted-foreground">Building your route...</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="heading-serif text-[0.9rem]">
                        {aiFilterActive ? "Mappy picks" : activeCategories.size === 0 ? "All places" : [...activeCategories].join(", ")}
                      </h3>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">{filteredVenues.length} spots</span>
                        {aiFilterActive && (
                          <button
                            type="button"
                            onClick={() => { setAiFilterActive(false); setAiFilteredIds(null); setVenueSearch(""); setActiveCategories(new Set()); }}
                            className="text-[0.65rem] text-primary hover:text-primary/80 font-medium transition-colors"
                          >
                            Show all
                          </button>
                        )}
                      </div>
                    </div>
                    <VenueList venues={filteredVenues} selectedVenueId={selectedVenueId} onSelect={handleSelectVenue} />
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* ── Chat content (mirrors right panel) ── */
            <div className="flex flex-col flex-1 min-h-0">
              <Conversation className="flex-1 min-h-0">
                <ConversationContent className="gap-4 px-4 py-4">
                  {visibleMessages.map((m) => {
                    const isUser = (m.role as string) === "user";
                    return isUser ? (
                      <div key={m.id} className="chat-msg flex justify-end">
                        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary/15 px-3 py-2">
                          <p className="text-[14px] leading-[1.6] text-foreground">{getMessageText(m)}</p>
                        </div>
                      </div>
                    ) : (
                      <div key={m.id} className="chat-msg flex items-start gap-2.5">
                        <div className="shrink-0 mt-0.5 grid place-items-center size-6">
                          <AgentIcon className="size-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <ChatMd className="text-[14px] leading-[1.7] text-foreground">
                            {getMessageText(m)}
                          </ChatMd>
                        </div>
                      </div>
                    );
                  })}
                  {isBusy && visibleMessages[visibleMessages.length - 1]?.role !== "assistant" && (
                    <div className="chat-msg flex items-start gap-2.5">
                      <div className="shrink-0 mt-0.5 grid place-items-center size-6">
                        <AgentIconWindy className="size-5" />
                      </div>
                      <div className="leaf-wind h-6 mt-1">
                        <span className="leaf-wind__leaf">🍃</span>
                        <span className="leaf-wind__leaf">🍃</span>
                        <span className="leaf-wind__leaf">🍃</span>
                      </div>
                    </div>
                  )}
                </ConversationContent>
                <ConversationScrollButton className="bottom-2" />
              </Conversation>
              <div className="shrink-0 px-3 pb-3 pt-2 space-y-2">
                <form
                  onSubmit={(e) => { e.preventDefault(); handleSend(); }}
                  className="composer-box rounded-2xl border-2 border-border/30 bg-muted/10 transition-all focus-within:border-primary/50 focus-within:shadow-[0_0_0_3px_oklch(0.65_0.16_255/0.15)]"
                >
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder={placeholder}
                    rows={1}
                    disabled={isBusy}
                    className="block w-full resize-none bg-transparent px-3 pt-3 pb-1 text-[14px] text-foreground placeholder:text-muted-foreground/50 outline-none"
                    style={{ fieldSizing: "content" } as React.CSSProperties}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
                    }}
                  />
                  <div className="flex items-center justify-end gap-2 px-3 pb-2">
                    {messages.length > 1 && (
                      <button
                        type="button"
                        onClick={handleReset}
                        className="shrink-0 grid place-items-center size-7 rounded-full text-muted-foreground/50 hover:text-foreground hover:bg-muted/30 transition-all"
                        title="Reset"
                      >
                        <RotateCcw className="size-3.5" />
                      </button>
                    )}
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
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
