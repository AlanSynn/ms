import { useEffect, useId, useMemo, useRef, useState, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { Circle, Expand, Hand, Minimize2, MousePointer2, Pencil, Plus, Redo2, RotateCcw, Square, Trash2, Undo2 } from 'lucide-react';
import type { BodyPartLayer, Bounds, Point, SceneObject } from '../../../types';
import { artworkForOwner, artworkOwnerFrame } from '../../../utils/artwork';
import { clientPointToCutPoint } from '../../../utils/cutEditorViewport';
import { contourPathD } from '../../../utils/partGeometry';
import {
  ellipseOutline, PHYSICAL_OUTLINE_POINT_LIMIT, rectangleOutline,
  scalePhysicalOutline, validatePhysicalOutline, type OutlineAttachment,
} from '../../../utils/shapeEditing';
import { ARTWORK_RASTER_LIMITS, compositeArtwork, disposeArtworkCanvas } from '../../../runtime/artwork/artworkCompositor';
import { loadArtworkImage } from '../../../runtime/artwork/artworkRaster';
import './shapeEditor.css';

type ShapeGesture = { pointerId: number; ownerId: string; before: Point[]; mode: 'draw' | 'edit' | 'pan'; points: Point[]; index?: number; startClient?: Point; panBefore?: Point };
type ShapeEditorProps = {
  owner: BodyPartLayer | SceneObject;
  sourceTextureUrl?: string;
  outline: readonly Readonly<Point>[];
  attachments: readonly OutlineAttachment[];
  onCommit: (points: Point[]) => void;
  onClose: () => void;
};
const clonePoints = (points: readonly Readonly<Point>[]) => points.map(point => ({ ...point }));

/** Candidate geometry stays local until the explicit, valid Use shape action. */
export const ShapeEditor = ({ owner, outline, attachments, sourceTextureUrl, onCommit, onClose }: ShapeEditorProps) => {
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<ShapeGesture | null>(null);
  const imageRef = useRef<CanvasImageSource | undefined>(undefined);
  const [imageVersion, setImageVersion] = useState(0);
  const [candidate, setCandidate] = useState(() => clonePoints(outline));
  const candidateRef = useRef(candidate);
  const [draft, setDraft] = useState<Point[]>([]);
  const [tool, setTool] = useState<'edit' | 'draw' | 'pan'>('edit');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [showSource, setShowSource] = useState(false);
  const historyRef = useRef<{ past: Point[][]; future: Point[][] }>({ past: [], future: [] });
  const [, setHistoryVersion] = useState(0);
  const [size, setSize] = useState({ width: 760, height: 440 });
  const [error, setError] = useState('');
  const artwork = useMemo(() => artworkForOwner(owner), [owner]);
  const sourceImageFrame = 'sourceImageFrame' in owner ? owner.sourceImageFrame : undefined;
  const validation = useMemo(() => validatePhysicalOutline(candidate, { attachments }), [candidate, attachments]);
  const frame = useMemo((): Bounds => {
    const original = artworkOwnerFrame(owner);
    const points = [...outline, { x: original.x, y: original.y }, { x: original.x + original.width, y: original.y + original.height },
      ...attachments.flatMap(hole => [{ x: hole.center.x - hole.radius, y: hole.center.y - hole.radius },
        { x: hole.center.x + hole.radius, y: hole.center.y + hole.radius }]),
      ...(showSource && sourceImageFrame ? [{ x: sourceImageFrame.x, y: -sourceImageFrame.y },
        { x: sourceImageFrame.x + sourceImageFrame.width, y: -sourceImageFrame.y - sourceImageFrame.height }] : [])];
    const xs = points.map(point => point.x), ys = points.map(point => point.y);
    const x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, width: Math.max(1, Math.max(...xs) - x), height: Math.max(1, Math.max(...ys) - y) };
  }, [owner.id, showSource]);
  const scale = Math.min(size.width / (frame.width * 1.8), size.height / (frame.height * 1.8)) * zoom;
  const view = { minX: frame.x + frame.width / 2 + pan.x - size.width / scale / 2,
    minY: -(frame.y + frame.height / 2 + pan.y) - size.height / scale / 2,
    width: size.width / scale, height: size.height / scale };

  const replace = (points: Point[]) => { candidateRef.current = points; setCandidate(points); setError(''); };
  const recordCandidate = (before: Point[]) => {
    historyRef.current = { past: [...historyRef.current.past, before].slice(-40), future: [] };
    setHistoryVersion(version => version + 1);
  };
  const cancelGesture = () => {
    const gesture = gestureRef.current;
    gestureRef.current = null;
    if (gesture?.mode === 'edit') replace(gesture.before);
    if (gesture?.mode === 'pan' && gesture.panBefore) setPan(gesture.panBefore);
    if (gesture && svgRef.current?.hasPointerCapture(gesture.pointerId)) svgRef.current.releasePointerCapture(gesture.pointerId);
    setDraft([]);
  };
  const undoShape = (redo = false) => {
    cancelGesture();
    const history = historyRef.current;
    const from = redo ? history.future : history.past;
    const next = from.pop(); if (!next) return;
    (redo ? history.past : history.future).push(candidateRef.current);
    replace(next); setHistoryVersion(version => version + 1);
  };
  useEffect(() => {
    const previouslyFocused = window.document.activeElement as HTMLElement | null;
    dialogRef.current?.showModal();
    const observer = new ResizeObserver(([entry]) => setSize({ width: Math.max(1, entry.contentRect.width), height: Math.max(1, entry.contentRect.height) }));
    if (surfaceRef.current) observer.observe(surfaceRef.current);
    return () => {
      observer.disconnect(); gestureRef.current = null;
      if (canvasRef.current) disposeArtworkCanvas(canvasRef.current);
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, []);
  useEffect(() => {
    cancelGesture(); replace(clonePoints(outline)); setSelectedIndex(0); setZoom(1); setPan({ x: 0, y: 0 });
    historyRef.current = { past: [], future: [] };
  }, [owner.id]);
  useEffect(() => {
    const controller = new AbortController();
    let dispose: (() => void) | undefined;
    imageRef.current = undefined;
    if (artwork.sourceImage && owner.textureUrl) loadArtworkImage(owner.textureUrl, controller.signal).then(loaded => {
      if (controller.signal.aborted) { loaded.dispose(); return; }
      imageRef.current = loaded.image; dispose = loaded.dispose; setImageVersion(version => version + 1);
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Artwork preview unavailable.'); });
    return () => { controller.abort(); dispose?.(); };
  }, [owner.textureUrl, Boolean(artwork.sourceImage)]);
  useEffect(() => {
    const request = requestAnimationFrame(() => {
      const canvas = canvasRef.current, context = canvas?.getContext('2d');
      if (!canvas || !context || artwork.sourceImage && !imageRef.current) return;
      const ratio = Math.min(window.devicePixelRatio || 1, 2, ARTWORK_RASTER_LIMITS.edge / Math.max(size.width, size.height),
        Math.sqrt(ARTWORK_RASTER_LIMITS.pixels / (size.width * size.height)));
      canvas.width = Math.max(1, Math.floor(size.width * ratio)); canvas.height = Math.max(1, Math.floor(size.height * ratio));
      try {
        const composite = compositeArtwork({ document: artwork, assets: { texture: imageRef.current },
          targetFrame: { x: view.minX, y: -view.minY - view.height, width: view.width, height: view.height },
          clip: { kind: 'contour', points: validation.ok ? validation.points : outline, holes: attachments },
          resolution: { width: canvas.width, height: canvas.height }, baseColor: owner.fillColor });
        context.drawImage(composite, 0, 0); disposeArtworkCanvas(composite);
      } catch (cause) { setError(cause instanceof Error ? cause.message : 'Artwork preview unavailable.'); }
    });
    return () => cancelAnimationFrame(request);
  }, [candidate, artwork, imageVersion, owner.fillColor, size, zoom, pan, frame, validation]);

  const pointFrom = (event: PointerEvent<SVGSVGElement>) => clientPointToCutPoint({ viewport: view,
    svgRect: event.currentTarget.getBoundingClientRect(), clientX: event.clientX, clientY: event.clientY });
  const moveGesture = (event: PointerEvent<SVGSVGElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId || gesture.ownerId !== owner.id) return;
    if (gesture.mode === 'pan' && gesture.startClient && gesture.panBefore) {
      setPan({ x: gesture.panBefore.x - (event.clientX - gesture.startClient.x) / scale,
        y: gesture.panBefore.y + (event.clientY - gesture.startClient.y) / scale });
      return;
    }
    const point = pointFrom(event); if (!point) return;
    if (gesture.mode === 'edit') replace(candidateRef.current.map((current, index) => index === gesture.index ? point : current));
    else {
      const last = gesture.points[gesture.points.length - 1];
      if (gesture.points.length > PHYSICAL_OUTLINE_POINT_LIMIT || Math.hypot(point.x - last.x, point.y - last.y) * scale < 2) return;
      gesture.points = [...gesture.points, point]; setDraft(gesture.points);
    }
  };
  const mutateCandidate = (next: (points: Point[]) => Point[]) => { cancelGesture(); recordCandidate(candidateRef.current); replace(next(candidateRef.current)); };
  const presetFrame = () => {
    const valid = validatePhysicalOutline(candidateRef.current);
    return valid.ok ? valid.bounds : frame;
  };
  const changePoint = (index: number, x: number, y: number) => mutateCandidate(points => points.map((point, i) => i === index ? { x, y } : point));
  const addPoint = () => mutateCandidate(points => {
    if (points.length < 2) return rectangleOutline(frame);
    const index = Math.min(selectedIndex, points.length - 1), a = points[index], b = points[(index + 1) % points.length];
    setSelectedIndex(index + 1);
    return [...points.slice(0, index + 1), { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, ...points.slice(index + 1)];
  });
  const removePoint = () => mutateCandidate(points => {
    const next = points.filter((_, index) => index !== selectedIndex); setSelectedIndex(Math.max(0, selectedIndex - 1)); return next;
  });
  const useShape = () => {
    cancelGesture();
    const result = validatePhysicalOutline(candidateRef.current, { attachments });
    if (!result.ok) { setError(result.blocker); return; }
    try { onCommit(result.points); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Shape could not be applied.'); }
  };

  return createPortal(<dialog ref={dialogRef} className="shape-editor" aria-labelledby={titleId} data-testid="shape-editor"
    onKeyDown={event => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); if (gestureRef.current) cancelGesture(); else onClose(); }
      if ((event.metaKey || event.ctrlKey) && ['z', 'y'].includes(event.key.toLowerCase())) {
        event.preventDefault(); undoShape(event.shiftKey || event.key.toLowerCase() === 'y');
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault(); setError('Use shape to apply this outline.');
      }
    }}
    onCancel={event => { event.preventDefault(); if (gestureRef.current) cancelGesture(); else onClose(); }}>
    <header className="shape-editor-head"><h2 id={titleId}>Change shape: {owner.name}</h2>
      <button type="button" className="btn-secondary" onClick={() => { cancelGesture(); onClose(); }}>Cancel</button></header>
    <div className="shape-editor-tools" role="toolbar" aria-label="Shape tools">
      <button type="button" aria-pressed={tool === 'edit'} onClick={() => { cancelGesture(); setTool('edit'); }}><MousePointer2 size={16} />Edit points</button>
      <button type="button" aria-pressed={tool === 'draw'} onClick={() => { cancelGesture(); setTool('draw'); }}><Pencil size={16} />Draw outline</button>
      <button type="button" aria-pressed={tool === 'pan'} onClick={() => { cancelGesture(); setTool('pan'); }}><Hand size={16} />Pan</button>
      <button type="button" onClick={() => mutateCandidate(() => rectangleOutline(presetFrame()))}><Square size={16} />Rectangle</button>
      <button type="button" onClick={() => mutateCandidate(() => ellipseOutline(presetFrame()))}><Circle size={16} />Ellipse</button>
      <button type="button" onClick={() => mutateCandidate(points => scalePhysicalOutline(points, 1.1))}><Expand size={16} />Expand</button>
      <button type="button" onClick={() => mutateCandidate(points => scalePhysicalOutline(points, 0.9))}><Minimize2 size={16} />Shrink</button>
      <button type="button" onClick={() => mutateCandidate(() => clonePoints(outline))}><RotateCcw size={16} />Reset</button>
      {sourceTextureUrl && sourceImageFrame && <button type="button" aria-pressed={showSource}
        onClick={() => { cancelGesture(); setShowSource(!showSource); }}>Source guide</button>}
    </div>
    <div className="shape-editor-surface" ref={surfaceRef}>
      {showSource && sourceTextureUrl && sourceImageFrame && <svg className="shape-source-guide" aria-hidden="true"
        viewBox={`${view.minX} ${view.minY} ${view.width} ${view.height}`} preserveAspectRatio="none">
        <image data-testid="shape-source-image" href={sourceTextureUrl} x={sourceImageFrame.x} y={sourceImageFrame.y}
          width={sourceImageFrame.width} height={sourceImageFrame.height} preserveAspectRatio="xMidYMid meet" />
      </svg>}
      <canvas ref={canvasRef} aria-hidden="true" />
      <svg ref={svgRef} viewBox={`${view.minX} ${view.minY} ${view.width} ${view.height}`} preserveAspectRatio="none"
        className={`shape-editor-canvas tool-${tool}`} data-testid="shape-editor-canvas" aria-label={`Cut outline for ${owner.name}`} role="img" tabIndex={0}
        onPointerDown={event => {
          if (event.button !== 0 || owner.locked || gestureRef.current) return;
          const point = pointFrom(event); if (!point) return;
          const indexValue = (event.target as Element).getAttribute('data-shape-point');
          if (tool === 'edit' && indexValue === null) return;
          const index = indexValue === null ? undefined : Number(indexValue);
          event.preventDefault(); setError(''); if (index !== undefined) setSelectedIndex(index);
          gestureRef.current = { pointerId: event.pointerId, ownerId: owner.id, before: clonePoints(candidateRef.current), mode: tool,
            points: [point], index, startClient: { x: event.clientX, y: event.clientY }, panBefore: pan }; if (tool === 'draw') setDraft([point]);
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={moveGesture}
        onPointerUp={event => {
          moveGesture(event); const gesture = gestureRef.current;
          if (!gesture || gesture.pointerId !== event.pointerId) return;
          gestureRef.current = null;
          if (gesture.mode !== 'pan') recordCandidate(gesture.before);
          if (gesture.mode === 'draw') { replace(gesture.points); setSelectedIndex(0); }
          setDraft([]); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        }} onPointerCancel={cancelGesture} onLostPointerCapture={() => { if (gestureRef.current) cancelGesture(); }}>
        <path d={contourPathD(clonePoints(outline), true)} className="shape-original" vectorEffect="non-scaling-stroke" />
        <path d={contourPathD(candidate, true)} className={`shape-candidate ${validation.ok ? '' : 'invalid'}`} vectorEffect="non-scaling-stroke" />
        {draft.length > 1 && <path d={`M ${draft.map(point => `${point.x} ${-point.y}`).join(' L ')}`} className="shape-draft" vectorEffect="non-scaling-stroke" />}
        {attachments.map(hole => <g key={hole.jointId} className="shape-attachment" pointerEvents="none">
          <circle cx={hole.center.x} cy={-hole.center.y} r={hole.radius} vectorEffect="non-scaling-stroke" />
          <path d={`M ${hole.center.x - 5 / scale} ${-hole.center.y} h ${10 / scale} M ${hole.center.x} ${-hole.center.y - 5 / scale} v ${10 / scale}`} vectorEffect="non-scaling-stroke" />
        </g>)}
        {tool === 'edit' && candidate.map((point, index) => <circle key={index} data-shape-point={index} cx={point.x} cy={-point.y}
          r={(index === selectedIndex ? 5 : 3.5) / scale} className={`shape-handle ${index === selectedIndex ? 'selected' : ''}`}
          vectorEffect="non-scaling-stroke" tabIndex={0} role="button" aria-label={`Outline point ${index + 1}`}
          onFocus={() => setSelectedIndex(index)} onKeyDown={event => {
            const step = event.shiftKey ? 5 : 1;
            const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
            const delta = moves[event.key as keyof typeof moves];
            if (delta) { event.preventDefault(); event.stopPropagation(); changePoint(index, point.x + delta[0], point.y + delta[1]); }
            if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); event.stopPropagation(); removePoint(); }
          }} />)}
      </svg>
      {(!validation.ok || error) && <div className="shape-editor-status" role="status">{!validation.ok ? validation.blocker : error}</div>}
    </div>
    <footer className="shape-editor-footer">
      <div className="shape-point-controls">
        <button type="button" aria-label="Undo shape" disabled={!historyRef.current.past.length} onClick={() => undoShape()}><Undo2 size={16} /></button>
        <button type="button" aria-label="Redo shape" disabled={!historyRef.current.future.length} onClick={() => undoShape(true)}><Redo2 size={16} /></button>
        <button type="button" onClick={addPoint} disabled={candidate.length >= PHYSICAL_OUTLINE_POINT_LIMIT}><Plus size={16} />Add point</button>
        <button type="button" onClick={removePoint} disabled={candidate.length <= 3}><Trash2 size={16} />Remove point</button></div>
      <label>Zoom<input aria-label="Shape zoom" type="range" min="0.5" max="3" step="0.1" value={zoom} onChange={event => { cancelGesture(); setZoom(Number(event.currentTarget.value)); }} /></label>
      <button type="button" className="btn-secondary" onClick={() => { cancelGesture(); setZoom(1); setPan({ x: 0, y: 0 }); }}>Fit</button>
      <button type="button" className="btn-primary" data-testid="use-shape" disabled={!validation.ok || owner.locked} onClick={useShape}>Use shape</button>
    </footer>
  </dialog>, window.document.body);
};
