import { ChromaClient } from "chromadb";
import { config } from "dotenv";
import * as fs from "fs";
import * as path from "path";

config({ path: ".env.local" });

// ── Usage ──────────────────────────────────────────────────────
// npx tsx scripts/seed-chroma.ts data/seed/venues.json
// npx tsx scripts/seed-chroma.ts data/seed/tiktok.json data/seed/instagram.json

const inputFiles = process.argv.slice(2);
if (inputFiles.length === 0) {
  console.error("❌ No input files provided.");
  console.error("Usage: npx tsx scripts/seed-chroma.ts <file1.json> [file2.json] ...");
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

// Merge source_urls from two venues with same google_place_id
function mergeSourceUrls(existing: string, incoming: string): string {
  const existingUrls: string[] = JSON.parse(existing || "[]");
  const incomingUrls: string[] = JSON.parse(incoming || "[]");
  const merged = Array.from(new Set([...existingUrls, ...incomingUrls]));
  return JSON.stringify(merged);
}

// Validate required fields — skip venue if missing
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

// Build the document text that gets embedded as a vector
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

// ── Main ───────────────────────────────────────────────────────
async function seed() {
  // 1. Load and merge all input files
  // Key = google_place_id, value = venue (deduplicated)
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
        // Duplicate found — merge source_urls, keep everything else from existing
        console.log(`🔀 Duplicate found: "${venue.name}" — merging source_urls`);
        existing.source_urls = mergeSourceUrls(existing.source_urls, venue.source_urls);
      } else {
        venueMap.set(venue.google_place_id, { ...venue });
      }
    }
  }

  const venues = Array.from(venueMap.values());
  console.log(`\n📊 Total unique venues to seed: ${venues.length}`);

  if (venues.length === 0) {
    console.error("❌ No valid venues to seed.");
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
  const existing = await collection.get({ ids: incomingIds });
  const existingIds = new Set(existing.ids);

  const toAdd = venues.filter((v) => !existingIds.has(v.google_place_id));
  const toUpdate = venues.filter((v) => existingIds.has(v.google_place_id));

  // 4. Add new venues
  if (toAdd.length > 0) {
    await collection.add({
      ids: toAdd.map((v) => v.google_place_id),
      documents: toAdd.map(buildDocument),
      metadatas: toAdd.map(({ description: _desc, ...rest }) => ({
        ...rest,
        price_level: rest.price_level ?? -1,
        google_rating: rest.google_rating ?? -1,
        google_rating_count: rest.google_rating_count ?? -1,
      })),
    });
    console.log(`✅ Added ${toAdd.length} new venues`);
  }

  // 5. Update existing venues (merge source_urls)
  if (toUpdate.length > 0) {
    await collection.update({
      ids: toUpdate.map((v) => v.google_place_id),
      documents: toUpdate.map(buildDocument),
      metadatas: toUpdate.map(({ description: _desc, ...rest }) => ({
        ...rest,
        price_level: rest.price_level ?? -1,
        google_rating: rest.google_rating ?? -1,
        google_rating_count: rest.google_rating_count ?? -1,
      })),
    });
    console.log(`🔄 Updated ${toUpdate.length} existing venues`);
  }

  console.log(`\n🎉 Done! Collection now has venues from ${inputFiles.length} file(s).`);
}

seed().catch(console.error);