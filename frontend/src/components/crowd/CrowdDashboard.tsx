import { useState, useEffect, useMemo } from 'react';
import { apiClient, type CrowdAnalysis, type CrowdAlert } from '@/lib/api';
import {
  Users, Loader2, TrendingUp, Activity,
  Clock, Bell, Flame, Radio,
  ShieldAlert, Eye, Layers, X, Maximize2
} from 'lucide-react';
import { useCrowdDashboard } from '@/contexts/CrowdDashboardContext';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  Tooltip, ResponsiveContainer, CartesianGrid
} from 'recharts';

// ─── helpers ────────────────────────────────────────────────────────────────

const FRS_ALERT_TYPES = new Set(['person_match', 'face_match', 'person_detected', 'unknown_person']);

function densityConfig(level: string) {
  if (level === 'CRITICAL') return { text: 'text-red-400', bg: 'bg-red-500/15', border: 'border-red-500/40', glow: '#ef4444', bar: 'bg-red-500' };
  if (level === 'HIGH')     return { text: 'text-orange-400', bg: 'bg-orange-500/15', border: 'border-orange-500/40', glow: '#f97316', bar: 'bg-orange-500' };
  if (level === 'MEDIUM')   return { text: 'text-yellow-400', bg: 'bg-yellow-500/15', border: 'border-yellow-500/40', glow: '#eab308', bar: 'bg-yellow-500' };
  return { text: 'text-emerald-400', bg: 'bg-emerald-500/15', border: 'border-emerald-500/40', glow: '#10b981', bar: 'bg-emerald-500' };
}

function timeSince(ts: string) {
  const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

// ─── main component ──────────────────────────────────────────────────────────

type TimeRange = '1H' | '24H' | '7D';

const TIME_RANGE_CFG: Record<TimeRange, { label: string; hours: number; limit: number; subtitle: string; bucket: (d: Date) => string }> = {
  '1H':  { label: '1H',   hours: 1,   limit: 300,  subtitle: 'Avg people per 5 min',  bucket: (d) => `${d.getHours().toString().padStart(2,'0')}:${(Math.floor(d.getMinutes()/5)*5).toString().padStart(2,'0')}` },
  '24H': { label: '24H',  hours: 24,  limit: 1000, subtitle: 'Avg people per hour',   bucket: (d) => `${d.getHours().toString().padStart(2,'0')}:00` },
  '7D':  { label: '7D',   hours: 168, limit: 5000, subtitle: 'Avg people per day',    bucket: (d) => ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()] },
};

