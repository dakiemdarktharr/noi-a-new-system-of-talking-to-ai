import { DEFAULT_MEANINGS } from "./meaning-cycle";

export type GraphWord = { id: string; label: string };
export type Point = { x: number; y: number };
export type MeaningGraph = { version: 1; positions: Record<string, Point>; chains: string[][]; extraWords: GraphWord[] };
export type Slot = Point & { target: string; side: "before" | "after"; distance: number };
export const GRAPH_KEY = "noi-meaning-graph-v1";
export const BLOCK_W = 196, BLOCK_H = 54, CHAIN_STEP = 86;
const COLUMNS = 72, GRID_X = 244, GRID_Y = 126;
const blank = (): MeaningGraph => ({ version: 1, positions: {}, chains: [], extraWords: [] });
const labelKey = (s: string) => s.normalize("NFC").trim().toLocaleLowerCase("vi");
export function graphWords(entries: GraphWord[], graph: MeaningGraph): GraphWord[] {
  const words = entries.filter(e => e.id !== "NO_SIGN");
  const ids = new Set(words.map(w => w.id));
  return [...words, ...graph.extraWords.filter(w => !ids.has(w.id))];
}
export function positionsFor(words: GraphWord[], graph: MeaningGraph): Map<string, Point> {
  return new Map(words.map((word, i) => [word.id, graph.positions[word.id] ?? { x: i % COLUMNS * GRID_X, y: Math.floor(i / COLUMNS) * GRID_Y }]));
}
export function graphMeanings(graph: MeaningGraph, words: GraphWord[]): Record<string, string[]> {
  const labels = new Map(words.map(w => [w.id, w.label]));
  const result: Record<string, string[]> = {};
  for (const chain of graph.chains) {
    const valid = chain.filter(id => labels.has(id));
    if (valid.length < 2) continue;
    const row = valid.map(id => labels.get(id)!);
    // Keep one shared row per chain; rotate only the recognized word on access.
    // Materializing every rotation made a long chain consume quadratic memory.
    valid.forEach((id, i) => Object.defineProperty(result, id, { enumerable: true,
      get: () => [...row.slice(i), ...row.slice(0, i)] }));
  }
  return result;
}
export function readGraph(entries: GraphWord[], raw: string | null, legacy: string | null): MeaningGraph {
  if (raw) {
    try {
      const value = JSON.parse(raw);
      if (value.version !== 1 || !Array.isArray(value.chains) || !Array.isArray(value.extraWords) || !value.positions || typeof value.positions !== "object") throw Error();
      const graph = blank();
      graph.extraWords = value.extraWords.filter((w: GraphWord) => typeof w?.id === "string" && w.id.startsWith("MEANING_") && typeof w.label === "string" && w.label.length > 0 && w.label.length <= 80);
      const ids = new Set(graphWords(entries, graph).map(w => w.id)), used = new Set<string>();
      for (const chain of value.chains) {
        if (!Array.isArray(chain)) continue;
        const valid = chain.filter((id: unknown): id is string => {
          if (typeof id !== "string" || !ids.has(id) || used.has(id)) return false;
          used.add(id); return true;
        });
        if (valid.length > 1) graph.chains.push(valid);
      }
      for (const [id, point] of Object.entries(value.positions) as [string, Point][])
        if (ids.has(id) && point && Number.isFinite(point.x) && Number.isFinite(point.y) && Math.abs(point.x) < 1e7 && Math.abs(point.y) < 1e7)
          graph.positions[id] = { x: point.x, y: point.y };
      return graph;
    } catch { /* Recover from the previous meaning settings without throwing on boot. */ }
  }
  const graph = blank();
  let meanings: Record<string, string[]> = DEFAULT_MEANINGS;
  try { const value = JSON.parse(legacy ?? "null"); if (value && typeof value === "object" && !Array.isArray(value)) meanings = value; } catch { /* Default chain. */ }
  const words = entries.filter(w => w.id !== "NO_SIGN"), byLabel = new Map(words.map(w => [labelKey(w.label), w.id]));
  for (const [root, labels] of Object.entries(meanings)) {
    if (!words.some(w => w.id === root) || !Array.isArray(labels) || labels.length < 2) continue;
    const chain = [root];
    for (const label of labels.slice(1)) {
      if (typeof label !== "string" || !label.trim() || label.length > 80) continue;
      const key = labelKey(label);
      let id = byLabel.get(key);
      if (!id) {
        id = `MEANING_${encodeURIComponent(key)}`;
        const word = { id, label: label.normalize("NFC").trim() };
        byLabel.set(key, id); graph.extraWords.push(word); words.push(word);
      }
      if (!chain.includes(id)) chain.push(id);
    }
    // A word has one position in one linear chain. Later explicit settings win.
    graph.chains = graph.chains.map(old => old.filter(id => !chain.includes(id))).filter(old => old.length > 1);
    if (chain.length > 1) graph.chains.push(chain);
  }
  const positions = positionsFor(words, graph);
  for (const chain of graph.chains) {
    const anchor = positions.get(chain[0])!;
    chain.forEach((id, i) => { graph.positions[id] = { x: anchor.x, y: anchor.y + i * CHAIN_STEP }; });
  }
  let spaced = graph;
  for (const chain of graph.chains) {
    const last = chain.at(-1)!;
    spaced = placeWord(spaced, words, last, positions.get(last)!, { target: chain.at(-2)!, side: "after" });
  }
  return spaced;
}
export function dragPositions(graph: MeaningGraph, positions: Map<string, Point>, id: string): Map<string, Point> {
  const next = new Map(positions), remainder = chainOf(graph, id).filter(key => key !== id);
  if (remainder.length) {
    const anchor = positions.get(remainder[0])!;
    remainder.forEach((key, i) => next.set(key, { x: anchor.x, y: anchor.y + i * CHAIN_STEP }));
  }
  return next;
}
export function nearbySlots(id: string, point: Point, positions: Map<string, Point>, graph?: MeaningGraph): Slot[] {
  const slots: Slot[] = [];
  const hasPrevious = new Set(graph?.chains.flatMap(chain => chain.filter(key => key !== id).slice(1)) ?? []);
  for (const [target, p] of positions) {
    if (target === id || Math.abs(point.x - p.x) > BLOCK_W * .7 || Math.abs(point.y - p.y) > CHAIN_STEP * 2) continue;
    for (const side of ["before", "after"] as const) {
      const y = p.y + (side === "after" ? CHAIN_STEP : hasPrevious.has(target) ? 0 : -CHAIN_STEP);
      const distance = Math.hypot(point.x - p.x, point.y - y);
      if (distance <= 112) slots.push({ target, side, x: p.x, y, distance });
    }
  }
  const visible: Slot[] = [];
  for (const slot of slots.sort((a, b) => a.distance - b.distance || a.target.localeCompare(b.target) || a.side.localeCompare(b.side))) {
    // Adjacent nodes can describe the same insertion. Keep the closest slot,
    // and avoid overlapping ghost outlines from unrelated neighbouring rows.
    if (visible.every(other => Math.abs(slot.x - other.x) >= BLOCK_W + 8 || Math.abs(slot.y - other.y) >= BLOCK_H + 8)) visible.push(slot);
    if (visible.length === 3) break;
  }
  return visible;
}
export function chainOf(graph: MeaningGraph, id: string): string[] {
  return graph.chains.find(chain => chain.includes(id)) ?? [id];
}

