export type SpotKind = "food" | "lookout" | "fashion";
export type TravelMode = "walking" | "driving" | "transit";

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
