"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  APIProvider,
  Map,
  AdvancedMarker,
  useMap,
  useMapsLibrary
} from "@vis.gl/react-google-maps";

import type { PlannedStop, Spot, TravelMode, Venue } from "@/lib/types";

const MELBOURNE_CENTER = { lat: -37.8136, lng: 144.9631 };
// 483 Swanston St, Melbourne CBD
const CURRENT_LOCATION = { lat: -37.8103, lng: 144.9633 };
const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";

const DARK_MAP_ID = "DEMO_MAP_ID";

type RouteMapProps = {
  stops: PlannedStop[];
  previewSpots: Spot[];
  venues: Venue[];
  topRecommendationVenueId?: string | null;
  activeStopId: string | null;
  selectedVenueId: string | null;
  onSelectStop: (id: string) => void;
  onSelectVenue: (id: string) => void;
  onDeselectVenue?: () => void;
  startLocation: string;
  travelMode: TravelMode;
  colorScheme?: "DARK" | "LIGHT";
  isPlanning?: boolean;
};

function travelModeToGoogle(mode: TravelMode): google.maps.TravelMode {
  switch (mode) {
    case "walking":
      return google.maps.TravelMode.WALKING;
    case "transit":
      return google.maps.TravelMode.TRANSIT;
    default:
      return google.maps.TravelMode.DRIVING;
  }
}

function AnimatedRouteRenderer({
  stops,
  startLocation,
  travelMode
}: {
  stops: PlannedStop[];
  startLocation?: string;
  travelMode: TravelMode;
}) {
  const map = useMap();
  const routesLib = useMapsLibrary("routes");
  const lineRef = useRef<google.maps.Polyline | null>(null);
  const glowRef = useRef<google.maps.Polyline | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    // Tear down previous
    if (lineRef.current) { lineRef.current.setMap(null); lineRef.current = null; }
    if (glowRef.current) { glowRef.current.setMap(null); glowRef.current = null; }
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }

    if (!map || !routesLib || stops.length < 2) return;

    const service = new routesLib.DirectionsService();
    const waypoints = stops.slice(1, -1).map((s) => ({
      location: new google.maps.LatLng(s.spot.coordinates.lat, s.spot.coordinates.lng),
      stopover: true
    }));

    service.route(
      {
        origin,
        destination,
        waypoints,
        travelMode: travelModeToGoogle(travelMode)
      },
      (result, status) => {
        if (status !== google.maps.DirectionsStatus.OK || !result) return;

        // Decode full path from all legs + steps
        const full: google.maps.LatLng[] = [];
        for (const leg of result.routes[0].legs) {
          for (const step of leg.steps) {
            full.push(...step.path);
          }
        }
        if (full.length === 0) return;

        // Glow layer
        const glow = new google.maps.Polyline({
          map,
          path: [],
          strokeColor: "#4f8cf9",
          strokeWeight: 14,
          strokeOpacity: 0.12,
          zIndex: 1
        });
        // Main line
        const line = new google.maps.Polyline({
          map,
          path: [],
          strokeColor: "#4f8cf9",
          strokeWeight: 4,
          strokeOpacity: 0.88,
          zIndex: 2
        });
        lineRef.current = line;
        glowRef.current = glow;

        // Animate reveal over ~1.4 s with ease-out cubic
        const DURATION = 1400;
        const startTs = performance.now();

        function frame(now: number) {
          const t = Math.min((now - startTs) / DURATION, 1);
          const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
          const idx = Math.ceil(eased * full.length);
          const slice = full.slice(0, idx);
          line.setPath(slice);
          glow.setPath(slice);
          if (t < 1) rafRef.current = requestAnimationFrame(frame);
        }

        rafRef.current = requestAnimationFrame(frame);
      }
    );

    return () => {
      if (lineRef.current) { lineRef.current.setMap(null); lineRef.current = null; }
      if (glowRef.current) { glowRef.current.setMap(null); glowRef.current = null; }
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    };
  }, [map, routesLib, stops, startLocation, travelMode]);

  return null;
}

/** During planning: show a single preview route through the filtered venues
 *  using nearest-neighbour ordering. Uses lat/lng to avoid geocoding errors. */
