
import React, { useState, useEffect } from 'react';
import { GlobalConfig, MechanismConfig, MechanismType } from '../types';
import { Play, Pause, RefreshCw, Info, MousePointer2, Pencil, Sparkles, Trash2, Save, ChevronRight, ChevronDown, Gauge, Component, MoveHorizontal, Settings2, Plus, Route, Timer, Download, FileJson, ListTree, Crosshair } from 'lucide-react';
import { mechanismTemplateLabel } from '../utils/mechanismTemplates';

interface Preset {
    name: string;
    conf: GlobalConfig;
}

export interface OptimizationOptions {
    forcedType?: MechanismType;
    excludeCurrent?: boolean;
    testAllTypes?: boolean;
    seedMechanism?: MechanismConfig;
}

interface ControlsProps {
    config: GlobalConfig;
    setConfig: React.Dispatch<React.SetStateAction<GlobalConfig>>;
    selectedId: string | null;
    setSelectedId: (id: string) => void;
    isPlaying: boolean;
    setIsPlaying: (val: boolean) => void;
    showTrace: boolean;
    setShowTrace: (val: boolean) => void;
    isDrawMode: boolean;
    toggleDrawMode: () => void;
    clearUserPath: () => void;
    onOptimize: (options: OptimizationOptions) => void;
    isOptimizing: boolean;
    presets: Preset[];
    onSavePreset: () => void;
    onLoadPreset: (conf: GlobalConfig) => void;
    optimizationDuration: number;
    setOptimizationDuration: (val: number) => void;
    onExportSVG: () => void;
    onExportDXF: () => void;
    onOpenTracking?: () => void;
    angle: number;  // Current animation angle in radians
    setAngle: (val: number) => void;  // Set animation angle
}

const Slider: React.FC<{
    label: string;
    value: number;
    min: number;
    max: number;
    onChange: (val: number) => void;
    unit?: string;
    disabled?: boolean;
    step?: number;
}> = ({ label, value, min, max, onChange, unit, disabled, step = 1 }) => (
    <div className={`mb-4 relative z-0 ${disabled ? 'opacity-50' : ''}`}>
        <div className="flex justify-between mb-1 items-center">
            <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">{label}</label>
            <div className="flex items-center">
                <input
                    type="number"
                    value={parseFloat(value.toFixed(step < 1 ? 2 : 0))}
                    step={step}
                    min={min}
                    max={max}
                    onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        if (!isNaN(val)) onChange(val);
                    }}
                    disabled={disabled}
                    className="text-xs text-slate-600 font-mono bg-slate-100 px-1 py-0.5 rounded border border-transparent hover:border-slate-300 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none w-16 text-right transition-all"
                />
                {unit && <span className="text-xs text-slate-400 ml-1">{unit}</span>}
            </div>
        </div>
        <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(e) => onChange(Number(e.target.value))}
            disabled={disabled}
            className="w-full h-8 cursor-pointer relative z-10"
        />
    </div>
);

