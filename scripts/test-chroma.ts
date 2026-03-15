import { ChromaClient } from "chromadb";
import { config } from "dotenv";

config({ path: ".env.local" });

const client = new ChromaClient({
  ssl: true,
  host: "api.trychroma.com",
  port: 443,
  headers: {
    "x-chroma-token": process.env.CHROMA_API_KEY!,
  },
  tenant: process.env.CHROMA_TENANT!,
  database: process.env.CHROMA_DATABASE!,
});

async function main() {
  const heartbeat = await client.heartbeat();
  console.log("Connected!", heartbeat);

  // List collections
  const collections = await client.listCollections();
  console.log("Collections:", collections);

  const collName = process.env.CHROMA_COLLECTION ?? "venues";
  console.log("Using collection:", collName);

  const collection = await client.getCollection({ name: collName });
  const count = await collection.count();
  console.log("Documents in collection:", count);

  // Test query
  const raw = await collection.query({
    queryTexts: ["matcha cafes CBD Melbourne"],
    nResults: 5,
    include: ["metadatas", "distances"],
  });

  console.log("\nQuery: 'food CBD Melbourne'");
  console.log("IDs:", raw.ids?.[0]?.length ?? 0, "results");

  const ids = raw.ids?.[0] ?? [];
  const metas = raw.metadatas?.[0] ?? [];
  const dists = raw.distances?.[0] ?? [];

  for (let i = 0; i < ids.length; i++) {
    const m = metas[i] as Record<string, unknown>;
    console.log(`  ${i + 1}. ${m?.name} | ${m?.suburb} | dist: ${dists[i]?.toFixed(3)}`);
  }
}

main().catch(console.error);
