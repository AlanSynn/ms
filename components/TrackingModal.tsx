import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Upload, Crosshair, Play, Square, ArrowRight, Loader2, AlertCircle } from 'lucide-react';
import type { Point, ProjectState } from '../types';
import { createGifFrameSession, type GifFrameSession } from '../runtime/media/gifFrameSession';
import {
    fitTrackingMediaDimensions,
    TRACKING_GIF_MAX_COMPRESSED_BYTES,
    TRACKING_MEDIA_MAX_FPS,
    type TrackingGifPlan,
} from '../runtime/media/trackingMediaPolicy';
import { smoothTrackingPoints, trackingPointsToWorldPath } from '../utils/trackingPath';
import { resolveRenderPerformancePolicy } from '../utils/renderPerformancePolicy';

interface TrackingModalProps {
    isOpen: boolean;
    onClose: () => void;
    onTransfer: (path: Point[]) => void;
    performancePreset: ProjectState['settings']['performancePreset'];
}

interface VideoState {
    url: string;
    currentFrame: number;
    totalFrames: number;
    fps: number;
    width: number;
    height: number;
    isLoading: boolean;
    isGif: boolean;
}

const EMPTY_VIDEO_STATE: VideoState = {
    url: '',
    currentFrame: 0,
    totalFrames: 0,
    fps: TRACKING_MEDIA_MAX_FPS,
    width: 640,
    height: 480,
    isLoading: false,
    isGif: false,
};

