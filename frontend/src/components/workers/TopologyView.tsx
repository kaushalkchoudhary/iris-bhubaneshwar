import { useMemo, useRef, useState } from 'react';
import type { WorkerLiveStat } from '@/lib/worker-types';
import { Server, Cpu, HardDrive } from 'lucide-react';

// ── Constants ────────────────────────────────────────────────────────────────

const CX = 500;   // SVG center X
const CY = 440;   // SVG center Y
const JETSON_R = 200;  // radius of Jetson ring
const CAM_R = 75;      // radius of camera arc per Jetson

// ── Helpers ──────────────────────────────────────────────────────────────────

function polar(cx: number, cy: number, r: number, angleDeg: number) {
    const rad = (angleDeg - 90) * (Math.PI / 180);
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}




// Animated dashed link
function Link({
    x1, y1, x2, y2, color, active, delay = 0, width = 1.5,
}: { x1: number; y1: number; x2: number; y2: number; color: string; active: boolean; delay?: number; width?: number }) {
    const len = Math.hypot(x2 - x1, y2 - y1);
    return (
        <g>
            {/* base line */}
            <line x1={x1} y1={y1} x2={x2} y2={y2}
                stroke={active ? color : '#27272a'} strokeWidth={width} strokeOpacity={active ? 0.25 : 0.2} />
            {/* animated dash */}
            {active && (
                <line x1={x1} y1={y1} x2={x2} y2={y2}
                    stroke={color} strokeWidth={width} strokeDasharray={`8 ${Math.max(8, len - 16)}`}
                    strokeLinecap="round" strokeOpacity={0.8}
                >
                    <animate attributeName="stroke-dashoffset"
                        from={len} to={0} dur="1.8s" repeatCount="indefinite"
                        begin={`${delay}s`} />
                </line>
            )}
        </g>
    );
}

// Hexagonal node for central server
function HexNode({ cx, cy, pulse }: { cx: number; cy: number; pulse: boolean }) {
    const pts = Array.from({ length: 6 }, (_, i) => {
        const a = (i * 60 - 30) * Math.PI / 180;
        return `${cx + 38 * Math.cos(a)},${cy + 38 * Math.sin(a)}`;
    }).join(' ');
    return (
        <g>
            {/* glow rings */}
            {pulse && <>
                <circle cx={cx} cy={cy} r={70} fill="none" stroke="#6366f1" strokeWidth={1} strokeOpacity={0.15}>
                    <animate attributeName="r" values="52;72;52" dur="2.4s" repeatCount="indefinite" />
                    <animate attributeName="stroke-opacity" values="0.15;0.04;0.15" dur="2.4s" repeatCount="indefinite" />
                </circle>
                <circle cx={cx} cy={cy} r={90} fill="none" stroke="#6366f1" strokeWidth={0.6} strokeOpacity={0.08}>
                    <animate attributeName="r" values="72;92;72" dur="3.2s" repeatCount="indefinite" />
                </circle>
            </>}
            {/* outer hex ring */}
            <polygon points={pts} fill="none" stroke="#6366f1" strokeWidth={1.5} strokeOpacity={0.4} />
            {/* inner fill */}
            <polygon points={Array.from({ length: 6 }, (_, i) => {
                const a = (i * 60 - 30) * Math.PI / 180;
                return `${cx + 30 * Math.cos(a)},${cy + 30 * Math.sin(a)}`;
            }).join(' ')} fill="#1e1b4b" />
            {/* icon placeholder (we'll use foreignObject in JSX) */}
        </g>
    );
}

// Jetson node circle
function JetsonNode({ cx, cy, online, selected, onClick }: {
    cx: number; cy: number; online: boolean; selected: boolean; onClick: () => void;
}) {
    return (
        <g className="cursor-pointer" onClick={onClick}>
            {selected && (
                <circle cx={cx} cy={cy} r={26} fill="none" stroke="#6366f1" strokeWidth={1.5} strokeOpacity={0.6}>
                    <animate attributeName="r" values="24;30;24" dur="1.5s" repeatCount="indefinite" />
                    <animate attributeName="stroke-opacity" values="0.7;0.2;0.7" dur="1.5s" repeatCount="indefinite" />
                </circle>
            )}
            {online && !selected && (
                <circle cx={cx} cy={cy} r={22} fill="none" stroke="#10b981" strokeWidth={1} strokeOpacity={0.3}>
                    <animate attributeName="r" values="20;26;20" dur="2s" repeatCount="indefinite" />
                    <animate attributeName="stroke-opacity" values="0.3;0.05;0.3" dur="2s" repeatCount="indefinite" />
                </circle>
            )}
            <circle cx={cx} cy={cy} r={20}
                fill={online ? (selected ? '#1e1b4b' : '#0f172a') : '#18181b'}
                stroke={selected ? '#6366f1' : online ? '#10b981' : '#3f3f46'}
                strokeWidth={selected ? 2 : 1.5}
            />
        </g>
    );
}

