import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Boxes, Eye, ImagePlus, Maximize2, Radar, RefreshCw, Search,
    Server, ScanFace, UploadCloud, X, Monitor, WifiOff, Activity, Send,
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, AreaChart, Area, Sankey, Rectangle, Layer } from 'recharts';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { apiClient, type WorkerWithCounts } from '@/lib/api';
import type { WorkerLiveStat } from '@/lib/worker-types';
import { DirectWebRTCFrame } from '@/components/cameras/DirectWebRTCFrame';
import { cn } from '@/lib/utils';

// ── Detection class catalog ────────────────────────────────────────────────────
type ClassEntry = { name: string; emoji: string; category: string };
const DETECTION_CLASSES: ClassEntry[] = [
    { name: 'person', emoji: '🧑', category: 'People' }, { name: 'crowd', emoji: '👥', category: 'People' },
    { name: 'child', emoji: '👦', category: 'People' }, { name: 'worker', emoji: '👷', category: 'People' },
    { name: 'cyclist', emoji: '🚴', category: 'People' }, { name: 'pedestrian', emoji: '🚶', category: 'People' },
    { name: 'helmet', emoji: '⛑️', category: 'Safety' }, { name: 'hardhat', emoji: '🪖', category: 'Safety' },
    { name: 'vest', emoji: '🦺', category: 'Safety' }, { name: 'mask', emoji: '😷', category: 'Safety' },
    { name: 'gloves', emoji: '🧤', category: 'Safety' }, { name: 'goggles', emoji: '🥽', category: 'Safety' },
    { name: 'car', emoji: '🚗', category: 'Vehicles' }, { name: 'truck', emoji: '🚚', category: 'Vehicles' },
    { name: 'bus', emoji: '🚌', category: 'Vehicles' }, { name: 'motorcycle', emoji: '🏍️', category: 'Vehicles' },
    { name: 'bicycle', emoji: '🚲', category: 'Vehicles' }, { name: 'van', emoji: '🚐', category: 'Vehicles' },
    { name: 'ambulance', emoji: '🚑', category: 'Vehicles' }, { name: 'fire truck', emoji: '🚒', category: 'Vehicles' },
    { name: 'police car', emoji: '🚓', category: 'Vehicles' }, { name: 'scooter', emoji: '🛵', category: 'Vehicles' },
    { name: 'auto rickshaw', emoji: '🛺', category: 'Vehicles' }, { name: 'forklift', emoji: '🏗️', category: 'Vehicles' },
    { name: 'tractor', emoji: '🚜', category: 'Vehicles' }, { name: 'airplane', emoji: '✈️', category: 'Aircraft' },
    { name: 'helicopter', emoji: '🚁', category: 'Aircraft' }, { name: 'drone', emoji: '🚁', category: 'Aircraft' },
    { name: 'dog', emoji: '🐕', category: 'Animals' }, { name: 'cat', emoji: '🐈', category: 'Animals' },
    { name: 'cow', emoji: '🐄', category: 'Animals' }, { name: 'horse', emoji: '🐎', category: 'Animals' },
    { name: 'bird', emoji: '🐦', category: 'Animals' }, { name: 'elephant', emoji: '🐘', category: 'Animals' },
    { name: 'backpack', emoji: '🎒', category: 'Bags' }, { name: 'handbag', emoji: '👜', category: 'Bags' },
    { name: 'suitcase', emoji: '🧳', category: 'Bags' }, { name: 'box', emoji: '📦', category: 'Bags' },
    { name: 'cell phone', emoji: '📱', category: 'Tech' }, { name: 'laptop', emoji: '💻', category: 'Tech' },
    { name: 'camera', emoji: '📷', category: 'Tech' }, { name: 'keyboard', emoji: '⌨️', category: 'Tech' },
    { name: 'gun', emoji: '🔫', category: 'Hazards' }, { name: 'knife', emoji: '🔪', category: 'Hazards' },
    { name: 'fire', emoji: '🔥', category: 'Hazards' }, { name: 'smoke', emoji: '💨', category: 'Hazards' },
    { name: 'flood', emoji: '🌊', category: 'Hazards' }, { name: 'explosion', emoji: '💥', category: 'Hazards' },
    { name: 'traffic light', emoji: '🚦', category: 'Infra' }, { name: 'stop sign', emoji: '🛑', category: 'Infra' },
    { name: 'fire hydrant', emoji: '🚒', category: 'Infra' }, { name: 'barrier', emoji: '🚧', category: 'Infra' },
    { name: 'bench', emoji: '🪑', category: 'Infra' }, { name: 'gate', emoji: '🚧', category: 'Infra' },
    { name: 'wrench', emoji: '🔧', category: 'Tools' }, { name: 'hammer', emoji: '🔨', category: 'Tools' },
    { name: 'ladder', emoji: '🪜', category: 'Tools' }, { name: 'shovel', emoji: '🪚', category: 'Tools' },
    { name: 'ball', emoji: '⚽', category: 'Sports' }, { name: 'skateboard', emoji: '🛹', category: 'Sports' },
    { name: 'syringe', emoji: '💉', category: 'Medical' }, { name: 'wheelchair', emoji: '♿', category: 'Medical' },
    { name: 'book', emoji: '📚', category: 'Objects' }, { name: 'clock', emoji: '🕐', category: 'Objects' },
    { name: 'umbrella', emoji: '☂️', category: 'Objects' }, { name: 'chair', emoji: '🪑', category: 'Objects' },
    { name: 'bottle', emoji: '🍶', category: 'Objects' }, { name: 'cup', emoji: '☕', category: 'Objects' },
    { name: 'scissors', emoji: '✂️', category: 'Objects' }, { name: 'teddy bear', emoji: '🧸', category: 'Objects' },
    { name: 'wine glass', emoji: '🍷', category: 'Objects' }, { name: 'refrigerator', emoji: '🧊', category: 'Objects' },
    { name: 'vase', emoji: '🏺', category: 'Objects' }, { name: 'mouse', emoji: '🖱️', category: 'Tech' },
];

