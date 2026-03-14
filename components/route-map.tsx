"use client";

import { divIcon, point } from "leaflet";
import { useEffect } from "react";
import { MapContainer, Marker, Popup, Polyline, TileLayer, ZoomControl, useMap } from "react-leaflet";

import type { PlannedStop, Spot } from "@/lib/types";

type RouteMapProps = {
  stops: PlannedStop[];
  previewSpots?: Spot[];
  activeStopId?: string | null;
  onSelectStop?: (spotId: string) => void;
};

function resolveViewportPadding() {
  if (typeof window === "undefined") {
    return {
      paddingTopLeft: [88, 88] as [number, number],
      paddingBottomRight: [88, 88] as [number, number]
    };
  }

  if (window.innerWidth <= 720) {
    return {
      paddingTopLeft: [24, 132] as [number, number],
      paddingBottomRight: [24, Math.round(window.innerHeight * 0.38)] as [number, number]
    };
  }

  if (window.innerWidth <= 960) {
    return {
      paddingTopLeft: [28, 150] as [number, number],
      paddingBottomRight: [28, Math.round(window.innerHeight * 0.34)] as [number, number]
    };
  }

  return {
    paddingTopLeft: [Math.round(Math.min(520, window.innerWidth * 0.38)), 120] as [number, number],
    paddingBottomRight: [92, 92] as [number, number]
  };
}

function resolveFocusOffset() {
  if (typeof window === "undefined") {
    return [0, 0] as [number, number];
  }

  if (window.innerWidth <= 520) {
    return [0, -Math.round(window.innerHeight * 0.1)] as [number, number];
  }

  if (window.innerWidth <= 960) {
    return [0, -Math.round(window.innerHeight * 0.18)] as [number, number];
  }

  return [-Math.round(Math.min(260, window.innerWidth * 0.16)), 0] as [number, number];
}

function buildStopIcon(index: number, active: boolean, featured: boolean) {
  return divIcon({
    className: "route-map__marker-shell",
    html: `<span class="route-map__marker${active ? " route-map__marker--active" : ""}${featured ? " route-map__marker--featured" : ""}"><span class="route-map__marker-label">${index + 1}</span></span>`,
    iconSize: point(36, 36, true),
    iconAnchor: [18, 30],
    popupAnchor: [0, -26]
  });
}

function buildPreviewIcon() {
  return divIcon({
    className: "route-map__marker-shell",
    html: '<span class="route-map__marker route-map__marker--preview"><span class="route-map__marker-dot"></span></span>',
    iconSize: point(28, 28, true),
    iconAnchor: [14, 24],
    popupAnchor: [0, -20]
  });
}

function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();

  useEffect(() => {
    if (points.length === 0) {
      return;
    }

    if (points.length === 1) {
      map.setView(points[0], 13);
      return;
    }

    map.fitBounds(points, resolveViewportPadding());
  }, [map, points]);

  return null;
}

function FocusStop({ stops, activeStopId }: Pick<RouteMapProps, "stops" | "activeStopId">) {
  const map = useMap();

  useEffect(() => {
    if (!activeStopId) {
      return;
    }

    const activeStop = stops.find((stop) => stop.spot.id === activeStopId);
    if (!activeStop) {
      return;
    }

    const offset = resolveFocusOffset();
    const handleMoveEnd = () => {
      if (offset[0] === 0 && offset[1] === 0) {
        return;
      }

      map.panBy(offset, { animate: true, duration: 0.4 });
    };

    map.once("moveend", handleMoveEnd);
    map.flyTo([activeStop.spot.coordinates.lat, activeStop.spot.coordinates.lng], Math.max(map.getZoom(), 14), {
      duration: 0.65
    });

    return () => {
      map.off("moveend", handleMoveEnd);
    };
  }, [activeStopId, map, stops]);

  return null;
}

export function RouteMap({ stops, previewSpots = [], activeStopId, onSelectStop }: RouteMapProps) {
  const routeSpots = stops.map((stop) => stop.spot);
  const previewPins = previewSpots.filter((spot) => !routeSpots.some((routeSpot) => routeSpot.id === spot.id));
  const baseSpots = routeSpots.length > 0 ? routeSpots : previewPins;
  const center = baseSpots.length > 0 ? ([baseSpots[0].coordinates.lat, baseSpots[0].coordinates.lng] as [number, number]) : ([-37.8136, 144.9631] as [number, number]);
  const polyline = stops.map((stop) => [stop.spot.coordinates.lat, stop.spot.coordinates.lng]) as [number, number][];
  const fitPoints = (routeSpots.length > 0 ? routeSpots : previewPins).map((spot) => [spot.coordinates.lat, spot.coordinates.lng]) as [number, number][];

  return (
    <MapContainer center={center} zoom={12} scrollWheelZoom className="route-map" zoomControl={false}>
      <TileLayer
        attribution='&copy; <a href="https://stadiamaps.com/">Stadia Maps</a>, &copy; <a href="https://openmaptiles.org/">OpenMapTiles</a> &copy; <a href="https://openstreetmap.org">OpenStreetMap</a> contributors'
        url="https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}{r}.png"
      />

      <ZoomControl position="topright" />

      {polyline.length > 1 ? (
        <>
          <Polyline positions={polyline} pathOptions={{ color: "rgba(255,255,255,0.92)", weight: 12, opacity: 0.95 }} />
          <Polyline positions={polyline} pathOptions={{ color: "#2563eb", weight: 7, opacity: 0.96 }} />
        </>
      ) : null}

      {previewPins.map((spot) => (
        <Marker
          key={`preview-${spot.id}`}
          position={[spot.coordinates.lat, spot.coordinates.lng]}
          icon={buildPreviewIcon()}
        >
          <Popup>
            <strong>{spot.name}</strong>
            <br />
            {spot.area} · {spot.kind}
          </Popup>
        </Marker>
      ))}

      {stops.map((stop, index) => {
        const active = activeStopId === stop.spot.id;

        return (
          <Marker
            key={stop.spot.id}
            position={[stop.spot.coordinates.lat, stop.spot.coordinates.lng]}
            icon={buildStopIcon(index, active, index === 0)}
            eventHandlers={{
              click: () => onSelectStop?.(stop.spot.id)
            }}
          >
            <Popup>
              <strong>{stop.spot.name}</strong>
              <br />
              {stop.arrivalTime} to {stop.departureTime}
              <br />
              {stop.spot.area}
            </Popup>
          </Marker>
        );
      })}

      <FitBounds points={fitPoints} />
      <FocusStop stops={stops} activeStopId={activeStopId} />
    </MapContainer>
  );
}
