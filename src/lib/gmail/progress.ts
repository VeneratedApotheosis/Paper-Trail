/** Promotions-category emails read by the second pass of a sync (#137); `total` is null until its list query answered. */
export type GmailPromotionsProgress = { fetched: number; total: number | null };
export type GmailWorkProgress = {
  stage: "listing" | "fetching" | "processing" | "promotions";
  /** Receipt messages (all stages): during `promotions` they stay at the finished receipt pass's counts. */
  fetched: number;
  total: number | null;
  skipped: number;
  /** Set from the `promotions` stage on (#137); summed over accounts at the top level. */
  promotions?: GmailPromotionsProgress;
};
type GmailSyncStage = GmailWorkProgress["stage"] | "idle" | "complete" | "failed";
/** Progress of one linked Gmail account within a sync (#114). `idle` = waiting for its turn. */
export type GmailAccountProgress = {
  accountId: string;
  mailbox: string | null;
  stage: GmailSyncStage;
  fetched: number;
  total: number | null;
};
/**
 * Top-level fields describe the whole sync: stage of the account being synced, `fetched`/`skipped` summed over
 * accounts, `total` summed once every account knows its own (else null). `accounts` is present only while/after a sync of
 * several accounts reports per account; a single-account sync keeps the plain shape.
 */
export type GmailSyncProgress = Omit<GmailWorkProgress, "stage"> & {
  stage: GmailSyncStage;
  accounts?: GmailAccountProgress[];
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
      const value = entries.get(userId)?.value ?? idle();
      return { ...value, ...(value.accounts ? { accounts: value.accounts.map(account => ({ ...account })) } : {}) };
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
      const work = new Map<string, { mailbox: string | null; stage: GmailSyncStage; fetched: number; total: number | null; skipped: number;
        promotions?: GmailPromotionsProgress }>();
      const active = ["listing", "fetching", "processing", "promotions"];
      const refresh = () => {
        const all = [...work.entries()];
        const current = all.find(([, item]) => active.includes(item.stage));
        const withPromotions = all.filter(([, item]) => item.promotions);
        write({
          stage: current ? current[1].stage : entry.value.stage,
          fetched: all.reduce((sum, [, item]) => sum + item.fetched, 0),
          skipped: all.reduce((sum, [, item]) => sum + item.skipped, 0),
          total: all.some(([, item]) => item.total === null) ? null : all.reduce((sum, [, item]) => sum + (item.total ?? 0), 0),
          ...(withPromotions.length > 0 ? { promotions: {
            fetched: withPromotions.reduce((sum, [, item]) => sum + item.promotions!.fetched, 0),
            total: withPromotions.some(([, item]) => item.promotions!.total === null) ? null
              : withPromotions.reduce((sum, [, item]) => sum + item.promotions!.total!, 0),
          } } : {}),
          accounts: all.map(([accountId, item]) => ({ accountId, mailbox: item.mailbox, stage: item.stage, fetched: item.fetched, total: item.total })),
        });
      };
      return {
        update: (value: GmailWorkProgress) => write(value),
        // The whole run ends complete or failed; per-account state stays as reported.
        complete: () => write({ ...entry.value, stage: "complete" }),
        fail: () => write({ ...entry.value, stage: "failed" }),
        /** Registers one account of a multi-account sync (waiting) and returns its own reporter. */
        forAccount(accountId: string, mailbox: string | null) {
          work.set(accountId, { mailbox, stage: "idle", fetched: 0, total: null, skipped: 0 });
          refresh();
          const set = (patch: Partial<NonNullable<ReturnType<typeof work.get>>>) => {
            work.set(accountId, { ...work.get(accountId)!, ...patch });
            refresh();
          };
          return {
            update: (value: GmailWorkProgress) => set(value),
            complete: () => set({ stage: "complete" }),
            fail: () => set({ stage: "failed" }),
          };
        },
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
