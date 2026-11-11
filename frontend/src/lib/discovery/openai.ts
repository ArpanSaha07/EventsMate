import "server-only";
import OpenAI from "openai";

let client: OpenAI | null = null;

export function getOpenAIClient(): OpenAI {
  if (client) return client;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  client = new OpenAI({ apiKey });
  return client;
}

export function getOpenAIModel(): string {
  // Strip any inline comments or whitespace from .env
  const raw = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
  const cleaned = raw.split("#")[0].trim();
  return cleaned || "gpt-4o-mini";
}

