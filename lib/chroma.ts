import { ChromaClient } from "chromadb";

let _client: ChromaClient | null = null;

export function getChromaClient(): ChromaClient {
  if (!_client) {
    _client = new ChromaClient({
      ssl: true,
      host: "api.trychroma.com",
      port: 443,
      headers: { "x-chroma-token": process.env.CHROMA_API_KEY! },
      tenant: process.env.CHROMA_TENANT!,
      database: process.env.CHROMA_DATABASE!,
    });
  }
  return _client;
}

export const COLLECTION_NAME = process.env.CHROMA_COLLECTION ?? "venues";
