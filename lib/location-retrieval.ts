import { ChromaClient } from "chromadb";

export type LocationMatch = {
  id: string;
  name: string;
  city: string | null;
  suburb: string | null;
  category: string | null;
  vibe: string | null;
  address: string | null;
  website: string | null;
  googleMapsUrl: string | null;
  sourceUrls: string[];
  tags: string[];
  distance: number | null;
  reason: string;
  score: number;
};

export type LocationRetrievalRequest = {
  intent: string;
  clarification?: string;
  topK?: number;
  collectionName?: string;
};

export type LocationRetrievalResponse = {
  queryText: string;
  results: LocationMatch[];
};

type MetadataRecord = Record<string, unknown>;

type RankedHit = {
  id: string;
  metadata: MetadataRecord;
  distance: number | null;
  score: number;
};

function cleanText(value: unknown): string {
  return String(value ?? "").trim();
}

function getEnv(name: string): string | undefined {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return env?.[name];
}

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-zA-Z][a-zA-Z0-9'-]+/g) ?? [];
}

function safeParseList(value: unknown): string[] {
  if (value == null) return [];

  if (Array.isArray(value)) {
    return value
      .map((item) => String(item).trim())
      .filter(Boolean);
  }

  const text = String(value).trim();
  if (!text) return [];

  try {
    const parsed = JSON.parse(text) as unknown;
    if (Array.isArray(parsed)) {
      return parsed
        .map((item) => String(item).trim())
        .filter(Boolean);
    }
  } catch {
    // Fall through to comma splitting.
  }

  return text
    .split(",")
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function metadataToText(meta: MetadataRecord): string {
  const fields = ["name", "description", "category", "suburb", "city", "vibe", "address", "tags"];
  const parts: string[] = [];

  for (const field of fields) {
    const value = meta[field];
    if (value == null) continue;

    if (Array.isArray(value)) {
      for (const item of value) {
        parts.push(String(item));
      }
      continue;
    }

    parts.push(String(value));
  }

  return parts.join(" ").toLowerCase();
}

function buildReason(intent: string, clarification: string, meta: MetadataRecord): string {
  const combined = `${intent} ${clarification}`.toLowerCase();
  const intentTokens = new Set(tokenize(intent));
  const reasonBits: string[] = [];

  const tags = safeParseList(meta.tags).map((tag) => tag.toLowerCase());
  const matchedTags = tags.filter((tag) => {
    for (const token of intentTokens) {
      if (tag.includes(token)) {
        return true;
      }
    }
    return false;
  });
  if (matchedTags.length > 0) {
    reasonBits.push(`tag match: ${matchedTags.slice(0, 3).join(", ")}`);
  }

  const category = cleanText(meta.category).toLowerCase();
  const categorySignals = ["coffee", "cafe", "food", "drinks", "bar", "restaurant"];
  if (category && categorySignals.some((signal) => combined.includes(signal))) {
    reasonBits.push(`category: ${category}`);
  }

  const suburb = cleanText(meta.suburb);
  const city = cleanText(meta.city);
  for (const place of [suburb, city]) {
    if (place && combined.includes(place.toLowerCase())) {
      reasonBits.push(`location: ${place}`);
    }
  }

  const vibe = cleanText(meta.vibe);
  if (vibe && combined.includes(vibe.toLowerCase())) {
    reasonBits.push(`vibe: ${vibe}`);
  }

  if (reasonBits.length === 0) {
    reasonBits.push("semantic similarity to your intent");
  }

  return reasonBits.join("; ");
}

function composeSearchText(intent: string, clarification: string): string {
  const cleanedIntent = cleanText(intent);
  const cleanedClarification = cleanText(clarification);
  if (cleanedClarification) {
    return `${cleanedClarification} ${cleanedIntent} Melbourne`;
  }
  return `${cleanedIntent} Melbourne`;
}

function parseEnvBoolean(name: string, defaultValue: boolean): boolean {
  const raw = getEnv(name);
  if (!raw) return defaultValue;
  return ["1", "true", "yes", "y", "on"].includes(raw.trim().toLowerCase());
}

const EMBED_MODEL = "gemini-embedding-001";

async function embedText(text: string): Promise<number[]> {
  const apiKey = getEnv("GOOGLE_GENERATIVE_AI_API_KEY");
  if (!apiKey) throw new Error("Missing GOOGLE_GENERATIVE_AI_API_KEY");
  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: `models/${EMBED_MODEL}`,
        content: { parts: [{ text }] },
      }),
    }
  );
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Embedding API error ${resp.status}: ${err}`);
  }
  const data = await resp.json() as { embedding: { values: number[] } };
  return data.embedding.values;
}

function createChromaClient(): ChromaClient {
  const apiKey = getEnv("CHROMA_API_KEY")?.trim();
  const tenant = getEnv("CHROMA_TENANT")?.trim();
  const database = getEnv("CHROMA_DATABASE")?.trim();

  if (!apiKey || !tenant || !database) {
    throw new Error(
      "Missing Chroma Cloud env vars. Set CHROMA_API_KEY, CHROMA_TENANT, and CHROMA_DATABASE.",
    );
  }

  const host = getEnv("CHROMA_HOST")?.trim() || getEnv("CHROMA_CLOUD_HOST")?.trim() || "api.trychroma.com";
  const port = Number.parseInt(getEnv("CHROMA_CLOUD_PORT") ?? "443", 10);
  const ssl = parseEnvBoolean("CHROMA_CLOUD_SSL", true);

  return new ChromaClient({
    host,
    port: Number.isFinite(port) ? port : 443,
    ssl,
    headers: {
      "x-chroma-token": apiKey,
    },
    tenant,
    database,
  });
}

function rerankHits(input: {
  queryText: string;
  intentKeywords: string[];
  ids: string[];
  metadatas: MetadataRecord[];
  distances: Array<number | null>;
  keepTopK: number;
}): RankedHit[] {
  const qTokens = new Set(tokenize(input.queryText));
  const ranked: RankedHit[] = [];

  for (let idx = 0; idx < input.ids.length; idx += 1) {
    const id = input.ids[idx];
    const metadata = input.metadatas[idx] ?? {};
    const distance = typeof input.distances[idx] === "number" ? (input.distances[idx] as number) : null;

    const haystack = metadataToText(metadata);
    const haystackTokens = new Set(tokenize(haystack));

    let overlap = 0;
    for (const token of qTokens) {
      if (haystackTokens.has(token)) {
        overlap += 1;
      }
    }

    const overlapScore = overlap / Math.max(1, qTokens.size);
    const chromaScore = distance == null ? 0 : 1 / (1 + distance);

    const keywordHit =
      input.intentKeywords.length === 0 ||
      input.intentKeywords.some((keyword) => haystack.includes(keyword));
    const penalty = keywordHit ? 1 : 0.25;

    const score = ((0.75 * chromaScore) + (0.25 * overlapScore)) * penalty;

    ranked.push({
      id,
      metadata,
      distance,
      score,
    });
  }

  ranked.sort((a, b) => b.score - a.score);
  return ranked.slice(0, input.keepTopK);
}

export async function retrieveLocationsFromChroma(
  request: LocationRetrievalRequest,
): Promise<LocationRetrievalResponse> {
  const intent = cleanText(request.intent);
  if (!intent) {
    throw new Error("intent is required");
  }

  const clarification = cleanText(request.clarification);
  const topK = Math.max(1, Math.min(20, request.topK ?? 8));
  const collectionName = request.collectionName ?? getEnv("CHROMA_COLLECTION") ?? getEnv("CHROMA_COLLECTION_NAME") ?? "venues";

  const queryText = composeSearchText(intent, clarification);
  const intentKeywords = tokenize(intent);

  const client = createChromaClient();
  const collection = await client.getCollection({ name: collectionName });

  const embedding = await embedText(queryText);

  const raw = await collection.query({
    queryEmbeddings: [embedding],
    nResults: Math.max(topK * 4, 20),
    include: ["metadatas", "distances"],
  });

  const ids = Array.isArray(raw.ids?.[0]) ? (raw.ids[0] as string[]) : [];
  const metadatas = Array.isArray(raw.metadatas?.[0]) ? (raw.metadatas[0] as MetadataRecord[]) : [];
  const distances = Array.isArray(raw.distances?.[0])
    ? (raw.distances[0] as Array<number | null>)
    : [];

  const ranked = rerankHits({
    queryText,
    intentKeywords,
    ids,
    metadatas,
    distances,
    keepTopK: topK,
  });

  const results: LocationMatch[] = ranked.map((hit) => {
    const meta = hit.metadata;

    return {
      id: hit.id,
      name: cleanText(meta.name) || "Unknown location",
      city: cleanText(meta.city) || null,
      suburb: cleanText(meta.suburb) || null,
      category: cleanText(meta.category) || null,
      vibe: cleanText(meta.vibe) || null,
      address: cleanText(meta.address) || null,
      website: cleanText(meta.website) || null,
      googleMapsUrl: cleanText(meta.google_maps_url) || null,
      sourceUrls: safeParseList(meta.source_urls),
      tags: safeParseList(meta.tags),
      distance: hit.distance,
      score: Number(hit.score.toFixed(4)),
      reason: buildReason(intent, clarification, meta),
    };
  });

  return {
    queryText,
    results,
  };
}
