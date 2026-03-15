import { config } from "dotenv";

config({ path: ".env.local" });
config();

const applicationId = process.env.DISCORD_APPLICATION_ID?.trim();
const botToken = process.env.DISCORD_BOT_TOKEN?.trim();

if (!applicationId) {
  console.error("Missing DISCORD_APPLICATION_ID");
  process.exit(1);
}

if (!botToken) {
  console.error("Missing DISCORD_BOT_TOKEN");
  process.exit(1);
}

const body = {
  name: "ingest-tiktok",
  description: "Scrape a TikTok video for Melbourne venues and ingest them",
  options: [
    {
      type: 3,
      name: "url",
      description: "TikTok video URL",
      required: true,
    },
  ],
  dm_permission: true,
};

const response = await fetch(`https://discord.com/api/v10/applications/${applicationId}/commands`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bot ${botToken}`,
  },
  body: JSON.stringify(body),
});

const payload = await response.text();
if (!response.ok) {
  console.error(payload);
  process.exit(1);
}

console.log(payload);
