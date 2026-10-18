import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { expect, it, vi } from "vitest";
import { createAuthStore } from "./store";
import { revokeUserAuthorization } from "./revoke";
import { seal } from "./crypto";

it.each(["success", "provider-failure", "cleared-grant"])("persists an unlinked deletion audit after %s", async scenario => {
  const folder = mkdtempSync(join(tmpdir(), "papertrail-delete-audit-"));
  const filename = join(folder, "synthetic.sqlite");
  const store = createAuthStore(filename);
  const config = { key: "ab".repeat(32), clientId: "synthetic", clientSecret: "synthetic", origin: "http://localhost:3000",
    redirectUri: "http://localhost:3000/api/auth/callback", secure: false };
  let closed = false;
  try {
    const id = store.save("synthetic@example.test", seal({ accessToken: "synthetic-access", refreshToken: "synthetic-refresh",
      expiresAt: Date.now() + 10000 }, config.key, "tokens"));
    const other = store.save("other@example.test", "synthetic-encrypted");
    store.audit("oauth.connected", id);
    store.audit("oauth.connected", other);
    if (scenario === "cleared-grant") store.update(id, null);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: scenario === "provider-failure" ? 503 : 200 }));
    await revokeUserAuthorization(id, config, store, fetcher);
    expect(store.find(id)).toBeUndefined();
    expect(store.find(other)).toBeDefined();
    store.close(); closed = true;
    // Reopen from disk to verify persistent, not merely in-memory, audit state.
    const reopened = new Database(filename, { readonly: true });
    try {
      const deletion = reopened.prepare("SELECT action,subject_id,meta_json FROM audit WHERE action='oauth.deleted'").all();
      expect(deletion).toEqual([{ action: "oauth.deleted", subject_id: null, meta_json: "{}" }]);
      expect(JSON.stringify(deletion)).not.toContain(id);
      expect(JSON.stringify(deletion)).not.toContain("synthetic-refresh");
      expect(reopened.prepare("SELECT id FROM audit WHERE subject_id=?").all(id)).toEqual([]);
      expect(reopened.prepare("SELECT id FROM audit WHERE subject_id=?").all(other)).toHaveLength(1);
    } finally { reopened.close(); }
  } finally { if (!closed) store.close(); rmSync(folder, { recursive: true, force: true }); }
});
