import vocabulary from "../data/vocabulary.json";
import type { MeaningGraph, GraphWord } from "./meaning-graph.js";
import { isCustomWordId, wordKey } from "./words.js";

export const WORKSPACE_KEY = "noi-workspace-v1";
export const WORKSPACE_LIMIT = 1_500_000;
export type Workspace = { version: 1; graph: MeaningGraph; words: GraphWord[] };
export type WorkspaceWrite = { id: string; parents: string[]; data: Workspace };
export type WorkspaceRevision = WorkspaceWrite & { updatedAt: string };
export const revisionId = (id: unknown): id is string => typeof id === "string" && /^[a-f0-9-]{36}$/.test(id);
const builtinIds = new Set(vocabulary.entries.map(w => w.id));
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/** Reject a damaged cloud snapshot, rather than silently dropping its words or links. */
export function validateWorkspace(value: unknown): Workspace {
  const bad = () => { throw new Error("Graph hoặc danh mục từ không hợp lệ."); };
  if (!record(value) || value.version !== 1 || !Array.isArray(value.words) || value.words.length > 6000 || !record(value.graph)) return bad();
  const ids = new Set(builtinIds);
  const words: GraphWord[] = [];
  function word(raw: unknown, extra: boolean) {
    if (!record(raw) || typeof raw.id !== "string" || ids.has(raw.id) || typeof raw.label !== "string" || !raw.label.trim() || raw.label.length > 80 ||
      (extra ? !/^MEANING_[^\s/\\]{1,800}$/.test(raw.id) : !isCustomWordId(raw.id))) return bad();
    ids.add(raw.id); return { id: raw.id, label: raw.label.normalize("NFC").trim() };
  }
  for (const raw of value.words) words.push(word(raw, false));
  const g = value.graph;
  if (g.version !== 1 || !Array.isArray(g.extraWords) || g.extraWords.length > 6000 || !Array.isArray(g.chains) || g.chains.length > 9000 || !record(g.positions)) return bad();
  const extraWords = g.extraWords.map(raw => word(raw, true));
  const used = new Set<string>(), chains: string[][] = [];
  for (const row of g.chains) {
    if (!Array.isArray(row) || row.length < 2 || row.length > ids.size) return bad();
    const chain: string[] = [];
    for (const id of row) {
      if (typeof id !== "string" || !ids.has(id) || used.has(id)) return bad();
      used.add(id); chain.push(id);
    }
    chains.push(chain);
  }
  const positions: MeaningGraph["positions"] = {};
  if (Object.keys(g.positions).length > ids.size) return bad();
  for (const [id, p] of Object.entries(g.positions)) {
    if (!ids.has(id) || !record(p) || typeof p.x !== "number" || typeof p.y !== "number" || !Number.isFinite(p.x) || !Number.isFinite(p.y) || Math.abs(p.x) >= 1e7 || Math.abs(p.y) >= 1e7) return bad();
    positions[id] = { x: p.x, y: p.y };
  }
  const result: Workspace = { version: 1, words, graph: { version: 1, positions, chains, extraWords } };
  if (new TextEncoder().encode(JSON.stringify(result)).length > WORKSPACE_LIMIT - 10_000) throw new Error("Graph vượt giới hạn đồng bộ 1,5 MB.");
  return result;
}
export function validateWorkspaceWrite(value: unknown): WorkspaceWrite {
  if (!record(value) || !revisionId(value.id) || !Array.isArray(value.parents) || value.parents.length > 100 ||
      value.parents.some(id => !revisionId(id) || id === value.id) || new Set(value.parents).size !== value.parents.length)
    throw new Error("Phiên bản graph không hợp lệ.");
  return { id: value.id, parents: [...value.parents].sort(), data: validateWorkspace(value.data) };
}
export function validateWorkspaceRevision(value: unknown): WorkspaceRevision {
  if (!record(value) || typeof value.updatedAt !== "string" || !Number.isFinite(Date.parse(value.updatedAt))) throw new Error("Mốc lưu graph không hợp lệ.");
  return { ...validateWorkspaceWrite(value), updatedAt: value.updatedAt };
}
export function workspaceHeads(revisions: WorkspaceRevision[]) {
  const replaced = new Set(revisions.flatMap(r => r.parents));
  return revisions.filter(r => !replaced.has(r.id)).sort((a, b) => a.id.localeCompare(b.id));
}
export const sameIds = (a: string[], b: string[]) => a.length === b.length && [...a].sort().every((id, i) => id === [...b].sort()[i]);
export const workspaceText = (data: Workspace) => JSON.stringify({ ...data, words: [...data.words].sort((a, b) => a.id.localeCompare(b.id)),
  graph: { ...data.graph, positions: Object.fromEntries(Object.entries(data.graph.positions).sort(([a], [b]) => a.localeCompare(b))) } });

export function workspaceWords(data: Workspace, words: GraphWord[]): Workspace {
  const byLabel = new Map(words.map(w => [wordKey(w.label), w.id]));
  const replacements = new Map(data.graph.extraWords.flatMap(w => byLabel.has(wordKey(w.label)) ? [[w.id, byLabel.get(wordKey(w.label))!] as const] : []));
  const positions = { ...data.graph.positions };
  for (const [old, id] of replacements) { if (positions[old]) positions[id] = positions[old]; delete positions[old]; }
  return { ...data, words: words.map(({ id, label }) => ({ id, label })), graph: { ...data.graph, positions,
    extraWords: data.graph.extraWords.filter(w => !replacements.has(w.id)), chains: data.graph.chains.map(row => row.map(id => replacements.get(id) ?? id)) } };
}