export const TrackingModal: React.FC<TrackingModalProps> = ({ isOpen, onClose, onTransfer, performancePreset }) => {
    const mediaDetail = resolveRenderPerformancePolicy(performancePreset).interactiveDetail;
    const mediaLimits = {
        maxEdgePx: mediaDetail.maxMediaEdgePx,
        maxFrames: mediaDetail.maxMediaFrames,
        maxFramesPerSecond: mediaDetail.maxMediaFramesPerSecond,
    };
    // State
    const [videoState, setVideoState] = useState<VideoState>(EMPTY_VIDEO_STATE);

    const [isPlaying, setIsPlaying] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Manual correction state
    const [manualPoints, setManualPoints] = useState<{ x: number; y: number }[]>([]);  // Points placed in manual mode
    const [enableSmoothing, setEnableSmoothing] = useState(true);  // Smoothing checkbox - default ON
    const [connectEndPoints, setConnectEndPoints] = useState(true);  // Connect first/last points - default ON
    const [redrawKey, setRedrawKey] = useState(0);  // Used to force canvas redraw
    const [hoveredManualPoint, setHoveredManualPoint] = useState<number | null>(null);  // Index of point under mouse
    const [draggingManualPoint, setDraggingManualPoint] = useState<number | null>(null);  // Index of point being dragged
    const [isDraggingFile, setIsDraggingFile] = useState(false);  // For drag-drop file upload

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const gifSessionRef = useRef<GifFrameSession | null>(null);
    const gifBitmapRef = useRef<ImageBitmap | null>(null);
    const gifPlanRef = useRef<TrackingGifPlan | null>(null);
    const mediaGenerationRef = useRef(0);
    const objectUrlRef = useRef('');
    const currentFrameRef = useRef(0);
    const timelineInputRef = useRef<HTMLInputElement>(null);
    const timelineLabelRef = useRef<HTMLSpanElement>(null);
    const timelineTimeRef = useRef<HTMLSpanElement>(null);
    const drawCanvasRef = useRef<() => void>(() => {});

    const updateTimeline = useCallback((frame: number, totalFrames: number, fps: number) => {
        const safeFrame = Math.max(0, Math.min(Math.max(0, totalFrames - 1), frame));
        currentFrameRef.current = safeFrame;
        if (timelineInputRef.current) timelineInputRef.current.value = String(safeFrame);
        if (timelineLabelRef.current) {
            timelineLabelRef.current.textContent = `Frame ${safeFrame + 1} / ${totalFrames}`;
        }
        if (timelineTimeRef.current) {
            timelineTimeRef.current.textContent = `${(safeFrame / Math.max(1, fps)).toFixed(2)}s`;
        }
    }, []);

    const releaseMedia = useCallback(() => {
        mediaGenerationRef.current += 1;
        setIsPlaying(false);
        videoRef.current?.pause();
        gifSessionRef.current?.close();
        gifSessionRef.current = null;
        gifBitmapRef.current?.close();
        gifBitmapRef.current = null;
        gifPlanRef.current = null;
        canvasRef.current?.removeAttribute('data-gif-delivered-frame');
        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = '';
        currentFrameRef.current = 0;
    }, []);

    useEffect(() => {
        if (isOpen) {
            setRedrawKey(prev => prev + 1);
        } else {
            releaseMedia();
            setVideoState(EMPTY_VIDEO_STATE);
            setError(null);
        }
    }, [isOpen, releaseMedia]);

    useEffect(() => () => releaseMedia(), [releaseMedia]);

    const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        releaseMedia();
        const generationId = ++mediaGenerationRef.current;
        const isGif = file.type === 'image/gif' || file.name.toLowerCase().endsWith('.gif');
        const url = isGif ? `gif-worker:${generationId}` : URL.createObjectURL(file);
        if (!isGif) objectUrlRef.current = url;
        setVideoState(prev => ({
            ...prev,
            url,
            currentFrame: 0,
            isLoading: true,
            isGif,
        }));
        setError(null);
        setManualPoints([]);

        try {
            if (isGif) {
                if (file.size > TRACKING_GIF_MAX_COMPRESSED_BYTES) {
                    throw new Error('GIF files must be 32MB or smaller.');
                }
                const arrayBuffer = await file.arrayBuffer();
                if (generationId !== mediaGenerationRef.current) return;
                let session: GifFrameSession;
                session = createGifFrameSession({
                    generationId,
                    buffer: arrayBuffer,
                    onReady: plan => {
                        if (generationId !== mediaGenerationRef.current) return;
                        gifPlanRef.current = plan;
                        const fps = Math.max(1, plan.fps);
                        setVideoState({
                            url,
                            currentFrame: 0,
                            totalFrames: plan.sampledFrames,
                            fps,
                            width: plan.width,
                            height: plan.height,
                            isLoading: true,
                            isGif: true
                        });
                        session.requestFrame(0);
                    },
                    onFrame: (frame, bitmap) => {
                        if (generationId !== mediaGenerationRef.current) {
                            bitmap.close();
                            return;
                        }
                        const activePlan = gifPlanRef.current;
                        if (!activePlan) {
                            bitmap.close();
                            return;
                        }
                        gifBitmapRef.current?.close();
                        gifBitmapRef.current = bitmap;
                        if (canvasRef.current) {
                            canvasRef.current.dataset.gifDeliveredFrame = String(frame);
                        }
                        drawCanvasRef.current();
                        updateTimeline(frame, activePlan.sampledFrames, activePlan.fps);
                        setVideoState(prev => prev.isLoading
                            ? { ...prev, isLoading: false }
                            : prev);
                    },
                    onError: message => {
                        if (generationId !== mediaGenerationRef.current) return;
                        releaseMedia();
                        setVideoState(EMPTY_VIDEO_STATE);
                        setError(`Failed to load media: ${message}`);
                    },
                    limits: mediaLimits,
                });
                gifSessionRef.current = session;
            } else {
                const video = document.createElement('video');
                video.preload = 'metadata';
                video.src = url;

                await new Promise<void>((resolve, reject) => {
                    video.onloadedmetadata = () => resolve();
                    video.onerror = () => reject(new Error('Failed to load video'));
                });

                if (generationId !== mediaGenerationRef.current) return;
                const duration = Math.max(1 / mediaLimits.maxFramesPerSecond, video.duration);
                const totalFrames = Math.max(1, Math.min(
                    mediaLimits.maxFrames,
                    Math.ceil(duration * mediaLimits.maxFramesPerSecond),
                ));
                const fps = Math.max(1, Math.min(mediaLimits.maxFramesPerSecond, totalFrames / duration));
                const dimensions = fitTrackingMediaDimensions(
                    video.videoWidth || 640,
                    video.videoHeight || 480,
                    mediaLimits.maxEdgePx,
                );

                setVideoState({
                    url,
                    currentFrame: 0,
                    totalFrames,
                    fps,
                    width: dimensions.width,
                    height: dimensions.height,
                    isLoading: false,
                    isGif: false
                });
                updateTimeline(0, totalFrames, fps);
                video.remove();
            }
        } catch (err) {
            if (generationId !== mediaGenerationRef.current) return;
            releaseMedia();
            setVideoState(EMPTY_VIDEO_STATE);
            setError('Failed to load media: ' + (err instanceof Error ? err.message : 'Unknown error'));
        } finally {
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    // Process a dropped or selected file
    const processDroppedFile = async (file: File) => {
        const validTypes = ['video/mp4', 'video/webm', 'image/gif'];
        const isValidExtension = file.name.toLowerCase().match(/\.(mp4|webm|gif)$/);

        if (!validTypes.includes(file.type) && !isValidExtension) {
            setError('Unsupported format. Please use MP4, WebM, or GIF.');
            return;
        }

        // Reuse the same file-selection path for drop and picker input.
        const syntheticEvent = {
            target: { files: [file] }
        } as unknown as React.ChangeEvent<HTMLInputElement>;

        await handleFileSelect(syntheticEvent);
    };

    // Drag and drop handlers
    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDraggingFile(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDraggingFile(false);
    };

    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDraggingFile(false);

        const files = e.dataTransfer.files;
        if (files.length > 0) {
            await processDroppedFile(files[0]);
        }
    };

    const seekToFrame = useCallback((frame: number) => {
        setIsPlaying(false);
        const targetFrame = Math.max(
            0,
            Math.min(Math.max(0, videoState.totalFrames - 1), frame),
        );
        if (videoState.isGif) {
            gifSessionRef.current?.requestFrame(targetFrame);
            if (timelineInputRef.current) {
                timelineInputRef.current.value = String(currentFrameRef.current);
            }
            return;
        }
        updateTimeline(targetFrame, videoState.totalFrames, videoState.fps);
        if (videoRef.current && !videoState.isGif) {
            const time = currentFrameRef.current / videoState.fps;
            videoRef.current.currentTime = time;
        }
    }, [updateTimeline, videoState.fps, videoState.isGif, videoState.totalFrames]);

    useEffect(() => {
        if (!isOpen || !isPlaying || videoState.totalFrames <= 1) return;
        let cancelled = false;
        let animationFrame = 0;
        let videoFrame = 0;

        if (videoState.isGif) {
            let nextFrameAt = performance.now();
            const tick = (time: number) => {
                if (cancelled) return;
                if (time >= nextFrameAt) {
                    const nextFrame = (currentFrameRef.current + 1) % videoState.totalFrames;
                    gifSessionRef.current?.requestFrame(nextFrame);
                    nextFrameAt = time + 1000 / videoState.fps;
                }
                animationFrame = requestAnimationFrame(tick);
            };
            animationFrame = requestAnimationFrame(tick);
        } else {
            const video = videoRef.current;
            if (!video) return;
            video.loop = true;
            const drawVideoFrame = (_time: number, metadata?: VideoFrameCallbackMetadata) => {
                if (cancelled) return;
                const mediaTime = metadata?.mediaTime ?? video.currentTime;
                const frame = Math.min(
                    videoState.totalFrames - 1,
                    Math.floor(mediaTime * videoState.fps),
                );
                if (frame !== currentFrameRef.current) {
                    updateTimeline(frame, videoState.totalFrames, videoState.fps);
                    drawCanvasRef.current();
                }
                if ('requestVideoFrameCallback' in video) {
                    videoFrame = video.requestVideoFrameCallback(drawVideoFrame);
                } else {
                    animationFrame = requestAnimationFrame((time) => drawVideoFrame(time));
                }
            };
            void video.play().catch(() => setIsPlaying(false));
            if ('requestVideoFrameCallback' in video) {
                videoFrame = video.requestVideoFrameCallback(drawVideoFrame);
            } else {
                animationFrame = requestAnimationFrame((time) => drawVideoFrame(time));
            }
        }

        return () => {
            cancelled = true;
            if (animationFrame) cancelAnimationFrame(animationFrame);
            const video = videoRef.current;
            if (videoFrame && video && 'cancelVideoFrameCallback' in video) {
                video.cancelVideoFrameCallback(videoFrame);
            }
            video?.pause();
        };
    }, [isOpen, isPlaying, updateTimeline, videoState.fps, videoState.isGif, videoState.totalFrames]);

    // Helper to convert mouse event to canvas coordinates
    const getCanvasCoordinates = (event: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (!canvas) return null;

        const rect = canvas.getBoundingClientRect();
        const canvasAspect = canvas.width / canvas.height;
        const containerAspect = rect.width / rect.height;

        let renderWidth, renderHeight, offsetX, offsetY;
        if (canvasAspect > containerAspect) {
            renderWidth = rect.width;
            renderHeight = rect.width / canvasAspect;
            offsetX = 0;
            offsetY = (rect.height - renderHeight) / 2;
        } else {
            renderHeight = rect.height;
            renderWidth = rect.height * canvasAspect;
            offsetX = (rect.width - renderWidth) / 2;
            offsetY = 0;
        }

        const clickX = event.clientX - rect.left - offsetX;
        const clickY = event.clientY - rect.top - offsetY;

        if (clickX < 0 || clickX > renderWidth || clickY < 0 || clickY > renderHeight) {
            return null;
        }

        return {
            x: (clickX / renderWidth) * canvas.width,
            y: (clickY / renderHeight) * canvas.height
        };
    };

    // Helper: Find if a point is at the given coordinates (within hit radius)
    const getManualPointAtPosition = (coords: { x: number; y: number }): number | null => {
        const HIT_RADIUS = 15;  // Pixels tolerance for clicking on a point
        for (let i = 0; i < manualPoints.length; i++) {
            const pt = manualPoints[i];
            const dist = Math.hypot(pt.x - coords.x, pt.y - coords.y);
            if (dist <= HIT_RADIUS) {
                return i;
            }
        }
        return null;
    };

    // Handle mouse DOWN - manual mode: drag point or add new
    const handleCanvasMouseDown = (event: React.MouseEvent<HTMLCanvasElement>) => {
        if (event.button !== 0 || !videoState.url) return; // Left click only

        const coords = getCanvasCoordinates(event);
        if (!coords) return;

        // MANUAL MODE: Check if clicking on existing point to drag, or add new
        const pointIndex = getManualPointAtPosition(coords);
        if (pointIndex !== null) {
            // Start dragging existing point
            setDraggingManualPoint(pointIndex);
        } else {
            // Add new point
            setManualPoints(prev => [...prev, coords]);
        }
    };

    // Handle mouse MOVE - drag manual point, update rectangle, or track hover
    const handleCanvasMouseMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
        const coords = getCanvasCoordinates(event);
        if (!coords) return;

        // Manual mode: Handle point dragging or hover detection
        if (draggingManualPoint !== null) {
            // Update dragged point position
            setManualPoints(prev => prev.map((pt, i) =>
                i === draggingManualPoint ? coords : pt
            ));
        } else {
            // Check for hover over points
            const pointIndex = getManualPointAtPosition(coords);
            setHoveredManualPoint(pointIndex);
        }
    };

    // Handle mouse UP - finish rectangle selection or stop dragging
    const handleCanvasMouseUp = (event: React.MouseEvent<HTMLCanvasElement>) => {
        // Stop any manual point dragging
        if (draggingManualPoint !== null) {
            setDraggingManualPoint(null);
            return;
        }
    };

    // Handle canvas RIGHT click - delete single point in manual mode
    const handleCanvasRightClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
        event.preventDefault();

        // MANUAL MODE: Delete only the clicked point (if any)
        const coords = getCanvasCoordinates(event);
        if (coords) {
            const pointIndex = getManualPointAtPosition(coords);
            if (pointIndex !== null) {
                // Remove only this point
                setManualPoints(prev => prev.filter((_, i) => i !== pointIndex));
                return;
            }
        }
    };

    const drawCanvas = useCallback(() => {
        const canvas = canvasRef.current;
        const video = videoRef.current;
        if (!canvas || !videoState.url) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (videoState.isGif) {
            if (gifBitmapRef.current) {
                ctx.drawImage(gifBitmapRef.current, 0, 0, canvas.width, canvas.height);
            }
        } else if (video?.readyState && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        }

        if (manualPoints.length === 0) return;
        const scaleX = canvas.width / videoState.width;
        const scaleY = canvas.height / videoState.height;
        const displayPoints = smoothTrackingPoints(manualPoints, {
            enabled: enableSmoothing,
            connectEndPoints
        });
        if (displayPoints.length > 1) {
            ctx.beginPath();
            ctx.moveTo(displayPoints[0].x * scaleX, displayPoints[0].y * scaleY);
            for (let i = 1; i < displayPoints.length; i++) {
                ctx.lineTo(displayPoints[i].x * scaleX, displayPoints[i].y * scaleY);
            }
            if (connectEndPoints) {
                ctx.lineTo(displayPoints[0].x * scaleX, displayPoints[0].y * scaleY);
            }
            ctx.strokeStyle = enableSmoothing ? 'rgba(150, 100, 255, 0.9)' : 'rgba(100, 200, 255, 0.9)';
            ctx.lineWidth = 3;
            ctx.setLineDash([]);
            ctx.stroke();
        }
        manualPoints.forEach((pt, idx) => {
            const isHovered = hoveredManualPoint === idx;
            const isDragging = draggingManualPoint === idx;
            const radius = (isHovered || isDragging) ? 12 : 8;
            ctx.beginPath();
            ctx.arc(pt.x * scaleX, pt.y * scaleY, radius, 0, Math.PI * 2);
            ctx.fillStyle = isDragging
                ? '#ff6600'
                : isHovered
                    ? '#ffff00'
                    : idx === 0
                        ? '#00ff00'
                        : '#00aaff';
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.fillStyle = '#000';
            ctx.font = 'bold 10px Arial';
            ctx.textAlign = 'center';
            ctx.fillText(`${idx + 1}`, pt.x * scaleX, pt.y * scaleY + 3);
        });
    }, [connectEndPoints, draggingManualPoint, enableSmoothing, hoveredManualPoint, manualPoints, videoState.height, videoState.isGif, videoState.url, videoState.width]);
    drawCanvasRef.current = drawCanvas;

    useEffect(() => {
        if (isOpen) drawCanvas();
    }, [drawCanvas, isOpen, redrawKey]);



    // Transfer path to main canvas - normalized and centered
    const handleTransfer = () => {
        if (manualPoints.length < 2) return;
        const points: Point[] = trackingPointsToWorldPath(manualPoints, {
            enabled: enableSmoothing,
            connectEndPoints
        });
        onTransfer(points);
        releaseMedia();
        onClose();
    };

    const closeModal = () => {
        releaseMedia();
        onClose();
    };

    if (!isOpen) return null;

    const modal = (
        <div
            className="fixed inset-0 bg-black/80 flex items-center justify-center p-4"
            style={{ zIndex: 1000, background: 'rgba(0, 0, 0, 0.8)' }}
        >
            <div
                className="bg-slate-800 rounded-xl shadow-2xl w-[95vw] h-[95vh] overflow-hidden flex flex-col"
                style={{ width: '95vw', height: '95vh', background: '#1e293b' }}
                data-testid="tracking-modal"
                data-media-policy={`max-${mediaLimits.maxEdgePx}px-${mediaLimits.maxFramesPerSecond}fps-${mediaLimits.maxFrames}-samples-one-bitmap`}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700">
                    <div className="flex items-center gap-3">
                        <Crosshair className="w-5 h-5 text-blue-400" />
                        <h2 className="text-lg font-semibold text-white">Trace</h2>
                    </div>

                    <button onClick={closeModal} className="p-1 hover:bg-slate-700 rounded" aria-label="Close trace">
                        <X className="w-5 h-5 text-slate-400" />
                    </button>
                </div>

                {/* Main Content */}
                <div className="flex-1 flex flex-col p-4 gap-4 overflow-auto">
                    {/* Video Canvas */}
                    <div
                        className="relative bg-slate-900 rounded-lg overflow-hidden flex-1"
                        style={{ minHeight: '500px' }}
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onDrop={handleDrop}
                    >
                        {!videoState.url ? (
                            <div
                                className={`absolute inset-0 flex flex-col items-center justify-center cursor-pointer border-2 border-dashed rounded-lg transition-all duration-200 ${isDraggingFile
                                    ? 'border-blue-400 bg-blue-500/10 text-blue-400'
                                    : 'border-slate-700 text-slate-500 hover:border-slate-500 hover:text-slate-400'
                                    }`}
                                onClick={() => fileInputRef.current?.click()}
                            >
                                <Upload className={`w-16 h-16 mb-4 ${isDraggingFile ? 'animate-bounce' : ''}`} />
                                <p className="text-lg font-medium mb-2">
                                    {isDraggingFile ? 'Drop' : 'Drop media'}
                                </p>
                                <p className="text-sm opacity-70">Browse</p>
                                <p className="text-xs mt-3 opacity-50">MP4 · WebM · GIF</p>
                            </div>
                        ) : (
                            <>
                                {/* Hidden video element for video files */}
                                {!videoState.isGif && (
                                    <video
                                        ref={videoRef}
                                        src={videoState.url}
                                        className="hidden"
                                        preload="metadata"
                                        onLoadedData={() => {
                                            if (videoRef.current) {
                                                videoRef.current.currentTime = 0;
                                                drawCanvasRef.current();
                                            }
                                        }}
                                        onSeeked={() => drawCanvasRef.current()}
                                    />
                                )}
                                <canvas
                                    ref={canvasRef}
                                    width={videoState.width}
                                    height={videoState.height}
                                    onMouseDown={handleCanvasMouseDown}
                                    onMouseMove={handleCanvasMouseMove}
                                    onMouseUp={handleCanvasMouseUp}
                                    onMouseLeave={handleCanvasMouseUp}
                                    onContextMenu={handleCanvasRightClick}
                                    className="w-full h-full cursor-crosshair object-contain"
                                />
                            </>
                        )}

                        {videoState.isLoading && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                                <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
                            </div>
                        )}
                    </div>

                    {/* Timeline Slider */}
                    {videoState.url && !videoState.isLoading && (
                        <div className="flex items-center gap-3 px-2">
                            {/* Play/Stop Button */}
                            <button
                                onClick={() => setIsPlaying(!isPlaying)}
                                className={`p-2 rounded-lg transition-colors ${isPlaying
                                    ? 'bg-red-600 hover:bg-red-500 text-white'
                                    : 'bg-green-600 hover:bg-green-500 text-white'
                                    }`}
                                title={isPlaying ? 'Stop' : 'Play'}
                            >
                                {isPlaying ? <Square className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                            </button>

                            <span ref={timelineLabelRef} className="text-xs text-slate-400 w-20">
                                Frame {videoState.currentFrame + 1} / {videoState.totalFrames}
                            </span>
                            <input
                                ref={timelineInputRef}
                                key={videoState.url}
                                type="range"
                                min={0}
                                max={Math.max(0, videoState.totalFrames - 1)}
                                defaultValue={videoState.currentFrame}
                                onChange={(e) => {
                                    seekToFrame(parseInt(e.target.value));
                                }}
                                className="flex-1 accent-blue-500 cursor-pointer"
                            />
                            <span ref={timelineTimeRef} className="text-xs text-slate-400 w-16 text-right">
                                {(videoState.currentFrame / videoState.fps).toFixed(2)}s
                            </span>
                        </div>
                    )}

                    {/* Error Display */}
                    {error && (
                        <div className="bg-red-900/30 border border-red-500/50 rounded-lg px-4 py-2 text-red-300 text-sm flex items-center gap-2">
                            <AlertCircle className="w-4 h-4" />
                            {error}
                        </div>
                    )}
                </div>

                {/* Controls Footer */}
                <div className="flex items-center justify-between px-4 py-3 border-t border-slate-700 bg-slate-800/50">
                    <div className="flex gap-2 items-center">
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="video/mp4,video/webm,image/gif"
                            onChange={handleFileSelect}
                            className="hidden"
                        />
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
                        >
                            <Upload className="w-4 h-4" />
                            Load Media
                        </button>



                        {/* Path Info - show simple trace readiness */}

                        {manualPoints.length > 0 && (
                            <span className="text-cyan-400 text-sm px-3">
                                ✓ Path ready
                            </span>
                        )}
                    </div>

                    <div className="flex gap-2">
                        {/* Smoothing checkbox for manual mode - next to Transfer button */}
                        <label className="flex items-center gap-2 px-3 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={enableSmoothing}
                                onChange={(e) => setEnableSmoothing(e.target.checked)}
                                className="w-4 h-4 rounded border-slate-600 bg-slate-700 text-blue-500 focus:ring-blue-500 accent-blue-500"
                            />
                            <span className="text-sm text-slate-300">Smooth</span>
                        </label>

                        {/* Connect end points checkbox */}
                        <label className="flex items-center gap-2 px-3 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={connectEndPoints}
                                onChange={(e) => setConnectEndPoints(e.target.checked)}
                                className="w-4 h-4 rounded border-slate-600 bg-slate-700 text-blue-500 focus:ring-blue-500 accent-blue-500"
                            />
                            <span className="text-sm text-slate-300">Close loop</span>
                        </label>

                        <button
                            onClick={handleTransfer}
                            disabled={manualPoints.length < 2}
                            className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-500 disabled:bg-slate-600 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
                        >
                            <ArrowRight className="w-4 h-4" />
                            Use path
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );

    return typeof document === 'undefined' ? modal : createPortal(modal, document.body);
};
