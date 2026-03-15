import { createPublicKey, verify } from "node:crypto";

import { NextResponse } from "next/server";

import { ingestTikTokUrl } from "@/lib/server/tiktok-ingest";

export const runtime = "nodejs";
export const maxDuration = 180;

const DISCORD_API_BASE = "https://discord.com/api/v10";
const PING = 1;
const APPLICATION_COMMAND = 2;
const PONG = 1;
const DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE = 5;
const EPHEMERAL_FLAG = 64;

type DiscordCommandOption = {
  name: string;
  value?: string;
};

type DiscordInteraction = {
  id: string;
  token: string;
  type: number;
  data?: {
    name?: string;
    options?: DiscordCommandOption[];
  };
};

function getDiscordPublicKey() {
  const key = process.env.DISCORD_PUBLIC_KEY?.trim() ?? "";
  if (!key) {
    throw new Error("Missing DISCORD_PUBLIC_KEY");
  }
  return key;
}

function getDiscordApplicationId() {
  const applicationId = process.env.DISCORD_APPLICATION_ID?.trim() ?? "";
  if (!applicationId) {
    throw new Error("Missing DISCORD_APPLICATION_ID");
  }
  return applicationId;
}

function ed25519PublicKeyFromHex(hex: string) {
  const raw = Buffer.from(hex, "hex");
  const prefix = Buffer.from("302a300506032b6570032100", "hex");
  return createPublicKey({
    key: Buffer.concat([prefix, raw]),
    format: "der",
    type: "spki",
  });
}

function verifyDiscordRequest(signature: string, timestamp: string, body: string) {
  const publicKey = ed25519PublicKeyFromHex(getDiscordPublicKey());
  return verify(
    null,
    Buffer.from(timestamp + body),
    publicKey,
    Buffer.from(signature, "hex"),
  );
}

function getCommandOption(interaction: DiscordInteraction, name: string) {
  return interaction.data?.options?.find((option) => option.name === name)?.value ?? "";
}

async function sendDiscordFollowup(interaction: DiscordInteraction, content: string) {
  const applicationId = getDiscordApplicationId();
  await fetch(`${DISCORD_API_BASE}/webhooks/${applicationId}/${interaction.token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content,
      flags: EPHEMERAL_FLAG,
    }),
  });
}

async function processDiscordCommand(interaction: DiscordInteraction) {
  const commandName = interaction.data?.name ?? "";
  if (commandName !== "ingest-tiktok") {
    await sendDiscordFollowup(interaction, `Unsupported command: ${commandName}`);
    return;
  }

  const url = String(getCommandOption(interaction, "url") || "").trim();
  if (!url) {
    await sendDiscordFollowup(interaction, "Missing TikTok URL.");
    return;
  }

  try {
    const result = await ingestTikTokUrl(url, "discord_command");
    const venueCount = result.venues.length;
    const message =
      venueCount === 0
        ? "I checked that TikTok but did not get a usable Melbourne venue from it."
        : `Found ${venueCount} venue${venueCount === 1 ? "" : "s"} from that TikTok. `
            + `DB sync: ${result.database.addedCount} added, ${result.database.updatedCount} updated.`;
    await sendDiscordFollowup(interaction, message);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown ingest failure";
    await sendDiscordFollowup(interaction, `TikTok ingest failed: ${message}`);
  }
}

export async function POST(request: Request) {
  const signature = request.headers.get("x-signature-ed25519") ?? "";
  const timestamp = request.headers.get("x-signature-timestamp") ?? "";
  const body = await request.text();

  if (!signature || !timestamp || !verifyDiscordRequest(signature, timestamp, body)) {
    return new NextResponse("invalid request signature", { status: 401 });
  }

  const interaction = JSON.parse(body) as DiscordInteraction;

  if (interaction.type === PING) {
    return NextResponse.json({ type: PONG });
  }

  if (interaction.type === APPLICATION_COMMAND) {
    void processDiscordCommand(interaction);
    return NextResponse.json({
      type: DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        flags: EPHEMERAL_FLAG,
      },
    });
  }

  return NextResponse.json({
    type: 4,
    data: {
      flags: EPHEMERAL_FLAG,
      content: "Unsupported Discord interaction type.",
    },
  });
}