export function CrowdDashboard() {
  const [latestAnalyses, setLatestAnalyses] = useState<CrowdAnalysis[]>([]);
  const [historical, setHistorical]         = useState<CrowdAnalysis[]>([]);
  const [alerts, setAlerts]                 = useState<CrowdAlert[]>([]);
  const [liveFrames, setLiveFrames]         = useState<Record<string, string>>({});
  const [loading, setLoading]               = useState(true);
  const [selectedHotspot, setSelectedHotspot] = useState<CrowdAnalysis | null>(null);
  const [selectedAlert, setSelectedAlert]     = useState<CrowdAlert | null>(null);
  const [zoomedFrame, setZoomedFrame]         = useState<{ name: string; src: string | null } | null>(null);
  const [timeRange, setTimeRange]           = useState<TimeRange>('24H');
  const { autoRefresh } = useCrowdDashboard();

  const fetchHistorical = async (range: TimeRange) => {
    const cfg = TIME_RANGE_CFG[range];
    const startTime = new Date(Date.now() - cfg.hours * 3_600_000).toISOString();
    const hist = await apiClient.getCrowdAnalysis({ startTime, limit: cfg.limit });
    setHistorical(Array.isArray(hist) ? hist : []);
  };

  const fetchAll = async () => {
    try {
      const [latest, alts] = await Promise.all([
        apiClient.getLatestCrowdAnalysis(),
        apiClient.getCrowdAlerts({ isResolved: false, limit: 30 }),
      ]);
      setLatestAnalyses(Array.isArray(latest) ? latest : []);
      setAlerts(Array.isArray(alts) ? alts.filter(a => !FRS_ALERT_TYPES.has(a.alertType)) : []);
      await fetchHistorical(timeRange);
    } catch (err) {
      console.error('Failed to fetch crowd data:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchFrames = async () => {
    try {
      const frames = await apiClient.getAllLiveFrames();
      if (frames && typeof frames === 'object') setLiveFrames(frames);
    } catch { /* no frames yet */ }
  };

  useEffect(() => { fetchAll(); fetchFrames(); }, []);

  // Re-fetch historical whenever time range changes
  useEffect(() => { fetchHistorical(timeRange); }, [timeRange]);

  // Analysis data: refresh every 5s
  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(fetchAll, 5000);
    return () => clearInterval(id);
  }, [autoRefresh]);

  // Live frames: always poll every 2s for near-real-time display
  useEffect(() => {
    const id = setInterval(fetchFrames, 2000);
    return () => clearInterval(id);
  }, []);

  // ── KPIs ─────────────────────────────────────────────────────────────────
  // Full-day total footfall from cumulative tracking across cameras
  const totalPeople   = useMemo(() => latestAnalyses.reduce((s, a) => s + (a.cumulativeCount ?? 0), 0), [latestAnalyses]);
  // Current live occupancy (people visible in cameras right now)
  const liveNow       = useMemo(() => latestAnalyses.reduce((s, a) => s + (a.peopleCount ?? 0), 0), [latestAnalyses]);
  const activeCameras = useMemo(() => latestAnalyses.filter(a => a.peopleCount != null).length, [latestAnalyses]);
  // Peak occupancy within the selected time range (from historical data)
  const peakCount = useMemo(() => historical.reduce((m, a) => Math.max(m, a.peopleCount ?? 0), 0), [historical]);


  // ── Trend chart ───────────────────────────────────────────────────────────
  const trendData = useMemo(() => {
    const cfg = TIME_RANGE_CFG[timeRange];
    const buckets: Record<string, number[]> = {};
    historical.forEach(a => {
      const key = cfg.bucket(new Date(a.timestamp));
      if (!buckets[key]) buckets[key] = [];
      buckets[key].push(a.peopleCount ?? 0);
    });
    return Object.entries(buckets)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([hour, counts]) => ({
        hour,
        people: Math.round(counts.reduce((s, v) => s + v, 0) / counts.length),
        max:    Math.max(...counts),
      }));
  }, [historical, timeRange]);

  const peakHours     = useMemo(() => [...trendData].sort((a, b) => b.people - a.people).slice(0, 5), [trendData]);
  const highRiskHours = useMemo(() => trendData.filter(d => d.people > 30).length, [trendData]);
  const avgCrowd      = useMemo(() => trendData.length ? Math.round(trendData.reduce((s, d) => s + d.people, 0) / trendData.length) : 0, [trendData]);
  const peakMax       = peakHours[0]?.people || 1;

  // ── Sparklines ────────────────────────────────────────────────────────────
  const deviceSparklines = useMemo(() => {
    const map: Record<string, number[]> = {};
    [...historical].reverse().forEach(a => {
      if (!map[a.deviceId]) map[a.deviceId] = [];
      if (map[a.deviceId].length < 14) map[a.deviceId].push(a.peopleCount ?? 0);
    });
    return map;
  }, [historical]);

  const hotspots = useMemo(
    () => [...latestAnalyses].sort((a, b) => (b.peopleCount ?? 0) - (a.peopleCount ?? 0)),
    [latestAnalyses]
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full bg-zinc-950">
        <div className="flex flex-col items-center gap-3">
          <div className="relative">
            <div className="w-12 h-12 rounded-full border-2 border-cyan-500/30 animate-ping absolute inset-0" />
            <Loader2 className="w-12 h-12 animate-spin text-cyan-500 relative" />
          </div>
          <p className="text-sm text-zinc-400 tracking-wide">Loading crowd intelligence…</p>
        </div>
      </div>
    );
  }

  return (
    <>
    <div className="h-full w-full flex overflow-hidden bg-zinc-950">

      {/* ── Main ──────────────────────────────────────────────────────────── */}
      <div className="flex-1 min-w-0 overflow-y-auto scroll-on-hover">
        <div className="p-5 space-y-5">

          {/* Header */}
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-400" />
            </span>
            <span className="text-[10px] font-semibold text-cyan-400 uppercase tracking-widest">Live · Crowd Intelligence</span>
            <span className="text-zinc-700 mx-1">·</span>
            <h1 className="text-sm font-bold text-white tracking-tight">Crowd Analytics</h1>
          </div>

          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
            <KpiCard
              label="Total People Today"
              value={totalPeople.toLocaleString()}
              sub="Running cumulative footfall"
              icon={<Users className="w-5 h-5" />}
              gradient="from-cyan-500/20 to-cyan-500/5"
              borderColor="border-cyan-500/30"
              glowColor="rgba(34,211,238,0.15)"
              textColor="text-cyan-300"
            />
            <KpiCard
              label="Live Now"
              value={liveNow.toLocaleString()}
              sub="Current occupancy across cams"
              icon={<Radio className="w-5 h-5" />}
              gradient="from-emerald-500/20 to-emerald-500/5"
              borderColor="border-emerald-500/30"
              glowColor="rgba(16,185,129,0.15)"
              textColor="text-emerald-300"
            />
            <KpiCard
              label={`Peak (${TIME_RANGE_CFG[timeRange].label})`}
              value={peakCount.toLocaleString()}
              sub={`Highest count in selected period`}
              icon={<Flame className="w-5 h-5" />}
              gradient="from-orange-500/20 to-orange-500/5"
              borderColor="border-orange-500/30"
              glowColor="rgba(249,115,22,0.15)"
              textColor="text-orange-300"
            />
            <KpiCard
              label="Active Cameras"
              value={`${activeCameras} / ${latestAnalyses.length}`}
              sub="Reporting live data"
              icon={<Eye className="w-5 h-5" />}
              gradient="from-violet-500/20 to-violet-500/5"
              borderColor="border-violet-500/30"
              glowColor="rgba(139,92,246,0.15)"
              textColor="text-violet-300"
            />
          </div>

          {/* Trend + Peak Hours */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">

            {/* Area chart */}
            <div className="xl:col-span-2 rounded-2xl border border-white/8 bg-zinc-900/60 backdrop-blur-sm overflow-hidden">
              <div className="px-5 pt-4 pb-3 flex items-center justify-between border-b border-white/5">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-cyan-500/10">
                    <TrendingUp className="w-4 h-4 text-cyan-400" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-zinc-100">Crowd Footfall Trend</p>
                    <p className="text-[10px] text-zinc-500">{TIME_RANGE_CFG[timeRange].subtitle}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1 bg-zinc-800/60 rounded-full px-1.5 py-1">
                  {(['1H','24H','7D'] as TimeRange[]).map(r => (
                    <button
                      key={r}
                      onClick={() => setTimeRange(r)}
                      className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold transition-all duration-150 ${
                        timeRange === r ? 'bg-cyan-500 text-black' : 'text-zinc-500 hover:text-zinc-300'
                      }`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>
              <div className="p-4">
                {trendData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={190}>
                    <AreaChart data={trendData} margin={{ top: 8, right: 4, left: -24, bottom: 0 }}>
                      <defs>
                        <linearGradient id="crowdGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.35} />
                          <stop offset="100%" stopColor="#22d3ee" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                      <XAxis dataKey="hour" tick={{ fill: '#52525b', fontSize: 10 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                      <YAxis tick={{ fill: '#52525b', fontSize: 10 }} axisLine={false} tickLine={false} />
                      <Tooltip
                        contentStyle={{ background: '#111113', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, fontSize: 12, padding: '8px 12px' }}
                        labelStyle={{ color: '#71717a', marginBottom: 4 }}
                        itemStyle={{ color: '#22d3ee' }}
                        cursor={{ stroke: 'rgba(34,211,238,0.2)', strokeWidth: 1 }}
                      />
                      <Area type="monotone" dataKey="people" stroke="#22d3ee" strokeWidth={2} fill="url(#crowdGrad)" dot={false} activeDot={{ r: 5, fill: '#22d3ee', strokeWidth: 0 }} />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-[190px] flex flex-col items-center justify-center gap-2">
                    <Activity className="w-8 h-8 text-zinc-700" />
                    <p className="text-sm text-zinc-600">Pipeline populating data…</p>
                    <p className="text-xs text-zinc-700">Check back in a few seconds</p>
                  </div>
                )}
              </div>
            </div>

            {/* Peak hours + summary */}
            <div className="rounded-2xl border border-white/8 bg-zinc-900/60 backdrop-blur-sm overflow-hidden flex flex-col">
              {/* Peak hours */}
              <div className="px-5 pt-4 pb-3 border-b border-white/5">
                <div className="flex items-center gap-2 mb-4">
                  <div className="p-1.5 rounded-lg bg-orange-500/10">
                    <Clock className="w-4 h-4 text-orange-400" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-zinc-100">Peak {timeRange === '7D' ? 'Days' : 'Hours'}</p>
                    <p className="text-[10px] text-zinc-500">Top 5 busiest {timeRange === '7D' ? 'days' : 'slots'} ({TIME_RANGE_CFG[timeRange].label})</p>
                  </div>
                </div>
                {peakHours.length > 0 ? (
                  <div className="space-y-2.5">
                    {peakHours.map((slot, i) => {
                      const rankColors = ['bg-red-500','bg-orange-500','bg-yellow-500','bg-cyan-500','bg-zinc-600'];
                      const textColors = ['text-red-400','text-orange-400','text-yellow-400','text-cyan-400','text-zinc-400'];
                      return (
                        <div key={slot.hour} className="flex items-center gap-3">
                          <span className={`w-4 h-4 rounded-full ${rankColors[i]} flex items-center justify-center text-[9px] font-bold text-black shrink-0`}>
                            {i + 1}
                          </span>
                          <span className="text-xs text-zinc-400 w-12 shrink-0 font-mono">{slot.hour}</span>
                          <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${rankColors[i]} transition-all duration-700`}
                              style={{ width: `${Math.round((slot.people / peakMax) * 100)}%` }}
                            />
                          </div>
                          <span className={`text-xs font-bold w-8 text-right tabular-nums ${textColors[i]}`}>
                            {slot.people}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-zinc-700 text-center py-4">No data yet</p>
                )}
              </div>

              {/* Summary stats */}
              <div className="px-5 py-4 flex-1">
                <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-3">Summary</p>
                <div className="space-y-2.5">
                  <SummaryRow label="High-Risk Hours" value={highRiskHours.toString()} valueColor="text-red-400" icon={<ShieldAlert className="w-3 h-3" />} />
                  <SummaryRow label="Avg Crowd Size" value={avgCrowd.toString()} valueColor="text-zinc-200" icon={<Users className="w-3 h-3" />} />
                  <SummaryRow label="Active Alerts" value={alerts.length.toString()} valueColor="text-orange-400" icon={<Bell className="w-3 h-3" />} />
                  <SummaryRow label="Total Cameras" value={latestAnalyses.length.toString()} valueColor="text-cyan-400" icon={<Layers className="w-3 h-3" />} />
                </div>
              </div>
            </div>
          </div>

          {/* Hotspots */}
          <div className="rounded-2xl border border-white/8 bg-zinc-900/60 backdrop-blur-sm overflow-hidden">
            <div className="px-5 pt-4 pb-3 border-b border-white/5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-orange-500/10">
                  <Radio className="w-4 h-4 text-orange-400" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-zinc-100">Top Crowd Hotspots</p>
                  <p className="text-[10px] text-zinc-500">Ranked by current density</p>
                </div>
              </div>
              <span className="text-[10px] text-zinc-600 bg-zinc-800 rounded-full px-2.5 py-1">
                {hotspots.length} cameras
              </span>
            </div>
            <div className="p-4">
              {hotspots.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 gap-2">
                  <Users className="w-8 h-8 text-zinc-700" />
                  <p className="text-sm text-zinc-600">No camera data available</p>
                </div>
              ) : (
                <div className="flex gap-4 overflow-x-auto pb-1 scrollbar-thin">
                  {hotspots.slice(0, 10).map((a) => (
                    <HotspotCard
                      key={a.deviceId}
                      analysis={a}
                      sparkline={deviceSparklines[a.deviceId] ?? []}
                      liveFrame={liveFrames[a.deviceId] ?? null}
                      onZoom={() => setZoomedFrame({ name: a.device?.name || a.deviceId, src: liveFrames[a.deviceId] ?? null })}
                      onClick={() => setSelectedHotspot(a)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

        </div>
      </div>

      {/* ── Alerts Sidebar ──────────────────────────────────────────────────── */}
      <div className="w-[280px] shrink-0 border-l border-white/5 bg-zinc-900/50 flex flex-col overflow-hidden">

        {/* Sidebar header */}
        <div className="p-4 border-b border-white/5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-orange-500/10">
                <Bell className="w-3.5 h-3.5 text-orange-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-zinc-100">Crowd Signals</p>
                <p className="text-[10px] text-zinc-500">Live alert feed</p>
              </div>
            </div>
            {alerts.length > 0 && (
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-orange-500 text-[9px] font-bold text-black">
                {alerts.length}
              </span>
            )}
          </div>

          {/* Severity counts */}
          <div className="grid grid-cols-3 gap-1.5">
            {[
              { label: 'Critical', sev: 'RED',    color: 'bg-red-500/15 text-red-400 border-red-500/30' },
              { label: 'Warning',  sev: 'ORANGE',  color: 'bg-orange-500/15 text-orange-400 border-orange-500/30' },
              { label: 'Notice',   sev: 'YELLOW',  color: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30' },
            ].map(({ label, sev, color }) => (
              <div key={sev} className={`rounded-lg border text-center py-1.5 ${color}`}>
                <p className="text-base font-bold tabular-nums">
                  {alerts.filter(a => a.severity === sev).length}
                </p>
                <p className="text-[9px] font-medium">{label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Alert list */}
        <div className="flex-1 overflow-y-auto scroll-on-hover p-3 space-y-2">
          {alerts.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-zinc-700">
              <div className="w-14 h-14 rounded-full bg-zinc-800/60 flex items-center justify-center">
                <Bell className="w-6 h-6 opacity-40" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-zinc-500">All Clear</p>
                <p className="text-xs text-zinc-700 mt-0.5">No active crowd alerts</p>
              </div>
            </div>
          ) : (
            alerts.map(alert => <AlertCard key={alert.id} alert={alert} onClick={() => setSelectedAlert(alert)} />)
          )}
        </div>
      </div>

    </div>

    {/* ── Hotspot Detail Modal ─────────────────────────────────────────────── */}
    {selectedHotspot && (
      <HotspotModal
        analysis={selectedHotspot}
        liveFrame={liveFrames[selectedHotspot.deviceId] ?? null}
        onClose={() => setSelectedHotspot(null)}
      />
    )}

    {/* ── Alert Detail Modal ────────────────────────────────────────────────── */}
    {selectedAlert && (
      <AlertModal alert={selectedAlert} onClose={() => setSelectedAlert(null)} />
    )}

    {zoomedFrame && (
      <div
        className="fixed inset-0 z-[80] bg-black/90 backdrop-blur-sm p-3 md:p-6"
        onClick={() => setZoomedFrame(null)}
      >
        <div className="relative w-full h-full rounded-xl overflow-hidden border border-white/10 bg-black">
          <div className="absolute top-3 left-3 z-10 pointer-events-none bg-black/70 text-white text-xs px-2 py-1 rounded">
            {zoomedFrame.name}
          </div>
          {zoomedFrame.src ? (
            <img src={zoomedFrame.src} alt={zoomedFrame.name} className="w-full h-full object-contain" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-zinc-500">
              <Users className="w-12 h-12 opacity-40" />
            </div>
          )}
        </div>
      </div>
    )}
    </>
  );
}

// ─── Hotspot Modal ────────────────────────────────────────────────────────────

function HotspotModal({ analysis, liveFrame, onClose }: {
  analysis: CrowdAnalysis; liveFrame: string | null; onClose: () => void;
}) {
  const cfg = densityConfig(analysis.densityLevel);
  const name = analysis.device?.name || analysis.deviceId;
  const currentCount = analysis.peopleCount ?? 0;
  const dailyTotal = analysis.cumulativeCount ?? null;
  const congestion = analysis.congestionLevel ?? Math.min(100, currentCount * 3);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        className={`relative w-full max-w-lg rounded-2xl border ${cfg.border} overflow-hidden`}
        style={{ background: 'rgba(12,12,18,0.97)', boxShadow: `0 0 60px ${cfg.glow}30` }}
        onClick={e => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-10 w-7 h-7 rounded-full bg-black/60 flex items-center justify-center text-zinc-400 hover:text-white transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Live frame */}
        <div className="relative w-full" style={{ aspectRatio: '16/9' }}>
          {liveFrame ? (
            <img src={liveFrame} alt={name} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-zinc-900"
              style={{ background: `radial-gradient(ellipse at 50% 60%, ${cfg.glow}12 0%, transparent 70%)` }}>
              <Users className="w-16 h-16" style={{ color: cfg.glow, opacity: 0.2 }} />
            </div>
          )}

          {/* LIVE badge */}
          {liveFrame && (
            <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-black/70 rounded-full px-2.5 py-1">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-red-400" />
              </span>
              <span className="text-[10px] font-bold text-white uppercase tracking-wider">Live</span>
            </div>
          )}

          {/* Density badge */}
          <div className={`absolute top-3 right-10 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-md ${cfg.bg} ${cfg.border} ${cfg.text} border`}>
            {analysis.densityLevel}
          </div>

          {/* Gradient overlay */}
          <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-black/90 to-transparent" />
          <p className="absolute bottom-3 left-4 text-base font-bold text-white">{name}</p>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-px bg-white/5">
          {[
            { label: 'Live Now', value: currentCount.toString(), color: cfg.text },
            { label: 'Today Total', value: dailyTotal != null ? dailyTotal.toLocaleString() : '—', color: 'text-zinc-200' },
            { label: 'Congestion', value: `${congestion}%`, color: cfg.text },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-zinc-900/80 px-4 py-3 text-center">
              <p className="text-[9px] text-zinc-500 uppercase tracking-widest font-semibold mb-1">{label}</p>
              <p className={`text-xl font-black tabular-nums ${color}`}>{value}</p>
            </div>
          ))}
        </div>

        {/* Congestion bar */}
        <div className="px-4 py-3">
          <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className={`h-full ${cfg.bar} rounded-full transition-all duration-700`}
              style={{ width: `${congestion}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Alert Modal ─────────────────────────────────────────────────────────────

function AlertModal({ alert, onClose }: { alert: CrowdAlert; onClose: () => void }) {
  const cfg = densityConfig(alert.severity === 'RED' ? 'CRITICAL' : alert.severity === 'ORANGE' ? 'HIGH' : alert.severity === 'YELLOW' ? 'MEDIUM' : 'LOW');
  const severityLabel = alert.severity === 'RED' ? 'Critical' : alert.severity === 'ORANGE' ? 'Warning' : alert.severity === 'YELLOW' ? 'Notice' : 'Info';
  const camName = alert.device?.name || alert.deviceId;
  const frame = alert.frameSnapshot ?? null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.80)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        className={`relative w-full max-w-md rounded-2xl border ${cfg.border} overflow-hidden`}
        style={{ background: 'rgba(12,12,18,0.97)', boxShadow: `0 0 60px ${cfg.glow}30` }}
        onClick={e => e.stopPropagation()}
      >
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-10 w-7 h-7 rounded-full bg-black/60 flex items-center justify-center text-zinc-400 hover:text-white transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Snapshot frame */}
        <div className="relative w-full" style={{ aspectRatio: '16/9' }}>
          {frame ? (
            <img src={frame} alt={camName} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-zinc-900"
              style={{ background: `radial-gradient(ellipse at 50% 60%, ${cfg.glow}12 0%, transparent 70%)` }}>
              <Users className="w-16 h-16" style={{ color: cfg.glow, opacity: 0.2 }} />
            </div>
          )}

          {/* Severity badge */}
          <div className={`absolute top-3 left-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-black uppercase tracking-wider ${cfg.bg} ${cfg.border} ${cfg.text}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${cfg.bar}`} />
            {severityLabel}
          </div>

          {/* Timestamp badge */}
          <div className="absolute top-3 right-10 flex items-center gap-1 bg-black/70 rounded-full px-2.5 py-1">
            <Clock className="w-3 h-3 text-zinc-400" />
            <span className="text-[10px] text-zinc-300 font-semibold">{timeSince(alert.timestamp)}</span>
          </div>

          <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-black/90 to-transparent" />
          <p className="absolute bottom-3 left-4 text-base font-bold text-white">{camName}</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-px bg-white/5">
          {[
            { label: 'People',     value: alert.peopleCount != null ? alert.peopleCount.toString() : '—', color: cfg.text },
            { label: 'Density',    value: alert.densityLevel, color: cfg.text },
            { label: 'Congestion', value: alert.congestionLevel != null ? `${alert.congestionLevel}%` : '—', color: 'text-zinc-200' },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-zinc-900/80 px-4 py-3 text-center">
              <p className="text-[9px] text-zinc-500 uppercase tracking-widest font-semibold mb-1">{label}</p>
              <p className={`text-lg font-black tabular-nums ${color}`}>{value}</p>
            </div>
          ))}
        </div>

        {/* Alert details */}
        <div className="px-4 py-3 border-t border-white/5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-bold text-zinc-100 mb-0.5">{alert.title}</p>
              {alert.description && (
                <p className="text-[11px] text-zinc-400">{alert.description}</p>
              )}
            </div>
            <div className="shrink-0 text-right">
              <p className="text-[10px] font-semibold text-zinc-400 tabular-nums">
                {new Date(alert.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </p>
              <p className="text-[10px] text-zinc-600">
                {new Date(alert.timestamp).toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' })}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── KPI Card ────────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, icon, gradient, borderColor, glowColor, textColor }: {
  label: string; value: string; sub: string; icon: React.ReactNode;
  gradient: string; borderColor: string; glowColor: string; textColor: string;
}) {
  return (
    <div
      className={`relative rounded-2xl border ${borderColor} bg-gradient-to-b ${gradient} p-4 overflow-hidden`}
      style={{ boxShadow: `0 0 24px ${glowColor}` }}
    >
      {/* subtle grid texture */}
      <div className="absolute inset-0 opacity-[0.03]"
        style={{ backgroundImage: 'repeating-linear-gradient(0deg,#fff 0,#fff 1px,transparent 0,transparent 50%),repeating-linear-gradient(90deg,#fff 0,#fff 1px,transparent 0,transparent 50%)', backgroundSize: '24px 24px' }}
      />
      <div className="relative">
        <div className={`flex items-center gap-1.5 mb-3 ${textColor} opacity-80`}>
          {icon}
          <span className="text-[10px] font-semibold uppercase tracking-widest">{label}</span>
        </div>
        <p className={`text-3xl font-black tracking-tight tabular-nums ${textColor}`}>{value}</p>
        <p className="text-[10px] text-zinc-600 mt-1 font-medium">{sub}</p>
      </div>
    </div>
  );
}

// ─── Summary Row ─────────────────────────────────────────────────────────────

function SummaryRow({ label, value, valueColor, icon }: {
  label: string; value: string; valueColor: string; icon: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className={`flex items-center gap-1.5 text-zinc-500`}>
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <span className={`text-sm font-bold tabular-nums ${valueColor}`}>{value}</span>
    </div>
  );
}

// ─── Hotspot Card ─────────────────────────────────────────────────────────────

function HotspotCard({ analysis, sparkline, liveFrame, onClick, onZoom }: {
  analysis: CrowdAnalysis; sparkline: number[]; liveFrame: string | null; onClick: () => void; onZoom: () => void;
}) {
  const currentCount  = analysis.peopleCount ?? 0;
  const dailyTotal    = analysis.cumulativeCount ?? null;
  const cfg           = densityConfig(analysis.densityLevel);
  const sparkData     = sparkline.map((v, i) => ({ i, v }));
  const name          = analysis.device?.name || analysis.deviceId;
  const congestion    = analysis.congestionLevel ?? Math.min(100, currentCount * 3);

  return (
    <div
      className={`group shrink-0 w-52 rounded-2xl border ${cfg.border} overflow-hidden cursor-pointer hover:scale-[1.02] transition-transform duration-200`}
      style={{ background: 'rgba(15,15,20,0.8)', boxShadow: `0 0 20px ${cfg.glow}18` }}
      onClick={onClick}
    >
      {/* Live frame or placeholder */}
      <div className="relative h-32 bg-zinc-900">
        {liveFrame ? (
          <img
            src={liveFrame}
            alt={name}
            className="w-full h-full object-cover"
            style={{ imageRendering: 'auto' }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center"
            style={{ background: `radial-gradient(ellipse at 50% 60%, ${cfg.glow}12 0%, transparent 70%)` }}>
            <Users className="w-10 h-10" style={{ color: cfg.glow, opacity: 0.3 }} />
          </div>
        )}

        {/* LIVE badge */}
        {liveFrame && (
          <div className="absolute top-2 left-2 flex items-center gap-1 bg-black/70 rounded-full px-2 py-0.5">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-red-400" />
            </span>
            <span className="text-[9px] font-bold text-white uppercase tracking-wider">Live</span>
          </div>
        )}

        {/* Density label */}
        <div className={`absolute top-2 right-2 text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md ${cfg.bg} ${cfg.border} ${cfg.text} border`}>
          {analysis.densityLevel}
        </div>

        {/* Expand icon */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onZoom();
          }}
          className="absolute top-2 right-2 w-5 h-5 rounded bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/70"
          title="Zoom feed"
        >
          <Maximize2 className="w-3 h-3 text-white" />
        </button>

        {/* Overlay gradient */}
        <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-black/80 to-transparent" />

        {/* Camera name on overlay */}
        <p className="absolute bottom-2 left-3 right-3 text-xs font-semibold text-white truncate">{name}</p>
      </div>

      {/* Sparkline */}
      {sparkData.length > 1 ? (
        <div className="h-9 bg-black/40">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={sparkData} margin={{ top: 2, right: 0, left: 0, bottom: 0 }} barSize={8}>
              <Bar dataKey="v" fill={cfg.glow} opacity={0.6} radius={[1, 1, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="h-9 bg-black/40" />
      )}

      {/* Stats */}
      <div className="px-3 py-2.5 space-y-2">

        {/* Current count — big prominent */}
        <div className="flex items-end justify-between">
          <div>
            <p className="text-[9px] text-zinc-500 uppercase tracking-widest font-semibold">Live Now</p>
            <p className={`text-2xl font-black tabular-nums tracking-tight ${cfg.text}`}>{currentCount}</p>
          </div>
          {dailyTotal != null && (
            <div className="text-right">
              <p className="text-[9px] text-zinc-500 uppercase tracking-widest font-semibold">Today</p>
              <p className="text-sm font-bold tabular-nums text-zinc-300">{dailyTotal.toLocaleString()}</p>
            </div>
          )}
        </div>

        {/* Congestion bar */}
        <div>
          <div className="flex justify-between text-[9px] text-zinc-600 mb-1">
            <span>Congestion</span>
            <span className={cfg.text}>{congestion}%</span>
          </div>
          <div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className={`h-full ${cfg.bar} rounded-full transition-all duration-700`}
              style={{ width: `${congestion}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Alert Card ───────────────────────────────────────────────────────────────

function AlertCard({ alert, onClick }: { alert: CrowdAlert; onClick: () => void }) {
  const cfg = densityConfig(alert.severity === 'RED' ? 'CRITICAL' : alert.severity === 'ORANGE' ? 'HIGH' : alert.severity === 'YELLOW' ? 'MEDIUM' : 'LOW');
  const severityLabel = alert.severity === 'RED' ? 'Critical' : alert.severity === 'ORANGE' ? 'Warning' : alert.severity === 'YELLOW' ? 'Notice' : 'Info';
  const camName = alert.device?.name || alert.deviceId;
  const frame = alert.frameSnapshot ?? null;

  return (
    <div className={`rounded-xl border ${cfg.border} bg-zinc-900/80 overflow-hidden cursor-pointer hover:brightness-110 transition-all duration-150`} onClick={onClick}>
      {/* Top accent line */}
      <div className={`h-0.5 w-full ${cfg.bar}`} />

      <div className="flex gap-2.5 p-2.5">
        {/* Snapshot at alert time */}
        <div className="relative shrink-0 w-16 h-14 rounded-lg overflow-hidden bg-zinc-800">
          {frame ? (
            <img src={frame} alt={camName} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Users className="w-5 h-5 text-zinc-700" />
            </div>
          )}
          {/* severity dot */}
          <span className={`absolute top-1 left-1 w-1.5 h-1.5 rounded-full ${cfg.bar}`} />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-1 mb-0.5">
              <span className={`text-[9px] font-black uppercase tracking-widest ${cfg.text}`}>
                {severityLabel}
              </span>
              <span className="text-[9px] text-zinc-600 tabular-nums">{timeSince(alert.timestamp)}</span>
            </div>
            <p className="text-[11px] font-semibold text-zinc-100 leading-snug truncate">{alert.title}</p>
            <p className="text-[10px] text-zinc-500 truncate">{camName}</p>
          </div>

          {alert.peopleCount != null && (
            <div className={`mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-bold ${cfg.bg} border ${cfg.border} ${cfg.text}`}>
              <Users className="w-2.5 h-2.5" />
              {alert.peopleCount} people
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
