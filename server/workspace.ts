import { deleteFiles, downloadFile, listFiles, uploadFiles } from "@huggingface/hub";
import { WORKSPACE_LIMIT, revisionId, sameIds, validateWorkspaceWrite, validateWorkspaceRevision, workspaceHeads, workspaceText, type WorkspaceRevision } from "../src/lib/workspace.js";

const folder = "workspace/revisions";
const pathFor = (id: string) => `${folder}/${id}.json`;
const missing = (e: unknown) => (e as { statusCode?: number })?.statusCode === 404 || (e as { status?: number })?.status === 404;
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });

export async function workspaceRequest(request: Request, name: string, accessToken: string) {
  const credentials = { repo: { type: "bucket" as const, name }, accessToken };
  // Bound every upstream fetch, including Xet uploads and redirects.
  const deadline = AbortSignal.timeout(23_000);
  const bounded = { ...credentials, fetch: (input: string | URL | Request, init?: RequestInit) => fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, deadline]) : deadline }) };
  async function revisions(): Promise<WorkspaceRevision[]> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const paths: string[] = [];
      try {
        for await (const item of listFiles({ ...bounded, path: folder })) {
          const filename = item.path.split("/").at(-1) ?? "";
          if (item.type === "file" && filename.endsWith(".json") && revisionId(filename.slice(0, -5))) paths.push(item.path);
          if (paths.length > 100) throw new Error("Too many unresolved workspace versions");
        }
      } catch (error) { if (!missing(error)) throw error; }
      const found: WorkspaceRevision[] = [];
      let changed = false;
      // A successful writer may compact its parents while another reader lists.
      for (const path of paths) {
        const file = await downloadFile({ ...bounded, path }).catch(error => { if (missing(error)) return null; throw error; });
        if (!file) { changed = true; break; }
        if (file.size > WORKSPACE_LIMIT) throw new Error("Oversized workspace");
        const row = validateWorkspaceRevision(JSON.parse(await file.text()));
        if (pathFor(row.id) !== path) throw new Error("Workspace ID mismatch");
        found.push(row);
      }
      if (!changed) return found;
    }
    throw new Error("Workspace changed while reading");
  }
  try {
    if (request.method === "GET") return json({ heads: workspaceHeads(await revisions()) });
    if (request.method !== "POST") return json({ error: "Thao tác graph không hợp lệ." }, 405);
    if (Number(request.headers.get("content-length") ?? 0) > WORKSPACE_LIMIT) return json({ error: "Graph vượt giới hạn 1,5 MB." }, 413);
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength > WORKSPACE_LIMIT) return json({ error: "Graph vượt giới hạn 1,5 MB." }, 413);
    let write;
    try { write = validateWorkspaceWrite(JSON.parse(new TextDecoder().decode(bytes))); }
    catch { return json({ error: "Graph hoặc phiên bản không hợp lệ." }, 400); }
    const all = await revisions(), heads = workspaceHeads(all), existing = all.find(r => r.id === write.id);
    if (existing) {
      if (!sameIds(existing.parents, write.parents) || workspaceText(existing.data) !== workspaceText(write.data)) return json({ error: "Mã phiên bản graph bị trùng." }, 409);
      return json({ id: write.id, heads });
    }
    if (!sameIds(heads.map(r => r.id), write.parents)) return json({ error: "Graph trên kho đã thay đổi.", heads }, 409);
    const row: WorkspaceRevision = { ...write, updatedAt: new Date().toISOString() };
    await uploadFiles({ ...bounded, files: [{ path: pathFor(row.id), content: new Blob([JSON.stringify(row)], { type: "application/json" }) }] });
    // Immutable IDs preserve both writes if two devices passed the same base
    // check concurrently. Never acknowledge merely because upload was called.
    const after = await revisions();
    if (!after.some(r => r.id === row.id || r.parents.includes(row.id))) throw new Error("Workspace write not confirmed");
    const current = workspaceHeads(after);
    // Delete only superseded revisions observed in this read, never a competing
    // head. Failure to compact leaves harmless history and does not lose a save.
    const retired = after.filter(r => !current.some(h => h.id === r.id));
    if (retired.length) await deleteFiles({ ...bounded, paths: retired.map(r => pathFor(r.id)) }).catch(() => {});
    return json({ id: row.id, heads: current }, 201);
  } catch { return json({ error: "Chưa đồng bộ được graph. Bản trên máy vẫn được giữ." }, 502); }
}