function RoutePlanningPreview({
  venues,
  travelMode,
}: {
  venues: Venue[];
  startLocation: string;
  travelMode: TravelMode;
}) {
  const map = useMap();
  const routesLib = useMapsLibrary("routes");
  const rendererRef = useRef<google.maps.DirectionsRenderer | null>(null);

  useEffect(() => {
    if (!map || !routesLib || venues.length < 2) {
      if (rendererRef.current) { rendererRef.current.setMap(null); rendererRef.current = null; }
      return;
    }

    // Order venues by nearest-neighbour starting from the first
    const ordered: Venue[] = [];
    const remaining = [...venues];
    let current = remaining.shift()!;
    ordered.push(current);
    while (remaining.length > 0) {
      let nearest = 0;
      let nearestDist = Infinity;
      for (let j = 0; j < remaining.length; j++) {
        const d = Math.hypot(remaining[j].lat - current.lat, remaining[j].lng - current.lng);
        if (d < nearestDist) { nearestDist = d; nearest = j; }
      }
      current = remaining.splice(nearest, 1)[0];
      ordered.push(current);
    }

    const renderer = new routesLib.DirectionsRenderer({
      map,
      suppressMarkers: true,
      polylineOptions: {
        strokeColor: "#4f8cf9",
        strokeWeight: 4,
        strokeOpacity: 0.5,
        zIndex: 5,
      },
    });
    rendererRef.current = renderer;

    const service = new routesLib.DirectionsService();
    const origin = new google.maps.LatLng(ordered[0].lat, ordered[0].lng);
    const dest = new google.maps.LatLng(ordered[ordered.length - 1].lat, ordered[ordered.length - 1].lng);
    const waypoints = ordered.slice(1, -1).map(v => ({
      location: new google.maps.LatLng(v.lat, v.lng),
      stopover: true,
    }));

    service.route(
      { origin, destination: dest, waypoints, travelMode: travelModeToGoogle(travelMode) },
      (result, status) => {
        if (status === google.maps.DirectionsStatus.OK && result) {
          renderer.setDirections(result);
        }
      }
    );

    return () => {
      renderer.setMap(null);
      rendererRef.current = null;
    };
  }, [map, routesLib, venues, travelMode]);

  return null;
}

function ZoomToSelected({ destination }: { destination: { lat: number; lng: number } | null }) {
  const map = useMap();
  const prevDest = useRef<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    if (!map || !destination) {
      prevDest.current = null;
      return;
    }
    // Only zoom when destination changes
    if (
      prevDest.current &&
      prevDest.current.lat === destination.lat &&
      prevDest.current.lng === destination.lng
    ) return;

    prevDest.current = destination;

    // Center between current location and destination, zoom in
    const bounds = new google.maps.LatLngBounds();
    bounds.extend(CURRENT_LOCATION);
    bounds.extend(destination);
    map.fitBounds(bounds, { top: 80, bottom: 80, left: 60, right: 60 });
  }, [map, destination]);

  return null;
}

function FitBounds({ stops, previewSpots, venues }: { stops: PlannedStop[]; previewSpots: Spot[]; venues: Venue[] }) {
  const map = useMap();

  // Build a stable key from the set of point IDs so we only fitBounds when
  // the actual points change, not on every selection/re-render.
  const pointsKey = useMemo(() => {
    if (stops.length > 0) return stops.map((s) => s.spot.id).join(",");
    if (venues.length > 0) return venues.map((v) => v.id).join(",");
    return previewSpots.map((s) => s.id).join(",");
  }, [stops, previewSpots, venues]);

  useEffect(() => {
    if (!map) return;

    const points =
      stops.length > 0
        ? stops.map((s) => s.spot.coordinates)
        : venues.length > 0
          ? venues.map((v) => ({ lat: v.lat, lng: v.lng }))
          : previewSpots.map((s) => s.coordinates);

    if (points.length === 0) return;

    const bounds = new google.maps.LatLngBounds();
    for (const p of points) {
      bounds.extend({ lat: p.lat, lng: p.lng });
    }
    map.fitBounds(bounds, { top: 80, bottom: 80, left: 420, right: 420 });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, pointsKey]);

  return null;
}

const VENUE_CATEGORY_COLORS: Record<string, string> = {
  restaurant: "#f97316",
  cafe: "#a855f7",
  bar: "#3b82f6",
  attraction: "#22c55e",
  shopping: "#ec4899",
  other: "#6b7280",
};

import { UtensilsCrossed, Coffee, Wine, MapPin, Navigation, ShoppingBag, X } from "lucide-react";
import type { ReactNode } from "react";

