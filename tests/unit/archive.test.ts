import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { fixtureSequence } from "../../src/lib/fixtures";
const mock = vi.hoisted(() => ({ paths: new Set<string>(), deleted: new Set<string>(), order: [] as string[] }));
vi.mock("@huggingface/hub", () => ({
  async *listFiles({ path }: { path: string }) {
    if (path === "clips") {
      yield { type: "directory", path: "clips/NOI0001/" };
      yield { type: "directory", path: "clips/NOI0002" };
      yield { type: "directory", path: "clips/unrelated" };
    } else for (const p of mock.paths) if (p.startsWith(path + "/")) yield { type: "file", path: p, size: 100 };
  },
  async downloadFile({ path }: { path: string }) { return mock.deleted.has(path) ? new Blob(["{}"]) : null; },
  async uploadFiles({ files }: { files: { path: string }[] }) {
    for (const f of files) { mock.order.push("write:" + f.path); if (f.path.startsWith("deleted/")) mock.deleted.add(f.path); else mock.paths.add(f.path); }
  },
  async deleteFiles({ paths }: { paths: string[] }) { paths.forEach(p => { mock.order.push("delete:" + p); mock.paths.delete(p); }); },
}));
import archive from "../../api/archive";
const code = "x".repeat(43);
const headers = { authorization: "Bearer " + code, origin: "https://noi.example" };
beforeEach(() => {
  mock.paths.clear(); mock.deleted.clear(); mock.order.length = 0;
  vi.stubEnv("NOI_CLOUD_KEY_SHA256", createHash("sha256").update(code).digest("hex"));
  vi.stubEnv("NOI_HF_ACCESS_TOKEN", "test-only"); vi.stubEnv("NOI_HF_BUCKET", "test/only");
});
describe("private archive inventory and deletion", () => {
  it("requires authentication and returns only label folders", async () => {
    expect((await archive.fetch(new Request("https://noi.example/api/archive?action=inventory"))).status).toBe(401);
    const response = await archive.fetch(new Request("https://noi.example/api/archive?action=inventory", { headers }));
    expect(await response.json()).toEqual({ labels: ["NOI0001", "NOI0002"] });
  });
  it("records deletion before removing a clip, blocks stale uploads, rejects cross-site mutations", async () => {
    mock.paths.add("clips/NOI0001/sample.zip");
    const url = "https://noi.example/api/archive?label=NOI0001&id=sample";
    expect((await archive.fetch(new Request(url, { method: "DELETE", headers: { ...headers, origin: "https://evil.example" } }))).status).toBe(403);
    expect(mock.paths.size).toBe(1);
    expect((await archive.fetch(new Request(url, { method: "DELETE", headers }))).status).toBe(200);
    expect(mock.order).toEqual(["write:deleted/NOI0001/sample.json", "delete:clips/NOI0001/sample.zip"]);
    const form = new FormData();
    form.set("sample", JSON.stringify({ id: "sample", labelId: "NOI0001", label: "tôi", schema: 1,
      sessionId: "test", createdAt: new Date().toISOString(), durationMs: 2950, frames: fixtureSequence() }));
    form.set("video", new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1])], { type: "video/webm" }), "clip.webm");
    expect((await archive.fetch(new Request(url, { method: "POST", headers, body: form }))).status).toBe(410);
    expect(mock.paths.size).toBe(0);
  });
});
