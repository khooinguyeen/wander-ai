import { ChromaClient } from "chromadb";
import { config } from "dotenv";
import * as fs from "fs";
import * as path from "path";

config({ path: ".env.local" });

// ── Usage ──────────────────────────────────────────────────────
// npx tsx scripts/ingest-venues.ts data/seed/venues.json
// npx tsx scripts/ingest-venues.ts data/seed/tiktok.json data/seed/instagram.json

const inputFiles = process.argv.slice(2);
if (inputFiles.length === 0) {
  console.error("❌ No input files provided.");
  console.error("Usage: npx tsx scripts/ingest-venues.ts <file1.json> [file2.json] ...");
  process.exit(1);
}

// ── Chroma client ──────────────────────────────────────────────
const client = new ChromaClient({
  ssl: true,
  host: "api.trychroma.com",
  port: 443,
  headers: { "x-chroma-token": process.env.CHROMA_API_KEY! },
  tenant: process.env.CHROMA_TENANT!,
  database: process.env.CHROMA_DATABASE!,
});

// ── Types ──────────────────────────────────────────────────────
interface Venue {
  name: string;
  description: string;
  category: string;
  suburb: string;
  city: string;
  state: string;
  country: string;
  address: string;
  lat: number;
  lng: number;
  price_level: number | null;
  vibe: string;
  google_place_id: string;
  google_rating: number | null;
  google_rating_count: number | null;
  tags: string;
  opening_hours: string;
  website: string | null;
  google_maps_url: string;
  source_urls: string;
}

// ── Helpers ────────────────────────────────────────────────────

function mergeSourceUrls(existing: string, incoming: string): string {
  const existingUrls: string[] = JSON.parse(existing || "[]");
  const incomingUrls: string[] = JSON.parse(incoming || "[]");
  const merged = Array.from(new Set([...existingUrls, ...incomingUrls]));
  return JSON.stringify(merged);
}

function isValid(venue: Venue): boolean {
  if (!venue.name) {
    console.warn(`⚠️  Skipping venue with no name`);
    return false;
  }
  if (!venue.google_place_id) {
    console.warn(`⚠️  Skipping "${venue.name}" — no google_place_id`);
    return false;
  }
  if (!venue.lat || !venue.lng) {
    console.warn(`⚠️  Skipping "${venue.name}" — no coordinates`);
    return false;
  }
  return true;
}

const EMBED_BATCH_SIZE = 100;
const GOOGLE_API_KEY = process.env.GOOGLE_GENERATIVE_AI_API_KEY!;
const EMBED_MODEL = "gemini-embedding-001";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function embedBatch(texts: string[]): Promise<number[][]> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:batchEmbedContents?key=${GOOGLE_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requests: texts.map((text) => ({
            model: `models/${EMBED_MODEL}`,
            content: { parts: [{ text }] },
          })),
        }),
      }
    );
    if (resp.status === 429) {
      const wait = 30_000;
      console.log(`  Rate limited, waiting ${wait / 1000}s...`);
      await sleep(wait);
      continue;
    }
    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`Embedding API error ${resp.status}: ${err}`);
    }
    const data = await resp.json() as { embeddings: { values: number[] }[] };
    return data.embeddings.map((e) => e.values);
  }
  throw new Error("Embedding failed after 3 retries");
}

async function embedInBatches(docs: string[]): Promise<number[][]> {
  const allEmbeddings: number[][] = [];
  for (let i = 0; i < docs.length; i += EMBED_BATCH_SIZE) {
    if (i > 0) await sleep(61_000); // wait 61s between batches to stay under 100 req/min
    const batch = docs.slice(i, i + EMBED_BATCH_SIZE);
    const embeddings = await embedBatch(batch);
    allEmbeddings.push(...embeddings);
    console.log(`  Embedded ${Math.min(i + EMBED_BATCH_SIZE, docs.length)}/${docs.length}`);
  }
  return allEmbeddings;
}

