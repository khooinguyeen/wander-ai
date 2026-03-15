import { spawn } from "node:child_process";

import { z } from "zod";

import type { VenueRaw } from "@/lib/types";
import { upsertVenuesInChroma } from "@/lib/server/chroma-venues";
import { recordIngestEvent } from "@/lib/server/ingest-events";

export const tiktokIngestRequestSchema = z.object({
  url: z
    .string()
    .url()
    .refine((value) => /(?:[\w-]+\.)?tiktok\.com/i.test(value), "Expected a TikTok URL"),
});

export type TikTokIngestExtraction = {
  inputUrl: string;
  venues: VenueRaw[];
  rawItemCount: number;
  candidateRecordCount: number;
  matchedRecordCount: number;
};

export type TikTokIngestResult = TikTokIngestExtraction & {
  database: {
    enabled: boolean;
    collection: string | null;
    addedCount: number;
    updatedCount: number;
    addedIds: string[];
    updatedIds: string[];
  };
};

export type TikTokIngestSource =
  | "app_chat"
  | "telegram_bot"
  | "discord_bot"
  | "discord_command"
  | "unknown";

function log(message: string) {
  const timestamp = new Date().toISOString();
  console.log(`[tiktok-ingest ${timestamp}] ${message}`);
}

function stripTikTokTracking(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return url.trim();
  }
}

async function normalizeTikTokInputUrl(url: string): Promise<string> {
  const cleaned = stripTikTokTracking(url);

  try {
    const response = await fetch(cleaned, {
      method: "GET",
      redirect: "follow",
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
      },
    });
    const finalUrl = stripTikTokTracking(response.url || cleaned);
    log(`Normalized TikTok URL: ${cleaned} -> ${finalUrl}`);
    return finalUrl;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown normalization failure";
    log(`TikTok URL normalization failed, using original URL: ${cleaned}. ${message}`);
    return cleaned;
  }
}

function parseExtractorPayload(stdout: string): TikTokIngestExtraction {
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new Error("TikTok extractor produced empty stdout");
  }

  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    try {
      const parsed = JSON.parse(line) as TikTokIngestExtraction;
      if (parsed && typeof parsed === "object" && Array.isArray(parsed.venues)) {
        return parsed;
      }
    } catch {
      // Keep scanning upwards for the final JSON payload.
    }
  }

  try {
    return JSON.parse(trimmed) as TikTokIngestExtraction;
  } catch {
    throw new Error("TikTok extractor stdout did not contain a valid JSON payload");
  }
}

export function runLiveTikTokExtractor(url: string): Promise<TikTokIngestExtraction> {
  return new Promise((resolve, reject) => {
    const scriptPath = "scripts/apify_tiktok_scraper/live_extract_tiktok_url.py";
    log(`Starting Python extractor for URL: ${url}`);
    const child = spawn("python", [scriptPath, "--url", url, "--description-mode", "auto"], {
      cwd: process.cwd(),
      env: process.env,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      const trimmed = text.trim();
      if (trimmed) {
        log(`[python stdout] ${trimmed}`);
      }
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      const trimmed = text.trim();
      if (trimmed) {
        log(`[python stderr] ${trimmed}`);
      }
    });
    child.on("error", (error) => {
      log(`Python extractor process error: ${error.message}`);
      reject(error);
    });
    child.on("close", (code) => {
      log(`Python extractor exited with code ${code}`);
      if (code !== 0) {
        reject(new Error(stderr.trim() || `TikTok extractor exited with code ${code}`));
        return;
      }

      try {
        const parsed = parseExtractorPayload(stdout);
        log(
          `Python extractor parsed successfully: rawItems=${parsed.rawItemCount}, candidates=${parsed.candidateRecordCount}, matched=${parsed.matchedRecordCount}, venues=${parsed.venues.length}`,
        );
        resolve(parsed);
      } catch {
        reject(
          new Error(
            `TikTok extractor returned invalid JSON.${stderr ? ` ${stderr.trim()}` : ""}`,
          ),
        );
      }
    });
  });
}

export async function ingestTikTokUrl(
  url: string,
  source: TikTokIngestSource = "unknown",
): Promise<TikTokIngestResult> {
  const normalizedUrl = await normalizeTikTokInputUrl(url);
  log(`Ingest requested for URL: ${normalizedUrl} source=${source}`);
  try {
    const extraction = await runLiveTikTokExtractor(normalizedUrl);
    log(`Starting database sync for ${extraction.venues.length} venue(s)`);
    const chroma = await upsertVenuesInChroma(extraction.venues);
    log(
      `Database sync finished: enabled=${chroma.enabled}, collection=${chroma.collection ?? "none"}, added=${chroma.addedIds.length}, updated=${chroma.updatedIds.length}`,
    );

    const result = {
      ...extraction,
      database: {
        enabled: chroma.enabled,
        collection: chroma.collection,
        addedCount: chroma.addedIds.length,
        updatedCount: chroma.updatedIds.length,
        addedIds: chroma.addedIds,
        updatedIds: chroma.updatedIds,
      },
    };

    await recordIngestEvent({
      source,
      inputUrl: normalizedUrl,
      venueCount: result.venues.length,
      addedCount: result.database.addedCount,
      updatedCount: result.database.updatedCount,
      success: true,
      error: null,
      venues: result.venues,
    });

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown ingest failure";
    await recordIngestEvent({
      source,
      inputUrl: normalizedUrl,
      venueCount: 0,
      addedCount: 0,
      updatedCount: 0,
      success: false,
      error: message,
      venues: [],
    });
    throw error;
  }
}
