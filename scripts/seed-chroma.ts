import { ChromaClient } from "chromadb";
import { config } from "dotenv";
import venues from "../data/seed/venues.json";

config({ path: ".env.local" });

const client = new ChromaClient({
  ssl: true,
  host: "api.trychroma.com",
  port: 443,
  headers: { "x-chroma-token": process.env.CHROMA_API_KEY! },
  tenant: process.env.CHROMA_TENANT!,
  database: process.env.CHROMA_DATABASE!,
});

async function seed() {
  // Xoá collection cũ nếu có, tạo lại
  await client.deleteCollection({ name: "venues" }).catch(() => {});
  const collection = await client.createCollection({ name: "venues" });

  await collection.add({
    ids: venues.map((v) => v.id),
    documents: venues.map(
      (v) => `${v.name}. ${v.description}. Vibe: ${v.vibe}. Tags: ${v.tags}.`
    ),
    metadatas: venues.map(({ id: _id, description: _desc, ...rest }) => rest),
  });

  console.log(`✅ Seeded ${venues.length} venues`);
}

seed().catch(console.error);