// ── Helpers ────────────────────────────────────────────────────────────────────

function parseNum(v: unknown): number {
    return typeof v === 'number' && isFinite(v) ? v : 0;
}

// ── Sub-components ─────────────────────────────────────────────────────────────


function BarTooltip({ active, payload, label }: any) {
    if (!active || !payload?.length) return null;
    return (
        <div className="bg-zinc-950/96 border border-white/10 rounded-lg shadow-2xl backdrop-blur-sm px-3 py-2 min-w-[120px]">
            <p className="text-zinc-500 text-[9px] font-mono pb-1 mb-1 border-b border-white/5 truncate">{label}</p>
            {payload.map((p: any, i: number) => (
                <div key={i} className="flex items-center justify-between gap-3">
                    <span className="text-zinc-600 text-[9px] font-mono">{p.name}</span>
                    <span className="text-xs font-mono font-bold" style={{ color: p.fill }}>{p.value}%</span>
                </div>
            ))}
        </div>
    );
}

function SankeyNode({ x, y, width, height, index, payload }: any) {
    const isLeft = x < 200;
    return (
        <Layer key={`node-${index}`}>
            <Rectangle x={x} y={y} width={width} height={height} fill={isLeft ? '#818cf8' : '#22d3ee'} fillOpacity={0.7} radius={2} />
            <text x={isLeft ? x - 4 : x + width + 4} y={y + height / 2} textAnchor={isLeft ? 'end' : 'start'}
                fill="#a1a1aa" fontSize={9} fontFamily="monospace" dominantBaseline="middle">
                {payload?.name}
            </text>
        </Layer>
    );
}

function SankeyTooltip({ active, payload }: any) {
    if (!active || !payload?.length) return null;
    const d = payload[0]?.payload;
    return (
        <div className="bg-zinc-950/96 border border-white/10 rounded-lg shadow-2xl px-3 py-2 text-[9px] font-mono">
            {d?.source?.name && d?.target?.name
                ? <p className="text-zinc-400">{d.source.name} → {d.target.name}: <span className="text-indigo-300 font-bold">{d.value}</span></p>
                : <p className="text-zinc-400">{d?.name}: <span className="text-cyan-300 font-bold">{d?.value}</span></p>
            }
        </div>
    );
}

// ── FeedTile — one camera live inference feed ─────────────────────────────────

