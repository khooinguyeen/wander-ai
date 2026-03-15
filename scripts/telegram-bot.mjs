import { config } from "dotenv";

config({ path: ".env.local" });
config();

const TELEGRAM_API_BASE = "https://api.telegram.org";

const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
const appBaseUrl = (process.env.APP_BASE_URL?.trim() || "http://localhost:3000").replace(/\/$/, "");

if (!botToken) {
  console.error("Missing TELEGRAM_BOT_TOKEN");
  process.exit(1);
}

function telegramUrl(path) {
  return `${TELEGRAM_API_BASE}/bot${botToken}/${path}`;
}

function log(message) {
  const timestamp = new Date().toISOString();
  console.log(`[telegram-bot ${timestamp}] ${message}`);
}

function normalizeTikTokUrl(url) {
  return url.trim().replace(/[)\].,!?]+$/, "");
}

function extractTikTokUrls(text) {
  const matches = text.match(/https?:\/\/(?:[\w-]+\.)?tiktok\.com\/[^\s]+/gi) || [];
  return [...new Set(matches.map(normalizeTikTokUrl))];
}

async function telegramRequest(method, body = undefined) {
  const response = await fetch(telegramUrl(method), {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(payload.description || `Telegram ${method} failed`);
  }
  return payload.result;
}

async function sendTelegramMessage(chatId, text) {
  const limit = 3500;
  const normalized = String(text || "").trim() || "(empty message)";
  const chunks = [];

  for (let start = 0; start < normalized.length; start += limit) {
    chunks.push(normalized.slice(start, start + limit));
  }

  for (const chunk of chunks) {
    log(`Sending Telegram reply to chat ${chatId} (${chunk.length} chars)`);
    await telegramRequest("sendMessage", {
      chat_id: chatId,
      text: chunk,
      disable_web_page_preview: true,
    });
  }
}

async function ingestTikTok(url) {
  log(`Calling app ingest endpoint for URL: ${url}`);
  const response = await fetch(`${appBaseUrl}/api/ingest/tiktok`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, source: "telegram_bot" }),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error || "TikTok ingest failed");
  }
  log(
    `App ingest completed: venues=${payload.venues?.length ?? 0}, added=${payload.database?.addedCount ?? 0}, updated=${payload.database?.updatedCount ?? 0}`,
  );
  return payload;
}

function messageText(update) {
  return update.message?.text || update.message?.caption || "";
}

async function handleUpdate(update) {
  const chatId = update.message?.chat?.id;
  const text = messageText(update);
  log(`Received update ${update.update_id ?? "unknown"} chat=${chatId ?? "unknown"} textLength=${text.length}`);
  if (!chatId || !text) {
    log("Skipping update without chat/text");
    return;
  }

  const tiktokUrls = extractTikTokUrls(text);
  if (tiktokUrls.length === 0) {
    log(`No TikTok URL found in chat ${chatId}`);
    return;
  }
  const tiktokUrl = tiktokUrls[0];
  log(`Detected ${tiktokUrls.length} unique TikTok URL(s) in chat ${chatId}`);
  log(`TikTok URL detected for chat ${chatId}: ${tiktokUrl}`);

  try {
    await sendTelegramMessage(
      chatId,
      "Checking that TikTok, extracting venue clues, and sending them to the app.",
    );

    const result = await ingestTikTok(tiktokUrl);
    const venueCount = result.venues?.length ?? 0;
    const reply =
      venueCount === 0
        ? "I checked that TikTok but did not get a usable Melbourne venue from it."
        : `Found ${venueCount} venue${venueCount === 1 ? "" : "s"} from that TikTok. `
            + `DB sync: ${result.database.addedCount} added, ${result.database.updatedCount} updated.`;

    await sendTelegramMessage(chatId, reply);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown ingest failure";
    await sendTelegramMessage(chatId, `TikTok ingest failed: ${message}`);
  }
}

async function main() {
  let offset = 0;
  log("Telegram bot polling started");

  while (true) {
    try {
      log(`Polling Telegram updates with offset=${offset}`);
      const updates = await telegramRequest("getUpdates", {
        timeout: 30,
        offset,
      });
      log(`Telegram returned ${updates.length} update(s)`);

      for (const update of updates) {
        offset = Math.max(offset, (update.update_id ?? 0) + 1);
        await handleUpdate(update);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown Telegram polling failure";
      log(`Telegram bot error: ${message}`);
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
