/**
 * ChromaDB client singleton for server-side use.
 * Connects to the hosted Chroma instance at api.trychroma.com.
 */

import { ChromaClient } from "chromadb";

let _client: ChromaClient | null = null;

export function getChromaClient(): ChromaClient {
  if (_client) return _client;

  _client = new ChromaClient({
    ssl: true,
    host: "api.trychroma.com",
    port: 443,
    headers: { "x-chroma-token": process.env.CHROMA_API_KEY! },
    tenant: process.env.CHROMA_TENANT!,
    database: process.env.CHROMA_DATABASE!,
  });

  return _client;
}

export async function getVenuesCollection() {
  const client = getChromaClient();
  return client.getCollection({ name: "venues" });
}
