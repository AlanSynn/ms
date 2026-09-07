import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { Brush, Circle, Eraser, Minus, Redo2, Square, Trash2, Undo2 } from "lucide-react";
import type { ArtworkDocument, ArtworkOperation, BodyPartLayer, Bounds, Point, SceneObject } from "../../../types";
import { appendArtworkOperation, artworkForOwner, clearArtwork } from "../../../utils/artwork";
import { ARTWORK_RASTER_LIMITS, compositeArtwork } from "../../../runtime/artwork/artworkCompositor";
import { disposeArtworkCanvas, loadArtworkImage } from "../../../runtime/artwork/artworkRaster";
import { clientPointToCutPoint } from "../../../utils/cutEditorViewport";
import { partOutlineBounds } from "../../../utils/partGeometry";
import { uid } from "../../../utils/project";
import type { CharacterFabricationHole } from "../../../utils/characterFabricationHoles";
import "./paintWorkspace.css";

type PaintTool = "brush" | "erase" | "line" | "rectangle" | "ellipse";
type Owner = BodyPartLayer | SceneObject;
type Gesture = { pointerId: number; document: ArtworkDocument; ownerId: string; operation: ArtworkOperation };
const SWATCHES = ["#172033", "#ffffff", "#ef476f", "#ff9f1c", "#ffd166", "#06a77d", "#2389da", "#8559da"];