type ModeInfo = { distance: string; duration: string };
type AllRouteInfo = {
  walking: ModeInfo | null;
  driving: ModeInfo | null;
  transit: ModeInfo | null;
};

function DirectionsToSelected({
  destination,
  active,
  travelMode,
  onRouteInfo
}: {
  destination: { lat: number; lng: number } | null;
  active: boolean;
  travelMode: TravelMode;
  onRouteInfo: (info: AllRouteInfo | null) => void;
}) {
  const map = useMap();
  const routesLib = useMapsLibrary("routes");
  const rendererRef = useRef<google.maps.DirectionsRenderer | null>(null);
  const glowRendererRef = useRef<google.maps.DirectionsRenderer | null>(null);
  const pulseRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!map || !routesLib || !destination || !active) {
      if (rendererRef.current) { rendererRef.current.setMap(null); rendererRef.current = null; }
      if (glowRendererRef.current) { glowRendererRef.current.setMap(null); glowRendererRef.current = null; }
      if (pulseRef.current) { clearInterval(pulseRef.current); pulseRef.current = null; }
      if (!active) onRouteInfo(null);
      return;
    }

    const service = new routesLib.DirectionsService();

    // Glow layer — wider, semi-transparent, pulsing
    const glowPolylineOpts: google.maps.PolylineOptions = {
      strokeColor: "#facc15",
      strokeWeight: 12,
      strokeOpacity: 0.25
    };
    const glowRenderer = new routesLib.DirectionsRenderer({
      map,
      suppressMarkers: true,
      polylineOptions: glowPolylineOpts
    });
    glowRendererRef.current = glowRenderer;

    // Main route layer
    const renderer = new routesLib.DirectionsRenderer({
      map,
      suppressMarkers: true,
      polylineOptions: {
        strokeColor: "#facc15",
        strokeWeight: 4,
        strokeOpacity: 0.95
      }
    });
    rendererRef.current = renderer;

    const origin = new google.maps.LatLng(CURRENT_LOCATION.lat, CURRENT_LOCATION.lng);
    const dest = new google.maps.LatLng(destination.lat, destination.lng);

    // Render the active travel mode route on the map
    service.route(
      { origin, destination: dest, travelMode: travelModeToGoogle(travelMode) },
      (result, status) => {
        if (status === google.maps.DirectionsStatus.OK && result) {
          renderer.setDirections(result);
          glowRenderer.setDirections(result);

          // Pulse the glow opacity
          let opacity = 0.25;
          let rising = true;
          pulseRef.current = setInterval(() => {
            opacity += rising ? 0.02 : -0.02;
            if (opacity >= 0.45) rising = false;
            if (opacity <= 0.15) rising = true;
            glowRenderer.setOptions({ polylineOptions: { ...glowPolylineOpts, strokeOpacity: opacity } });
          }, 60);
        }
      }
    );

    // Fetch all three modes in parallel for the info panel
    const modes: TravelMode[] = ["walking", "driving", "transit"];
    const results: AllRouteInfo = { walking: null, driving: null, transit: null };
    let completed = 0;

    for (const mode of modes) {
      service.route(
        { origin, destination: dest, travelMode: travelModeToGoogle(mode) },
        (result, status) => {
          if (status === google.maps.DirectionsStatus.OK && result) {
            const leg = result.routes[0]?.legs[0];
            if (leg) {
              results[mode] = {
                distance: leg.distance?.text ?? "",
                duration: leg.duration?.text ?? "",
              };
            }
          }
          completed++;
          if (completed === modes.length) {
            onRouteInfo({ ...results });
          }
        }
      );
    }

    return () => {
      renderer.setMap(null);
      glowRenderer.setMap(null);
      if (pulseRef.current) { clearInterval(pulseRef.current); pulseRef.current = null; }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, routesLib, destination, active, travelMode]);

  return null;
}

const VENUE_CATEGORY_ICON: Record<string, ReactNode> = {
  restaurant: <UtensilsCrossed size={14} strokeWidth={2.5} color="#fff" />,
  cafe: <Coffee size={14} strokeWidth={2.5} color="#fff" />,
  bar: <Wine size={14} strokeWidth={2.5} color="#fff" />,
  attraction: <MapPin size={14} strokeWidth={2.5} color="#fff" />,
  shopping: <ShoppingBag size={14} strokeWidth={2.5} color="#fff" />,
  other: <MapPin size={14} strokeWidth={2.5} color="#fff" />,
};


