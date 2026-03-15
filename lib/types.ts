export type VenueCategory = "restaurant" | "cafe" | "bar" | "attraction" | "shopping" | "other";

/** Raw shape coming from melbourne_videos_locations.json */
export type VenueRaw = {
  name: string;
  description: string;
  category: string; // raw Google Places category string
  suburb: string;
  city: string;
  state: string;
  country: string;
  address: string;
  lat: number;
  lng: number;
  review_count: number | null;
  price_level: number | null;
  vibe: string | null;
  tags: string; // JSON-encoded string array
  opening_hours: string; // JSON-encoded string array
  website: string | null;
  google_maps_url: string | null;
  google_place_id: string | null;
  source_urls: string; // JSON-encoded string array
};

export type Venue = VenueRaw & {
  /** Derived stable id */
  id: string;
  /** Normalised UI category */
  uiCategory: VenueCategory;
};

export type SpotKind = "food" | "lookout" | "fashion";
export type TravelMode = "walking" | "driving" | "transit";
export type ChatMode = "route-planning" | "recommendations";

export type SourcePost = {
  platform: "tiktok" | "instagram" | "youtube" | "rednote";
  url: string;
  creatorHandle: string;
  caption: string;
  postedAt: string;
};

export type Spot = {
  id: string;
  name: string;
  kind: SpotKind;
  area: string;
  suburb: string;
  city: string;
  neighbourhood: string;
  categories: string[];
  vibeTags: string[];
  description: string;
  whyItTrends: string;
  address: string;
  coordinates: {
    lat: number;
    lng: number;
  };
  priceBand: "$" | "$$" | "$$$" | null;
  idealVisitMinutes: number;
  bestFor: string[];
  visitWindows: string[];
  signals: {
    food: number;
    scenic: number;
    fashion: number;
    hiddenGem: number;
    viral: number;
  };
  socialProof: {
    mentions: number;
    creatorCount: number;
    lastScrapedAt: string;
  };
  sourcePosts: SourcePost[];
};

export type SearchResult = Spot & {
  matchScore: number;
  matchReason: string;
};

export type PlannedStop = {
  spot: Spot;
  arrivalTime: string;
  departureTime: string;
  reason: string;
  legFromPreviousMinutes: number;
  legDistanceKm: number;
};

export type ItineraryResponse = {
  query: string;
  queryMode: "ai" | "heuristic";
  dayTheme: string;
  areaSummary: string;
  summary: string;
  routeRationale: string;
  travelMode: TravelMode;
  route: {
    googleMapsUrl: string;
    totalDistanceKm: number;
    totalTravelMinutes: number;
  };
  stops: PlannedStop[];
  backups: Spot[];
  candidates: SearchResult[];
};

export type RecommendationItem = {
  id: string;
  name: string;
  city: string | null;
  suburb: string | null;
  category: string | null;
  vibe: string | null;
  address: string | null;
  website: string | null;
  googleMapsUrl: string | null;
  tags: string[];
  distance: number | null;
  reason: string;
  score: number;
};

export type RecommendationsResponse = {
  queryText: string;
  results: RecommendationItem[];
  error?: string;
};
