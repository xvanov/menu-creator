import "server-only";
import { z } from "zod";
import { LlmUnavailableError, type LlmProvider, type LlmRequest } from "./types";

function withoutMetaSchema(s: Record<string, unknown>) {
  const { $schema: _, ...rest } = s;
  void _;
  return rest;
}

const MODELS ={ fast: "claude-haiku-4-5", smart: "claude-sonnet-5" } as const;

/**
 * Future provider for deployments (Vercel), where the Claude Code CLI is not available.
 * Plain fetch against the Messages API with a forced tool call for structured output, so no SDK is needed.
 */
export const anthropicApiProvider: LlmProvider = {
  name: "anthropic",
  async complete<T>(req: LlmRequest<T>): Promise<T> {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new LlmUnavailableError("Falta ANTHROPIC_API_KEY");
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL ?? MODELS[req.tier ?? "smart"],
        max_tokens: 8000,
        system: req.system,
        messages: [{ role: "user", content: req.prompt }],
        tools: [{ name: "respond", description: "Devuelve la respuesta estructurada", input_schema: withoutMetaSchema(z.toJSONSchema(req.schema)) }],
        tool_choice: { type: "tool", name: "respond" },
      }),
    });
    if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as { content: { type: string; input?: unknown }[] };
    const call = body.content.find((c) => c.type === "tool_use");
    return req.schema.parse(call?.input);
  },
};
