import { google } from "@ai-sdk/google";
import { groq } from "@ai-sdk/groq";

/**
 * Returns the configured AI model.
 * Set AI_PROVIDER=groq and GROQ_API_KEY in .env.local to use Groq.
 * Defaults to Google Gemini.
 */
export function getModel() {
  const provider = process.env.AI_PROVIDER ?? "google";

  if (provider === "groq") {
    const modelId = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
    return groq(modelId);
  }

  const modelId = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite-preview";
  return google(modelId);
}
