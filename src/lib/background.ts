import "server-only";
import { after } from "next/server";

/**
 * BACKGROUND_INLINE=1 runs "after the response" work inside the request instead. Needed on Cloud Run with
 * request-based billing (the $0 tier), where an instance gets no CPU once the response is sent.
 */
export const inlineBackground = () => process.env.BACKGROUND_INLINE === "1";

/** Runs `work` after the response (default) or before returning (inline mode). Never throws. */
export async function runLater(work: () => Promise<unknown>): Promise<void> {
  const safe = () => work().catch((e) => console.error("[background]", e));
  if (inlineBackground()) {
    await safe();
    return;
  }
  try {
    after(safe);
  } catch {
    void safe(); // outside a request (cron/scripts)
  }
}
