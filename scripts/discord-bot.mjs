import { config } from "dotenv";

config({ path: ".env.local" });
config();

const DISCORD_API_BASE = "https://discord.com/api/v10";
const GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json";
const INTENTS = (1 << 0) | (1 << 9) | (1 << 12);

const botToken = process.env.DISCORD_BOT_TOKEN?.trim();
const appBaseUrl = (process.env.APP_BASE_URL?.trim() || "http://localhost:3000").replace(/\/$/, "");

if (!botToken) {
  console.error("Missing DISCORD_BOT_TOKEN");
  process.exit(1);
}

function extractTikTokUrl(text) {
  const match = text.match(/https?:\/\/(?:www\.)?tiktok\.com\/[^\s]+/i);
  return match ? match[0] : null;
}

async function postDiscordMessage(channelId, content) {
  const response = await fetch(`${DISCORD_API_BASE}/channels/${channelId}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bot ${botToken}`,
    },
    body: JSON.stringify({ content }),
  });

  if (!response.ok) {
    const payload = await response.text();
    throw new Error(`Discord send failed: ${payload}`);
  }
}

async function ingestTikTok(url) {
  const response = await fetch(`${appBaseUrl}/api/ingest/tiktok`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, source: "discord_bot" }),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error || "TikTok ingest failed");
  }
  return payload;
}

async function handleMessage(event, botUserId) {
  if (!event || event.author?.bot) {
    return;
  }

  const content = event.content || "";
  const isDm = event.guild_id == null;
  const mentionsBot = Array.isArray(event.mentions)
    && event.mentions.some((mention) => mention.id === botUserId);

  if (!isDm && !mentionsBot) {
    return;
  }

  const tiktokUrl = extractTikTokUrl(content);
  if (!tiktokUrl) {
    return;
  }

  try {
    await postDiscordMessage(
      event.channel_id,
      "Checking that TikTok, extracting venue clues, and sending them to the app.",
    );

    const result = await ingestTikTok(tiktokUrl);
    const venueCount = result.venues?.length ?? 0;
    const message =
      venueCount === 0
        ? "I checked that TikTok but did not get a usable Melbourne venue from it."
        : `Found ${venueCount} venue${venueCount === 1 ? "" : "s"} from that TikTok. `
            + `DB sync: ${result.database.addedCount} added, ${result.database.updatedCount} updated.`;
    await postDiscordMessage(event.channel_id, message);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown ingest failure";
    await postDiscordMessage(event.channel_id, `TikTok ingest failed: ${message}`);
  }
}

function startHeartbeat(ws, intervalMs) {
  return setInterval(() => {
    ws.send(JSON.stringify({ op: 1, d: null }));
  }, intervalMs);
}

const ws = new WebSocket(GATEWAY_URL);
let heartbeatTimer = null;
let sessionBotUserId = "";

ws.addEventListener("message", async (messageEvent) => {
  const payload = JSON.parse(messageEvent.data);

  if (payload.op === 10) {
    heartbeatTimer = startHeartbeat(ws, payload.d.heartbeat_interval);
    ws.send(
      JSON.stringify({
        op: 2,
        d: {
          token: botToken,
          intents: INTENTS,
          properties: {
            os: process.platform,
            browser: "wander-ai",
            device: "wander-ai",
          },
        },
      }),
    );
    return;
  }

  if (payload.op === 11) {
    return;
  }

  if (payload.t === "READY") {
    sessionBotUserId = payload.d.user.id;
    console.log(`Discord bot connected as ${payload.d.user.username}`);
    return;
  }

  if (payload.t === "MESSAGE_CREATE") {
    await handleMessage(payload.d, sessionBotUserId);
  }
});

ws.addEventListener("close", (event) => {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
  }
  console.error(`Discord gateway closed: ${event.code} ${event.reason}`);
  process.exit(1);
});

ws.addEventListener("error", (error) => {
  console.error("Discord gateway error", error);
});