function buildDocument(venue: Venue): string {
  return [
    venue.name,
    venue.description,
    `Category: ${venue.category}`,
    `Vibe: ${venue.vibe}`,
    `Tags: ${venue.tags}`,
    `Location: ${venue.suburb}, ${venue.city}`,
  ].join(". ");
}

function toMetadata(venue: Venue) {
  return {
    ...venue,
    price_level: venue.price_level ?? -1,
    google_rating: venue.google_rating ?? -1,
    google_rating_count: venue.google_rating_count ?? -1,
  };
}

// ── Main ───────────────────────────────────────────────────────
async function seed() {
  // 1. Load and deduplicate across input files
  const venueMap = new Map<string, Venue>();

  for (const filePath of inputFiles) {
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) {
      console.warn(`⚠️  File not found, skipping: ${resolved}`);
      continue;
    }

    const raw = JSON.parse(fs.readFileSync(resolved, "utf-8")) as Venue[];
    console.log(`📂 Loaded ${raw.length} venues from ${filePath}`);

    for (const venue of raw) {
      if (!isValid(venue)) continue;

      const existing = venueMap.get(venue.google_place_id);
      if (existing) {
        console.log(`🔀 Duplicate in files: "${venue.name}" — merging source_urls`);
        existing.source_urls = mergeSourceUrls(existing.source_urls, venue.source_urls);
      } else {
        venueMap.set(venue.google_place_id, { ...venue });
      }
    }
  }

  const venues = Array.from(venueMap.values());
  console.log(`\n📊 Total unique venues to process: ${venues.length}`);

  if (venues.length === 0) {
    console.error("❌ No valid venues to ingest.");
    process.exit(1);
  }

  // 2. Get or create collection
  let collection;
  try {
    collection = await client.getCollection({ name: "venues" });
    console.log(`📦 Found existing collection "venues"`);
  } catch {
    collection = await client.createCollection({ name: "venues" });
    console.log(`✨ Created new collection "venues"`);
  }

  // 3. Check which place_ids already exist in Chroma
  const incomingIds = venues.map((v) => v.google_place_id);
  const existingResult = await collection.get({ ids: incomingIds });
  const existingIds = new Set(existingResult.ids);

  const toAdd    = venues.filter((v) => !existingIds.has(v.google_place_id));
  const toUpdate = venues.filter((v) =>  existingIds.has(v.google_place_id));

  // 4. Add new venues
  if (toAdd.length > 0) {
    const addDocs = toAdd.map(buildDocument);
    const addEmbeddings = await embedInBatches(addDocs);
    await collection.add({
      ids:        toAdd.map((v) => v.google_place_id),
      documents:  addDocs,
      embeddings: addEmbeddings,
      metadatas:  toAdd.map(toMetadata),
    });
    console.log(`✅ Added ${toAdd.length} new venues`);
  }

  // 5. Update existing venues — fetch old source_urls from Chroma first, then merge
  if (toUpdate.length > 0) {
    const oldData = await collection.get({
      ids: toUpdate.map((v) => v.google_place_id),
    });

    // Build a map of place_id → old source_urls
    const oldSourceUrlsMap = new Map<string, string>();
    oldData.ids.forEach((id, i) => {
      const meta = oldData.metadatas[i] as Record<string, string>;
      oldSourceUrlsMap.set(id, meta?.source_urls ?? "[]");
    });

    // Merge old source_urls with incoming
    const mergedVenues = toUpdate.map((v) => ({
      ...v,
      source_urls: mergeSourceUrls(
        oldSourceUrlsMap.get(v.google_place_id) ?? "[]",
        v.source_urls
      ),
    }));

    const updateDocs = mergedVenues.map(buildDocument);
    const updateEmbeddings = await embedInBatches(updateDocs);
    await collection.update({
      ids:        mergedVenues.map((v) => v.google_place_id),
      documents:  updateDocs,
      embeddings: updateEmbeddings,
      metadatas:  mergedVenues.map(toMetadata),
    });
    console.log(`🔄 Updated ${toUpdate.length} existing venues (source_urls merged)`);
  }

  console.log(`\n🎉 Done! Ingested from ${inputFiles.length} file(s).`);
}

seed().catch(console.error);