/** A front-facing editing projection. Only a completed gesture writes ProjectState. */
export const PaintWorkspace = ({ owner, outline, holes, onArtwork, onBaseColor, onDone, onUndo, onRedo, onChangeShape, onCancel, onNameChange }: {
  owner: Owner;
  outline: Point[];
  holes: readonly CharacterFabricationHole[];
  onArtwork: (document: ArtworkDocument, expectedRevision: string) => void;
  onBaseColor: (color: string) => void;
  onDone: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onChangeShape?: () => void;
  onCancel?: () => void;
  onNameChange?: (name: string) => void;
}) => {
  const document = useMemo(() => artworkForOwner(owner), [owner]);
  const frame = useMemo((): Bounds => {
    const bounds = partOutlineBounds(outline);
    const original = document.frame;
    const x = Math.min(original.x, bounds.minX);
    const y = Math.min(original.y, bounds.minY);
    return { x, y, width: Math.max(original.x + original.width, bounds.maxX) - x,
      height: Math.max(original.y + original.height, bounds.maxY) - y };
  }, [outline, document.frame]);
  const [tool, setTool] = useState<PaintTool>("brush");
  const [width, setWidth] = useState(8);
  const [color, setColor] = useState("#ef476f");
  const [error, setError] = useState("");
  const [imageVersion, setImageVersion] = useState(0);
  const [size, setSize] = useState({ width: 640, height: 480 });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const imageRef = useRef<CanvasImageSource | undefined>(undefined);
  const animationRef = useRef(0);
  const latest = useRef({ owner, document, onArtwork });
  latest.current = { owner, document, onArtwork };
  const scale = Math.min(size.width / (frame.width * 1.35), size.height / (frame.height * 1.35));
  const view = { minX: frame.x + frame.width / 2 - size.width / scale / 2,
    minY: -(frame.y + frame.height / 2) - size.height / scale / 2,
    width: size.width / scale, height: size.height / scale };

  const draw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2,
      ARTWORK_RASTER_LIMITS.edge / Math.max(size.width, size.height),
      Math.sqrt(ARTWORK_RASTER_LIMITS.pixels / (size.width * size.height)));
    canvas.width = Math.round(size.width * ratio);
    canvas.height = Math.round(size.height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const gesture = gestureRef.current;
    const preview = gesture && gesture.ownerId === owner.id && gesture.document === document
      ? { ...document, operations: [...document.operations, gesture.operation] } : document;
    const targetFrame = { x: view.minX, y: -view.minY - view.height, width: view.width, height: view.height };
    try {
      if (preview.sourceImage && !imageRef.current) return;
      const composite = compositeArtwork({ document: preview, assets: { texture: imageRef.current },
        targetFrame, clip: { kind: "contour", points: outline, holes },
        resolution: { width: canvas.width, height: canvas.height }, baseColor: owner.fillColor });
      ctx.drawImage(composite, 0, 0, size.width, size.height);
      disposeArtworkCanvas(composite);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Paint preview unavailable. Try reopening Draw & paint.");
    }
    const toScreen = (point: Point) => ({ x: (point.x - view.minX) * scale, y: (-point.y - view.minY) * scale });
    ctx.strokeStyle = "#475569";
    ctx.lineWidth = 1;
    ctx.beginPath();
    outline.forEach((p, index) => { const s = toScreen(p); if (index) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y); });
    ctx.closePath(); ctx.stroke();
    // Attachment guides are overlays, never paint operations or new holes.
    for (const hole of holes) {
      const p = toScreen(hole.center);
      ctx.beginPath(); ctx.arc(p.x, p.y, hole.radius * scale, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff"; ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(p.x - 7, p.y); ctx.lineTo(p.x + 7, p.y);
      ctx.moveTo(p.x, p.y - 7); ctx.lineTo(p.x, p.y + 7); ctx.stroke();
    }
  };
  const drawRef = useRef(draw);
  drawRef.current = draw;
  const scheduleDraw = () => {
    if (animationRef.current) return;
    animationRef.current = requestAnimationFrame(() => { animationRef.current = 0; drawRef.current(); });
  };
  const cancelGesture = () => {
    const gesture = gestureRef.current;
    gestureRef.current = null;
    if (gesture && canvasRef.current?.hasPointerCapture(gesture.pointerId)) canvasRef.current.releasePointerCapture(gesture.pointerId);
    scheduleDraw();
  };

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: Math.max(1, entry.contentRect.width), height: Math.max(1, entry.contentRect.height) }));
    observer.observe(surface);
    canvasRef.current?.focus();
    return () => { observer.disconnect(); gestureRef.current = null; cancelAnimationFrame(animationRef.current); };
  }, []);
  useEffect(() => {
    let current = true;
    let dispose: (() => void) | undefined;
    imageRef.current = undefined;
    if (owner.textureUrl) loadArtworkImage(owner.textureUrl).then((loaded) => {
      if (!current) { loaded.dispose(); return; }
      dispose = loaded.dispose; imageRef.current = loaded.image; setError(""); setImageVersion(v => v + 1);
    }).catch(() => { if (current) setError("Image preview unavailable. Your artwork is kept."); });
    return () => { current = false; dispose?.(); };
  }, [owner.textureUrl]);
  useEffect(() => { cancelGesture(); }, [document, owner.locked]);
  useEffect(scheduleDraw, [document, frame, size, imageVersion, owner.fillColor, holes]);

  const pointerPoint = (event: PointerEvent<HTMLCanvasElement>) => clientPointToCutPoint({ viewport: view,
    svgRect: event.currentTarget.getBoundingClientRect(), clientX: event.clientX, clientY: event.clientY });
  const moveCursor = (event: PointerEvent<HTMLCanvasElement>) => {
    const cursor = cursorRef.current;
    if (!cursor) return;
    const rect = event.currentTarget.getBoundingClientRect();
    cursor.style.left = `${event.clientX - rect.left}px`;
    cursor.style.top = `${event.clientY - rect.top}px`;
    cursor.style.display = "block";
  };
  const appendPoint = (event: PointerEvent<HTMLCanvasElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const p = pointerPoint(event);
    if (!p) return;
    if (!("points" in gesture.operation)) { gesture.operation = { ...gesture.operation, to: p }; return; }
    const points = gesture.operation.points;
    const last = points[points.length - 1];
    if (Math.hypot(p.x - last.x, p.y - last.y) < 0.15) return;
    if (points.length >= 4096) { setError("Stroke limit. Draw a shorter mark."); cancelGesture(); return; }
    gesture.operation = { ...gesture.operation, points: [...points, p] };
  };
  const commit = (event: PointerEvent<HTMLCanvasElement>) => {
    appendPoint(event);
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const current = latest.current;
    cancelGesture();
    if (current.owner.id !== gesture.ownerId || current.document !== gesture.document || current.owner.locked) return;
    try { current.onArtwork(appendArtworkOperation(gesture.document, gesture.operation), gesture.document.revision); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Cannot add this mark."); }
  };

  return <section className="paint-workspace" aria-label={`Paint: ${owner.name}`} data-testid="paint-workspace"
    data-paint-owner={owner.id} data-artwork-revision={document.revision}
    onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) cancelGesture();
    }}
    onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancelGesture(); }
      const editingText = event.target instanceof HTMLInputElement && event.target.type !== "color"
        || event.target instanceof HTMLTextAreaElement
        || event.target instanceof HTMLElement && event.target.isContentEditable;
      if ((event.metaKey || event.ctrlKey) && ["z", "y"].includes(event.key.toLowerCase()) && !editingText) {
        event.preventDefault(); event.stopPropagation(); cancelGesture();
        if (event.shiftKey || event.key.toLowerCase() === "y") onRedo(); else onUndo();
      }
    }}>
    <header className="paint-header">
      {onNameChange ? <label className="paint-draft-name">Paint:<input aria-label="Object name" value={owner.name} maxLength={80} onChange={e => onNameChange(e.currentTarget.value)} /></label> : <strong>Paint: {owner.name}</strong>}
      <div className="paint-header-actions">
        {onChangeShape && <button className="btn-secondary" onClick={() => { cancelGesture(); onChangeShape(); }}>Change shape</button>}
        {onCancel && <button className="btn-secondary" onClick={() => { cancelGesture(); onCancel(); }}>Cancel</button>}
        <button className="btn-primary" onClick={() => { cancelGesture(); try { onDone(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Cannot add this object."); } }}>{onCancel ? "Add object" : "Done"}</button>
      </div>
    </header>
    <div className="paint-toolbar" role="toolbar" aria-label="Paint tools">
      <button aria-label="Brush" aria-pressed={tool === "brush"} onClick={() => { cancelGesture(); setTool("brush"); }}><Brush size={18} />Brush</button>
      <button aria-label="Eraser" aria-pressed={tool === "erase"} onClick={() => { cancelGesture(); setTool("erase"); }}><Eraser size={18} />Eraser</button>
      <button aria-label="Line" aria-pressed={tool === "line"} onClick={() => { cancelGesture(); setTool("line"); }}><Minus size={18} />Line</button>
      <button aria-label="Filled rectangle" aria-pressed={tool === "rectangle"} onClick={() => { cancelGesture(); setTool("rectangle"); }}><Square size={18} />Rectangle</button>
      <button aria-label="Filled ellipse" aria-pressed={tool === "ellipse"} onClick={() => { cancelGesture(); setTool("ellipse"); }}><Circle size={18} />Ellipse</button>
      <span className="paint-divider" />
      <button aria-label="Thin brush" aria-pressed={width === 2} onClick={() => { cancelGesture(); setWidth(2); }}><i style={{ width: 3, height: 3 }} />Thin</button>
      <button aria-label="Broad brush" aria-pressed={width === 8} onClick={() => { cancelGesture(); setWidth(8); }}><i style={{ width: 10, height: 10 }} />Broad</button>
      <span className="paint-toolbar-spacer" />
      <button aria-label="Undo paint" onClick={() => { cancelGesture(); onUndo(); }}><Undo2 size={18} /></button>
      <button aria-label="Redo paint" onClick={() => { cancelGesture(); onRedo(); }}><Redo2 size={18} /></button>
    </div>
    <div ref={surfaceRef} className="paint-surface">
      <canvas ref={canvasRef} aria-label={`Paint on ${owner.name}`} data-testid="paint-canvas" data-paint-view={JSON.stringify(view)} tabIndex={0}
        onPointerDown={event => {
          if (event.button !== 0 || owner.locked || gestureRef.current) return;
          const p = pointerPoint(event); if (!p) return;
          event.preventDefault(); event.currentTarget.focus(); setError("");
          gestureRef.current = { pointerId: event.pointerId, ownerId: owner.id, document,
            operation: tool === "brush" ? { id: uid("ink"), kind: "brush", points: [p], color, width }
              : tool === "erase" ? { id: uid("ink"), kind: "erase", points: [p], width }
              : tool === "line" ? { id: uid("ink"), kind: "line", from: p, to: p, color, width }
              : { id: uid("ink"), kind: tool, from: p, to: p, color } };
          event.currentTarget.setPointerCapture(event.pointerId); moveCursor(event); scheduleDraw();
        }}
        onPointerMove={event => { moveCursor(event); appendPoint(event); if (gestureRef.current) scheduleDraw(); }}
        onPointerUp={commit} onPointerCancel={cancelGesture}
        onLostPointerCapture={() => { if (gestureRef.current) cancelGesture(); }}
        onPointerLeave={() => { if (cursorRef.current) cursorRef.current.style.display = "none"; }} />
      <div ref={cursorRef} className={`paint-cursor ${tool === "erase" ? "erasing" : ""}`} style={{ width: Math.max(4, width * scale), height: Math.max(4, width * scale) }} />
      {error && <div role="status" className="paint-status">{error}</div>}
    </div>
    <footer className="paint-colors" aria-label="Paint colors">
      {SWATCHES.map(swatch => <button key={swatch} aria-label={`Paint color ${swatch}`} aria-pressed={color === swatch}
        className="paint-swatch" style={{ background: swatch }} onClick={() => { cancelGesture(); setColor(swatch); }} />)}
      <label className="paint-custom-color">Color<input aria-label="Custom paint color" type="color" value={color} onChange={e => { cancelGesture(); setColor(e.currentTarget.value); }} /></label>
      <span className="paint-toolbar-spacer" />
      <label className="paint-custom-color">Base color<input aria-label="Base color" type="color" value={owner.fillColor} onChange={e => { cancelGesture(); onBaseColor(e.currentTarget.value); }} /></label>
      <button className="paint-clear" aria-label="Clear paint" disabled={!document.operations.length && !document.sourceImage}
        onClick={() => { cancelGesture(); onArtwork(clearArtwork(document), document.revision); }}><Trash2 size={16} />Clear paint</button>
    </footer>
  </section>;
};
