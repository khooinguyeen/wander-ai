"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  APIProvider,
  Map,
  AdvancedMarker,
  useMap,
  useMapsLibrary
} from "@vis.gl/react-google-maps";

import type { PlannedStop, Spot, TravelMode, Venue } from "@/lib/types";

const MELBOURNE_CENTER = { lat: -37.8136, lng: 144.9631 };
const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";

const DARK_MAP_ID = "DEMO_MAP_ID";

type RouteMapProps = {
  stops: PlannedStop[];
  previewSpots: Spot[];
  venues: Venue[];
  activeStopId: string | null;
  selectedVenueId: string | null;
  onSelectStop: (id: string) => void;
  onSelectVenue: (id: string) => void;
  startLocation: string;
  travelMode: TravelMode;
  colorScheme?: "DARK" | "LIGHT";
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

function DirectionsRenderer({
  stops,
  travelMode
}: {
  stops: PlannedStop[];
  travelMode: TravelMode;
}) {
  const map = useMap();
  const routesLib = useMapsLibrary("routes");
  const rendererRef = useRef<google.maps.DirectionsRenderer | null>(null);

  useEffect(() => {
    if (!map || !routesLib || stops.length < 2) {
      if (rendererRef.current) {
        rendererRef.current.setMap(null);
        rendererRef.current = null;
      }
      return;
    }

    const service = new routesLib.DirectionsService();
    const renderer = new routesLib.DirectionsRenderer({
      map,
      suppressMarkers: true,
      polylineOptions: {
        strokeColor: "#4f8cf9",
        strokeWeight: 4,
        strokeOpacity: 0.85
      }
    });

    rendererRef.current = renderer;

    const waypoints = stops.slice(1, -1).map((s) => ({
      location: new google.maps.LatLng(s.spot.coordinates.lat, s.spot.coordinates.lng),
      stopover: true
    }));

    service.route(
      {
        origin: new google.maps.LatLng(
          stops[0].spot.coordinates.lat,
          stops[0].spot.coordinates.lng
        ),
        destination: new google.maps.LatLng(
          stops[stops.length - 1].spot.coordinates.lat,
          stops[stops.length - 1].spot.coordinates.lng
        ),
        waypoints,
        travelMode: travelModeToGoogle(travelMode)
      },
      (result, status) => {
        if (status === google.maps.DirectionsStatus.OK && result) {
          renderer.setDirections(result);
        }
      }
    );

    return () => {
      renderer.setMap(null);
    };
  }, [map, routesLib, stops, travelMode]);

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

import { UtensilsCrossed, Coffee, Wine, MapPin } from "lucide-react";
import type { ReactNode } from "react";

const VENUE_CATEGORY_ICON: Record<string, ReactNode> = {
  restaurant: <UtensilsCrossed size={14} strokeWidth={2.5} color="#fff" />,
  cafe: <Coffee size={14} strokeWidth={2.5} color="#fff" />,
  bar: <Wine size={14} strokeWidth={2.5} color="#fff" />,
  attraction: <MapPin size={14} strokeWidth={2.5} color="#fff" />,
  shopping: <MapPin size={14} strokeWidth={2.5} color="#fff" />,
  other: <MapPin size={14} strokeWidth={2.5} color="#fff" />,
};


function GoogleMapInner({
  stops,
  previewSpots,
  venues,
  activeStopId,
  selectedVenueId,
  onSelectStop,
  onSelectVenue,
  travelMode,
  colorScheme = "DARK"
}: RouteMapProps) {
  const hasStops = stops.length > 0;
  const hasVenues = venues.length > 0;

  return (
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
    >
      <FitBounds stops={stops} previewSpots={previewSpots} venues={venues} />

      {hasStops && <DirectionsRenderer stops={stops} travelMode={travelMode} />}

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
            >
              <div
                className={`gmap-marker ${activeStopId === stop.spot.id ? "gmap-marker--active" : ""}`}
              >
                {String(i + 1).padStart(2, "0")}
              </div>
            </AdvancedMarker>
          ))
        : hasVenues
          ? venues.map((venue) => {
              const isSelected = selectedVenueId === venue.id;
              const color = VENUE_CATEGORY_COLORS[venue.uiCategory] ?? "#3b82f6";
              const icon = VENUE_CATEGORY_ICON[venue.uiCategory] ?? <MapPin size={14} strokeWidth={2.5} color="#fff" />;
              return (
                <AdvancedMarker
                  key={venue.id}
                  position={{ lat: venue.lat, lng: venue.lng }}
                  title={venue.name}
                  onClick={() => onSelectVenue(venue.id)}
                  zIndex={isSelected ? 100 : 10}
                >
                  {isSelected ? (
                    <div className="venue-marker venue-marker--expanded" style={{ borderColor: color }}>
                      <div className="venue-marker__dot" style={{ background: color }}>
                        {icon}
                      </div>
                      <div className="venue-marker__info">
                        <span className="venue-marker__name">{venue.name}</span>
                        <span className="venue-marker__sub">{venue.suburb !== "unknown" ? venue.suburb : venue.city} · {venue.uiCategory}</span>
                      </div>
                      <div className="venue-marker__arrow" style={{ borderTopColor: color }} />
                    </div>
                  ) : (
                    <div className="venue-marker venue-marker--dot" style={{ background: color }}>
                      {icon}
                      <div className="venue-marker__arrow-sm" style={{ borderTopColor: color }} />
                    </div>
                  )}
                </AdvancedMarker>
              );
            })
          : previewSpots.slice(0, 20).map((spot) => (
              <AdvancedMarker
                key={spot.id}
                position={{ lat: spot.coordinates.lat, lng: spot.coordinates.lng }}
              >
                <div className="gmap-marker gmap-marker--preview" />
              </AdvancedMarker>
            ))}
    </Map>
  );
}

function FallbackMap({
  stops,
  previewSpots,
  venues,
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
              return (
                <button
                  key={venue.id}
                  type="button"
                  className="fallback-pin fallback-pin--venue"
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
    <APIProvider apiKey={API_KEY}>
      <GoogleMapInner {...props} />
    </APIProvider>
  );
}
