import "server-only";
import { z } from "zod";
import { LlmUnavailableError, type LlmProvider, type LlmRequest } from "./types";

interface Preset {
  name: string;
  keyEnv: string;
  baseUrl: string;
  models: { fast: string; smart: string };
}

/** Groq: free tier (no card), ~1,000 requests/day on most models. */
export const GROQ: Preset = {
  name: "groq",
  keyEnv: "GROQ_API_KEY",
  baseUrl: "https://api.groq.com/openai/v1",
  models: { fast: "openai/gpt-oss-20b", smart: "openai/gpt-oss-120b" },
};

/** Any other OpenAI-compatible API (OpenRouter, Mistral, DeepSeek, OpenAI…): OPENAI_BASE_URL, OPENAI_API_KEY, OPENAI_MODEL. */
export const OPENAI_COMPAT: Preset = {
  name: "openai",
  keyEnv: "OPENAI_API_KEY",
  baseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
  models: { fast: process.env.OPENAI_MODEL_FAST ?? process.env.OPENAI_MODEL ?? "gpt-4o-mini", smart: process.env.OPENAI_MODEL ?? "gpt-4o-mini" },
};

function strip(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(strip);
  if (!schema || typeof schema !== "object") return schema;
  return Object.fromEntries(Object.entries(schema).filter(([k]) => k !== "$schema").map(([k, v]) => [k, strip(v)]));
}

/** Chat Completions with response_format json_schema (non-strict: our schemas have optional fields); zod validates. */
export function openAiCompatibleProvider(p: Preset): LlmProvider {
  return {
    name: p.name,
    async complete<T>(req: LlmRequest<T>): Promise<T> {
      const key = process.env[p.keyEnv];
      if (!key) throw new LlmUnavailableError(`Falta ${p.keyEnv}`);
      const model = p.name === "groq" ? (process.env[`GROQ_MODEL${req.tier === "fast" ? "_FAST" : ""}`] ?? p.models[req.tier ?? "smart"]) : p.models[req.tier ?? "smart"];
      const body = JSON.stringify({
        model,
        temperature: 0.4,
        messages: [
          { role: "system", content: `${req.system}\nResponde solo con un objeto JSON que cumpla el esquema.` },
          { role: "user", content: req.prompt },
        ],
        response_format: { type: "json_schema", json_schema: { name: "respuesta", strict: false, schema: strip(z.toJSONSchema(req.schema)) } },
      });
      for (let attempt = 0; ; attempt++) {
        const res = await fetch(`${p.baseUrl}/chat/completions`, {
          method: "POST",
          headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
          body,
        });
        if ((res.status === 429 || res.status >= 500) && attempt < 2) {
          const wait = Number(res.headers.get("retry-after")) || 3 * 2 ** attempt;
          await new Promise((r) => setTimeout(r, Math.min(wait, 20) * 1000));
          continue;
        }
        if (!res.ok) throw new Error(`${p.name} ${res.status}: ${(await res.text()).slice(0, 400)}`);
        const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
        const text = data.choices?.[0]?.message?.content ?? "";
        const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
        return req.schema.parse(JSON.parse(json));
      }
    },
  };
}