// Camera node
function CamNode({ cx, cy, active }: { cx: number; cy: number; active: boolean }) {
    return (
        <g>
            <circle cx={cx} cy={cy} r={10}
                fill={active ? '#1a103a' : '#18181b'}
                stroke={active ? '#a78bfa' : '#3f3f46'}
                strokeWidth={1}
            />
            {active && (
                <circle cx={cx} cy={cy} r={13} fill="none" stroke="#a78bfa" strokeWidth={0.6} strokeOpacity={0.4}>
                    <animate attributeName="stroke-opacity" values="0.4;0.1;0.4" dur="2.5s" repeatCount="indefinite" />
                </circle>
            )}
        </g>
    );
}

// ── Types ─────────────────────────────────────────────────────────────────────

type JetsonEntry = {
    id: string;
    name: string;
    online: boolean;
    cpuPct: number | null;
    memPct: number | null;
    tempC: number | null;
    cameraCount: number;
    ping: number | null;
};

// ── Main Component ────────────────────────────────────────────────────────────

export function TopologyView({ liveStats }: { liveStats: WorkerLiveStat[] }) {
    const svgRef = useRef<SVGSVGElement>(null);
    const [selected, setSelected] = useState<string | null>(null);

    // Build Jetsons array (real data if available, padded to 6 for display)
    const jetsons: JetsonEntry[] = useMemo(() => {
        const fromData: JetsonEntry[] = liveStats.map((s) => {
            const r = s.resources;
            return {
                id: s.workerId,
                name: s.name,
                online: s.reachable && s.status !== 'revoked' && s.status !== 'pending',
                cpuPct: r?.cpu_percent ?? (r?.cpu_load_1m != null ? Math.min(100, (r.cpu_load_1m / 6) * 100) : null),
                memPct: r?.memory_percent ?? null,
                tempC: r?.temperature_c ?? null,
                cameraCount: s.cameraCount,
                ping: s.latencyMs ?? null,
            };
        });

        // Pad with ghost nodes if < 6 workers registered
        while (fromData.length < 6) {
            fromData.push({
                id: `ghost-${fromData.length}`,
                name: `Jetson-0${fromData.length + 1}`,
                online: false,
                cpuPct: null, memPct: null, tempC: null, cameraCount: 0, ping: null,
            });
        }
        return fromData.slice(0, 6);
    }, [liveStats]);

    const selectedJetson = jetsons.find((j) => j.id === selected);
    const onlineCount = jetsons.filter((j) => j.online).length;

    return (
        <div className="flex flex-col lg:flex-row gap-4 h-full min-h-0">

            {/* ── SVG topology canvas ── */}
            <div className="flex-1 min-h-[520px] lg:min-h-0 relative rounded-xl border border-border bg-card/60 overflow-hidden">
                {/* sci-fi grid background */}
                <svg className="absolute inset-0 w-full h-full pointer-events-none" xmlns="http://www.w3.org/2000/svg">
                    <defs>
                        <pattern id="topo-grid" width="40" height="40" patternUnits="userSpaceOnUse">
                            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#6366f1" strokeWidth="0.3" strokeOpacity="0.08" />
                        </pattern>
                        <radialGradient id="topo-vignette" cx="50%" cy="50%" r="50%">
                            <stop offset="0%" stopColor="transparent" />
                            <stop offset="100%" stopColor="#000000" stopOpacity="0.5" />
                        </radialGradient>
                    </defs>
                    <rect width="100%" height="100%" fill="url(#topo-grid)" />
                    <rect width="100%" height="100%" fill="url(#topo-vignette)" />
                </svg>

                {/* Main topology SVG */}
                <svg
                    ref={svgRef}
                    viewBox="0 0 1000 880"
                    className="w-full h-full"
                    xmlns="http://www.w3.org/2000/svg"
                >
                    <defs>
                        <radialGradient id="server-glow" cx="50%" cy="50%" r="50%">
                            <stop offset="0%" stopColor="#6366f1" stopOpacity="0.15" />
                            <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
                        </radialGradient>
                        <filter id="glow-sm">
                            <feGaussianBlur stdDeviation="2.5" result="coloredBlur" />
                            <feMerge><feMergeNode in="coloredBlur" /><feMergeNode in="SourceGraphic" /></feMerge>
                        </filter>
                        <filter id="glow-lg">
                            <feGaussianBlur stdDeviation="6" result="coloredBlur" />
                            <feMerge><feMergeNode in="coloredBlur" /><feMergeNode in="SourceGraphic" /></feMerge>
                        </filter>
                    </defs>

                    {/* Server glow radial */}
                    <circle cx={CX} cy={CY} r={120} fill="url(#server-glow)" />

                    {/* Links: server → Jetsons */}
                    {jetsons.map((j, i) => {
                        const angle = i * 60;
                        const jp = polar(CX, CY, JETSON_R, angle);
                        return (
                            <Link key={`link-s-${j.id}`}
                                x1={CX} y1={CY} x2={jp.x} y2={jp.y}
                                color="#6366f1" active={j.online} delay={i * 0.3} width={1.8}
                            />
                        );
                    })}

                    {/* Links: Jetsons → Cameras */}
                    {jetsons.map((j, i) => {
                        const angle = i * 60;
                        const jp = polar(CX, CY, JETSON_R, angle);
                        const camCount = Math.max(j.cameraCount, 4); // show 4 per Jetson
                        return Array.from({ length: 4 }, (_, ci) => {
                            const spread = 40;
                            const startAngle = angle - spread * 1.5;
                            const camAngle = startAngle + ci * spread;
                            // push cams away from center
                            const outerAngle = camAngle;
                            const cp = polar(jp.x, jp.y, CAM_R, outerAngle);
                            return (
                                <Link key={`link-c-${j.id}-${ci}`}
                                    x1={jp.x} y1={jp.y} x2={cp.x} y2={cp.y}
                                    color="#a78bfa" active={j.online && ci < camCount} delay={i * 0.3 + ci * 0.1} width={1}
                                />
                            );
                        });
                    })}

                    {/* Camera nodes */}
                    {jetsons.map((j, i) => {
                        const angle = i * 60;
                        const jp = polar(CX, CY, JETSON_R, angle);
                        return Array.from({ length: 4 }, (_, ci) => {
                            const spread = 40;
                            const startAngle = angle - spread * 1.5;
                            const camAngle = startAngle + ci * spread;
                            const cp = polar(jp.x, jp.y, CAM_R, camAngle);
                            const active = j.online && ci < j.cameraCount;
                            return (
                                <g key={`cam-${j.id}-${ci}`} filter={active ? 'url(#glow-sm)' : undefined}>
                                    <CamNode cx={cp.x} cy={cp.y} active={active} />
                                    <text x={cp.x} y={cp.y + 24} textAnchor="middle"
                                        fontSize={8} fill={active ? '#a78bfa' : '#52525b'} fontFamily="monospace">
                                        CAM{ci + 1}
                                    </text>
                                </g>
                            );
                        });
                    })}

                    {/* Jetson nodes */}
                    {jetsons.map((j, i) => {
                        const angle = i * 60;
                        const jp = polar(CX, CY, JETSON_R, angle);
                        return (
                            <g key={j.id} filter={j.online ? 'url(#glow-sm)' : undefined}>
                                <JetsonNode
                                    cx={jp.x} cy={jp.y}
                                    online={j.online}
                                    selected={selected === j.id}
                                    onClick={() => setSelected(selected === j.id ? null : j.id)}
                                />
                                {/* Jetson label */}
                                <text
                                    x={jp.x}
                                    y={jp.y + 36}
                                    textAnchor="middle"
                                    fontSize={10}
                                    fontFamily="monospace"
                                    fill={j.online ? '#a1a1aa' : '#52525b'}
                                    fontWeight="600"
                                >
                                    {j.name}
                                </text>
                                {j.online && j.ping != null && (
                                    <text x={jp.x} y={jp.y + 48} textAnchor="middle" fontSize={8} fill="#6366f1" fontFamily="monospace">
                                        {j.ping}ms
                                    </text>
                                )}
                                {/* Server icon (S) inside node */}
                                <text x={jp.x} y={jp.y + 4} textAnchor="middle" fontSize={11}
                                    fill={j.online ? '#10b981' : '#52525b'} fontWeight="bold" fontFamily="monospace">
                                    J
                                </text>
                            </g>
                        );
                    })}

                    {/* Central server node */}
                    <g filter="url(#glow-lg)">
                        <HexNode cx={CX} cy={CY} pulse={onlineCount > 0} />
                        {/* IRIS text */}
                        <text x={CX} y={CY - 6} textAnchor="middle" fontSize={13}
                            fill="#a5b4fc" fontWeight="bold" fontFamily="monospace" letterSpacing="3">
                            IRIS
                        </text>
                        <text x={CX} y={CY + 10} textAnchor="middle" fontSize={8}
                            fill="#6366f1" fontFamily="monospace" letterSpacing="2">
                            CORE
                        </text>
                    </g>

                    {/* Status ring label */}
                    <text x={CX} y={CY + 56} textAnchor="middle" fontSize={9}
                        fill="#52525b" fontFamily="monospace">
                        {onlineCount}/{jetsons.length} NODES ONLINE
                    </text>

                    {/* Outer decorative arc */}
                    <circle cx={CX} cy={CY} r={320} fill="none"
                        stroke="#6366f1" strokeWidth={0.5} strokeOpacity={0.07}
                        strokeDasharray="4 20"
                    >
                        <animateTransform attributeName="transform" type="rotate"
                            from={`0 ${CX} ${CY}`} to={`360 ${CX} ${CY}`}
                            dur="60s" repeatCount="indefinite" />
                    </circle>
                    <circle cx={CX} cy={CY} r={280} fill="none"
                        stroke="#6366f1" strokeWidth={0.4} strokeOpacity={0.05}
                        strokeDasharray="2 30"
                    >
                        <animateTransform attributeName="transform" type="rotate"
                            from={`360 ${CX} ${CY}`} to={`0 ${CX} ${CY}`}
                            dur="90s" repeatCount="indefinite" />
                    </circle>
                </svg>

                {/* Legend */}
                <div className="absolute bottom-3 left-4 flex items-center gap-4 text-[10px] font-mono text-zinc-600">
                    <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500" />Jetson Online</span>
                    <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-zinc-600" />Offline</span>
                    <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-purple-500" />Camera Active</span>
                </div>
            </div>

            {/* ── Detail panel ── */}
            <div className="lg:w-72 shrink-0 flex flex-col gap-3">
                {/* Central server card */}
                <div className="rounded-xl border border-indigo-500/20 bg-indigo-950/20 p-4">
                    <div className="flex items-center gap-2.5 mb-3">
                        <div className="w-8 h-8 rounded-lg bg-indigo-500/15 ring-1 ring-indigo-500/25 flex items-center justify-center">
                            <Server className="w-4 h-4 text-indigo-400" />
                        </div>
                        <div>
                            <p className="text-xs font-bold text-indigo-300 tracking-widest uppercase font-mono">IRIS Core</p>
                            <p className="text-[10px] text-zinc-500 font-mono">Central Processing Node</p>
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        {[
                            { label: 'Nodes', value: `${jetsons.length}`, color: 'text-zinc-300' },
                            { label: 'Online', value: `${onlineCount}`, color: 'text-emerald-400' },
                            { label: 'Cameras', value: `${jetsons.reduce((s, j) => s + j.cameraCount, 0)}`, color: 'text-purple-400' },
                            { label: 'Offline', value: `${jetsons.length - onlineCount}`, color: 'text-zinc-500' },
                        ].map(({ label, value, color }) => (
                            <div key={label} className="bg-indigo-950/30 rounded-lg px-2.5 py-2 border border-indigo-500/10">
                                <p className="text-[9px] font-mono text-zinc-600 uppercase tracking-wider">{label}</p>
                                <p className={`text-base font-bold font-mono ${color}`}>{value}</p>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Selected Jetson detail */}
                {selected && selectedJetson ? (
                    <div className={`rounded-xl border p-4 transition-all ${selectedJetson.online ? 'border-emerald-500/20 bg-emerald-950/10' : 'border-border bg-card/40'}`}>
                        <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                                <div className={`w-2 h-2 rounded-full ${selectedJetson.online ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-600'}`} />
                                <span className="text-sm font-bold text-foreground font-mono">{selectedJetson.name}</span>
                            </div>
                            <button onClick={() => setSelected(null)} className="text-zinc-600 hover:text-zinc-400 text-xs">✕</button>
                        </div>

                        <div className="space-y-3">
                            {/* CPU */}
                            {selectedJetson.cpuPct != null && (
                                <div>
                                    <div className="flex justify-between text-[10px] font-mono mb-1">
                                        <span className="flex items-center gap-1 text-zinc-500"><Cpu className="w-3 h-3" />CPU</span>
                                        <span className={selectedJetson.cpuPct > 80 ? 'text-red-400' : selectedJetson.cpuPct > 60 ? 'text-amber-400' : 'text-blue-400'}>
                                            {selectedJetson.cpuPct.toFixed(0)}%
                                        </span>
                                    </div>
                                    <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                                        <div className={`h-full rounded-full transition-all ${selectedJetson.cpuPct > 80 ? 'bg-red-400' : selectedJetson.cpuPct > 60 ? 'bg-amber-400' : 'bg-blue-400'}`}
                                            style={{ width: `${Math.min(100, selectedJetson.cpuPct)}%` }} />
                                    </div>
                                </div>
                            )}

                            {/* RAM */}
                            {selectedJetson.memPct != null && (
                                <div>
                                    <div className="flex justify-between text-[10px] font-mono mb-1">
                                        <span className="flex items-center gap-1 text-zinc-500"><HardDrive className="w-3 h-3" />RAM</span>
                                        <span className={selectedJetson.memPct > 85 ? 'text-red-400' : selectedJetson.memPct > 65 ? 'text-amber-400' : 'text-purple-400'}>
                                            {selectedJetson.memPct.toFixed(0)}%
                                        </span>
                                    </div>
                                    <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                                        <div className={`h-full rounded-full transition-all ${selectedJetson.memPct > 85 ? 'bg-red-400' : selectedJetson.memPct > 65 ? 'bg-amber-400' : 'bg-purple-400'}`}
                                            style={{ width: `${Math.min(100, selectedJetson.memPct)}%` }} />
                                    </div>
                                </div>
                            )}

                            {/* Meta */}
                            <div className="grid grid-cols-2 gap-1.5 text-[10px] font-mono">
                                {selectedJetson.tempC != null && (
                                    <div className="bg-card/40 border border-border rounded px-2 py-1.5">
                                        <p className="text-zinc-600 uppercase text-[9px] tracking-wider">Temp</p>
                                        <p className={`font-bold mt-0.5 ${selectedJetson.tempC > 75 ? 'text-red-400' : selectedJetson.tempC > 55 ? 'text-amber-400' : 'text-sky-400'}`}>
                                            {selectedJetson.tempC.toFixed(1)}°C
                                        </p>
                                    </div>
                                )}
                                {selectedJetson.ping != null && (
                                    <div className="bg-card/40 border border-border rounded px-2 py-1.5">
                                        <p className="text-zinc-600 uppercase text-[9px] tracking-wider">Ping</p>
                                        <p className="text-emerald-400 font-bold mt-0.5">{selectedJetson.ping}ms</p>
                                    </div>
                                )}
                                <div className="bg-card/40 border border-border rounded px-2 py-1.5">
                                    <p className="text-zinc-600 uppercase text-[9px] tracking-wider">Cameras</p>
                                    <p className="text-purple-400 font-bold mt-0.5">{selectedJetson.cameraCount}</p>
                                </div>
                                <div className="bg-card/40 border border-border rounded px-2 py-1.5">
                                    <p className="text-zinc-600 uppercase text-[9px] tracking-wider">Status</p>
                                    <p className={`font-bold mt-0.5 ${selectedJetson.online ? 'text-emerald-400' : 'text-zinc-500'}`}>
                                        {selectedJetson.online ? 'ONLINE' : 'OFFLINE'}
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="rounded-xl border border-dashed border-border bg-card/20 p-6 flex flex-col items-center justify-center gap-2 text-center flex-1">
                        <div className="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center">
                            <Server className="w-4 h-4 text-zinc-600" />
                        </div>
                        <p className="text-xs font-mono text-zinc-500">Click a Jetson node<br />to view details</p>
                    </div>
                )}

                {/* Camera grid legend */}
                <div className="rounded-xl border border-border bg-card/40 p-4">
                    <p className="text-[10px] font-mono text-zinc-600 uppercase tracking-widest mb-3">Camera Distribution</p>
                    <div className="flex flex-col gap-1.5">
                        {jetsons.map((j) => (
                            <div key={j.id} className="flex items-center gap-2">
                                <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${j.online ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
                                <span className="text-[10px] font-mono text-zinc-500 flex-1 truncate">{j.name}</span>
                                <div className="flex gap-0.5">
                                    {Array.from({ length: 4 }, (_, ci) => (
                                        <div key={ci} className={`w-2 h-2 rounded-sm ${j.online && ci < j.cameraCount ? 'bg-purple-500' : 'bg-zinc-800'}`} />
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
