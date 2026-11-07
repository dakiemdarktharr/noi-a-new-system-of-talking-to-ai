import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { validateWorkspace, workspaceWords, workspaceHeads, type Workspace } from "../../src/lib/workspace";
import { readZipEntry } from "../../src/lib/zip";
import { graphMeanings } from "../../src/lib/meaning-graph";

const empty = (): Workspace => ({ version: 1, words: [], graph: { version: 1, chains: [], extraWords: [], positions: {} } });
describe("workspace and import integrity", () => {
  it("promotes a legacy extra meaning to a real custom label atomically", () => {
    const data = empty(), id = "NOI_USER_00000000-0000-0000-0000-000000000001";
    data.graph.extraWords = [{ id: "MEANING_group", label: "nhóm riêng" }];
    data.graph.positions.MEANING_group = { x: 1, y: 2 };
    data.graph.chains = [["NOI0001", "MEANING_group"]];
    const result = validateWorkspace(workspaceWords(data, [{ id, label: "nhóm riêng" }]));
    expect(result.graph.chains).toEqual([["NOI0001", id]]);
    expect(result.graph.positions).toEqual({ [id]: { x: 1, y: 2 } });
    expect(result.graph.extraWords).toEqual([]);
  });
  it("rejects dangling positions, duplicate custom IDs and duplicate chain membership", () => {
    const data = empty(); data.graph.positions.unknown = { x: 0, y: 0 };
    expect(() => validateWorkspace(data)).toThrow();
    const word = { id: "NOI_USER_00000000-0000-0000-0000-000000000001", label: "từ" };
    expect(() => validateWorkspace({ ...empty(), words: [word, word] })).toThrow();
    expect(() => validateWorkspace({ ...empty(), graph: { ...empty().graph, chains: [["NOI0001", "NOI0002"], ["NOI0002", "NOI0003"]] } })).toThrow();
  });
  it("keeps concurrent versions until an explicit resolution includes both parents", () => {
    const a = { id: "a", parents: ["old"], data: empty(), updatedAt: "2026-11-07" }, b = { ...a, id: "b" };
    expect(workspaceHeads([a, b])).toHaveLength(2);
    expect(workspaceHeads([a, b, { ...a, id: "c", parents: ["a", "b"] }]).map(r => r.id)).toEqual(["c"]);
  });
  it("does not allocate every rotation of a long meaning chain", () => {
    const words = Array.from({ length: 6000 }, (_, i) => ({ id: `w${i}`, label: `word${i}` }));
    const graph = { ...empty().graph, chains: [words.map(w => w.id)] };
    const meanings = graphMeanings(graph, words);
    expect(Object.getOwnPropertyDescriptor(meanings, "w5999")?.get).toBeTypeOf("function");
    expect(meanings.w5999.slice(0, 3)).toEqual(["word5999", "word0", "word1"]);
  });
  it("bounds real ZIP output even when the compressed input is small", async () => {
    const zip = new JSZip(); zip.file("data", "A".repeat(32768));
    const compressed = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
    expect(compressed.byteLength).toBeLessThan(1000);
    const loaded = await JSZip.loadAsync(compressed);
    await expect(readZipEntry(loaded.file("data")!, 1024)).rejects.toThrow(/giới hạn/);
    expect((await readZipEntry(loaded.file("data")!, 32768)).byteLength).toBe(32768);
  });
});