/** One drag moves one word. Remove from its old chain before inserting, so
 * reordering, moving between chains and dropping above a root cannot cycle. */
export function placeWord(graph: MeaningGraph, words: GraphWord[], id: string, point: Point, slot?: Pick<Slot, "target" | "side">): MeaningGraph {
  const positions = positionsFor(words, graph);
  if (!positions.has(id) || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return graph;
  if (slot && (slot.target === id || !positions.has(slot.target))) return graph;
  const next: MeaningGraph = { ...graph, positions: { ...graph.positions }, chains: graph.chains.map(chain => chain.filter(key => key !== id)).filter(chain => chain.length > 1) };
  const oldChain = chainOf(graph, id), affected = new Set<string>();
  const layout = (chain: string[], anchor: Point) => chain.forEach((key, i) => {
    const p = { x: anchor.x, y: anchor.y + i * CHAIN_STEP };
    next.positions[key] = p; positions.set(key, p); affected.add(key);
  });
  const remainder = oldChain.filter(key => key !== id);
  if (remainder.length) layout(remainder, positions.get(remainder[0])!);
  next.positions[id] = { x: Math.round(point.x / 8) * 8, y: Math.round(point.y / 8) * 8 };
  positions.set(id, next.positions[id]); affected.add(id);
  let inserted = [id];
  if (slot) {
    const chain = chainOf(next, slot.target).slice(), index = chain.indexOf(slot.target) + Number(slot.side === "after");
    const anchor = { ...positions.get(chain[0])! };
    if (index === 0) anchor.y -= CHAIN_STEP;
    chain.splice(index, 0, id); inserted = chain;
    next.chains = [...next.chains.filter(old => !old.includes(slot.target)), chain];
    layout(chain, anchor);
  }
  // Give inserted words real space; move obstructing columns/whole chains down
  // instead of allowing blocks to cover each other after a snap.
  const fixed = new Set(inserted), queue = [...affected];
  let iterations = 0;
  while (queue.length && iterations++ < words.length * 2) {
    const moved = queue.shift()!, a = positions.get(moved)!;
    for (const [other, b] of positions) {
      if (other === moved || Math.abs(a.x - b.x) >= BLOCK_W + 12 || Math.abs(a.y - b.y) >= BLOCK_H + 12) continue;
      const group = chainOf(next, other);
      if (group.some(key => fixed.has(key)) || group.includes(moved)) continue;
      const delta = a.y + CHAIN_STEP - b.y;
      for (const key of group) {
        const p = positions.get(key)!;
        const shifted = { x: p.x, y: p.y + Math.max(CHAIN_STEP, delta) };
        positions.set(key, shifted); next.positions[key] = shifted; queue.push(key);
      }
    }
  }
  return next;
}

export function graphBounds(positions: Map<string, Point>, ids = [...positions.keys()]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const id of ids) { const p = positions.get(id); if (p) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x + BLOCK_W); maxY = Math.max(maxY, p.y + BLOCK_H); } }
  return Number.isFinite(minX) ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY } : { x: 0, y: 0, width: BLOCK_W, height: BLOCK_H };
}
