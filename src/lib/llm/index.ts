import "server-only";
import { spawnSync } from "node:child_process";
import { claudeCliProvider } from "./claude-cli";
import { anthropicApiProvider } from "./anthropic-api";
import { geminiProvider } from "./gemini";
import { GROQ, OPENAI_COMPAT, openAiCompatibleProvider } from "./openai-compatible";

import { LlmUnavailableError, type LlmProvider, type LlmRequest } from "./types";
export * from "./types";

type ProviderName = "claude-cli" | "anthropic" | "gemini" | "groq" | "openai" | "none";
const ALL: ProviderName[] = ["claude-cli", "anthropic", "gemini", "groq", "openai", "none"];

const PROVIDERS: Record<Exclude<ProviderName, "none">, { provider: LlmProvider; keyEnv?: string; label: string }> = {
  "claude-cli": { provider: claudeCliProvider, label: "Claude (local)" },
  anthropic: { provider: anthropicApiProvider, keyEnv: "ANTHROPIC_API_KEY", label: "Claude (API)" },
  gemini: { provider: geminiProvider, keyEnv: "GEMINI_API_KEY", label: "Gemini" },
  groq: { provider: openAiCompatibleProvider(GROQ), keyEnv: "GROQ_API_KEY", label: "Groq" },
  openai: { provider: openAiCompatibleProvider(OPENAI_COMPAT), keyEnv: "OPENAI_API_KEY", label: "OpenAI-compatible" },
};

/**
 * Provider order. LLM_PROVIDER can be one name or a comma-separated fallback chain, e.g. "gemini,groq":
 * claude-cli (local Claude Code subscription) | anthropic | gemini | groq | openai (OPENAI_BASE_URL) | none.
 * When unset: every provider whose API key is set, in the order anthropic, gemini, groq, openai; else the local CLI.
 */
export function providerChain(): ProviderName[] {
  const explicit = (process.env.LLM_PROVIDER ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is ProviderName => (ALL as string[]).includes(s));
  if (explicit.includes("none")) return ["none"];
  if (explicit.length) return explicit;
  const keyed = (["anthropic", "gemini", "groq", "openai"] as const).filter((p) => !!process.env[PROVIDERS[p].keyEnv!]);
  return keyed.length ? [...keyed] : ["claude-cli"];
}

/** First provider of the chain (kept for callers/logs). */
export function providerName(): ProviderName {
  return providerChain()[0];
}

const usable = (p: ProviderName) => p !== "none" && (!PROVIDERS[p].keyEnv || !!process.env[PROVIDERS[p].keyEnv!]);

/** Tries each provider in the chain; quota (429), outages and bad answers fall through to the next one. */
const chainProvider: LlmProvider = {
  name: "chain",
  async complete<T>(req: LlmRequest<T>): Promise<T> {
    const chain = providerChain().filter(usable);
    if (!chain.length) throw new LlmUnavailableError("La IA está desactivada o no hay ninguna clave configurada.");
    const errors: string[] = [];
    for (const name of chain) {
      try {
        return await PROVIDERS[name as Exclude<ProviderName, "none">].provider.complete(req);
      } catch (e) {
        errors.push(`${PROVIDERS[name as Exclude<ProviderName, "none">].label}: ${(e as Error).message.slice(0, 200)}`);
        console.warn(`[llm] ${name} failed, trying next`, (e as Error).message.slice(0, 200));
      }
    }
    throw new Error(errors.join(" · "));
  },
};

export function getLlm(): LlmProvider {
  return chainProvider;
}

export function llmEnabled() {
  return llmStatus().available;
}

export interface LlmStatus {
  provider: ProviderName;
  chain: ProviderName[];
  available: boolean;
  label: string;
  warning?: string;
}

let cliCheck: { at: number; ok: boolean } | null = null;
function cliInstalled() {
  if (!cliCheck || Date.now() - cliCheck.at > 5 * 60_000) {
    const r = spawnSync("claude", ["--version"], { windowsHide: true, timeout: 10_000 });
    cliCheck = { at: Date.now(), ok: r.status === 0 };
  }
  return cliCheck.ok;
}

/** Cheap availability check (no LLM call): are the keys set / is the CLI installed. */
export function llmStatus(): LlmStatus {
  const chain = providerChain();
  if (chain[0] === "none")
    return { provider: "none", chain, available: false, label: "IA desactivada", warning: "La IA está desactivada: todo funciona a mano y «Generar» usa reglas e historial." };
  const ok = chain.filter((p) => (p === "claude-cli" ? cliInstalled() : usable(p)));
  if (!ok.length) {
    const missing = chain.map((p) => (p === "claude-cli" ? "Claude Code no está instalado en esta computadora" : `falta ${PROVIDERS[p as Exclude<ProviderName, "none">].keyEnv}`));
    return {
      provider: chain[0],
      chain,
      available: false,
      label: "IA no disponible",
      warning: `IA no disponible (${missing.join("; ")}). La app funciona sin IA; agrega GEMINI_API_KEY o GROQ_API_KEY para activarla.`,
    };
  }
  return { provider: ok[0], chain: ok, available: true, label: `IA: ${ok.map((p) => PROVIDERS[p as Exclude<ProviderName, "none">].label).join(" → ")}` };
}
