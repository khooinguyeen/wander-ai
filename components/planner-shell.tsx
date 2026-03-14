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
import { AgentIcon } from "@/components/agent-icon";
import { cn } from "@/lib/utils";
import type {
  ItineraryResponse,
  PlannedStop,
  TravelMode,
  Venue,
  VenueCategory
} from "@/lib/types";

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
  "lowkey northside day with coffee and a lookout",
  "southside brunch then sunset for a date",
  "CBD fashion and food route for a visitor",
  "lunch and fashion stores around Fitzroy"
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

/* ── helpers for venues ───────────────────────────────────── */
function parseTags(raw: string): string[] {
  try { return JSON.parse(raw); } catch { return []; }
}

function priceLabel(level: number | null): string {
  if (level == null || level <= 0) return "";
  return "$".repeat(level);
}

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
  const tags = parseTags(venue.tags);
  const categoryIcon =
    venue.uiCategory === "restaurant" ? <UtensilsCrossed className="size-3" /> :
    venue.uiCategory === "cafe" ? <Coffee className="size-3" /> :
    <Wine className="size-3" />;

  return (
    <button
      type="button"
      onClick={() => onSelect(venue.id)}
      className={cn(
        "w-full text-left rounded-xl border p-3.5 space-y-2 transition-all cursor-pointer",
        active
          ? "border-primary/40 bg-primary/8 shadow-sm"
          : "border-border/40 bg-card/40 hover:border-border/60 hover:bg-card/60"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          <h3 className="text-sm font-semibold truncate">{venue.name}</h3>
          <p className="text-[0.65rem] text-muted-foreground flex items-center gap-1">
            {categoryIcon}
            <span className="capitalize">{venue.uiCategory}</span>
            <span className="opacity-40">·</span>
            {venue.suburb !== "unknown" ? venue.suburb : venue.city}
            <span className="opacity-40">·</span>
            {priceLabel(venue.price_level)}
          </p>
        </div>
        <Badge variant="secondary" className="shrink-0 text-[0.6rem] capitalize">
          {venue.vibe}
        </Badge>
      </div>

      <p className="text-xs text-muted-foreground/80 leading-relaxed line-clamp-2">
        {venue.description}
      </p>

      <div className="flex flex-wrap gap-1">
        {tags.slice(0, 3).map((tag) => (
          <Badge key={tag} variant="outline" className="text-[0.6rem] font-normal">
            {tag}
          </Badge>
        ))}
      </div>
    </button>
  );
}

/* ── Windowed venue list (renders in batches to avoid jank) ── */
const VENUE_PAGE_SIZE = 20;

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

  // Reset visible count when the list changes (filter/search)
  useEffect(() => { setVisible(VENUE_PAGE_SIZE); }, [venues]);

  // IntersectionObserver to load more when scrolling near the bottom
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

  return (
    <div className="space-y-2.5">
      {venues.slice(0, visible).map((venue) => (
        <VenueCard
          key={venue.id}
          venue={venue}
          active={selectedVenueId === venue.id}
          onSelect={onSelect}
        />
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
  const hours: string[] = (() => { try { return JSON.parse(venue.opening_hours); } catch { return []; } })();
  const socialLinks = parseSocialUrls(venue.source_urls);
  const accentColor = CATEGORY_COLORS[venue.uiCategory] ?? "oklch(0.65 0.16 255)";
  const icon = CATEGORY_ICON[venue.uiCategory] ?? <MapPin className="size-5" />;

  return (
    <div className="venue-detail rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-4 pb-2">
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
              <p className="text-[0.65rem] text-muted-foreground mt-0.5">
                <span className="capitalize">{venue.uiCategory}</span>
                {" · "}{venue.suburb !== "unknown" ? venue.suburb : venue.city}{" · "}{priceLabel(venue.price_level)}
              </p>
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
      </div>

      {/* Body */}
      <div className="px-4 pb-4 pt-1 space-y-3">
        <p className="text-xs text-muted-foreground/80 leading-relaxed">
          {venue.description}
        </p>

        {/* Vibe + tags inline */}
        <div className="flex flex-wrap gap-1">
          <Badge variant="secondary" className="text-[0.6rem] font-medium capitalize">
            {venue.vibe}
          </Badge>
          {tags.map((tag) => (
            <Badge key={tag} variant="outline" className="text-[0.6rem] font-normal opacity-80">
              {tag}
            </Badge>
          ))}
        </div>

        {/* Social embeds */}
        <SocialEmbeds links={socialLinks} />

        {/* Meta row */}
        <div className="flex items-center gap-3 text-[0.6rem] text-muted-foreground/70">
          <span className="flex items-center gap-1">
            <MapPin className="size-2.5" />
            {venue.suburb !== "unknown" ? venue.suburb : venue.city}
          </span>
          {hours.length > 0 && (
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
          {venue.website && (
            <Button size="sm" variant="outline" className="text-[0.65rem] flex-1 h-7 rounded-full" asChild>
              <a href={venue.website} target="_blank" rel="noreferrer">
                <ExternalLink className="size-3" />
                Website
              </a>
            </Button>
          )}
          <Button size="sm" className="text-[0.65rem] flex-1 h-7 rounded-full" asChild>
            <a
              href={venue.google_maps_url ?? `https://www.google.com/maps/search/?api=1&query=${venue.lat},${venue.lng}`}
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

/* ── Floating pill menu ───────────────────────────────────── */
function FloatingPill({
  activeCategory,
  onCategoryChange,
  searchQuery,
  onSearchChange,
  leftOpen,
  rightOpen,
  onToggleLeft,
  onToggleRight
}: {
  activeCategory: CategoryFilter;
  onCategoryChange: (cat: CategoryFilter) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  leftOpen: boolean;
  rightOpen: boolean;
  onToggleLeft: () => void;
  onToggleRight: () => void;
}) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <TooltipProvider delayDuration={200}>
      <div className="floating-pill absolute top-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1 px-2 py-1.5">
        {/* Toggle workspace */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              className={cn("rounded-full", leftOpen && "bg-secondary")}
              onClick={onToggleLeft}
            >
              <MapPin className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{leftOpen ? "Hide places" : "Show places"}</TooltipContent>
        </Tooltip>

        <div className="h-4 w-px bg-border mx-0.5" />

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

        {searchOpen ? (
          <div className="flex items-center gap-1.5">
            <Search className="size-3 text-muted-foreground shrink-0" />
            <input
              autoFocus
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              onBlur={() => { if (!searchQuery) setSearchOpen(false); }}
              onKeyDown={(e) => { if (e.key === "Escape") { onSearchChange(""); setSearchOpen(false); } }}
              placeholder="Search venues..."
              className="bg-transparent text-[0.7rem] text-foreground placeholder:text-muted-foreground outline-none w-28"
            />
          </div>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                className="rounded-full"
                onClick={() => setSearchOpen(true)}
              >
                <Search className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Search</TooltipContent>
          </Tooltip>
        )}

        <div className="h-4 w-px bg-border mx-0.5" />

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

        <div className="h-4 w-px bg-border mx-0.5" />

        {/* Toggle chat */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              className={cn("rounded-full", rightOpen && "bg-secondary")}
              onClick={onToggleRight}
            >
              <MessageCircle className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{rightOpen ? "Hide chat" : "Show chat"}</TooltipContent>
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
  const [venues, setVenues] = useState<Venue[]>([]);
  const [activeStopId, setActiveStopId] = useState<string | null>(null);
  const [welcomeMsg] = useState(getRandomWelcome);
  const [placeholder] = useState(() => PLACEHOLDERS[Math.floor(Math.random() * PLACEHOLDERS.length)]);
  const [input, setInput] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [venueSearch, setVenueSearch] = useState("");
  const [selectedVenueId, setSelectedVenueId] = useState<string | null>(null);
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);
  const { resolvedTheme } = useTheme();
  const [introPhase, setIntroPhase] = useState<
    "welcome" | "map" | "chat" | "typing" | "done"
  >("welcome");
  const [typedChars, setTypedChars] = useState(0);

  /* Lazy-load venues from API instead of bundling 283KB JSON into client */
  useEffect(() => {
    fetch("/api/venues")
      .then((r) => r.json())
      .then((data: Venue[]) => setVenues(data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const t1 = setTimeout(() => setIntroPhase("map"), 2000);
    const t2 = setTimeout(() => { setIntroPhase("chat"); setRightOpen(true); }, 3000);
    const t3 = setTimeout(() => setIntroPhase("typing"), 3500);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
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

  // Extract itinerary from tool parts (handles both static "tool-buildRoute" and "dynamic-tool")
  const itinerary = useMemo<ItineraryResponse | null>(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      for (const part of messages[i].parts) {

        const p = part as any;
        if (isBuildRoutePart(p) && p.state === "output-available" && p.output) {
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
      {/* welcome overlay */}
      {(introPhase === "welcome" || introPhase === "map") && (
        <div className={`intro-overlay${introPhase === "map" ? " intro-overlay--exit" : ""}`}>
          <div className="intro-overlay__glow" />
          <div className="intro-overlay__agent">
            <AgentIcon className="intro-overlay__icon" />
          </div>
          <p className="intro-overlay__name">Mappy</p>
        </div>
      )}

      {/* map */}
      <div className={`map-canvas${introPhase === "welcome" ? " intro-map-hidden" : " intro-map"}`}>
        <RouteMap
          stops={itinerary?.stops ?? []}
          previewSpots={itinerary ? itinerary.candidates : []}
          venues={filteredVenues}
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
      <div className={introPhase === "welcome" || introPhase === "map" ? "hidden" : ""}>
        <FloatingPill
          activeCategory={categoryFilter}
          onCategoryChange={setCategoryFilter}
          searchQuery={venueSearch}
          onSearchChange={setVenueSearch}
          leftOpen={leftOpen}
          rightOpen={rightOpen}
          onToggleLeft={() => setLeftOpen((v) => !v)}
          onToggleRight={() => setRightOpen((v) => !v)}
        />
      </div>

      {/* ── LEFT: workspace ────────────────────────────────── */}
      <aside className={`glass-panel glass-panel--left ${leftOpen ? "" : "glass-panel--collapsed-left"}`}>
        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide">
          <div className="p-5 space-y-5">

            {itinerary ? (
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

                {/* Highlighted stop */}
                {activeStop && (
                  <Card className="border-border/30 bg-card/40 shadow-none">
                    <CardContent className="p-4 space-y-1">
                      <p className="text-[0.6rem] font-semibold tracking-[0.12em] uppercase text-primary/80">
                        Highlighted
                      </p>
                      <p className="text-sm font-semibold text-foreground">
                        {activeStop.spot.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {activeStop.arrivalTime} &middot; {activeStop.spot.area} &middot;{" "}
                        {activeStop.spot.address}
                      </p>
                      <p className="text-xs text-muted-foreground/70 leading-relaxed pt-1">
                        {activeStop.spot.description}
                      </p>
                      <div className="flex flex-wrap gap-1 pt-1.5">
                        {activeStop.spot.vibeTags.slice(0, 4).map((tag) => (
                          <Badge key={tag} variant="outline" className="text-[0.6rem] font-normal">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

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
                    <AgentIcon className="size-6" />
                  </div>
                  {m.id === "welcome" && introPhase === "chat" ? (
                    <div className="flex items-center gap-1.5 h-7 mt-1">
                      <span className="chat-dot" />
                      <span className="chat-dot" />
                      <span className="chat-dot" />
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
                  <AgentIcon className="size-6" />
                </div>
                <div className="flex items-center gap-1.5 pt-0.5">
                  <span className="chat-dot" />
                  <span className="chat-dot" />
                  <span className="chat-dot" />
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
              {SUGGESTIONS.map((s, i) => (
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
