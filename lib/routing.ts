import type { PlannedStop, Spot, TravelMode } from "@/lib/types";

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

export function haversineKm(from: Spot, to: Spot) {
  const earthRadiusKm = 6371;
  const deltaLat = toRadians(to.coordinates.lat - from.coordinates.lat);
  const deltaLng = toRadians(to.coordinates.lng - from.coordinates.lng);
  const lat1 = toRadians(from.coordinates.lat);
  const lat2 = toRadians(to.coordinates.lat);

  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2) * Math.cos(lat1) * Math.cos(lat2);

  return earthRadiusKm * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

export function estimateTravelMinutes(distanceKm: number, travelMode: TravelMode) {
  const speedKmh = travelMode === "walking" ? 4.8 : travelMode === "transit" ? 18 : 26;
  return Math.max(6, Math.round((distanceKm / speedKmh) * 60));
}

function formatClock(totalMinutes: number) {
  const minutesInDay = ((totalMinutes % 1440) + 1440) % 1440;
  const hours = Math.floor(minutesInDay / 60);
  const minutes = minutesInDay % 60;
  const suffix = hours >= 12 ? "PM" : "AM";
  const displayHour = hours % 12 === 0 ? 12 : hours % 12;

  return `${displayHour}:${minutes.toString().padStart(2, "0")} ${suffix}`;
}

function inferStartMinutes(query: string) {
  const normalizedQuery = query.toLowerCase();
  if (normalizedQuery.includes("dinner") || normalizedQuery.includes("date night")) {
    return 17 * 60;
  }
  if (normalizedQuery.includes("sunset")) {
    return 15 * 60;
  }
  if (normalizedQuery.includes("lunch") || normalizedQuery.includes("shopping")) {
    return 11 * 60;
  }
  return 9 * 60 + 30;
}

function formatLocationForMaps(input: string) {
  return input;
}

function formatSpotForMaps(spot: Spot) {
  return `${spot.coordinates.lat},${spot.coordinates.lng}`;
}

export function buildGoogleMapsUrl(stops: Spot[], travelMode: TravelMode, startLocation?: string) {
  if (stops.length === 0) {
    return "https://www.google.com/maps";
  }

  const destination = formatSpotForMaps(stops[stops.length - 1]);
  const origin = startLocation ? formatLocationForMaps(startLocation) : formatSpotForMaps(stops[0]);
  const waypointSpots = startLocation ? stops.slice(0, -1) : stops.slice(1, -1);
  const waypoints = waypointSpots.map(formatSpotForMaps).join("|");
  const params = new URLSearchParams({
    api: "1",
    origin,
    destination,
    travelmode: travelMode
  });

  if (waypoints) {
    params.set("waypoints", waypoints);
  }

  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

export function scheduleStops(input: {
  spots: Spot[];
  reasonsById: Record<string, string>;
  query: string;
  travelMode: TravelMode;
}) {
  let cursorMinutes = inferStartMinutes(input.query);
  let totalDistanceKm = 0;
  let totalTravelMinutes = 0;

  const plannedStops: PlannedStop[] = input.spots.map((spot, index) => {
    let legDistanceKm = 0;
    let legFromPreviousMinutes = 0;

    if (index > 0) {
      legDistanceKm = haversineKm(input.spots[index - 1], spot);
      legFromPreviousMinutes = estimateTravelMinutes(legDistanceKm, input.travelMode);
      totalDistanceKm += legDistanceKm;
      totalTravelMinutes += legFromPreviousMinutes;
      cursorMinutes += legFromPreviousMinutes;
    }

    const arrivalMinutes = cursorMinutes;
    const departureMinutes = arrivalMinutes + spot.idealVisitMinutes;
    cursorMinutes = departureMinutes;

    return {
      spot,
      arrivalTime: formatClock(arrivalMinutes),
      departureTime: formatClock(departureMinutes),
      reason: input.reasonsById[spot.id] ?? `${spot.name} fits the brief.`,
      legFromPreviousMinutes,
      legDistanceKm: Number(legDistanceKm.toFixed(1))
    };
  });

  return {
    plannedStops,
    totalDistanceKm: Number(totalDistanceKm.toFixed(1)),
    totalTravelMinutes
  };
}