function FeedTile({
    cameraId, cameraName, workerName, workerIp, reachable, activeClasses, detCount, onZoom,
}: {
    cameraId: string; cameraName: string;
    workerName: string; workerIp: string; reachable: boolean;
    activeClasses: string[]; detCount: number; onZoom: () => void;
}) {
    const [connected, setConnected] = useState(false);

    return (
        <div className="group relative flex flex-col h-full rounded-2xl overflow-hidden border border-white/5 bg-zinc-950 hover:border-indigo-500/20 transition-all duration-300 shadow-xl ring-1 ring-inset ring-white/[0.04]">
            {/* Video canvas */}
            <div className="flex-1 relative">
                <DirectWebRTCFrame
                    workerIp={workerIp}
                    cameraId={cameraId}
                    className="absolute inset-0 w-full h-full"
                    onConnectionChange={setConnected}
                />

                {/* Gradient vignette */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/20 pointer-events-none" />

                {/* Top-left: live badge + node */}
                <div className="absolute top-3 left-3 flex items-center gap-1.5 pointer-events-none">
                    <div className="flex items-center gap-1.5 bg-black/50 backdrop-blur-md border border-white/10 rounded-lg px-2 py-1">
                        <span className={cn('w-1.5 h-1.5 rounded-full',
                            connected ? 'bg-emerald-400 shadow-[0_0_6px_#10b981] animate-pulse' : 'bg-zinc-600'
                        )} />
                        <span className="text-[9px] font-mono font-bold text-zinc-200 tracking-widest">
                            {connected ? 'LIVE' : 'OFFLINE'}
                        </span>
                    </div>
                </div>

                {/* Top-right: active class pills */}
                <div className="absolute top-3 right-3 flex flex-wrap gap-1 justify-end max-w-[55%] pointer-events-none">
                    {activeClasses.slice(0, 4).map(cls => (
                        <span key={cls} className="bg-indigo-900/60 backdrop-blur-md border border-indigo-500/30 rounded px-1.5 py-0.5 text-[8px] font-mono text-indigo-300">
                            {DETECTION_CLASSES.find(c => c.name === cls)?.emoji ?? '•'} {cls}
                        </span>
                    ))}
                    {activeClasses.length > 4 && (
                        <span className="bg-black/40 backdrop-blur-md border border-white/10 rounded px-1.5 py-0.5 text-[8px] font-mono text-zinc-500">
                            +{activeClasses.length - 4}
                        </span>
                    )}
                </div>

                {/* Bottom info bar */}
                <div className="absolute bottom-0 left-0 right-0 px-3 py-2.5 flex items-end justify-between pointer-events-none">
                    <div>
                        <p className="text-[13px] font-mono font-bold text-white leading-tight drop-shadow-md">{cameraName}</p>
                        <p className="text-[9px] font-mono text-zinc-500 mt-0.5">
                            <span className={cn('mr-1', reachable ? 'text-emerald-500' : 'text-red-500')}>●</span>
                            {workerName} · {workerIp}
                        </p>
                    </div>
                    <div className="flex items-center gap-2 pointer-events-auto">
                        {detCount > 0 && (
                            <div className="bg-indigo-500/20 backdrop-blur-md border border-indigo-500/30 rounded-lg px-2 py-0.5">
                                <span className="text-[9px] font-mono font-bold text-indigo-300">{detCount} det</span>
                            </div>
                        )}
                        <button type="button" onClick={onZoom}
                            className="h-7 w-7 flex items-center justify-center rounded-lg bg-white/10 hover:bg-indigo-500/30 border border-white/10 text-zinc-300 opacity-0 group-hover:opacity-100 transition-all duration-200">
                            <Maximize2 className="h-3.5 w-3.5" />
                        </button>
                    </div>
                </div>

                {/* Corner accents on hover */}
                <div className="absolute top-0 left-0 w-6 h-6 border-l-2 border-t-2 border-indigo-500/0 group-hover:border-indigo-500/40 transition-all duration-500 rounded-tl-2xl pointer-events-none" />
                <div className="absolute bottom-0 right-0 w-6 h-6 border-r-2 border-b-2 border-indigo-500/0 group-hover:border-indigo-500/40 transition-all duration-500 rounded-br-2xl pointer-events-none" />
            </div>
        </div>
    );
}

// ── Main ─────────────────────────────────────────────────────────────────────

export function GodsEyeTab() {
    const [tab, setTab] = useState<'overview' | 'live'>('overview');
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [workers, setWorkers] = useState<WorkerWithCounts[]>([]);
    const [liveStats, setLiveStats] = useState<WorkerLiveStat[]>([]);
    const [fallbackCams, setFallbackCams] = useState<Record<string, { id: string; name: string }[]>>({});
    const [zoomed, setZoomed] = useState<{ workerId: string; cameraId: string; cameraName: string; workerIp: string; reachable: boolean } | null>(null);
    const [detections, setDetections] = useState<Record<string, { ts: number; track_id: number; class: string; confidence: number }[]>>({});

    // Prompt state
    const [promptInput, setPromptInput] = useState('');
    const [promptClasses, setPromptClasses] = useState<string[]>(['person', 'helmet', 'vehicle']);
    const [promptImage, setPromptImage] = useState<{ name: string; src: string } | null>(null);
    const [dragOver, setDragOver] = useState(false);
    const [classSearch, setClassSearch] = useState('');
    const [activeCat, setActiveCat] = useState('All');
    const [syncing, setSyncing] = useState(false);
    const [syncStatus, setSyncStatus] = useState<'idle' | 'ok' | 'err'>('idle');
    const fileRef = useRef<HTMLInputElement>(null);

    // Load current server prompt config on mount
    useEffect(() => {
        apiClient.getGodsEyePrompts()
            .then(cfg => {
                if (Array.isArray(cfg.classes) && cfg.classes.length > 0) {
                    setPromptClasses(cfg.classes);
                }
            })
            .catch(() => { });
    }, []);

    const syncPrompts = useCallback(async () => {
        setSyncing(true);
        setSyncStatus('idle');
        try {
            await apiClient.setGodsEyePrompts({
                mode: promptImage ? 'visual' : 'text',
                classes: promptClasses,
                referImage: promptImage?.src ?? '',
                visualPrompts: [],
            });
            setSyncStatus('ok');
        } catch {
            setSyncStatus('err');
        } finally {
            setSyncing(false);
            setTimeout(() => setSyncStatus('idle'), 3000);
        }
    }, [promptClasses, promptImage]);

    const categories = useMemo(() => ['All', ...Array.from(new Set(DETECTION_CLASSES.map(c => c.category)))], []);

    const filteredClasses = useMemo(() => DETECTION_CLASSES.filter(c => {
        const matchText = !classSearch || c.name.toLowerCase().includes(classSearch.toLowerCase());
        const matchCat = activeCat === 'All' || c.category === activeCat;
        return matchText && matchCat;
    }), [classSearch, activeCat]);

    const loadData = useCallback(async () => {
        setRefreshing(true);
        try {
            const [workersRes, statsRes, cfgRes] = await Promise.allSettled([
                apiClient.getWorkers(),
                apiClient.getWorkerLiveStats(),
                fetch('/api/analytics/worker-configs').then(r => {
                    if (!r.ok) throw new Error(`HTTP ${r.status}`);
                    return r.json();
                }).catch(() => ({ data: [] })),
            ]);
            if (workersRes.status === 'fulfilled') setWorkers(workersRes.value);
            if (statsRes.status === 'fulfilled') setLiveStats(statsRes.value.workers ?? []);
            if (cfgRes.status === 'fulfilled') {
                const fb: Record<string, { id: string; name: string }[]> = {};
                for (const cam of (cfgRes.value?.data ?? []) as { id: string; name: string; workerId?: string }[]) {
                    if (!cam.workerId) continue;
                    (fb[cam.workerId] ??= []).push({ id: cam.id, name: cam.name });
                }
                setFallbackCams(fb);
            }
        } finally {
            setRefreshing(false);
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadData();
        const t = setInterval(() => void loadData(), 20_000);
        return () => clearInterval(t);
    }, [loadData]);

    // Poll detections every 5s
    useEffect(() => {
        const poll = () => {
            apiClient.getGodsEyeDetections().then(setDetections).catch(() => { });
        };
        poll();
        const t = setInterval(poll, 5_000);
        return () => clearInterval(t);
    }, []);

    // Merge liveStats + workers into usable cards
    const workerCards = useMemo(() => {
        const byId = new Map(workers.map(w => [w.id, w]));
        return liveStats.map(s => {
            const full = byId.get(s.workerId);

            // Strictly limit to 2 feeds per Jetson (YOLO processing limit)
            const assigned = (full?.cameraAssignments ?? [])
                .filter(a => a.isActive && a.device)
                .slice(0, 2)
                .map(a => ({ id: a.deviceId, name: a.device?.name || a.deviceId }));

            // Fallback to manual overrides if no DB assignments found
            const cameras = assigned.length > 0 ? assigned : (fallbackCams[s.workerId] ?? []).slice(0, 2);

            return {
                workerId: s.workerId,
                name: s.name,
                ip: s.ip,
                reachable: s.reachable,
                cameraCount: s.cameraCount,
                gpu: parseNum(s.resources?.gpu_percent),
                cpu: parseNum(s.resources?.cpu_percent ?? s.resources?.cpu_load_1m),
                memory: parseNum(s.resources?.memory_percent),
                cameras,
            };
        });
    }, [workers, liveStats, fallbackCams]);

    const onlineCount = workerCards.filter(w => w.reachable).length;
    const totalCams = workerCards.reduce((s, w) => s + w.cameraCount, 0);

    // Detection-derived charts
    const allEvents = useMemo(() => Object.values(detections).flat(), [detections]);

    // Top classes bar chart data
    const topClassesChart = useMemo(() => {
        const counts: Record<string, number> = {};
        for (const e of allEvents) counts[e.class] = (counts[e.class] ?? 0) + 1;
        return Object.entries(counts)
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);
    }, [allEvents]);

    // Detection density: events per 2-min bucket over last 30 min
    const densityChart = useMemo(() => {
        const now = Date.now() / 1000;
        const BUCKET = 120; // 2 min
        const WINDOW = 1800; // 30 min
        const buckets: Record<number, number> = {};
        for (let t = now - WINDOW; t < now; t += BUCKET) {
            buckets[Math.floor(t / BUCKET)] = 0;
        }
        for (const e of allEvents) {
            const b = Math.floor(e.ts / BUCKET);
            if (b in buckets) buckets[b] = (buckets[b] ?? 0) + 1;
        }
        return Object.entries(buckets)
            .sort(([a], [b]) => Number(a) - Number(b))
            .map(([b, count]) => ({
                time: new Date(Number(b) * BUCKET * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                count,
            }));
    }, [allEvents]);

    // Sankey: cameras → classes
    const sankeyData = useMemo(() => {
        const camCounts: Record<string, Record<string, number>> = {};
        for (const [key, evts] of Object.entries(detections)) {
            const camLabel = key.split('.').pop()?.slice(-6) ?? key.slice(-8);
            for (const e of evts) {
                (camCounts[camLabel] ??= {})[e.class] = ((camCounts[camLabel]?.[e.class]) ?? 0) + 1;
            }
        }
        const cams = Object.keys(camCounts);
        const classes = [...new Set(Object.values(camCounts).flatMap(m => Object.keys(m)))].slice(0, 8);
        if (cams.length === 0 || classes.length === 0) return null;
        const nodes = [
            ...cams.map(c => ({ name: c })),
            ...classes.map(c => ({ name: c })),
        ];
        const links: { source: number; target: number; value: number }[] = [];
        cams.forEach((cam, ci) => {
            classes.forEach((cls, ki) => {
                const v = camCounts[cam]?.[cls] ?? 0;
                if (v > 0) links.push({ source: ci, target: cams.length + ki, value: v });
            });
        });
        return { nodes, links };
    }, [detections]);

    const handleFile = useCallback((file?: File) => {
        if (!file?.type.startsWith('image/')) return;
        const r = new FileReader();
        r.onload = () => setPromptImage({ name: file.name, src: String(r.result ?? '') });
        r.readAsDataURL(file);
    }, []);

    const addClass = useCallback((name: string) => {
        setPromptClasses(p => p.includes(name) ? p.filter(v => v !== name) : [...p, name]);
    }, []);

    return (
        <div className="h-full overflow-hidden flex flex-col iris-dashboard-root">
            {/* ── Page header ─────────────────────────────────────────────────── */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-white/5 bg-zinc-950/40 backdrop-blur-sm shrink-0">
                <div className="flex items-center gap-2.5">
                    <Radar className="h-4 w-4 text-indigo-400" />
                    <h1 className="text-sm font-mono font-bold text-zinc-100 tracking-wide">God's Eye</h1>
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/20">EDGE AI</span>
                    {onlineCount > 0 && (
                        <span className="flex items-center gap-1 text-[9px] font-mono text-emerald-500 ml-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_#10b981] animate-pulse" />
                            {onlineCount}/{workerCards.length} nodes
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-2 text-[9px] font-mono text-zinc-600">
                    <span>{promptClasses.length} classes active</span>
                    {promptImage && <span className="text-fuchsia-500">· visual ref set</span>}
                    {syncStatus === 'ok' && <span className="text-emerald-400">· synced</span>}
                    {syncStatus === 'err' && <span className="text-red-400">· sync failed</span>}
                    <Button onClick={() => void syncPrompts()} disabled={syncing} size="sm"
                        className="h-7 px-2.5 bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 border border-indigo-500/30 text-[10px] font-mono flex items-center gap-1.5">
                        <Send className={cn('h-3 w-3', syncing && 'animate-pulse')} />
                        {syncing ? 'Syncing…' : 'Sync to Edge'}
                    </Button>
                    <Button onClick={() => void loadData()} disabled={refreshing} variant="ghost" size="sm"
                        className="h-7 w-7 p-0 text-zinc-500 hover:text-zinc-200 hover:bg-white/5">
                        <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
                    </Button>
                </div>
            </div>

            {/* ── Tabs ──────────────────────────────────────────────────────────── */}
            <Tabs value={tab} onValueChange={v => setTab(v as 'overview' | 'live')} className="flex-1 flex flex-col min-h-0">
                <div className="px-5 pt-3 pb-0 shrink-0">
                    <TabsList className="bg-zinc-900/40 border border-white/5 p-0.5 h-9 w-72">
                        <TabsTrigger value="overview"
                            className="flex-1 h-8 text-[11px] font-mono rounded-md data-[state=active]:bg-indigo-500/20 data-[state=active]:text-indigo-300 text-zinc-500 transition-all">
                            <Monitor className="h-3.5 w-3.5 mr-1.5" />Overview
                        </TabsTrigger>
                        <TabsTrigger value="live"
                            className="flex-1 h-8 text-[11px] font-mono rounded-md data-[state=active]:bg-emerald-500/20 data-[state=active]:text-emerald-300 text-zinc-500 transition-all">
                            <Eye className="h-3.5 w-3.5 mr-1.5" />Live Inference
                        </TabsTrigger>
                    </TabsList>
                </div>

                {/* ── OVERVIEW ─────────────────────────────────────────────────── */}
                <TabsContent value="overview" className="flex-1 min-h-0 overflow-y-auto outline-none">
                    <div className="p-5 space-y-4">
                        {/* KPI strip */}
                        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                            className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            {[
                                { label: 'Nodes Online', value: `${onlineCount}/${workerCards.length}`, icon: Server, accent: 'text-emerald-400' },
                                { label: 'Camera Feeds', value: totalCams, icon: ScanFace, accent: 'text-indigo-400' },
                                { label: 'Active Classes', value: promptClasses.length, icon: Boxes, accent: 'text-zinc-100' },
                                { label: 'Visual Prompt', value: promptImage ? 'Set' : 'None', icon: ImagePlus, accent: promptImage ? 'text-fuchsia-400' : 'text-zinc-600' },
                            ].map((k, i) => (
                                <motion.div key={k.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                                    <Card className="border border-white/5 bg-zinc-900/30 backdrop-blur-sm hover:border-indigo-500/15 transition-all">
                                        <CardContent className="p-4">
                                            <div className="flex items-start justify-between gap-2">
                                                <div>
                                                    <div className="text-[9px] font-mono tracking-widest text-zinc-600 uppercase mb-1.5">{k.label}</div>
                                                    <div className={`text-2xl font-mono font-bold leading-none ${k.accent}`}>
                                                        {typeof k.value === 'number' ? k.value : k.value}
                                                    </div>
                                                </div>
                                                <k.icon className="h-4 w-4 text-zinc-700 shrink-0 mt-0.5" />
                                            </div>
                                        </CardContent>
                                    </Card>
                                </motion.div>
                            ))}
                        </motion.div>

                        {/* Config + image upload */}
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                            {/* Prompt + catalog */}
                            <div className="lg:col-span-2 space-y-3">
                                {/* Text input */}
                                <Card className="border border-white/5 bg-zinc-900/30 backdrop-blur-sm">
                                    <CardHeader className="px-4 pt-4 pb-2">
                                        <CardTitle className="text-[10px] font-mono tracking-widest text-zinc-500 uppercase flex items-center gap-2">
                                            <Search className="h-3.5 w-3.5 text-indigo-400" />
                                            Detection Vocabulary
                                        </CardTitle>
                                    </CardHeader>
                                    <CardContent className="px-4 pb-4 space-y-3">
                                        <div className="flex gap-2">
                                            <Input value={promptInput} onChange={e => setPromptInput(e.target.value)}
                                                onKeyDown={e => { if (e.key === 'Enter') { const v = promptInput.trim().toLowerCase(); if (v) { addClass(v); setPromptInput(''); } } }}
                                                placeholder="Type a class name and press Enter…"
                                                className="bg-zinc-950/60 border-white/10 text-white text-xs font-mono h-8 focus-visible:ring-indigo-500/40 placeholder:text-zinc-700 flex-1" />
                                            <Button type="button" size="sm" onClick={() => { const v = promptInput.trim().toLowerCase(); if (v) { addClass(v); setPromptInput(''); } }}
                                                className="h-8 px-3 bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 border border-indigo-500/30 text-xs font-mono shrink-0">
                                                Add
                                            </Button>
                                        </div>
                                        {promptClasses.length > 0 && (
                                            <div className="flex flex-wrap gap-1.5">
                                                {promptClasses.map(cls => (
                                                    <motion.button key={cls} type="button"
                                                        initial={{ scale: 0.85, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                                                        onClick={() => setPromptClasses(p => p.filter(v => v !== cls))}
                                                        className="inline-flex items-center gap-1.5 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3 py-0.5 text-[10px] font-mono text-indigo-300 hover:bg-indigo-500/20 transition-all">
                                                        {DETECTION_CLASSES.find(c => c.name === cls)?.emoji ?? '•'} {cls}
                                                        <X className="h-2.5 w-2.5 text-indigo-500/60" />
                                                    </motion.button>
                                                ))}
                                            </div>
                                        )}
                                        <div className="flex items-center justify-between pt-1">
                                            <span className="text-[9px] font-mono text-zinc-700">
                                                Jetsons poll every 1s — changes apply within 2s
                                            </span>
                                            <Button type="button" size="sm" onClick={() => void syncPrompts()} disabled={syncing}
                                                className={cn(
                                                    'h-7 px-3 text-[10px] font-mono flex items-center gap-1.5 transition-all',
                                                    syncStatus === 'ok' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' :
                                                        syncStatus === 'err' ? 'bg-red-500/20 text-red-300 border border-red-500/30' :
                                                            'bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 border border-indigo-500/30'
                                                )}>
                                                <Send className={cn('h-3 w-3', syncing && 'animate-pulse')} />
                                                {syncing ? 'Syncing…' : syncStatus === 'ok' ? 'Synced!' : syncStatus === 'err' ? 'Failed' : 'Push to Edge'}
                                            </Button>
                                        </div>
                                    </CardContent>
                                </Card>

                                {/* Class catalog */}
                                <Card className="border border-white/5 bg-zinc-900/30 backdrop-blur-sm">
                                    <CardHeader className="px-4 pt-4 pb-2">
                                        <CardTitle className="text-[10px] font-mono tracking-widest text-zinc-500 uppercase flex items-center justify-between gap-3">
                                            <div className="flex items-center gap-2">
                                                <Boxes className="h-3.5 w-3.5 text-indigo-400" />
                                                Class Catalog
                                                <span className="text-zinc-700 normal-case font-normal text-[9px]">{DETECTION_CLASSES.length} classes</span>
                                            </div>
                                            <Input value={classSearch} onChange={e => setClassSearch(e.target.value)}
                                                placeholder="Filter…"
                                                className="bg-zinc-950/60 border-white/10 text-white text-[10px] font-mono h-6 w-28 focus-visible:ring-indigo-500/40 placeholder:text-zinc-700" />
                                        </CardTitle>
                                    </CardHeader>
                                    <CardContent className="px-4 pb-4 space-y-2">
                                        <div className="flex gap-1 flex-wrap">
                                            {categories.map(cat => (
                                                <button key={cat} type="button" onClick={() => setActiveCat(cat)}
                                                    className={cn(
                                                        'px-2 py-0.5 text-[9px] font-mono rounded transition-colors',
                                                        activeCat === cat ? 'bg-indigo-500/25 text-indigo-300' : 'text-zinc-700 hover:text-zinc-400'
                                                    )}>{cat}</button>
                                            ))}
                                        </div>
                                        <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 xl:grid-cols-10 gap-1.5 max-h-44 overflow-y-auto pr-1">
                                            {filteredClasses.map(cls => {
                                                const active = promptClasses.includes(cls.name);
                                                return (
                                                    <button key={cls.name} type="button" onClick={() => addClass(cls.name)}
                                                        title={`${cls.name} · ${cls.category}`}
                                                        className={cn(
                                                            'flex flex-col items-center gap-0.5 p-1.5 rounded-lg border transition-all duration-150 group',
                                                            active
                                                                ? 'border-indigo-500/50 bg-indigo-500/10 ring-1 ring-indigo-500/15'
                                                                : 'border-white/5 bg-white/[0.02] hover:bg-white/5 hover:border-white/10'
                                                        )}>
                                                        <span className="text-base leading-none">{cls.emoji}</span>
                                                        <span className={cn('text-[8px] font-mono truncate w-full text-center leading-tight',
                                                            active ? 'text-indigo-300' : 'text-zinc-600 group-hover:text-zinc-400'
                                                        )}>{cls.name}</span>
                                                    </button>
                                                );
                                            })}
                                            {filteredClasses.length === 0 && (
                                                <div className="col-span-full py-6 text-center text-[10px] font-mono text-zinc-700">No matches</div>
                                            )}
                                        </div>
                                    </CardContent>
                                </Card>
                            </div>

                            {/* Right column: image upload + resource chart */}
                            <div className="space-y-3">
                                {/* Visual reference */}
                                <Card className="border border-white/5 bg-zinc-900/30 backdrop-blur-sm">
                                    <CardHeader className="px-4 pt-4 pb-2">
                                        <CardTitle className="text-[10px] font-mono tracking-widest text-zinc-500 uppercase flex items-center gap-2">
                                            <ImagePlus className="h-3.5 w-3.5 text-fuchsia-400" />
                                            Visual Reference
                                        </CardTitle>
                                    </CardHeader>
                                    <CardContent className="px-4 pb-4 space-y-2">
                                        <button type="button"
                                            onClick={() => fileRef.current?.click()}
                                            onDrop={e => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files?.[0]); }}
                                            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                                            onDragLeave={() => setDragOver(false)}
                                            className={cn(
                                                'relative w-full rounded-xl border-2 border-dashed transition-all duration-200 flex flex-col items-center justify-center overflow-hidden',
                                                dragOver
                                                    ? 'border-fuchsia-500/60 bg-fuchsia-500/5'
                                                    : 'border-white/10 bg-white/[0.015] hover:border-fuchsia-500/30 hover:bg-fuchsia-500/[0.02]',
                                                promptImage ? 'aspect-[4/3]' : 'min-h-36 p-5'
                                            )}>
                                            {promptImage ? (
                                                <>
                                                    <img src={promptImage.src} alt="Reference"
                                                        className="absolute inset-0 w-full h-full object-cover rounded-xl" />
                                                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent rounded-xl" />
                                                    <p className="absolute bottom-2 left-2 right-2 text-[8px] font-mono text-zinc-300 truncate bg-black/40 backdrop-blur-sm px-1.5 py-0.5 rounded border border-white/10">
                                                        {promptImage.name}
                                                    </p>
                                                </>
                                            ) : (
                                                <>
                                                    <div className={cn('p-3 rounded-full mb-2 transition-colors', dragOver ? 'bg-fuchsia-500/20' : 'bg-white/5')}>
                                                        <UploadCloud className={cn('h-6 w-6 transition-colors', dragOver ? 'text-fuchsia-400' : 'text-zinc-600')} />
                                                    </div>
                                                    <p className="text-[11px] font-mono text-zinc-400 font-medium">Drop image here</p>
                                                    <p className="text-[9px] font-mono text-zinc-700 mt-0.5">or click · JPEG / PNG / WebP</p>
                                                </>
                                            )}
                                        </button>
                                        <input ref={fileRef} type="file" accept="image/*" className="hidden"
                                            onChange={e => handleFile(e.target.files?.[0])} />
                                        {promptImage && (
                                            <Button type="button" variant="ghost" size="sm" onClick={() => setPromptImage(null)}
                                                className="w-full h-7 text-[10px] font-mono text-zinc-600 hover:text-zinc-300 hover:bg-white/5 border border-white/5">
                                                <X className="h-3 w-3 mr-1" /> Remove
                                            </Button>
                                        )}
                                    </CardContent>
                                </Card>

                                {/* Top detected classes bar chart */}
                                <Card className="border border-white/5 bg-zinc-900/30 backdrop-blur-sm">
                                    <CardHeader className="px-4 pt-4 pb-1">
                                        <CardTitle className="text-[10px] font-mono tracking-widest text-zinc-500 uppercase flex items-center gap-2">
                                            <Boxes className="h-3.5 w-3.5 text-indigo-400" />
                                            Top Detected Classes
                                            <span className="ml-auto text-zinc-700 normal-case font-normal text-[9px]">last batch · {allEvents.length} events</span>
                                        </CardTitle>
                                    </CardHeader>
                                    <CardContent className="px-2 pb-3">
                                        {topClassesChart.length === 0 ? (
                                            <div className="h-36 flex items-center justify-center text-[10px] font-mono text-zinc-700">No detections yet — Jetsons reporting every 10s</div>
                                        ) : (
                                            <div className="h-36">
                                                <ResponsiveContainer width="100%" height="100%">
                                                    <BarChart data={topClassesChart} layout="vertical" margin={{ top: 2, right: 12, left: 2, bottom: 2 }} barCategoryGap="20%">
                                                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" horizontal={false} />
                                                        <XAxis type="number" tick={{ fill: '#52525b', fontSize: 8, fontFamily: 'monospace' }} axisLine={false} tickLine={false} />
                                                        <YAxis type="category" dataKey="name" width={72} tick={{ fill: '#a1a1aa', fontSize: 9, fontFamily: 'monospace' }} axisLine={false} tickLine={false} />
                                                        <Tooltip content={<BarTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                                                        <Bar dataKey="count" name="Detections" radius={[0, 3, 3, 0]} barSize={9}>
                                                            {topClassesChart.map((_, i) => (
                                                                <Cell key={i} fill={`hsl(${220 + i * 18}, 70%, 65%)`} />
                                                            ))}
                                                        </Bar>
                                                    </BarChart>
                                                </ResponsiveContainer>
                                            </div>
                                        )}
                                    </CardContent>
                                </Card>

                                {/* Detection density area chart */}
                                <Card className="border border-white/5 bg-zinc-900/30 backdrop-blur-sm">
                                    <CardHeader className="px-4 pt-4 pb-1">
                                        <CardTitle className="text-[10px] font-mono tracking-widest text-zinc-500 uppercase flex items-center gap-2">
                                            <Activity className="h-3.5 w-3.5 text-cyan-400" />
                                            Detection Density
                                            <span className="ml-auto text-zinc-700 normal-case font-normal text-[9px]">2-min buckets · 30 min window</span>
                                        </CardTitle>
                                    </CardHeader>
                                    <CardContent className="px-2 pb-3">
                                        {densityChart.every(d => d.count === 0) ? (
                                            <div className="h-32 flex items-center justify-center text-[10px] font-mono text-zinc-700">Waiting for detection events…</div>
                                        ) : (
                                            <div className="h-32">
                                                <ResponsiveContainer width="100%" height="100%">
                                                    <AreaChart data={densityChart} margin={{ top: 4, right: 8, left: -26, bottom: 0 }}>
                                                        <defs>
                                                            <linearGradient id="densityGrad" x1="0" y1="0" x2="0" y2="1">
                                                                <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.35} />
                                                                <stop offset="95%" stopColor="#22d3ee" stopOpacity={0.02} />
                                                            </linearGradient>
                                                        </defs>
                                                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                                                        <XAxis dataKey="time" tick={{ fill: '#52525b', fontSize: 8, fontFamily: 'monospace' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                                                        <YAxis tick={{ fill: '#52525b', fontSize: 8, fontFamily: 'monospace' }} axisLine={false} tickLine={false} allowDecimals={false} />
                                                        <Tooltip content={<BarTooltip />} cursor={{ stroke: 'rgba(255,255,255,0.1)', strokeWidth: 1 }} />
                                                        <Area type="monotone" dataKey="count" name="Events" stroke="#22d3ee" strokeWidth={1.5} fill="url(#densityGrad)" dot={false} />
                                                    </AreaChart>
                                                </ResponsiveContainer>
                                            </div>
                                        )}
                                    </CardContent>
                                </Card>

                                {/* Camera → Class Sankey flow */}
                                {sankeyData && sankeyData.links.length > 0 && (
                                    <Card className="border border-white/5 bg-zinc-900/30 backdrop-blur-sm">
                                        <CardHeader className="px-4 pt-4 pb-1">
                                            <CardTitle className="text-[10px] font-mono tracking-widest text-zinc-500 uppercase flex items-center gap-2">
                                                <Eye className="h-3.5 w-3.5 text-fuchsia-400" />
                                                Camera → Class Flow
                                            </CardTitle>
                                        </CardHeader>
                                        <CardContent className="px-1 pb-3">
                                            <div className="h-48 w-full">
                                                <ResponsiveContainer width="100%" height="100%">
                                                    <Sankey
                                                        data={sankeyData}
                                                        nodePadding={8}
                                                        nodeWidth={10}
                                                        link={{ stroke: '#818cf8', strokeOpacity: 0.25 }}
                                                        node={<SankeyNode />}
                                                        margin={{ top: 4, right: 80, left: 60, bottom: 4 }}
                                                    >
                                                        <Tooltip content={<SankeyTooltip />} />
                                                    </Sankey>
                                                </ResponsiveContainer>
                                            </div>
                                        </CardContent>
                                    </Card>
                                )}
                            </div>
                        </div>
                    </div>
                </TabsContent>

                {/* ── LIVE INFERENCE ────────────────────────────────────────────── */}
                <TabsContent value="live" className="flex-1 min-h-0 overflow-hidden outline-none">
                    {loading ? (
                        <div className="h-full grid grid-cols-2 gap-4 p-5">
                            {[1, 2, 3, 4].map(i => (
                                <div key={i} className="rounded-2xl bg-zinc-900/50 border border-white/5 animate-pulse" />
                            ))}
                        </div>
                    ) : workerCards.filter(w => w.cameras.length > 0).length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-zinc-700 gap-3">
                            <WifiOff className="h-12 w-12" />
                            <p className="text-sm font-mono font-bold">No active camera feeds</p>
                            <p className="text-[11px] font-mono text-zinc-700">Workers are offline or have no camera assignments</p>
                        </div>
                    ) : (
                        <div className="h-full overflow-y-auto p-5 space-y-5">
                            {workerCards.filter(w => w.cameras.length > 0).map((worker, wi) => (
                                <motion.div key={worker.workerId}
                                    initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
                                    transition={{ duration: 0.35, delay: wi * 0.06 }}
                                    className="space-y-2">
                                    {/* Worker strip */}
                                    <div className="flex items-center gap-2 px-1">
                                        <span className={cn('w-2 h-2 rounded-full shadow-[0_0_8px]',
                                            worker.reachable
                                                ? 'bg-emerald-400 shadow-emerald-400/50'
                                                : 'bg-red-500 shadow-red-500/50'
                                        )} />
                                        <span className="text-[11px] font-mono font-bold text-zinc-300 uppercase tracking-widest">{worker.name}</span>
                                        <span className="text-[9px] font-mono text-zinc-700 bg-white/5 px-1.5 py-0.5 rounded">{worker.ip}</span>
                                        <div className="flex items-center gap-3 ml-auto text-[9px] font-mono text-zinc-700">
                                            <span title="GPU">GPU {Math.round(worker.gpu)}%</span>
                                            <span title="CPU">CPU {Math.round(worker.cpu)}%</span>
                                            <span title="RAM">RAM {Math.round(worker.memory)}%</span>
                                            <span>{worker.cameras.length} feed{worker.cameras.length !== 1 ? 's' : ''}</span>
                                        </div>
                                    </div>

                                    {/* Camera grid — 2 cameras per row */}
                                    <div className={cn('grid gap-3', worker.cameras.length === 1 ? 'grid-cols-1 max-w-3xl' : 'grid-cols-2')}>
                                        {worker.cameras.map(cam => (
                                            <div key={cam.id} className="aspect-video">
                                                <FeedTile
                                                    cameraId={cam.id}
                                                    cameraName={cam.name}
                                                    workerName={worker.name}
                                                    workerIp={worker.ip}
                                                    reachable={worker.reachable}
                                                    activeClasses={promptClasses}
                                                    detCount={(detections[`${worker.workerId}.${cam.id}`] ?? []).length}
                                                    onZoom={() => setZoomed({
                                                        workerId: worker.workerId,
                                                        cameraId: cam.id,
                                                        cameraName: cam.name,
                                                        workerIp: worker.ip,
                                                        reachable: worker.reachable,
                                                    })}
                                                />
                                            </div>
                                        ))}
                                    </div>
                                </motion.div>
                            ))}
                        </div>
                    )}
                </TabsContent>
            </Tabs>

            {/* ── Fullscreen overlay ─────────────────────────────────────────────── */}
            <AnimatePresence>
                {zoomed && (
                    <motion.div
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[100] bg-zinc-950/96 backdrop-blur-md flex items-center justify-center p-4 md:p-8"
                        onClick={() => setZoomed(null)}>
                        <motion.div
                            initial={{ scale: 0.94, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.94, opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            className="relative w-full max-w-[1600px] aspect-video rounded-2xl overflow-hidden border border-white/10 bg-zinc-950 shadow-2xl"
                            onClick={e => e.stopPropagation()}>
                            <DirectWebRTCFrame
                                workerIp={zoomed.workerIp}
                                cameraId={zoomed.cameraId}
                                className="absolute inset-0 w-full h-full"
                            />
                            {/* Header */}
                            <div className="absolute top-4 left-4 right-4 z-10 flex items-center justify-between pointer-events-none">
                                <div className="bg-black/60 backdrop-blur-xl border border-white/10 rounded-xl px-4 py-2">
                                    <p className="text-sm font-mono font-bold text-white">{zoomed.cameraName}</p>
                                    <p className="text-[9px] font-mono text-zinc-600 uppercase tracking-widest mt-0.5">
                                        {zoomed.workerIp} · Live Inference
                                    </p>
                                </div>
                                <button type="button" onClick={() => setZoomed(null)} className="pointer-events-auto h-9 w-9 flex items-center justify-center rounded-xl bg-black/60 backdrop-blur-md border border-white/10 text-white hover:bg-white/10 transition-colors">
                                    <X className="h-4 w-4" />
                                </button>
                            </div>
                            {/* Bottom pill */}
                            <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
                                <div className="flex items-center gap-2 bg-black/50 backdrop-blur-xl border border-white/10 px-5 py-2 rounded-2xl">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_#10b981] animate-pulse" />
                                    <span className="text-[10px] font-mono font-bold text-zinc-300 uppercase tracking-widest">Inference Active</span>
                                    <span className="text-zinc-700 mx-1">·</span>
                                    <span className="text-[10px] font-mono text-zinc-500">
                                        {promptClasses.slice(0, 5).map(c => DETECTION_CLASSES.find(x => x.name === c)?.emoji ?? '•').join(' ')}
                                        {promptClasses.length > 5 ? ` +${promptClasses.length - 5}` : ''}
                                    </span>
                                </div>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