// Circular rotation dial component
const CircularDial: React.FC<{
    value: number;  // 0-360
    onChange: (val: number) => void;
    size?: number;
}> = ({ value, onChange, size = 100 }) => {
    const [isDragging, setIsDragging] = React.useState(false);
    const dialRef = React.useRef<SVGSVGElement>(null);

    const center = size / 2;
    const radius = size * 0.35;
    const arcRadius = size * 0.42;
    const strokeWidth = size * 0.06;

    // Convert angle to SVG arc coordinates
    const polarToCartesian = (cx: number, cy: number, r: number, angleDeg: number) => {
        const angleRad = (angleDeg - 90) * Math.PI / 180;
        return {
            x: cx + r * Math.cos(angleRad),
            y: cy + r * Math.sin(angleRad)
        };
    };

    // Create arc path
    const describeArc = (x: number, y: number, r: number, startAngle: number, endAngle: number) => {
        if (endAngle - startAngle >= 360) {
            // Full circle
            return `M ${x} ${y - r} A ${r} ${r} 0 1 1 ${x - 0.001} ${y - r}`;
        }
        const start = polarToCartesian(x, y, r, endAngle);
        const end = polarToCartesian(x, y, r, startAngle);
        const largeArcFlag = endAngle - startAngle <= 180 ? 0 : 1;
        return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`;
    };

    // Update angle from mouse position (works with both React and native events)
    const updateAngleFromPosition = (clientX: number, clientY: number) => {
        if (!dialRef.current) return;
        const rect = dialRef.current.getBoundingClientRect();
        const x = clientX - rect.left - center;
        const y = clientY - rect.top - center;
        let angle = Math.atan2(y, x) * 180 / Math.PI + 90;
        if (angle < 0) angle += 360;
        onChange(Math.round(angle) % 360);
    };

    const handleMouseDown = (e: React.MouseEvent) => {
        e.preventDefault();
        setIsDragging(true);
        updateAngleFromPosition(e.clientX, e.clientY);
    };

    // Handle document-level mouse events for smooth dragging outside the dial
    React.useEffect(() => {
        if (!isDragging) return;

        const handleGlobalMouseMove = (e: MouseEvent) => {
            updateAngleFromPosition(e.clientX, e.clientY);
        };

        const handleGlobalMouseUp = () => {
            setIsDragging(false);
        };

        document.addEventListener('mousemove', handleGlobalMouseMove);
        document.addEventListener('mouseup', handleGlobalMouseUp);

        return () => {
            document.removeEventListener('mousemove', handleGlobalMouseMove);
            document.removeEventListener('mouseup', handleGlobalMouseUp);
        };
    }, [isDragging, center, onChange]);

    // Knob position
    const knobPos = polarToCartesian(center, center, radius * 0.7, value);

    return (
        <div className="flex flex-col items-center mb-4">
            <label className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">Rotation</label>
            <div className="flex items-center">
                {/* Quick buttons on left side as column */}
                <div className="flex flex-col gap-1 mr-2">
                    {[0, 90, 180, 270].map(ang => (
                        <button
                            key={ang}
                            onClick={() => onChange(ang)}
                            className={`px-2 py-1 text-xs font-medium rounded transition-colors ${Math.round(value) === ang
                                ? 'bg-indigo-100 text-indigo-700 border border-indigo-200'
                                : 'bg-slate-100 text-slate-500 hover:bg-slate-200 border border-slate-200'
                                }`}
                        >
                            {ang}°
                        </button>
                    ))}
                </div>
                <svg
                    ref={dialRef}
                    width={size}
                    height={size}
                    onMouseDown={handleMouseDown}
                    className="cursor-pointer select-none"
                    style={{ touchAction: 'none' }}
                >
                    {/* Background circle */}
                    <circle
                        cx={center}
                        cy={center}
                        r={radius}
                        fill="#f1f5f9"
                        stroke="#e2e8f0"
                        strokeWidth="2"
                    />

                    {/* Arc track (background) */}
                    <circle
                        cx={center}
                        cy={center}
                        r={arcRadius}
                        fill="none"
                        stroke="#e2e8f0"
                        strokeWidth={strokeWidth}
                        strokeLinecap="round"
                    />

                    {/* Arc progress (indigo color) */}
                    {value > 0 && (
                        <path
                            d={describeArc(center, center, arcRadius, 0, value)}
                            fill="none"
                            stroke="#6366f1"
                            strokeWidth={strokeWidth}
                            strokeLinecap="round"
                        />
                    )}

                    {/* Center display */}
                    <circle
                        cx={center}
                        cy={center}
                        r={radius * 0.65}
                        fill="white"
                        stroke="#e2e8f0"
                        strokeWidth="1"
                    />

                    {/* Value text */}
                    <text
                        x={center}
                        y={center + 4}
                        textAnchor="middle"
                        className="text-sm font-bold fill-slate-700"
                        style={{ fontSize: size * 0.16 }}
                    >
                        {Math.round(value)}°
                    </text>

                    {/* Knob indicator */}
                    <circle
                        cx={knobPos.x}
                        cy={knobPos.y}
                        r={size * 0.06}
                        fill="#6366f1"
                        stroke="white"
                        strokeWidth="2"
                        className="drop-shadow-sm"
                    />
                </svg>
            </div>
        </div>
    );
};

export const Controls: React.FC<ControlsProps> = ({
    config, setConfig, selectedId, setSelectedId, isPlaying, setIsPlaying,
    showTrace, setShowTrace, isDrawMode, toggleDrawMode,
    clearUserPath, onOptimize, isOptimizing,
    presets, onSavePreset, onLoadPreset,
    optimizationDuration, setOptimizationDuration,
    onExportSVG, onExportDXF, onOpenTracking,
    angle, setAngle
}) => {

    const [optimizingTarget, setOptimizingTarget] = useState<'path' | 'shape' | null>(null);
    const [optDropdownOpen, setOptDropdownOpen] = useState(false);
    const [optPresetOpen, setOptPresetOpen] = useState(false);

    // Reset loading state when optimization finishes
    useEffect(() => {
        if (!isOptimizing) setOptimizingTarget(null);
    }, [isOptimizing]);

    // Close preset sub-menu when main dropdown closes
    useEffect(() => {
        if (!optDropdownOpen) setOptPresetOpen(false);
    }, [optDropdownOpen]);

    const activeMech = config.mechanisms.find(m => m.id === selectedId);

    const updateActiveMech = (updates: Partial<MechanismConfig>) => {
        if (!selectedId) return;
        setConfig(prev => ({
            ...prev,
            mechanisms: prev.mechanisms.map(m => m.id === selectedId ? { ...m, ...updates } : m)
        }));
    };

    const handleOptimizePath = () => {
        if (!activeMech) return;
        setOptimizingTarget('path');
        // Lock optimization to current type
        onOptimize({ forcedType: activeMech.type });
    };

    const handleChangePreset = () => {
        if (!selectedId) return;
        setOptimizingTarget('shape');
        // Test ALL mechanism types and find the best one
        onOptimize({ testAllTypes: true });
    };

    const handleOptimizeWithPreset = (presetConf: GlobalConfig) => {
        if (!selectedId) return;
        // We assume the preset has at least one mechanism and we take the type of the first one
        if (presetConf.mechanisms.length > 0) {
            const mech = presetConf.mechanisms[0];
            setOptimizingTarget('shape');
            onOptimize({
                forcedType: mech.type,
                seedMechanism: mech
            });
        }
    };

    const getMechLabel = (type: MechanismType) => mechanismTemplateLabel(type);

    return (
        <div className="h-full flex flex-col bg-slate-50 border-r border-slate-300 shadow-xl overflow-hidden">
            <div className="p-5 border-b border-slate-200 bg-white flex-shrink-0">
                <h1 className="text-xl font-extrabold text-slate-800 flex items-center gap-2 tracking-tight">
                    <div className="p-1.5 bg-indigo-100 rounded-md">
                        <RefreshCw className="w-5 h-5 text-indigo-600" />
                    </div>
                    MotionSmith
                </h1>
            </div>

            <div className="p-5 border-b border-slate-200 bg-slate-100/50 flex-shrink-0 relative z-20">
                {/* Tracking Button */}
                {onOpenTracking && (
                    <button
                        onClick={onOpenTracking}
                        className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-sm font-bold bg-purple-600 text-white border border-purple-700 shadow-sm hover:bg-purple-500 transition-all mb-3"
                    >
                        <Crosshair size={14} />
                        Tracking
                    </button>
                )}

                <div className="grid grid-cols-2 gap-2 mb-3">
                    <button
                        onClick={toggleDrawMode}
                        className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-sm font-bold border shadow-sm transition-all ${isDrawMode
                            ? 'bg-indigo-600 text-white border-indigo-700 ring-2 ring-indigo-200'
                            : 'bg-white text-slate-700 border-slate-300 hover:border-indigo-300 hover:text-indigo-600'
                            }`}
                    >
                        <Pencil size={14} />
                        {isDrawMode ? 'Done' : 'Draw'}
                    </button>
                    <button
                        onClick={clearUserPath}
                        className="flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-sm font-medium bg-white text-slate-600 border border-slate-300 shadow-sm hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-colors"
                    >
                        <Trash2 size={14} />
                        Clear
                    </button>
                </div>

                <div className="relative z-50">
                    <button
                        onClick={() => setOptDropdownOpen(!optDropdownOpen)}
                        disabled={isOptimizing || !selectedId}
                        className={`w-full flex items-center justify-between gap-2 py-3 px-4 rounded-lg text-sm font-bold text-white shadow-sm transition-all active:scale-95 border-b-2 ${isOptimizing || !selectedId
                            ? 'bg-slate-300 border-slate-400 text-slate-500 cursor-not-allowed'
                            : 'bg-indigo-600 border-indigo-800 hover:bg-indigo-700'
                            }`}
                    >
                        <div className="flex items-center gap-2">
                            {isOptimizing ? <RefreshCw size={16} className="animate-spin" /> : <Sparkles size={16} />}
                            <span>{isOptimizing ? (optimizingTarget === 'path' ? 'Refining...' : 'Searching...') : 'Machine Optimizer'}</span>
                        </div>
                        <ChevronDown size={16} className={`transition-transform ${optDropdownOpen ? 'rotate-180' : ''}`} />
                    </button>

                    {optDropdownOpen && !isOptimizing && (
                        <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-lg shadow-xl border border-slate-200 overflow-hidden p-1 animate-in fade-in slide-in-from-top-2 max-h-[400px] overflow-y-auto">
                            <button
                                onClick={() => {
                                    setOptDropdownOpen(false);
                                    handleOptimizePath();
                                }}
                                className="w-full flex items-center gap-3 px-3 py-2 text-left text-xs font-bold text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 rounded-md transition-colors"
                            >
                                <div className="p-1.5 bg-indigo-100 text-indigo-600 rounded">
                                    <Route size={14} />
                                </div>
                                <div>
                                    <div className="block">Path Optimization</div>
                                    <div className="text-[10px] font-normal text-slate-400">Refine current mechanism parameters</div>
                                </div>
                            </button>

                            <button
                                onClick={() => {
                                    setOptDropdownOpen(false);
                                    handleChangePreset();
                                }}
                                className="w-full flex items-center gap-3 px-3 py-2 text-left text-xs font-bold text-slate-700 hover:bg-fuchsia-50 hover:text-fuchsia-700 rounded-md transition-colors mt-1"
                            >
                                <div className="p-1.5 bg-fuchsia-100 text-fuchsia-600 rounded">
                                    <Component size={14} />
                                </div>
                                <div>
                                    <div className="block">Find Best Mechanism</div>
                                    <div className="text-[10px] font-normal text-slate-400">Test all types and pick the best match</div>
                                </div>
                            </button>

                            <div className="mt-1 border-t border-slate-100 pt-1">
                                <button
                                    onClick={() => setOptPresetOpen(!optPresetOpen)}
                                    className={`w-full flex items-center gap-3 px-3 py-2 text-left text-xs font-bold text-slate-700 hover:bg-emerald-50 hover:text-emerald-700 rounded-md transition-colors ${optPresetOpen ? 'bg-emerald-50 text-emerald-700' : ''}`}
                                >
                                    <div className="p-1.5 bg-emerald-100 text-emerald-600 rounded">
                                        <ListTree size={14} />
                                    </div>
                                    <div className="flex-1">
                                        <div className="block">Predict with specific preset</div>
                                        <div className="text-[10px] font-normal text-slate-400">Fit path using selected type</div>
                                    </div>
                                    <ChevronRight size={14} className={`transition-transform ${optPresetOpen ? 'rotate-90' : ''}`} />
                                </button>

                                {optPresetOpen && (
                                    <div className="ml-2 mr-2 mb-1 pl-4 border-l-2 border-slate-100 space-y-1 mt-1">
                                        {presets.map((p, i) => (
                                            <button
                                                key={i}
                                                onClick={() => {
                                                    setOptDropdownOpen(false);
                                                    handleOptimizeWithPreset(p.conf);
                                                }}
                                                className="w-full text-left text-[11px] font-medium text-slate-600 py-1.5 px-2 rounded hover:bg-slate-100 hover:text-slate-900 transition-colors truncate"
                                            >
                                                {p.name}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <div className="mt-2 pt-2 border-t border-slate-100 px-2 pb-1">
                                <div className="flex items-center justify-between mb-1">
                                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Duration</span>
                                    <span className="text-[9px] text-slate-400 font-mono">{optimizationDuration > 0 ? `${optimizationDuration}s` : 'Auto'}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <div className="relative flex-1">
                                        <input
                                            type="number"
                                            min="0"
                                            max="600"
                                            value={optimizationDuration}
                                            onChange={(e) => setOptimizationDuration(Math.max(0, parseInt(e.target.value) || 0))}
                                            className="w-full pl-7 pr-2 py-1 text-xs font-mono text-slate-700 bg-slate-50 border border-slate-200 rounded focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                                            placeholder="0"
                                        />
                                        <Timer size={10} className="absolute left-2 top-1.5 text-slate-400 pointer-events-none" />
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <div className="p-5 space-y-6 bg-slate-50 flex-1 min-h-0 overflow-y-auto relative z-0">

                {/* Global Controls */}
                <div className="flex flex-col gap-3">
                    <button
                        onClick={() => setIsPlaying(!isPlaying)}
                        className={`w-full flex items-center justify-center gap-2 py-2 px-4 rounded-md font-bold text-sm border shadow-sm transition-all ${isPlaying
                            ? 'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100'
                            : 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100'
                            }`}
                    >
                        {isPlaying ? <Pause size={16} /> : <Play size={16} />}
                        {isPlaying ? 'Pause' : 'Play'}
                    </button>

                    <Slider
                        label="Simulation Speed"
                        value={config.speed}
                        min={-3}
                        max={3}
                        step={0.1}
                        onChange={(v) => setConfig(prev => ({ ...prev, speed: v }))}
                    />

                    <CircularDial
                        value={((360 - angle * 180 / Math.PI + 90) % 360 + 360) % 360}
                        onChange={(deg) => setAngle((360 - deg + 90) * Math.PI / 180)}
                        size={140}
                    />

                    <label className="flex items-center justify-between p-2 rounded border border-slate-200 bg-white cursor-pointer hover:bg-slate-50 transition-colors">
                        <span className="text-sm font-medium text-slate-700">Show Path Trace</span>
                        <input
                            type="checkbox"
                            checked={showTrace}
                            onChange={e => setShowTrace(e.target.checked)}
                            className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-gray-300"
                        />
                    </label>
                </div>

                {/* Export Section */}
                <div>
                    <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Export Design</h3>
                    <div className="grid grid-cols-2 gap-2">
                        <button
                            onClick={onExportSVG}
                            className="flex items-center justify-center gap-2 py-2 px-3 rounded bg-white border border-slate-300 text-slate-700 text-xs font-bold hover:border-indigo-300 hover:text-indigo-600 transition-all shadow-sm"
                        >
                            <Download size={14} /> SVG
                        </button>
                        <button
                            onClick={onExportDXF}
                            className="flex items-center justify-center gap-2 py-2 px-3 rounded bg-white border border-slate-300 text-slate-700 text-xs font-bold hover:border-indigo-300 hover:text-indigo-600 transition-all shadow-sm"
                        >
                            <FileJson size={14} /> DXF
                        </button>
                    </div>
                </div>

                {/* Mechanism Selector */}
                <div>
                    <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Active Parts</h3>
                    <div className="flex flex-wrap gap-2 mb-2">
                        {config.mechanisms.map((m, idx) => (
                            <button
                                key={m.id}
                                onClick={() => setSelectedId(m.id)}
                                className={`px-3 py-1.5 rounded-md text-xs font-bold border transition-colors flex items-center gap-2 ${selectedId === m.id
                                    ? 'bg-white border-indigo-400 text-indigo-700 shadow-sm ring-1 ring-indigo-100'
                                    : 'bg-slate-100 border-slate-200 text-slate-500 hover:bg-slate-200'
                                    }`}
                            >
                                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: m.color }}></div>
                                {getMechLabel(m.type)}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Active Mechanism Controls */}
                {activeMech ? (
                    <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm">
                        <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-100">
                            <span className="text-sm font-bold text-slate-800 capitalize flex items-center gap-2">
                                <Settings2 size={14} className="text-indigo-500" />
                                {getMechLabel(activeMech.type)}
                            </span>
                        </div>

                        <Slider
                            label={activeMech.type === '5bar' ? "Left Gear Radius" : "Crank Radius"}
                            value={activeMech.crankLength}
                            min={10}
                            max={200}
                            onChange={(v) => updateActiveMech({ crankLength: v })}
                        />

                        {activeMech.type === '4bar' && (
                            <>
                                <Slider label="Linkage Bar" value={activeMech.couplerLength} min={20} max={300} onChange={(v) => updateActiveMech({ couplerLength: v })} />
                                <Slider label="Rocker Arm" value={activeMech.rockerLength} min={20} max={300} onChange={(v) => updateActiveMech({ rockerLength: v })} />
                                <Slider label="Pivot Distance" value={activeMech.groundLength} min={20} max={300} onChange={(v) => updateActiveMech({ groundLength: v })} />
                            </>
                        )}

                        {activeMech.type === '5bar' && (
                            <>
                                <Slider label="Right Gear Radius" value={activeMech.rockerLength} min={10} max={200} onChange={(v) => updateActiveMech({ rockerLength: v })} />
                                <Slider label="Gear Spacing" value={activeMech.groundLength} min={50} max={400} onChange={(v) => updateActiveMech({ groundLength: v })} />
                                <Slider label="Primary Arm" value={activeMech.couplerLength} min={50} max={300} onChange={(v) => updateActiveMech({ couplerLength: v })} />
                                <Slider label="Secondary Arm" value={activeMech.rodLength || 100} min={50} max={300} onChange={(v) => updateActiveMech({ rodLength: v })} />

                                <div className="mt-2 pt-2 border-t border-slate-100">
                                    <div className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Phase Offset</div>
                                    <Slider
                                        label="Phase Angle"
                                        value={(activeMech.phase || 0) * 180 / Math.PI}
                                        min={0}
                                        max={360}
                                        unit="°"
                                        onChange={(v) => updateActiveMech({ phase: v * Math.PI / 180 })}
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-4 mt-2 pt-2 border-t border-slate-100">
                                    <div className="col-span-2 text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Gear Speeds</div>
                                    <div className="-mb-4">
                                        <Slider
                                            label="Left"
                                            value={activeMech.speed1 ?? 1}
                                            min={-4}
                                            max={4}
                                            step={0.1}
                                            onChange={(v) => updateActiveMech({ speed1: v })}
                                        />
                                    </div>
                                    <div className="-mb-4">
                                        <Slider
                                            label="Right"
                                            value={activeMech.speed2 ?? 1}
                                            min={-4}
                                            max={4}
                                            step={0.1}
                                            onChange={(v) => updateActiveMech({ speed2: v })}
                                        />
                                    </div>
                                </div>
                            </>
                        )}

                        {activeMech.type === 'piston' && (
                            <>
                                <Slider label="Linkage Bar" value={activeMech.couplerLength} min={20} max={300} onChange={(v) => updateActiveMech({ couplerLength: v })} />
                                <Slider label="Track Offset" value={activeMech.sliderOffset} min={-150} max={150} onChange={(v) => updateActiveMech({ sliderOffset: v })} />
                            </>
                        )}

                        {activeMech.type === 'yoke' && (
                            <Slider
                                label="Track Offset"
                                value={activeMech.sliderOffset}
                                min={-activeMech.crankLength + 5}
                                max={activeMech.crankLength - 5}
                                onChange={(v) => updateActiveMech({ sliderOffset: v })}
                            />
                        )}

                        {activeMech.type === 'quick-return' && (
                            <>
                                <Slider label="Pivot X" value={activeMech.groundLength} min={50} max={300} onChange={(v) => updateActiveMech({ groundLength: v })} />
                                <Slider label="Pivot Y" value={activeMech.sliderOffset} min={-200} max={200} onChange={(v) => updateActiveMech({ sliderOffset: v })} />
                                <Slider label="Slotted Arm" value={activeMech.rockerLength} min={50} max={400} onChange={(v) => updateActiveMech({ rockerLength: v })} />
                            </>
                        )}

                        {(activeMech.type === '4bar' || activeMech.type === 'quick-return') && (
                            <div className="pt-2 mt-2 border-t border-slate-100">
                                <div className="flex items-center justify-between mb-3">
                                    <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Output Gear</span>
                                    <label className="relative inline-flex items-center cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={activeMech.showOutputGear || false}
                                            onChange={(e) => updateActiveMech({ showOutputGear: e.target.checked })}
                                            className="sr-only peer"
                                        />
                                        <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
                                    </label>
                                </div>
                                {activeMech.showOutputGear && (
                                    <Slider
                                        label="Gear Radius"
                                        value={activeMech.outputGearRadius || 40}
                                        min={20}
                                        max={150}
                                        onChange={(v) => updateActiveMech({ outputGearRadius: v })}
                                    />
                                )}
                            </div>
                        )}

                        {activeMech.type !== 'crank' && (
                            <div className="pt-2 mt-2 border-t border-slate-100">
                                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Extension</h3>
                                <Slider label="Distance" value={activeMech.couplerPointDist} min={0} max={200} onChange={(v) => updateActiveMech({ couplerPointDist: v })} />
                                {activeMech.type !== 'quick-return' && activeMech.type !== '5bar' && (
                                    <Slider label="Angle" value={activeMech.couplerPointAngle} min={-180} max={180} unit="°" onChange={(v) => updateActiveMech({ couplerPointAngle: v })} />
                                )}
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="text-center p-4 text-slate-400 italic text-sm">
                        Select a part to edit
                    </div>
                )}

                <div className="pt-2 pb-10">
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-bold text-slate-800">Presets</h3>
                        <button onClick={onSavePreset} className="text-xs flex items-center gap-1 text-indigo-600 font-bold hover:underline">
                            <Save size={12} /> Save
                        </button>
                    </div>
                    <div className="flex flex-col gap-2">
                        {presets.map((p, i) => (
                            <button
                                key={i}
                                onClick={() => onLoadPreset(p.conf)}
                                className="flex items-center justify-between p-3 rounded-lg border border-slate-200 bg-white hover:border-indigo-300 hover:bg-indigo-50 transition-all group text-left"
                            >
                                <span className="text-xs font-medium text-slate-700 group-hover:text-indigo-700">{p.name}</span>
                                <ChevronRight size={14} className="text-slate-300 group-hover:text-indigo-400" />
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};
