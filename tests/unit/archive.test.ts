import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { fixtureSequence } from "../../src/lib/fixtures";
const mock = vi.hoisted(() => ({ paths: new Set<string>(), deleted: new Set<string>(), order: [] as string[], files: new Map<string, Blob>(), dropWrite: false }));
vi.mock("@huggingface/hub", () => ({
  async *listFiles({ path }: { path: string }) {
    if (path === "clips") {
      yield { type: "directory", path: "clips/NOI0001/" };
      yield { type: "directory", path: "clips/NOI0002" };
      yield { type: "directory", path: "clips/unrelated" };
    } else for (const p of mock.paths) if (p.startsWith(path + "/")) yield { type: "file", path: p, size: 100 };
  },
  async downloadFile({ path }: { path: string }) { return mock.files.get(path) ?? (mock.deleted.has(path) ? new Blob(["{}"]) : null); },
  async uploadFiles({ files }: { files: { path: string; content: Blob }[] }) {
    if (mock.dropWrite) return;
    for (const f of files) { mock.order.push("write:" + f.path); mock.files.set(f.path, f.content); if (f.path.startsWith("deleted/")) mock.deleted.add(f.path); else mock.paths.add(f.path); }
  },
  async deleteFiles({ paths }: { paths: string[] }) { paths.forEach(p => { mock.order.push("delete:" + p); mock.paths.delete(p); mock.files.delete(p); }); },
}));
import archive from "../../api/archive";
const code = "x".repeat(43);
const headers = { authorization: "Bearer " + code, origin: "https://noi.example" };
beforeEach(() => {
  mock.paths.clear(); mock.deleted.clear(); mock.order.length = 0; mock.files.clear(); mock.dropWrite = false;
  vi.stubEnv("NOI_CLOUD_KEY_SHA256", createHash("sha256").update(code).digest("hex"));
  vi.stubEnv("NOI_HF_ACCESS_TOKEN", "test-only"); vi.stubEnv("NOI_HF_BUCKET", "test/only");
});

describe("workspace sync", () => {
  const data = { version: 1, words: [{ id: "NOI_USER_00000000-0000-0000-0000-000000000001", label: "từ riêng" }], graph: { version: 1, extraWords: [], positions: { NOI0001: { x: 10, y: -20 } }, chains: [["NOI0001", "NOI0003"]] } };
  const url = "https://noi.example/api/archive?action=workspace";
  const get = () => archive.fetch(new Request(url, { headers }));
  const post = (id: string, parents: string[] = [], payload: unknown = data) => archive.fetch(new Request(url, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ id, parents, data: payload }) }));
  const a = "00000000-0000-0000-0000-000000000001", b = "00000000-0000-0000-0000-000000000002", c = "00000000-0000-0000-0000-000000000003";
  it("requires authentication, preserves words/chains/positions and confirms retries idempotently", async () => {
    expect((await archive.fetch(new Request(url))).status).toBe(401);
    expect(await (await get()).json()).toEqual({ heads: [] });
    expect((await post(a)).status).toBe(201);
    expect((await post(a)).status).toBe(200);
    const result = await (await get()).json();
    expect(result.heads[0].data).toEqual(data);
    expect((await post(a, [], { ...data, words: [] })).status).toBe(409);
  });
  it("rejects stale writers, compacts replaced versions and keeps concurrent heads", async () => {
    await post(a);
    expect((await post(b)).status).toBe(409);
    expect((await post(b, [a])).status).toBe(201);
    expect(mock.files.has(`workspace/revisions/${a}.json`)).toBe(false);
    // Simulate an independent serverless writer that passed the same base check.
    const row = { id: c, parents: [a], updatedAt: new Date().toISOString(), data: { ...data, graph: { ...data.graph, chains: [] } } };
    const path = `workspace/revisions/${c}.json`; mock.paths.add(path); mock.files.set(path, new Blob([JSON.stringify(row)]));
    expect((await (await get()).json()).heads.map((r: { id: string }) => r.id)).toEqual([b, c]);
    const d = "00000000-0000-0000-0000-000000000004";
    expect((await post(d, [b, c])).status).toBe(201);
    expect((await (await get()).json()).heads.map((r: { id: string }) => r.id)).toEqual([d]);
  });
  it("rejects unknown IDs, duplicate membership, oversized bodies and false upload acknowledgements", async () => {
    expect((await post(a, [], { ...data, graph: { ...data.graph, chains: [["NOI0001", "NOI9999"]] } })).status).toBe(400);
    expect((await post(a, [], { ...data, graph: { ...data.graph, chains: [["NOI0001", "NOI0001"]] } })).status).toBe(400);
    expect((await archive.fetch(new Request(url, { method: "POST", headers, body: "x".repeat(1_500_001) }))).status).toBe(413);
    mock.dropWrite = true;
    expect((await post(a)).status).toBe(502);
  });
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
