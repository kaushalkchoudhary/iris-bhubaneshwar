import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Bot,
  Boxes,
  CheckCircle2,
  Cpu,
  ImagePlus,
  Maximize2,
  Radar,
  RefreshCw,
  Search,
  Server,
  Sparkles,
  UploadCloud,
  User,
  X,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { apiClient, type WorkerWithCounts } from '@/lib/api';
import type { WorkerLiveStat } from '@/lib/worker-types';
import { DirectWebRTCFrame } from '@/components/cameras/DirectWebRTCFrame';
import { cn } from '@/lib/utils';

type WorkerConfigCamera = {
  id: string;
  name: string;
  workerId?: string | null;
};

type PromptClass = {
  name: string;
  icon: typeof User;
  color: string;
};

const CLASS_SUGGESTIONS: PromptClass[] = [
  { name: 'person', icon: User, color: 'text-cyan-300' },
  { name: 'vehicle', icon: Boxes, color: 'text-indigo-300' },
  { name: 'helmet', icon: CheckCircle2, color: 'text-emerald-300' },
  { name: 'bag', icon: Bot, color: 'text-fuchsia-300' },
  { name: 'phone', icon: Sparkles, color: 'text-amber-300' },
  { name: 'fire', icon: Activity, color: 'text-rose-300' },
];

type TrendPoint = {
  time: string;
  onlineJetsons: number;
  activeCams: number;
  yoloFeeds: number;
};

type WorkerCard = {
  workerId: string;
  name: string;
  ip: string;
  reachable: boolean;
  cameraCount: number;
  gpu: number;
  cpu: number;
  memory: number;
  cameras: Array<{ id: string; name: string }>;
};

function parseResourceNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return 0;
}

function ClockTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-white/10 bg-zinc-950/95 p-2 text-xs">
      <p className="mb-1 text-zinc-400">{label}</p>
      {payload.map((entry: any) => (
        <div key={entry.name} className="flex items-center justify-between gap-5">
          <span style={{ color: entry.color }}>{entry.name}</span>
          <span className="font-mono text-zinc-200">{entry.value}</span>
        </div>
      ))}
    </div>
  );
}

