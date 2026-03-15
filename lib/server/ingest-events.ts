import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { VenueRaw } from "@/lib/types";

type IngestEventSource = "app_chat" | "telegram_bot" | "discord_bot" | "discord_command" | "unknown";

export type IngestEvent = {
  id: string;
  createdAt: string;
  source: IngestEventSource;
  inputUrl: string;
  venueCount: number;
  addedCount: number;
  updatedCount: number;
  success: boolean;
  error: string | null;
  venues: VenueRaw[];
};

const EVENTS_PATH = path.join(process.cwd(), "tmp", "ingest-events.json");
const MAX_EVENTS = 100;

async function ensureEventsDir() {
  await mkdir(path.dirname(EVENTS_PATH), { recursive: true });
}

async function readEvents(): Promise<IngestEvent[]> {
  try {
    const raw = await readFile(EVENTS_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as IngestEvent[]) : [];
  } catch {
    return [];
  }
}

async function writeEvents(events: IngestEvent[]) {
  await ensureEventsDir();
  await writeFile(EVENTS_PATH, `${JSON.stringify(events, null, 2)}\n`, "utf-8");
}

export async function listIngestEvents(): Promise<IngestEvent[]> {
  const events = await readEvents();
  return events.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function recordIngestEvent(
  event: Omit<IngestEvent, "id" | "createdAt">,
): Promise<IngestEvent> {
  const fullEvent: IngestEvent = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    ...event,
  };

  const existing = await readEvents();
  const next = [fullEvent, ...existing].slice(0, MAX_EVENTS);
  await writeEvents(next);
  return fullEvent;
}
