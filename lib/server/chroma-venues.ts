import { ChromaClient } from "chromadb";

import type { VenueRaw } from "@/lib/types";

type ChromaSyncResult = {
  enabled: boolean;
  collection: string | null;
  addedIds: string[];
  updatedIds: string[];
};

function getChromaConfig() {
  const apiKey = process.env.CHROMA_API_KEY?.trim() ?? "";
  const tenant = process.env.CHROMA_TENANT?.trim() ?? "";
  const database = process.env.CHROMA_DATABASE?.trim() ?? "";
  const collection = process.env.CHROMA_COLLECTION?.trim() || "venues";

  if (!apiKey || !tenant || !database) {
    return null;
  }

  return { apiKey, tenant, database, collection };
}

function mergeSourceUrls(existing: string, incoming: string): string {
  const existingUrls = JSON.parse(existing || "[]") as string[];
  const incomingUrls = JSON.parse(incoming || "[]") as string[];
  return JSON.stringify(Array.from(new Set([...existingUrls, ...incomingUrls])));
}

function buildDocument(venue: VenueRaw): string {
  return [
    venue.name,
    venue.description,
    `Category: ${venue.category}`,
    `Vibe: ${venue.vibe ?? ""}`,
    `Tags: ${venue.tags}`,
    `Location: ${venue.suburb}, ${venue.city}`,
  ].join(". ");
}

function toMetadata(venue: VenueRaw) {
  const { description: _description, ...rest } = venue;
  return {
    ...rest,
    price_level: rest.price_level ?? -1,
  };
}

function isValidVenue(venue: VenueRaw): venue is VenueRaw & { google_place_id: string } {
  return Boolean(venue.name && venue.google_place_id && venue.lat && venue.lng);
}

export async function upsertVenuesInChroma(venues: VenueRaw[]): Promise<ChromaSyncResult> {
  const config = getChromaConfig();
  if (!config) {
    return {
      enabled: false,
      collection: null,
      addedIds: [],
      updatedIds: [],
    };
  }

  const validVenues = venues.filter(isValidVenue);
  if (validVenues.length === 0) {
    return {
      enabled: true,
      collection: config.collection,
      addedIds: [],
      updatedIds: [],
    };
  }

  const client = new ChromaClient({
    ssl: true,
    host: "api.trychroma.com",
    port: 443,
    headers: { "x-chroma-token": config.apiKey },
    tenant: config.tenant,
    database: config.database,
  });

  let collection;
  try {
    collection = await client.getCollection({ name: config.collection });
  } catch {
    collection = await client.createCollection({ name: config.collection });
  }

  const incomingIds = validVenues.map((venue) => venue.google_place_id);
  const existingResult = await collection.get({ ids: incomingIds });
  const existingIds = new Set(existingResult.ids);

  const toAdd = validVenues.filter((venue) => !existingIds.has(venue.google_place_id));
  const toUpdate = validVenues.filter((venue) => existingIds.has(venue.google_place_id));

  if (toAdd.length > 0) {
    await collection.add({
      ids: toAdd.map((venue) => venue.google_place_id),
      documents: toAdd.map(buildDocument),
      metadatas: toAdd.map(toMetadata),
    });
  }

  if (toUpdate.length > 0) {
    const previous = await collection.get({ ids: toUpdate.map((venue) => venue.google_place_id) });
    const previousSourceUrls = new Map<string, string>();

    previous.ids.forEach((id, index) => {
      const metadata = previous.metadatas[index] as Record<string, string> | undefined;
      previousSourceUrls.set(id, metadata?.source_urls ?? "[]");
    });

    const merged = toUpdate.map((venue) => ({
      ...venue,
      source_urls: mergeSourceUrls(previousSourceUrls.get(venue.google_place_id) ?? "[]", venue.source_urls),
    }));

    await collection.update({
      ids: merged.map((venue) => venue.google_place_id),
      documents: merged.map(buildDocument),
      metadatas: merged.map(toMetadata),
    });
  }

  return {
    enabled: true,
    collection: config.collection,
    addedIds: toAdd.map((venue) => venue.google_place_id as string),
    updatedIds: toUpdate.map((venue) => venue.google_place_id as string),
  };
}
