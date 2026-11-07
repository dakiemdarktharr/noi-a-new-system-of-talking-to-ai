import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, Minus, Maximize, Undo2, Redo2, Unlink, Search, X } from "lucide-react";
import { BLOCK_W, BLOCK_H, chainOf, graphBounds, nearbySlots, placeWord, positionsFor, dragPositions,
  type GraphWord, type MeaningGraph as Graph, type Point, type Slot } from "../lib/meaning-graph";

type Viewport = Point & { zoom: number };
type Drag = { id: string; point: Point; offset: Point; start: Point; moved: boolean; pointer: number };
const clampZoom = (z: number) => Math.max(.005, Math.min(2.5, z));
const searchKey = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").toLowerCase();
export function MeaningGraph({ words, graph, onChange, onAddWord, onSelect }: {
  words: GraphWord[]; graph: Graph; onChange: (next: Graph) => boolean; onAddWord: () => void; onSelect: (id: string) => void;
}) {
  const root = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [view, setView] = useState<Viewport>({ x: 0, y: 0, zoom: .05 });
  const viewRef = useRef(view); viewRef.current = view;
  const positions = useMemo(() => positionsFor(words, graph), [words, graph]);
  const wordMap = useMemo(() => new Map(words.map(w => [w.id, w])), [words]);
  const searchable = useMemo(() => words.map(word => ({ ...word, search: searchKey(word.label) })), [words]);
  const [selected, setSelected] = useState<string | null>(null), [query, setQuery] = useState("");
  const [attach, setAttach] = useState(false), [targetQuery, setTargetQuery] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [drag, setDrag] = useState<Drag | null>(null), dragRef = useRef<Drag | null>(null);
  const [history, setHistory] = useState<{ past: Graph[]; future: Graph[] }>({ past: [], future: [] });
  const pan = useRef<{ pointer: number; start: Point; view: Viewport } | null>(null);
  const pointer = useRef<Point>({ x: 0, y: 0 }), initialized = useRef(false), previousIds = useRef(new Set(words.map(w => w.id)));
  const pointers = useRef(new Map<number, Point>()), pinch = useRef<{ distance: number; view: Viewport; center: Point } | null>(null);
  const chain = selected ? chainOf(graph, selected) : [];
  const scene = useMemo(() => drag?.moved ? dragPositions(graph, positions, drag.id) : positions, [drag?.moved, drag?.id, graph, positions]);
  const slots = useMemo(() => drag?.moved ? nearbySlots(drag.id, drag.point, scene, graph) : [], [drag, scene, graph]);
  const candidates = useMemo(() => new Set(slots.map(s => s.target)), [slots]);
  const found = useMemo(() => query.trim() ? searchable.filter(w => w.search.includes(searchKey(query.trim()))).slice(0, 24) : [], [query, searchable]);
  const targets = useMemo(() => targetQuery.trim() ? searchable.filter(w => w.id !== selected && w.search.includes(searchKey(targetQuery.trim()))).slice(0, 16) : [], [targetQuery, searchable, selected]);
  const setViewport = useCallback((next: Viewport) => { viewRef.current = next; setView(next); }, []);
  const fit = useCallback((ids?: string[], maxZoom = 1.15) => {
    const b = graphBounds(positions, ids);
    const zoom = clampZoom(Math.min(maxZoom, (size.width - 100) / b.width, (size.height - 100) / b.height));
    setViewport({ x: (size.width - b.width * zoom) / 2 - b.x * zoom, y: (size.height - b.height * zoom) / 2 - b.y * zoom, zoom });
  }, [positions, size, setViewport]);
  const pick = (id: string, focus = false) => {
    setSelected(id); onSelect(id); setAttach(false); setQuery("");
    if (focus) fit(chainOf(graph, id).length <= 6 ? chainOf(graph, id) : [id]);
  };
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(root.current!); return () => observer.disconnect();
  }, []);
  useEffect(() => { if (!initialized.current && size.width > 0) { fit(); initialized.current = true; } }, [size, fit]);
  useEffect(() => {
    const added = words.find(w => !previousIds.current.has(w.id));
    previousIds.current = new Set(words.map(w => w.id));
    if (added) { setSelected(added.id); fit([added.id]); }
  }, [words, fit]);
  const local = (clientX: number, clientY: number) => { const rect = root.current!.getBoundingClientRect(); return { x: clientX - rect.left, y: clientY - rect.top }; };
  const world = (p: Point, v = viewRef.current) => ({ x: (p.x - v.x) / v.zoom, y: (p.y - v.y) / v.zoom });
  const zoomAt = useCallback((factor: number, p: Point) => {
    const v = viewRef.current, zoom = clampZoom(v.zoom * factor);
    const next = { zoom, x: p.x - (p.x - v.x) * zoom / v.zoom, y: p.y - (p.y - v.y) * zoom / v.zoom };
    setViewport(next);
    const d = dragRef.current;
    if (d) {
      const moved = { ...d, point: { x: (pointer.current.x - next.x) / zoom - d.offset.x, y: (pointer.current.y - next.y) / zoom - d.offset.y } };
      dragRef.current = moved; setDrag(moved);
    }
  }, [setViewport]);
  useEffect(() => {
    const element = root.current!;
    const wheel = (event: WheelEvent) => { event.preventDefault(); const rect = element.getBoundingClientRect(); zoomAt(Math.exp(-event.deltaY * .002), { x: event.clientX - rect.left, y: event.clientY - rect.top }); };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [zoomAt]);
  const updateDrag = (p: Point) => {
    const d = dragRef.current; if (!d) return;
    const w = world(p);
    const next = { ...d, point: { x: w.x - d.offset.x, y: w.y - d.offset.y }, moved: d.moved || Math.hypot(p.x - d.start.x, p.y - d.start.y) > 4 };
    dragRef.current = next; setDrag(next);
  };
  useEffect(() => {
    if (!drag) return;
    let raf = 0;
    const tick = () => {
      const d = dragRef.current;
      if (!d) return;
      const p = pointer.current;
      const speed = (x: number, limit: number) => x < 36 ? Math.min(12, (36 - x) / 4) : x > limit - 36 ? -Math.min(12, (x - limit + 36) / 4) : 0;
      const dx = speed(p.x, size.width), dy = speed(p.y, size.height);
      if (d.moved && (dx || dy)) { setViewport({ ...viewRef.current, x: viewRef.current.x + dx, y: viewRef.current.y + dy }); updateDrag(p); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf);
    // One auto-pan loop per gesture; it reads fresh pointer/viewport refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!drag, size.width, size.height, setViewport]);
  const commit = (next: Graph) => {
    if (onChange(next)) { setHistory(h => ({ past: [...h.past.slice(-39), graph], future: [] })); return true; }
    return false;
  };
  const undo = () => { const previous = history.past.at(-1); if (previous && onChange(previous)) setHistory(h => ({ past: h.past.slice(0, -1), future: [graph, ...h.future] })); };
  const redo = () => { const next = history.future[0]; if (next && onChange(next)) setHistory(h => ({ past: [...h.past, graph], future: h.future.slice(1) })); };
  const cancel = useCallback(() => { dragRef.current = null; setDrag(null); pan.current = null; pinch.current = null; pointers.current.clear(); setAnnouncement("Đã hủy kéo."); }, []);
  useEffect(() => {
    const hidden = () => { if (document.hidden) cancel(); };
    window.addEventListener("blur", cancel); document.addEventListener("visibilitychange", hidden);
    return () => { window.removeEventListener("blur", cancel); document.removeEventListener("visibilitychange", hidden); };
  }, [cancel]);
  const finish = () => {
    const d = dragRef.current; dragRef.current = null; setDrag(null);
    if (!d?.moved) return;
    const slot = nearbySlots(d.id, d.point, dragPositions(graph, positions, d.id), graph)[0];
    if (commit(placeWord(graph, words, d.id, d.point, slot)))
      setAnnouncement(slot ? `Đã ghép ${wordMap.get(d.id)?.label} ${slot.side === "after" ? "dưới" : "trên"} ${wordMap.get(slot.target)?.label}.` : `Đã đặt ${wordMap.get(d.id)?.label}.`);
  };
  const hit = (p: Point) => {
    for (const word of words) { const q = positions.get(word.id)!; if (p.x >= q.x && p.x <= q.x + BLOCK_W && p.y >= q.y && p.y <= q.y + BLOCK_H) return word.id; }
    return null;
  };
  const visible = useMemo(() => view.zoom < .3 ? [] : words.filter(w => {
    const p = drag?.id === w.id ? drag.point : scene.get(w.id)!;
    return p.x * view.zoom + view.x < size.width + 40 && (p.x + BLOCK_W) * view.zoom + view.x > -40 && p.y * view.zoom + view.y < size.height + 40 && (p.y + BLOCK_H) * view.zoom + view.y > -40;
  }), [words, view, scene, size, drag]);
  useEffect(() => {
    const element = canvas.current!, context = element.getContext("2d")!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    element.width = Math.round(size.width * dpr); element.height = Math.round(size.height * dpr);
    context.scale(dpr, dpr); context.clearRect(0, 0, size.width, size.height);
    let grid = 24 * view.zoom; while (grid < 12) grid *= 4;
    context.strokeStyle = "#9ebfe51c"; context.lineWidth = 1; context.beginPath();
    for (let x = view.x % grid; x < size.width; x += grid) { context.moveTo(x, 0); context.lineTo(x, size.height); }
    for (let y = view.y % grid; y < size.height; y += grid) { context.moveTo(0, y); context.lineTo(size.width, y); }
    context.stroke();
    context.save(); context.translate(view.x, view.y); context.scale(view.zoom, view.zoom);
    context.strokeStyle = "#b9e4ff"; context.lineWidth = 2 / view.zoom;
    for (const original of graph.chains) { const row = drag?.moved ? original.filter(id => id !== drag.id) : original; for (let i = 1; i < row.length; i++) {
      const a = scene.get(row[i - 1]), b = scene.get(row[i]); if (!a || !b) continue;
      context.beginPath(); context.moveTo(a.x + BLOCK_W / 2, a.y + BLOCK_H); context.lineTo(b.x + BLOCK_W / 2, b.y); context.stroke();
    } }
    const order = new Map(graph.chains.flatMap(row => row.map((id, i) => [id, i + 1] as const)));
    const draw = (word: GraphWord, p: Point) => {
      const sx = p.x * view.zoom + view.x, sy = p.y * view.zoom + view.y;
      if (sx > size.width || sx + BLOCK_W * view.zoom < 0 || sy > size.height || sy + BLOCK_H * view.zoom < 0) return;
      const active = selected === word.id;
      context.fillStyle = active ? "#dcff3f" : order.has(word.id) ? "#174b82" : "#102f58";
      context.strokeStyle = active ? "#dcff3f" : candidates.has(word.id) ? "#dcff3f" : "#88b4e0";
      context.lineWidth = (active ? 2 : 1) / view.zoom;
      context.setLineDash(candidates.has(word.id) ? [6 / view.zoom, 4 / view.zoom] : []);
      context.fillRect(p.x, p.y, BLOCK_W, BLOCK_H); context.strokeRect(p.x, p.y, BLOCK_W, BLOCK_H);
      context.setLineDash([]);
      if (view.zoom >= .3) {
        context.save(); context.beginPath(); context.rect(p.x + 10, p.y, BLOCK_W - 36, BLOCK_H); context.clip();
        context.fillStyle = active ? "#0b2040" : "#f1f7ff"; context.font = '600 15px "Be Vietnam Pro", sans-serif'; context.textBaseline = "middle";
        context.fillText(word.label, p.x + 12, p.y + BLOCK_H / 2); context.restore();
        if (order.has(word.id)) { context.fillStyle = active ? "#0b2040" : "#b9e4ff"; context.font = '10px monospace'; context.fillText(String(order.get(word.id)).padStart(2, "0"), p.x + BLOCK_W - 24, p.y + 16); }
      }
    };
    for (const word of words) if (word.id !== drag?.id) draw(word, scene.get(word.id)!);
    if (drag) { const word = wordMap.get(drag.id); if (word) draw(word, drag.point); }
    context.restore();
  }, [words, graph, scene, view, size, drag, candidates, selected, wordMap]);
  const screenStyle = (p: Point) => ({ left: p.x * view.zoom + view.x, top: p.y * view.zoom + view.y, width: BLOCK_W * view.zoom, height: BLOCK_H * view.zoom });
  return <section className="meaning-graph" aria-label="Graph chuỗi nghĩa">
    <div className="graph-toolbar">
      <strong>BLOCK <span>{words.length.toLocaleString("vi-VN")}</span></strong>
      <div className="graph-search">
        <Search size={16} /><input aria-label="Tìm block" placeholder="Tìm từ" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === "Escape") setQuery(""); if (e.key === "Enter" && found[0]) pick(found[0].id, true); }} />
        {query && <button aria-label="Xóa tìm block" onClick={() => setQuery("")}><X size={14} /></button>}
        {found.length > 0 && <div className="graph-results" aria-label="Kết quả tìm block">{found.map(w => <button key={w.id} onClick={() => pick(w.id, true)}>{w.label}</button>)}</div>}
      </div>
      <div className="graph-actions">
        <button aria-label="Hoàn tác graph" disabled={!history.past.length || !!drag} onClick={undo}><Undo2 size={17} /></button>
        <button aria-label="Làm lại graph" disabled={!history.future.length || !!drag} onClick={redo}><Redo2 size={17} /></button>
        <button aria-label="Thu nhỏ graph" onClick={() => zoomAt(.7, { x: size.width / 2, y: size.height / 2 })}><Minus size={17} /></button>
        <output aria-label="Mức zoom graph">{Math.round(view.zoom * 100)}%</output>
        <button aria-label="Phóng to graph" onClick={() => zoomAt(1.4, { x: size.width / 2, y: size.height / 2 })}><Plus size={17} /></button>
        <button aria-label="Hiện toàn bộ block" onClick={() => fit()}><Maximize size={17} /></button>
        <button onClick={onAddWord}><Plus size={15} />Thêm từ</button>
      </div>
    </div>
    <div ref={root} className={"graph-canvas " + (drag ? "is-dragging" : "")} tabIndex={0} role="group" aria-label="Bản đồ block. Kéo từ để ghép chuỗi; lăn chuột để zoom. Phím mũi tên di chuyển; Escape hủy kéo." data-total-blocks={words.length}
      onContextMenu={e => e.preventDefault()}
      onKeyDown={e => {
        if (e.key === "Escape") { e.preventDefault(); cancel(); return; }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); if (dragRef.current) cancel(); else e.shiftKey ? redo() : undo(); return; }
        if (e.key === "Delete" && selected && chain.length > 1 && !dragRef.current) { e.preventDefault(); commit(placeWord(graph, words, selected, { x: positions.get(selected)!.x + BLOCK_W + 48, y: positions.get(selected)!.y })); return; }
        const vector: Record<string, Point> = { ArrowLeft: { x: 40, y: 0 }, ArrowRight: { x: -40, y: 0 }, ArrowUp: { x: 0, y: 40 }, ArrowDown: { x: 0, y: -40 } };
        if (vector[e.key]) { e.preventDefault(); setViewport({ ...viewRef.current, x: viewRef.current.x + vector[e.key].x, y: viewRef.current.y + vector[e.key].y }); }
      }}
      onPointerDown={e => {
        if (e.button !== 0 && e.button !== 1) return;
        e.preventDefault(); root.current!.focus({ preventScroll: true });
        const p = local(e.clientX, e.clientY); pointer.current = p; pointers.current.set(e.pointerId, p);
        root.current!.setPointerCapture(e.pointerId);
        if (pointers.current.size === 2) {
          dragRef.current = null; setDrag(null); pan.current = null;
          const [a, b] = [...pointers.current.values()]; pinch.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), view: { ...viewRef.current }, center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }; return;
        }
        const w = world(p), id = e.button === 0 ? hit(w) : null;
        if (id) {
          pick(id);
          if (viewRef.current.zoom < .3) { fit([id]); return; }
          const at = positions.get(id)!;
          const d = { id, point: at, offset: { x: w.x - at.x, y: w.y - at.y }, start: p, moved: false, pointer: e.pointerId };
          dragRef.current = d; setDrag(d);
        } else { pan.current = { pointer: e.pointerId, start: p, view: { ...viewRef.current } }; root.current!.focus({ preventScroll: true }); }
      }}
      onPointerMove={e => {
        const p = local(e.clientX, e.clientY); pointer.current = p;
        if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, p);
        if (pinch.current && pointers.current.size >= 2) {
          const [a, b] = [...pointers.current.values()], original = pinch.current;
          const zoom = clampZoom(original.view.zoom * Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, original.distance));
          setViewport({ zoom, x: (a.x + b.x) / 2 - (original.center.x - original.view.x) * zoom / original.view.zoom, y: (a.y + b.y) / 2 - (original.center.y - original.view.y) * zoom / original.view.zoom }); return;
        }
        if (dragRef.current?.pointer === e.pointerId) updateDrag(p);
        else if (pan.current?.pointer === e.pointerId) { const start = pan.current; setViewport({ ...start.view, x: start.view.x + p.x - start.start.x, y: start.view.y + p.y - start.start.y }); }
      }}
      onPointerUp={e => {
        if (dragRef.current?.pointer === e.pointerId) { updateDrag(local(e.clientX, e.clientY)); finish(); }
        pan.current = null; pinch.current = null; pointers.current.delete(e.pointerId);
        if (root.current!.hasPointerCapture(e.pointerId)) root.current!.releasePointerCapture(e.pointerId);
      }}
      onPointerCancel={cancel}
      onLostPointerCapture={e => { if (dragRef.current?.pointer === e.pointerId) cancel(); }}>
      <canvas ref={canvas} aria-hidden="true" />
      {visible.map(w => <button key={w.id} className={"graph-node " + (selected === w.id ? "selected" : "")} style={screenStyle(drag?.id === w.id ? drag.point : scene.get(w.id)!)} data-word-id={w.id} aria-label={`Block ${w.label}`} aria-pressed={selected === w.id} title={w.label}
        onClick={e => { if (e.detail === 0) pick(w.id); }}><span className="graph-sr">{w.label}</span></button>)}
      {slots.map((slot: Slot, i) => <div key={`${slot.target}-${slot.side}`} className={"graph-slot " + (i === 0 ? "nearest" : "")} data-target={slot.target} data-side={slot.side} style={screenStyle(slot)} aria-hidden="true" />)}
      <span className="graph-coordinate" aria-hidden="true">{Math.round(-view.x / view.zoom)} : {Math.round(-view.y / view.zoom)}</span>
    </div>
    <div className="graph-chainbar">
      <div className="graph-chain" aria-label="Chuỗi đang chọn">{selected ? chain.map((id, i) => <span key={id}>{i > 0 && <i aria-hidden="true">↓</i>}<button aria-pressed={id === selected} onClick={() => pick(id, true)}>{wordMap.get(id)?.label}</button></span>) : <span>{graph.chains.length} chuỗi</span>}</div>
      {selected && <div className="graph-chain-actions">
        <button onClick={() => fit(chain)}>Xem chuỗi</button>
        <button aria-pressed={attach} onClick={() => { setAttach(!attach); setTargetQuery(""); }}>Ghép dưới</button>
        <button disabled={chain.length < 2} onClick={() => commit(placeWord(graph, words, selected, { x: positions.get(selected)!.x + BLOCK_W + 48, y: positions.get(selected)!.y }))}><Unlink size={15} />Tách</button>
        {attach && <div className="graph-attach"><input autoFocus aria-label="Từ đứng trước block đang chọn" placeholder="Ghép dưới từ…" value={targetQuery} onChange={e => setTargetQuery(e.target.value)} onKeyDown={e => { if (e.key === "Escape") setAttach(false); }} />
          <div className="graph-results">{targets.map(w => <button key={w.id} onClick={() => { if (commit(placeWord(graph, words, selected, positions.get(w.id)!, { target: w.id, side: "after" }))) { setAttach(false); setAnnouncement(`Đã ghép dưới ${w.label}.`); } }}>{w.label}</button>)}</div>
        </div>}
      </div>}
    </div>
    <span className="graph-sr" role="status">{announcement}</span>
  </section>;
}