function GoogleMapInner({
  stops,
  previewSpots,
  venues,
  topRecommendationVenueId,
  activeStopId,
  selectedVenueId,
  onSelectStop,
  onSelectVenue,
  onDeselectVenue,
  startLocation,
  travelMode,
  colorScheme = "DARK",
  isPlanning = false
}: RouteMapProps) {
  const hasStops = stops.length > 0;
  const hasVenues = venues.length > 0;
  const [showDirections, setShowDirections] = useState(false);
  const [routeInfo, setRouteInfo] = useState<AllRouteInfo | null>(null);

  // Selected venue/stop name + category
  const selectedEntity = useMemo(() => {
    if (activeStopId && hasStops) {
      const stop = stops.find((s) => s.spot.id === activeStopId);
      if (stop) return { name: stop.spot.name, category: stop.spot.kind ?? "other" };
    }
    if (selectedVenueId && hasVenues) {
      const venue = venues.find((v) => v.id === selectedVenueId);
      if (venue) return { name: venue.name, category: venue.uiCategory ?? "other" };
    }
    return null;
  }, [activeStopId, selectedVenueId, stops, venues, hasStops, hasVenues]);

  // Compute destination for directions from current location
  const selectedDestination = useMemo(() => {
    if (activeStopId && hasStops) {
      const stop = stops.find((s) => s.spot.id === activeStopId);
      if (stop) return { lat: stop.spot.coordinates.lat, lng: stop.spot.coordinates.lng };
    }
    if (selectedVenueId && hasVenues) {
      const venue = venues.find((v) => v.id === selectedVenueId);
      if (venue) return { lat: venue.lat, lng: venue.lng };
    }
    return null;
  }, [activeStopId, selectedVenueId, stops, venues, hasStops, hasVenues]);

  // Reset directions when selection changes
  const prevDestRef = useRef(selectedDestination);
  useEffect(() => {
    if (
      prevDestRef.current?.lat !== selectedDestination?.lat ||
      prevDestRef.current?.lng !== selectedDestination?.lng
    ) {
      setShowDirections(false);
      setRouteInfo(null);
    }
    prevDestRef.current = selectedDestination;
  }, [selectedDestination]);

  const handleRouteInfo = useCallback((info: AllRouteInfo | null) => {
    setRouteInfo(info);
  }, []);

  const handleGetDirections = useCallback(() => {
    setShowDirections(true);
  }, []);

  const handleCloseDirections = useCallback(() => {
    setShowDirections(false);
    setRouteInfo(null);
  }, []);

  return (
    <>
    <Map
      defaultCenter={MELBOURNE_CENTER}
      defaultZoom={13}
      mapId={DARK_MAP_ID}
      colorScheme={colorScheme}
      gestureHandling="greedy"
      disableDefaultUI={false}
      zoomControl={true}
      mapTypeControl={false}
      streetViewControl={false}
      fullscreenControl={false}
      style={{ width: "100%", height: "100%" }}
      onClick={() => onDeselectVenue?.()}
    >
      <FitBounds stops={stops} previewSpots={previewSpots} venues={venues} />

      {/* Current location marker */}
      <AdvancedMarker position={CURRENT_LOCATION} zIndex={200}>
        <div className="current-location-marker" />
      </AdvancedMarker>

      {/* Directions from current location to selected marker — only when requested */}
      <DirectionsToSelected
        destination={selectedDestination}
        active={showDirections}
        travelMode={travelMode}
        onRouteInfo={handleRouteInfo}
      />
      {showDirections && <ZoomToSelected destination={selectedDestination} />}

      {hasStops && <AnimatedRouteRenderer stops={stops} travelMode={travelMode} />}

      {hasStops
        ? stops.map((stop, i) => (
            <AdvancedMarker
              key={stop.spot.id}
              position={{
                lat: stop.spot.coordinates.lat,
                lng: stop.spot.coordinates.lng
              }}
              onClick={() => onSelectStop(stop.spot.id)}
              zIndex={activeStopId === stop.spot.id ? 100 : 10}
              style={{
                overflow: "visible",
                animation: `stop-enter 0.45s cubic-bezier(0.34, 1.56, 0.64, 1) ${0.25 + i * 0.12}s both`
              }}
            >
              <div
                className={`pill-marker pill-marker--stop ${activeStopId === stop.spot.id ? "pill-marker--expanded" : ""}`}
              >
                <span className="pill-marker__num">{i + 1}</span>
                {activeStopId === stop.spot.id && (
                  <span className="pill-marker__label">{stop.spot.name}</span>
                )}
              </div>
            </AdvancedMarker>
          ))
        : hasVenues
          ? venues.map((venue) => {
              const isSelected = selectedVenueId === venue.id;
              const isTopRecommendation = topRecommendationVenueId === venue.id;
              const color = VENUE_CATEGORY_COLORS[venue.uiCategory] ?? "#3b82f6";
              const icon = VENUE_CATEGORY_ICON[venue.uiCategory] ?? <MapPin size={14} strokeWidth={2.5} color="#fff" />;
              return (
                <AdvancedMarker
                  key={venue.id}
                  position={{ lat: venue.lat, lng: venue.lng }}
                  title={venue.name}
                  onClick={() => onSelectVenue(venue.id)}
                  zIndex={isTopRecommendation ? 120 : isSelected ? 100 : 10}
                  style={{ overflow: "visible" }}
                >
                  <div className={`pill-marker pill-marker--venue ${isTopRecommendation ? "pill-marker--top-rec" : ""} ${isSelected ? "pill-marker--expanded" : ""}`}>
                    <span className="pill-marker__icon" style={{ background: color }}>
                      {icon}
                    </span>
                    {(isSelected || isTopRecommendation) && (
                      <span className="pill-marker__label">{venue.name}</span>
                    )}
                  </div>
                </AdvancedMarker>
              );
            })
          : previewSpots.slice(0, 20).map((spot) => (
              <AdvancedMarker
                key={stop.spot.id}
                position={{
                  lat: stop.spot.coordinates.lat,
                  lng: stop.spot.coordinates.lng
                }}
                onClick={() => onSelectStop(stop.spot.id)}
                zIndex={activeStopId === stop.spot.id ? 100 : 10}
                style={{ overflow: "visible" }}
              >
                <div
                  className={`pill-marker pill-marker--stop ${activeStopId === stop.spot.id ? "pill-marker--expanded" : ""}`}
                >
                  <span className="pill-marker__num">{i + 1}</span>
                  {activeStopId === stop.spot.id && (
                    <span className="pill-marker__label">{stop.spot.name}</span>
                  )}
                </div>
              </AdvancedMarker>
            ))
          : hasVenues
            ? <ClusteredVenueMarkers
                venues={venues}
                selectedVenueId={selectedVenueId}
                onSelectVenue={onSelectVenue}
              />
            : previewSpots.slice(0, 20).map((spot) => (
                <AdvancedMarker
                  key={spot.id}
                  position={{ lat: spot.coordinates.lat, lng: spot.coordinates.lng }}
                >
                  <div className="pill-marker pill-marker--preview" />
                </AdvancedMarker>
              ))
      )}
    </Map>

    {/* Bottom info panel — shows when a location is selected */}
    {selectedDestination && selectedEntity && (
      <div className="directions-panel">
        <div className="directions-panel__header">
          <span className="directions-panel__name">{selectedEntity.name}</span>
          {showDirections && routeInfo && (
            <button type="button" className="directions-panel__close" onClick={handleCloseDirections}>
              <X size={14} />
            </button>
          )}
        </div>

        {showDirections && routeInfo ? (
          <div className="directions-panel__modes">
            {routeInfo.walking && (
              <div className="directions-panel__mode-card">
                <span className="directions-panel__mode-icon">🚶</span>
                <span className="directions-panel__mode-time">{routeInfo.walking.duration}</span>
                <span className="directions-panel__mode-dist">{routeInfo.walking.distance}</span>
              </div>
            )}
            {routeInfo.driving && (
              <div className="directions-panel__mode-card">
                <span className="directions-panel__mode-icon">🚗</span>
                <span className="directions-panel__mode-time">{routeInfo.driving.duration}</span>
                <span className="directions-panel__mode-dist">{routeInfo.driving.distance}</span>
              </div>
            )}
            {routeInfo.transit && (
              <div className="directions-panel__mode-card">
                <span className="directions-panel__mode-icon">🚊</span>
                <span className="directions-panel__mode-time">{routeInfo.transit.duration}</span>
                <span className="directions-panel__mode-dist">{routeInfo.transit.distance}</span>
              </div>
            )}
          </div>
        ) : (
          <button type="button" className="directions-panel__btn" onClick={handleGetDirections}>
            <Navigation size={13} />
            Get Directions
          </button>
        )}
      </div>
    )}
    </>
  );
}

