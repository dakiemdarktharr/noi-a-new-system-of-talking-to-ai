import { describe, expect, it } from "vitest";
import { readGraph, graphWords, graphMeanings, positionsFor, placeWord, nearbySlots, dragPositions, CHAIN_STEP, BLOCK_H, type MeaningGraph } from "../../src/lib/meaning-graph";
const words = [{ id: "NOI0001", label: "tôi" }, { id: "B", label: "chúng ta" }, { id: "C", label: "chúng tôi" }, { id: "D", label: "bạn" }];
const empty = (): MeaningGraph => ({ version: 1, positions: {}, chains: [], extraWords: [] });
const after = (graph: MeaningGraph, id: string, target: string) => placeWord(graph, words, id, { x: 0, y: 0 }, { target, side: "after" });
describe("graph is the meaning chain", () => {
  it("migrates existing meanings, preserving unknown user meanings and an explicitly empty map", () => {
    const graph = readGraph(words, null, JSON.stringify({ NOI0001: ["tôi", "chúng ta", "nhóm của tôi"] }));
    const all = graphWords(words, graph);
    expect(graphMeanings(graph, all).NOI0001).toEqual(["tôi", "chúng ta", "nhóm của tôi"]);
    expect(graph.extraWords).toHaveLength(1);
    expect(readGraph(words, null, "{}").chains).toEqual([]);
    expect(readGraph(words, "bad JSON", null).chains[0]).toEqual(["NOI0001", "C"]);
  });
  it("cycles in visual order from every word, inserts and moves between chains without duplicates", () => {
    let graph = after(empty(), "B", "NOI0001");
    graph = after(graph, "C", "NOI0001");
    expect(graph.chains).toEqual([["NOI0001", "C", "B"]]);
    expect(graphMeanings(graph, words).NOI0001).toEqual(["tôi", "chúng tôi", "chúng ta"]);
    expect(graphMeanings(graph, words).B).toEqual(["chúng ta", "tôi", "chúng tôi"]);
    graph = after(graph, "C", "D");
    expect(graph.chains).toEqual([["NOI0001", "B"], ["D", "C"]]);
    expect(new Set(graph.chains.flat()).size).toBe(graph.chains.flat().length);
    expect(after(graph, "C", "C")).toBe(graph);
  });
  it("reorders inside a chain and disconnects a word without deleting its vocabulary", () => {
    let graph = after(after(empty(), "B", "NOI0001"), "C", "B");
    graph = placeWord(graph, words, "C", { x: 0, y: 0 }, { target: "NOI0001", side: "before" });
    expect(graph.chains[0]).toEqual(["C", "NOI0001", "B"]);
    graph = placeWord(graph, words, "NOI0001", { x: -500, y: 400 });
    expect(graph.chains[0]).toEqual(["C", "B"]);
    expect(positionsFor(words, graph).size).toBe(4);
    expect(graphMeanings(graph, words).NOI0001).toBeUndefined();
  });
  it("chooses nearest ghost slot and lands at that exact coordinate after a reorder", () => {
    const graph = after(after(empty(), "B", "NOI0001"), "C", "B");
    const preview = dragPositions(graph, positionsFor(words, graph), "B"), c = preview.get("C")!;
    const release = { x: c.x + 3, y: c.y + CHAIN_STEP - 4 };
    const slot = nearbySlots("B", release, preview, graph)[0];
    expect(slot.target).toBe("C"); expect(slot.side).toBe("after");
    const moved = placeWord(graph, words, "B", release, slot);
    expect(moved.positions.B).toEqual({ x: slot.x, y: slot.y });
    const innerSlot = nearbySlots("D", c, positionsFor(words, graph), graph)[0];
    const inserted = placeWord(graph, words, "D", innerSlot, innerSlot);
    expect(inserted.positions.D).toEqual({ x: innerSlot.x, y: innerSlot.y });
    expect(inserted.chains[0]).toEqual(["NOI0001", "D", "B", "C"]);
  });
  it("moves obstructing blocks out of a newly inserted chain", () => {
    const graph = empty(); graph.positions = { NOI0001: { x: 0, y: 0 }, B: { x: 300, y: 0 }, C: { x: 0, y: CHAIN_STEP } };
    const moved = after(graph, "B", "NOI0001");
    expect(moved.positions.B.y).toBe(CHAIN_STEP);
    expect(moved.positions.C.y - moved.positions.B.y).toBeGreaterThan(BLOCK_H);
  });
  it("round trips positions/chains and sanitizes invalid persisted references", () => {
    const graph = after(empty(), "B", "NOI0001");
    expect(readGraph(words, JSON.stringify(graph), null)).toEqual(graph);
    const broken = { ...graph, chains: [["NOI0001", "B", "NOI0001"], ["B", "missing"]], positions: { B: { x: "bad", y: null } } };
    const recovered = readGraph(words, JSON.stringify(broken), null);
    expect(recovered.chains).toEqual([["NOI0001", "B"]]); expect(recovered.positions.B).toBeUndefined();
  });
});
