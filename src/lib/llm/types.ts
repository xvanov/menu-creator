import type { z } from "zod";

export interface LlmRequest<T> {
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  /** "fast" for parsing/small edits, "smart" for menu generation. */
  tier?: "fast" | "smart";
}

export interface LlmProvider {
  name: string;
  complete<T>(req: LlmRequest<T>): Promise<T>;
}

export class LlmUnavailableError extends Error {}