function FallbackMap({
  stops,
  previewSpots,
  venues,
  topRecommendationVenueId,
  activeStopId,
  onSelectStop
}: Omit<RouteMapProps, "startLocation" | "travelMode">) {
  const hasStops = stops.length > 0;
  const hasVenues = venues.length > 0;
  const points = hasStops
    ? stops.map((s) => s.spot)
    : previewSpots.slice(0, 20);

  const allCoords = useMemo(() => {
    if (hasStops) return points.map((p) => ({ lat: p.coordinates.lat, lng: p.coordinates.lng }));
    if (hasVenues) return venues.map((v) => ({ lat: v.lat, lng: v.lng }));
    return points.map((p) => ({ lat: p.coordinates.lat, lng: p.coordinates.lng }));
  }, [hasStops, hasVenues, points, venues]);

  const bounds = useMemo(() => {
    if (allCoords.length === 0) return { minLat: -37.84, maxLat: -37.79, minLng: 144.94, maxLng: 144.99 };
    const lats = allCoords.map((p) => p.lat);
    const lngs = allCoords.map((p) => p.lng);
    const pad = 0.005;
    return {
      minLat: Math.min(...lats) - pad,
      maxLat: Math.max(...lats) + pad,
      minLng: Math.min(...lngs) - pad,
      maxLng: Math.max(...lngs) + pad
    };
  }, [allCoords]);

  function project(lat: number, lng: number) {
    const x = ((lng - bounds.minLng) / (bounds.maxLng - bounds.minLng)) * 100;
    const y = ((bounds.maxLat - lat) / (bounds.maxLat - bounds.minLat)) * 100;
    return { x: Math.max(2, Math.min(98, x)), y: Math.max(2, Math.min(98, y)) };
  }

  return (
    <div className="fallback-map">
      <div className="fallback-map__notice">
        Set <code>NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code> for the real map.
      </div>

      {hasStops && stops.length >= 2 && (
        <svg className="fallback-map__routes" viewBox="0 0 100 100" preserveAspectRatio="none">
          <polyline
            points={stops
              .map((s) => {
                const p = project(s.spot.coordinates.lat, s.spot.coordinates.lng);
                return `${p.x},${p.y}`;
              })
              .join(" ")}
            fill="none"
            stroke="rgba(79,140,249,0.6)"
            strokeWidth="0.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}

      {hasStops
        ? points.map((spot, i) => {
            const pos = project(spot.coordinates.lat, spot.coordinates.lng);
            const isActive = activeStopId === spot.id;
            return (
              <button
                key={spot.id}
                type="button"
                className={`fallback-pin fallback-pin--stop ${isActive ? "fallback-pin--active" : ""}`}
                style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
                onClick={() => onSelectStop(spot.id)}
                title={spot.name}
              >
                {String(i + 1).padStart(2, "0")}
              </button>
            );
          })
        : hasVenues
          ? venues.map((venue) => {
              const pos = project(venue.lat, venue.lng);
              const isTopRecommendation = topRecommendationVenueId === venue.id;
              return (
                <button
                  key={venue.id}
                  type="button"
                  className={`fallback-pin fallback-pin--venue ${isTopRecommendation ? "fallback-pin--top-rec" : ""}`}
                  style={{
                    left: `${pos.x}%`,
                    top: `${pos.y}%`,
                    background: VENUE_CATEGORY_COLORS[venue.uiCategory] ?? "#3b82f6"
                  }}
                  title={venue.name}
                >
                </button>
              );
            })
          : points.map((spot) => {
              const pos = project(spot.coordinates.lat, spot.coordinates.lng);
              return (
                <button
                  key={spot.id}
                  type="button"
                  className="fallback-pin fallback-pin--preview"
                  style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
                  title={spot.name}
                >
                </button>
              );
            })}
    </div>
  );
}

export function RouteMap(props: RouteMapProps) {
  if (!API_KEY) {
    return <FallbackMap {...props} />;
  }

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <APIProvider apiKey={API_KEY}>
        <GoogleMapInner {...props} />
      </APIProvider>
    </div>
  );
}
