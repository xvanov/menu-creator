import { connection } from "next/server";
import { llmStatus } from "@/lib/llm";

/** Header badge + a warning strip when an AI provider is configured but not usable. */
export async function AiStatus() {
  await connection(); // evaluate per request, not at build time
  const s = llmStatus();
  return (
    <>
      <span
        title={s.warning ?? s.label}
        className={`font-heading text-xs font-semibold uppercase tracking-wider ${s.available ? "text-gold" : "text-paper/70"}`}
      >
        {s.label}
      </span>
      {!s.available && s.provider !== "none" && s.warning && (
        <div className="fixed inset-x-0 bottom-0 z-40 bg-yellow px-4 py-1.5 text-center text-xs text-ink" role="status">
          {s.warning}
        </div>
      )}
    </>
  );
}
