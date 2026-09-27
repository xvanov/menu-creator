import "server-only";
import { spawn } from "node:child_process";
import { z } from "zod";
import { LlmUnavailableError, type LlmProvider, type LlmRequest } from "./types";

const MODELS = { fast: "haiku", smart: "sonnet" } as const;
const TIMEOUT_MS = 180_000;

function run(args: string[], input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // literal command: a dynamic one makes Next's output tracing copy the whole project
    const child = spawn("claude", args, { windowsHide: true });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("claude CLI timeout"));
    }, TIMEOUT_MS);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new LlmUnavailableError(`No se pudo ejecutar claude CLI: ${e.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`claude CLI salió con código ${code}: ${err || out}`.slice(0, 2000)));
    });
    child.stdin.end(input);
  });
}

/** Runs `claude -p` headless with no tools and a JSON schema for structured output. */
export const claudeCliProvider: LlmProvider = {
  name: "claude-cli",
  async complete<T>(req: LlmRequest<T>): Promise<T> {
    // the CLI's validator doesn't know the draft-2020-12 meta-schema URI zod emits
    const { $schema: _, ...jsonSchema } = z.toJSONSchema(req.schema);
    void _;
    const args = [
      "-p",
      "--output-format", "json",
      "--json-schema", JSON.stringify(jsonSchema),
      "--tools", "",
      "--no-session-persistence",
      "--model", MODELS[req.tier ?? "smart"],
      "--system-prompt", req.system,
    ];
    const raw = await run(args, req.prompt);
    const envelope = JSON.parse(raw) as { result?: string; structured_output?: unknown; is_error?: boolean };
    if (envelope.is_error) throw new Error(`claude CLI error: ${envelope.result}`);
    const payload = envelope.structured_output ?? extractJson(envelope.result ?? "");
    return req.schema.parse(payload);
  },
};

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  return JSON.parse(body);
}