export function GodsEyePage() {
  const [tab, setTab] = useState<'overview' | 'live'>('overview');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [workers, setWorkers] = useState<WorkerWithCounts[]>([]);
  const [liveStats, setLiveStats] = useState<WorkerLiveStat[]>([]);
  const [fallbackCameras, setFallbackCameras] = useState<Record<string, Array<{ id: string; name: string }>>>({});
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [promptInput, setPromptInput] = useState('');
  const [promptClasses, setPromptClasses] = useState<string[]>(['person', 'helmet', 'backpack']);
  const [promptImage, setPromptImage] = useState<{ fileName: string; src: string } | null>(null);
  const [zoomed, setZoomed] = useState<{ ip: string; id: string; name: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const updateTrend = useCallback((onlineJetsons: number, activeCams: number, yoloFeeds: number) => {
    const now = new Date();
    const point: TrendPoint = {
      time: now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
      onlineJetsons,
      activeCams,
      yoloFeeds,
    };
    setTrend((prev) => [...prev.slice(-11), point]);
  }, []);

  const loadData = useCallback(async () => {
    try {
      setRefreshing(true);
      const [workersRes, statsRes, workerCfgRes] = await Promise.all([
        apiClient.getWorkers().catch(() => [] as WorkerWithCounts[]),
        apiClient.getWorkerLiveStats().catch(() => ({ workers: [] as WorkerLiveStat[] })),
        fetch('/api/analytics/worker-configs')
          .then((r) => r.json())
          .catch(() => ({ data: [] as WorkerConfigCamera[] })),
      ]);

      setWorkers(workersRes);
      setLiveStats(statsRes.workers ?? []);

      const fallback: Record<string, Array<{ id: string; name: string }>> = {};
      for (const cam of (workerCfgRes?.data ?? []) as WorkerConfigCamera[]) {
        if (!cam.workerId) continue;
        if (!fallback[cam.workerId]) fallback[cam.workerId] = [];
        fallback[cam.workerId].push({ id: cam.id, name: cam.name });
      }
      setFallbackCameras(fallback);
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
    const timer = window.setInterval(() => {
      void loadData();
    }, 15000);
    return () => window.clearInterval(timer);
  }, [loadData]);

  const workerCards = useMemo<WorkerCard[]>(() => {
    const workerById = new Map(workers.map((w) => [w.id, w]));
    const cards = liveStats.map((s) => {
      const full = workerById.get(s.workerId);
      const assignments = (full?.cameraAssignments ?? [])
        .filter((a) => a.isActive && a.device)
        .slice(0, 2)
        .map((a) => ({
          id: a.deviceId,
          name: a.device?.name || a.deviceId,
        }));
      const fallback = (fallbackCameras[s.workerId] ?? []).slice(0, 2);
      const gpu = parseResourceNumber(s.resources?.gpu_percent);
      const cpu = parseResourceNumber(s.resources?.cpu_percent ?? s.resources?.cpu_load_1m);
      const memory = parseResourceNumber(s.resources?.memory_percent);

      return {
        workerId: s.workerId,
        name: s.name,
        ip: s.ip,
        reachable: s.reachable,
        cameraCount: s.cameraCount,
        gpu,
        cpu,
        memory,
        cameras: assignments.length > 0 ? assignments : fallback,
      };
    });
    return cards;
  }, [fallbackCameras, liveStats, workers]);

  useEffect(() => {
    if (!workerCards.length) return;
    const online = workerCards.filter((w) => w.reachable).length;
    const cams = workerCards.reduce((acc, w) => acc + w.cameras.length, 0);
    updateTrend(online, cams, cams);
  }, [updateTrend, workerCards]);

  const gpuChart = useMemo(
    () => workerCards.map((w) => ({ worker: w.name.replace('Jetson ', 'J'), gpu: Math.round(w.gpu), cpu: Math.round(w.cpu) })),
    [workerCards]
  );

  const servicePie = useMemo(() => {
    const online = workerCards.filter((w) => w.reachable).length;
    const offline = Math.max(workerCards.length - online, 0);
    const feeds = workerCards.reduce((acc, w) => acc + w.cameras.length, 0);
    const idle = Math.max(workerCards.length * 2 - feeds, 0);
    return [
      { name: 'Online', value: online, color: '#22d3ee' },
      { name: 'Offline', value: offline, color: '#ef4444' },
      { name: 'Feed Slots Used', value: feeds, color: '#818cf8' },
      { name: 'Feed Slots Free', value: idle, color: '#f59e0b' },
    ];
  }, [workerCards]);

  const handleAddPromptClass = useCallback(() => {
    const next = promptInput.trim().toLowerCase();
    if (!next) return;
    setPromptClasses((prev) => (prev.includes(next) ? prev : [...prev, next]));
    setPromptInput('');
  }, [promptInput]);

  const handleDropImage = useCallback((file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      setPromptImage({ fileName: file.name, src: String(reader.result || '') });
    };
    reader.readAsDataURL(file);
  }, []);

  return (
    <div className="h-full overflow-auto p-4 md:p-6 space-y-5 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.16),_transparent_55%),linear-gradient(180deg,rgba(7,12,22,0.95),rgba(7,12,22,0.98))]">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-[10px] tracking-[0.25em] uppercase text-cyan-300/80 font-mono">YOLOE Command Deck</p>
          <h1 className="text-2xl md:text-3xl font-semibold text-zinc-100 mt-1">God&apos;s Eye</h1>
          <p className="text-sm text-zinc-400 mt-1">Text and visual prompts, live GPU edge inference, and two-camera Jetson view.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            className="border-white/15 bg-white/5 hover:bg-white/10 text-zinc-200"
            onClick={() => void loadData()}
            disabled={refreshing}
          >
            <RefreshCw className={cn('h-4 w-4 mr-2', refreshing && 'animate-spin')} />
            Refresh
          </Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as 'overview' | 'live')}>
        <TabsList className="bg-zinc-900/70 border border-white/10">
          <TabsTrigger value="overview" className="data-[state=active]:bg-cyan-500/20 data-[state=active]:text-cyan-200">Overview</TabsTrigger>
          <TabsTrigger value="live" className="data-[state=active]:bg-cyan-500/20 data-[state=active]:text-cyan-200">Live</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="bg-zinc-950/55 border-white/10 lg:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-zinc-200 flex items-center gap-2">
                  <Search className="h-4 w-4 text-cyan-300" />
                  Text Prompt Classes
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-col sm:flex-row gap-2">
                  <Input
                    value={promptInput}
                    onChange={(e) => setPromptInput(e.target.value)}
                    placeholder="Add class (example: forklift, suitcase, fire extinguisher)"
                    className="bg-zinc-900/70 border-white/15 text-zinc-100"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddPromptClass();
                      }
                    }}
                  />
                  <Button type="button" onClick={handleAddPromptClass} className="bg-cyan-500 hover:bg-cyan-400 text-zinc-950">
                    Add class
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {promptClasses.map((cls) => (
                    <button
                      key={cls}
                      type="button"
                      onClick={() => setPromptClasses((prev) => prev.filter((v) => v !== cls))}
                      className="inline-flex items-center gap-1 rounded-md border border-cyan-400/30 bg-cyan-400/10 px-2.5 py-1 text-xs text-cyan-200 hover:bg-cyan-400/20"
                      title="Remove class"
                    >
                      <span>{cls}</span>
                      <X className="h-3 w-3" />
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  {CLASS_SUGGESTIONS.map((item) => {
                    const Icon = item.icon;
                    const active = promptClasses.includes(item.name);
                    return (
                      <button
                        key={item.name}
                        type="button"
                        onClick={() =>
                          setPromptClasses((prev) => (prev.includes(item.name) ? prev : [...prev, item.name]))
                        }
                        className={cn(
                          'flex items-center gap-2 rounded-lg border px-3 py-2 text-left transition',
                          active ? 'border-cyan-300/40 bg-cyan-400/10' : 'border-white/10 bg-zinc-900/40 hover:bg-zinc-900/70'
                        )}
                      >
                        <Icon className={cn('h-4 w-4', item.color)} />
                        <span className="text-xs text-zinc-200">{item.name}</span>
                      </button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            <Card className="bg-zinc-950/55 border-white/10">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-zinc-200 flex items-center gap-2">
                  <ImagePlus className="h-4 w-4 text-fuchsia-300" />
                  Visual Prompt
                </CardTitle>
              </CardHeader>
              <CardContent>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  onDrop={(e) => {
                    e.preventDefault();
                    handleDropImage(e.dataTransfer.files?.[0]);
                  }}
                  onDragOver={(e) => e.preventDefault()}
                  className="w-full rounded-lg border border-dashed border-white/15 bg-zinc-900/40 p-4 text-center hover:bg-zinc-900/60 transition"
                >
                  {promptImage ? (
                    <div className="space-y-2">
                      <img src={promptImage.src} alt="Prompt preview" className="mx-auto h-28 w-full rounded-md object-cover" />
                      <p className="text-xs text-zinc-300 truncate">{promptImage.fileName}</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <UploadCloud className="h-6 w-6 mx-auto text-zinc-400" />
                      <p className="text-xs text-zinc-300">Drag & drop an image prompt or click to upload</p>
                    </div>
                  )}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => handleDropImage(e.target.files?.[0])}
                />
                {promptImage && (
                  <Button
                    variant="ghost"
                    type="button"
                    className="mt-2 w-full text-xs text-zinc-300 hover:text-white"
                    onClick={() => setPromptImage(null)}
                  >
                    Remove prompt image
                  </Button>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <Card className="bg-zinc-950/55 border-white/10 xl:col-span-2">
              <CardHeader className="pb-1">
                <CardTitle className="text-sm text-zinc-200 flex items-center gap-2">
                  <Cpu className="h-4 w-4 text-amber-300" />
                  Jetson GPU/CPU Utilization
                </CardTitle>
              </CardHeader>
              <CardContent className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={gpuChart}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                    <XAxis dataKey="worker" stroke="#94a3b8" />
                    <YAxis stroke="#94a3b8" />
                    <Tooltip content={<ClockTooltip />} />
                    <Bar dataKey="gpu" name="GPU %" fill="#22d3ee" radius={[6, 6, 0, 0]} />
                    <Bar dataKey="cpu" name="CPU %" fill="#818cf8" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card className="bg-zinc-950/55 border-white/10">
              <CardHeader className="pb-1">
                <CardTitle className="text-sm text-zinc-200 flex items-center gap-2">
                  <Radar className="h-4 w-4 text-emerald-300" />
                  Fleet Snapshot
                </CardTitle>
              </CardHeader>
              <CardContent className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={servicePie} dataKey="value" nameKey="name" innerRadius={42} outerRadius={76}>
                      {servicePie.map((entry) => (
                        <Cell key={entry.name} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip content={<ClockTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          <Card className="bg-zinc-950/55 border-white/10">
            <CardHeader className="pb-1">
              <CardTitle className="text-sm text-zinc-200 flex items-center gap-2">
                <Server className="h-4 w-4 text-cyan-300" />
                Live Throughput Trend
              </CardTitle>
            </CardHeader>
            <CardContent className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trend}>
                  <defs>
                    <linearGradient id="onlineGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.6} />
                      <stop offset="95%" stopColor="#22d3ee" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                  <XAxis dataKey="time" stroke="#94a3b8" />
                  <YAxis stroke="#94a3b8" />
                  <Tooltip content={<ClockTooltip />} />
                  <Area type="monotone" dataKey="onlineJetsons" name="Online Jetsons" stroke="#22d3ee" fill="url(#onlineGrad)" strokeWidth={2} />
                  <Area type="monotone" dataKey="activeCams" name="Active Cam Feeds" stroke="#818cf8" fill="transparent" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="live" className="space-y-4">
          {loading ? (
            <div className="rounded-xl border border-white/10 bg-zinc-950/60 p-6 text-sm text-zinc-400">Loading workers and feeds...</div>
          ) : workerCards.length === 0 ? (
            <div className="rounded-xl border border-white/10 bg-zinc-950/60 p-6 text-sm text-zinc-400">No Jetsons found.</div>
          ) : (
            <div className="space-y-5">
              {workerCards.map((worker) => (
                <Card key={worker.workerId} className="bg-zinc-950/55 border-white/10 overflow-hidden">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-zinc-200 flex flex-wrap items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-2">
                        <Server className={cn('h-4 w-4', worker.reachable ? 'text-emerald-300' : 'text-rose-300')} />
                        {worker.name}
                        <span className="text-[10px] text-zinc-500 font-mono">{worker.ip || 'No IP'}</span>
                      </span>
                      <span className="inline-flex items-center gap-3 text-[11px] text-zinc-400 font-mono">
                        <span>GPU {Math.round(worker.gpu)}%</span>
                        <span>MEM {Math.round(worker.memory)}%</span>
                        <span>Cams {worker.cameras.length}/2</span>
                      </span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {worker.cameras.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-white/10 p-6 text-center text-xs text-zinc-500">
                        No cameras assigned for this Jetson.
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                        {worker.cameras.map((cam) => (
                          <div key={cam.id} className="relative aspect-video rounded-lg border border-white/10 overflow-hidden bg-black">
                            <DirectWebRTCFrame workerIp={worker.ip} cameraId={cam.id} className="h-full w-full" />
                            <div className="pointer-events-none absolute top-2 left-2 rounded border border-cyan-300/40 bg-cyan-400/15 px-2 py-0.5 text-[10px] font-mono text-cyan-200">
                              YOLOE LIVE
                            </div>
                            <div className="pointer-events-none absolute inset-0 opacity-0 hover:opacity-100 transition-opacity">
                              <div className="absolute left-2 top-2 h-4 w-4 border-l border-t border-cyan-300/70" />
                              <div className="absolute right-2 top-2 h-4 w-4 border-r border-t border-cyan-300/70" />
                              <div className="absolute left-2 bottom-2 h-4 w-4 border-l border-b border-cyan-300/70" />
                              <div className="absolute right-2 bottom-2 h-4 w-4 border-r border-b border-cyan-300/70" />
                            </div>
                            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/85 to-transparent px-3 py-2 text-xs text-zinc-100">
                              {cam.name}
                            </div>
                            <button
                              type="button"
                              onClick={() => setZoomed({ ip: worker.ip, id: cam.id, name: cam.name })}
                              className="absolute top-2 right-2 z-10 h-6 w-6 rounded border border-white/20 bg-black/60 text-cyan-200 hover:bg-black/75 flex items-center justify-center"
                              title="Expand feed"
                            >
                              <Maximize2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {zoomed && (
        <div className="fixed inset-0 z-[90] bg-black/85 p-4 md:p-8" onClick={() => setZoomed(null)}>
          <div className="relative mx-auto h-full w-full max-w-[1600px] overflow-hidden rounded-xl border border-white/10 bg-black">
            <div className="absolute left-3 top-3 z-10 rounded bg-black/65 px-2 py-1 text-xs text-zinc-100">{zoomed.name}</div>
            <DirectWebRTCFrame workerIp={zoomed.ip} cameraId={zoomed.id} className="h-full w-full" />
          </div>
        </div>
      )}
    </div>
  );
}
