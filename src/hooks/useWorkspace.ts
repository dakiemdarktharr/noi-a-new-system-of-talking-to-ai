import { useCallback, useEffect, useRef, useState } from "react";
import vocabulary from "../data/vocabulary.json";
import { GRAPH_KEY, readGraph } from "../lib/meaning-graph";
import { customWord, loadCustomWords, saveCustomWords } from "../lib/words";
import { ArchiveError, archiveRequest } from "../lib/archive-client";
import { WORKSPACE_KEY, sameIds, validateWorkspace, validateWorkspaceWrite, validateWorkspaceRevision, workspaceText, revisionId,
  type Workspace, type WorkspaceRevision, type WorkspaceWrite } from "../lib/workspace";

type Local = { version: 1; nonce: string; data: Workspace; base: string[]; dirty: boolean; pending: WorkspaceWrite | null };
type Connection = { connected: boolean; online: boolean; expire: () => void };
function decode(raw: string): Local {
  const value = JSON.parse(raw);
  if (value.version !== 1 || !revisionId(value.nonce) || !Array.isArray(value.base) || value.base.some((id: unknown) => !revisionId(id)) || typeof value.dirty !== "boolean") throw new Error("Bộ nhớ graph không hợp lệ.");
  return { ...value, data: validateWorkspace(value.data), pending: value.pending ? validateWorkspaceWrite(value.pending) : null };
}
function initial(): Local {
  const saved = localStorage.getItem(WORKSPACE_KEY);
  if (saved) return decode(saved);
  const words = loadCustomWords().map(({ id, label }) => ({ id, label }));
  const raw = localStorage.getItem(GRAPH_KEY), legacy = localStorage.getItem("noi-meanings-v1");
  return { version: 1, nonce: crypto.randomUUID(), base: [], dirty: !!raw || !!legacy || !!words.length, pending: null,
    data: { version: 1, words, graph: readGraph([...vocabulary.entries, ...words], raw, legacy) } };
}
export function useWorkspace(connection: Connection, notify: (message: string) => void) {
  const [local, setLocal] = useState<Local>(() => {
    try { return initial(); } catch { return { version: 1, nonce: crypto.randomUUID(), base: [], dirty: false, pending: null,
      data: { version: 1, words: [], graph: readGraph(vocabulary.entries, null, null) } }; }
  });
  const state = useRef(local), network = useRef(connection); network.current = connection;
  const [phase, setPhase] = useState<"pending" | "syncing" | "saved" | "error">("pending");
  const [error, setError] = useState("");
  const [conflicts, setConflicts] = useState<WorkspaceRevision[]>([]);
  const conflictRef = useRef(conflicts); conflictRef.current = conflicts;
  const [generation, setGeneration] = useState(0), [tick, setTick] = useState(0);
  const running = useRef(false), mounted = useRef(true), timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const failures = useRef(0), retryAt = useRef(0);
  const persist = useCallback((next: Local, external = false) => {
    const stored = localStorage.getItem(WORKSPACE_KEY);
    if (stored && decode(stored).nonce !== state.current.nonce) {
      const newer = decode(stored); state.current = newer; setLocal(newer); setGeneration(n => n + 1);
      throw new Error("Graph đã đổi ở tab khác. Hãy thử lại.");
    }
    const value = { ...next, nonce: crypto.randomUUID() };
    // One authoritative write: words, graph, base and durable outbox move together.
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify(value));
    state.current = value; setLocal(value);
    // Read-compatible mirrors for old exports/tools; never authoritative after migration.
    try { localStorage.setItem(GRAPH_KEY, JSON.stringify(value.data.graph)); saveCustomWords(value.data.words.map(w => customWord(w.id, w.label))); } catch { /* Main write already succeeded. */ }
    if (external) setGeneration(n => n + 1);
  }, []);
  const update = useCallback((edit: (data: Workspace) => Workspace) => {
    try {
      const data = validateWorkspace(edit(state.current.data));
      if (workspaceText(data) === workspaceText(state.current.data)) return true;
      persist({ ...state.current, data, dirty: true }); setPhase("pending"); setError(""); retryAt.current = 0;
      return true;
    } catch (e) { notify(e instanceof DOMException ? "Không lưu được graph. Thay đổi chưa được áp dụng." : e instanceof Error ? e.message : "Không lưu được graph. Thay đổi chưa được áp dụng."); return false; }
  }, [notify, persist]);
  const sync = useCallback(async () => {
    if (!mounted.current || running.current || !network.current.connected || !network.current.online || conflictRef.current.length) return;
    running.current = true;
    const work = async () => {
    if (!mounted.current || !network.current.connected || !network.current.online) return;
    setPhase("syncing");
    try {
      const stored = localStorage.getItem(WORKSPACE_KEY);
      if (stored) {
        const latest = decode(stored);
        if (latest.nonce !== state.current.nonce) {
          const changed = workspaceText(latest.data) !== workspaceText(state.current.data);
          state.current = latest; setLocal(latest); if (changed) setGeneration(n => n + 1);
        }
      }
      const response = await (await archiveRequest("GET", { action: "workspace" })).json();
      if (!mounted.current || !network.current.connected) return;
      if (!Array.isArray(response.heads)) throw new Error("Kho chưa trả về graph hợp lệ.");
      let heads: WorkspaceRevision[] = response.heads.map(validateWorkspaceRevision);
      let current = state.current;
      const ids = heads.map(r => r.id);
      if (heads.length > 1) { setConflicts(heads); return; }
      const remote = heads[0];
      if (remote && workspaceText(remote.data) === workspaceText(current.data)) {
        if (current.dirty || !sameIds(current.base, ids) || current.pending) persist({ ...current, base: ids, dirty: false, pending: null });
      } else if (remote && (!current.dirty || (current.pending && workspaceText(current.pending.data) === workspaceText(current.data) && remote.parents.includes(current.pending.id)))) {
        persist({ ...current, data: remote.data, base: ids, dirty: false, pending: null }, true);
      } else if (remote && !sameIds(current.base, ids)) {
        setConflicts(heads); return;
      } else if (current.dirty || !remote) {
        const pending: WorkspaceWrite = current.pending && sameIds(current.pending.parents, ids) && workspaceText(current.pending.data) === workspaceText(current.data)
          ? current.pending : { id: crypto.randomUUID(), parents: ids, data: current.data };
        persist({ ...current, pending });
        const result = await (await archiveRequest("POST", { action: "workspace" }, JSON.stringify(pending))).json();
        if (!mounted.current || !network.current.connected) return;
        if (result.id !== pending.id || !Array.isArray(result.heads)) throw new Error("Kho chưa xác nhận đúng phiên bản graph.");
        heads = result.heads.map(validateWorkspaceRevision);
        if (!heads.some(r => r.id === pending.id || r.parents.includes(pending.id))) throw new Error("Kho chưa xác nhận graph đã lưu.");
        current = state.current;
        persist({ ...current, base: [pending.id], pending: null, dirty: workspaceText(current.data) !== workspaceText(pending.data) });
        if (heads.length > 1) { setConflicts(heads); return; }
      }
      failures.current = 0; retryAt.current = 0; setError("");
      setPhase(state.current.dirty ? "pending" : "saved");
    } catch (e) {
      if (!mounted.current) return;
      if (e instanceof ArchiveError && e.status === 401) network.current.expire();
      setError(e instanceof Error ? e.message : "Chưa đồng bộ được graph."); setPhase("error");
      retryAt.current = Date.now() + (e instanceof ArchiveError && e.status === 409 ? 1000 : Math.min(60_000, 5000 * 2 ** Math.min(failures.current++, 4)));
    }
    };
    try {
      // Serialize this browser's tabs; different devices remain protected by
      // immutable revisions and explicit conflict resolution on the server.
      if (navigator.locks) await navigator.locks.request("noi-workspace-sync", work);
      else await work();
    } finally { running.current = false; if (mounted.current) setTick(n => n + 1); }
  }, [persist]);
  useEffect(() => {
    clearTimeout(timer.current);
    if (!connection.connected || !connection.online || conflicts.length) return;
    // Coalesce drag bursts; pull while visible to discover other devices' edits.
    const wait = Math.max(retryAt.current - Date.now(), local.dirty || !local.base.length ? 900 : 30_000);
    timer.current = setTimeout(() => { if (local.dirty || !document.hidden) void sync(); }, wait);
    return () => clearTimeout(timer.current);
  }, [connection.connected, connection.online, conflicts.length, local.nonce, tick, sync]);
  useEffect(() => { if (connection.connected && connection.online) { retryAt.current = 0; void sync(); } }, [connection.connected, connection.online, sync]);
  useEffect(() => {
    mounted.current = true;
    const focus = () => { if (!document.hidden) void sync(); };
    const storage = (event: StorageEvent) => {
      if (event.key !== WORKSPACE_KEY || !event.newValue) return;
      try { const next = decode(event.newValue); state.current = next; setLocal(next); setGeneration(n => n + 1); setPhase(next.dirty ? "pending" : "saved"); } catch { setError("Không đọc được graph từ tab khác."); }
    };
    window.addEventListener("storage", storage); window.addEventListener("focus", focus); document.addEventListener("visibilitychange", focus);
    return () => { mounted.current = false; clearTimeout(timer.current); window.removeEventListener("storage", storage); window.removeEventListener("focus", focus); document.removeEventListener("visibilitychange", focus); };
  }, [sync]);
  function resolve(id: string | null) {
    try {
      const data = id ? conflicts.find(r => r.id === id)?.data : state.current.data;
      if (!data) return;
      persist({ ...state.current, data, base: conflicts.map(r => r.id), dirty: true, pending: null }, true);
      conflictRef.current = []; setConflicts([]); retryAt.current = 0; void sync();
    } catch (e) { notify(e instanceof Error ? e.message : "Không áp dụng được graph."); }
  }
  return { data: local.data, update, generation, conflicts, resolve, error,
    sync: () => { retryAt.current = 0; void sync(); },
    status: !connection.connected ? "Chưa kết nối kho" : !connection.online ? "Chờ mạng" : conflicts.length ? "Chọn bản graph" :
      phase === "error" ? "Chờ thử lại" : phase === "syncing" ? "Đang đồng bộ" : local.dirty || phase === "pending" ? "Chờ đồng bộ" : "Đã đồng bộ" };
}
