/**
 * Google Directions API wrapper.
 * Returns real travel time, distance, and step-by-step directions between two points.
 */

export type DirectionsResult = {
  distanceKm: number;
  durationMinutes: number;
  summary: string; // e.g. "via Smith St and Brunswick St"
  steps: string[]; // human-readable turn-by-turn
};

const MODE_MAP: Record<string, string> = {
  walking: "walking",
  driving: "driving",
  transit: "transit",
};

export async function getDirections(input: {
  originAddress: string;
  destinationAddress: string;
  travelMode: string;
}): Promise<DirectionsResult> {
  const apiKey = process.env.GOOGLE_MAPS_SERVER_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  if (!apiKey) {
    // Fallback: estimate from coordinates if no API key
    return {
      distanceKm: 0,
      durationMinutes: 10,
      summary: "Directions unavailable (no API key)",
      steps: [],
    };
  }

  const mode = MODE_MAP[input.travelMode] ?? "walking";

  const params = new URLSearchParams({
    origin: input.originAddress,
    destination: input.destinationAddress,
    mode,
    key: apiKey,
  });

  const res = await fetch(
    `https://maps.googleapis.com/maps/api/directions/json?${params.toString()}`
  );

  if (!res.ok) {
    return {
      distanceKm: 0,
      durationMinutes: 10,
      summary: `Directions API error (${res.status})`,
      steps: [],
    };
  }

  const data = await res.json();

  if (data.status !== "OK" || !data.routes?.[0]?.legs?.[0]) {
    return {
      distanceKm: 0,
      durationMinutes: 10,
      summary: `No route found (${data.status})`,
      steps: [],
    };
  }

  const leg = data.routes[0].legs[0];

  return {
    distanceKm: Number((leg.distance.value / 1000).toFixed(1)),
    durationMinutes: Math.round(leg.duration.value / 60),
    summary: data.routes[0].summary || "",
    steps: leg.steps
      .slice(0, 5)
      .map((s: { html_instructions: string; distance: { text: string } }) =>
        `${s.html_instructions.replace(/<[^>]*>/g, "")} (${s.distance.text})`
      ),
  };
}
