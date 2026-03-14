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
}

main().catch(console.error);