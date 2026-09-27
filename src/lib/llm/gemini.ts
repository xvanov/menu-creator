import "server-only";
import { z } from "zod";
import { LlmUnavailableError, type LlmProvider, type LlmRequest } from "./types";

// Free-tier eligible (Google AI Studio key). Override with GEMINI_MODEL / GEMINI_MODEL_FAST.
const MODELS = { fast: "gemini-3.5-flash-lite", smart: "gemini-3.8-flash" } as const;

/** Keywords Gemini's JSON-schema subset doesn't accept. */
function clean(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(clean);
  if (!schema || typeof schema !== "object") return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema)) if (k !== "$schema") out[k] = clean(v);
  return out;
}

/** Google Gemini via REST (generateContent + responseJsonSchema). Retries 429/5xx with backoff. */
export const geminiProvider: LlmProvider = {
  name: "gemini",
  async complete<T>(req: LlmRequest<T>): Promise<T> {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new LlmUnavailableError("Falta GEMINI_API_KEY");
    const fast = process.env.GEMINI_MODEL_FAST ?? MODELS.fast;
    let model = req.tier === "fast" ? fast : (process.env.GEMINI_MODEL ?? MODELS.smart);
    const body = JSON.stringify({
      systemInstruction: { parts: [{ text: req.system }] },
      contents: [{ role: "user", parts: [{ text: req.prompt }] }],
      generationConfig: { responseMimeType: "application/json", responseJsonSchema: clean(z.toJSONSchema(req.schema)), temperature: 0.4 },
    });
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body,
      });
      // quota on the bigger model: switch to flash-lite (much higher free limits) instead of waiting
      if (res.status === 429 && model !== fast) {
        model = fast;
        continue;
      }
      if ((res.status === 429 || res.status >= 500) && attempt < 2) {
        await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
        continue;
      }
      if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 500)}`);
      const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
      return req.schema.parse(JSON.parse(text));
    }
  },
};
