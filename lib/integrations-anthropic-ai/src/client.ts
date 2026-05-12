import Anthropic from "@anthropic-ai/sdk";

export const anthropic = new Anthropic({
  apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY ?? "missing-anthropic-api-key",
  baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL ?? "http://127.0.0.1:9",
});
