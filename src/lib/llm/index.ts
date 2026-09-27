import "server-only";
import { spawnSync } from "node:child_process";
import { claudeCliProvider } from "./claude-cli";
import { anthropicApiProvider } from "./anthropic-api";
import { geminiProvider } from "./gemini";

import { LlmUnavailableError, type LlmProvider } from "./types";
export * from "./types";

const noLlmProvider: LlmProvider = {
  name: "none",
  async complete() {
    throw new LlmUnavailableError("La IA está desactivada (LLM_PROVIDER=none)");
  },
};

type ProviderName = "claude-cli" | "anthropic" | "gemini" | "none";

/**
 * LLM_PROVIDER picks explicitly: claude-cli (local Claude Code subscription) | anthropic (ANTHROPIC_API_KEY)
 * | gemini (GEMINI_API_KEY, has a free tier) | none. When unset: an API key that is present wins
 * (Anthropic, then Gemini), else the local Claude Code CLI. Every caller must handle LlmUnavailableError.
 */
export function providerName(): ProviderName {
  const explicit = process.env.LLM_PROVIDER as ProviderName | undefined;
  if (explicit && ["claude-cli", "anthropic", "gemini", "none"].includes(explicit)) return explicit;
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.GEMINI_API_KEY) return "gemini";
  return "claude-cli";
}

export function getLlm(): LlmProvider {
  switch (providerName()) {
    case "anthropic":
      return anthropicApiProvider;
    case "gemini":
      return geminiProvider;
    case "none":
      return noLlmProvider;
    default:
      return claudeCliProvider;
  }
}

export function llmEnabled() {
  return llmStatus().available;
}

export interface LlmStatus {
  provider: ProviderName;
  available: boolean;
  label: string;
  warning?: string;
}

let cliCheck: { at: number; ok: boolean } | null = null;

/** Cheap availability check (no LLM call): is the key set / is the CLI installed. */
export function llmStatus(): LlmStatus {
  const provider = providerName();
  switch (provider) {
    case "none":
      return { provider, available: false, label: "IA desactivada", warning: "La IA está desactivada: todo funciona a mano y «Generar» usa reglas e historial." };
    case "anthropic":
      return process.env.ANTHROPIC_API_KEY
        ? { provider, available: true, label: "IA: Claude (API)" }
        : { provider, available: false, label: "IA no disponible", warning: "Falta ANTHROPIC_API_KEY." };
    case "gemini":
      return process.env.GEMINI_API_KEY
        ? { provider, available: true, label: "IA: Gemini" }
        : { provider, available: false, label: "IA no disponible", warning: "Falta GEMINI_API_KEY." };
    default: {
      if (!cliCheck || Date.now() - cliCheck.at > 5 * 60_000) {
        const r = spawnSync("claude", ["--version"], { windowsHide: true, timeout: 10_000 });
        cliCheck = { at: Date.now(), ok: r.status === 0 };
      }
      return cliCheck.ok
        ? { provider, available: true, label: "IA: Claude (local)" }
        : {
            provider,
            available: false,
            label: "IA no disponible",
            warning: "No se encontró Claude Code en esta computadora. La app funciona sin IA; para activarla instala Claude Code o pon GEMINI_API_KEY en .env.local.",
          };
    }
  }
}
