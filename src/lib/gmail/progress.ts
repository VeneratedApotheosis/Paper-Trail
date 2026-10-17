export type GmailWorkProgress = {
  stage: "listing" | "fetching" | "processing";
  fetched: number;
  total: number | null;
  skipped: number;
};
export type GmailSyncProgress = Omit<GmailWorkProgress, "stage"> & {
  stage: GmailWorkProgress["stage"] | "idle" | "complete" | "failed";
};

const idle = (): GmailSyncProgress => ({ stage: "idle", fetched: 0, total: null, skipped: 0 });
const RETENTION_MS = 15 * 60 * 1000;
const MAX_ENTRIES = 1000;

/** Transient telemetry only; never stores message IDs, bodies, tokens, or errors. */
export function createGmailProgressStore(now = Date.now) {
  const entries = new Map<string, { value: GmailSyncProgress; updatedAt: number }>();
  function prune() {
    for (const [id, entry] of entries) {
      if (now() - entry.updatedAt >= RETENTION_MS) entries.delete(id);
    }
  }
  return {
    read(userId: string): GmailSyncProgress {
      prune();
      return { ...(entries.get(userId)?.value ?? idle()) };
    },
    begin(userId: string) {
      prune();
      entries.delete(userId);
      while (entries.size >= MAX_ENTRIES) entries.delete(entries.keys().next().value!);
      const entry = { value: { ...idle(), stage: "listing" } as GmailSyncProgress, updatedAt: now() };
      entries.set(userId, entry);
      const write = (value: GmailSyncProgress) => {
        // A late callback cannot overwrite a later run or resurrect expired data.
        prune();
        if (entries.get(userId) !== entry) return;
        entry.value = { ...value };
        entry.updatedAt = now();
      };
      return {
        update: (value: GmailWorkProgress) => write(value),
        complete: () => write({ ...entry.value, stage: "complete" }),
        fail: () => write({ ...entry.value, stage: "failed" }),
      };
    },
  };
}

// Share telemetry between Next route bundles within one Node process. Other
// processes/instances and restarts have independent state and may report idle.
const processState = globalThis as typeof globalThis & {
  papertrailGmailProgress?: ReturnType<typeof createGmailProgressStore>;
};
export const gmailProgress = processState.papertrailGmailProgress ??= createGmailProgressStore();
