import Anthropic from "@anthropic-ai/sdk";

const anthropicClient = new Anthropic({
  apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY ?? "missing-anthropic-api-key",
  baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL ?? "http://127.0.0.1:9",
});

type Message = { role: "user" | "assistant"; content: string };
type AnthropicLikeRequest = {
  model: string;
  max_tokens?: number;
  system?: string;
  messages: Message[];
};

async function createOpenAiMessage(request: AnthropicLikeRequest) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

  const model = process.env.OPENAI_MODEL || "gpt-4.1";
  const messages = [
    ...(request.system ? [{ role: "system", content: request.system }] : []),
    ...request.messages.map((message) => ({ role: message.role, content: message.content })),
  ];

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.35,
      max_tokens: request.max_tokens ?? 4096,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`OpenAI request failed (${response.status}): ${detail.slice(0, 500)}`);
  }

  const data = await response.json() as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  const text = data.choices?.[0]?.message?.content ?? "{}";
  return { content: [{ type: "text", text }] };
}

export const anthropic = {
	messages: {
    create(request: AnthropicLikeRequest) {
      if (process.env.OPENAI_API_KEY) return createOpenAiMessage(request);
      return anthropicClient.messages.create({
        ...request,
        max_tokens: request.max_tokens ?? 4096,
      });
    },
  },
};
