import { useState, useEffect, useCallback } from 'react';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, Legend,
} from 'recharts';
import {
  Car, Shield, Eye, Users, Activity,
  TrendingUp, Clock, MapPin, BarChart3, RefreshCw, PieChart as PieChartIcon,
  Bell, ScanFace, UserCheck, UserX,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { HudBadge } from '@/components/ui/hud-badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Empty, EmptyIcon, EmptyTitle, EmptyDescription } from '@/components/ui/empty';
import { apiClient } from '@/lib/api';
import type { VehicleStats, VCCStats, AlertStats, Hotspot, Person, FRSMatch } from '@/lib/api';

// ── Types ──────────────────────────────────────────────────────────────

type TimeRange = 'today' | '7d' | '30d';

interface AllStats {
  vehicles: VehicleStats | null;
  vcc: VCCStats | null;
  alerts: AlertStats | null;
  hotspots: Hotspot[] | null;
  frsPersons: Person[] | null;
  frsDetections: FRSMatch[] | null;
}

// ── Constants ──────────────────────────────────────────────────────────

const CHART_COLORS = [
  '#6366f1', '#818cf8', '#a5b4fc', '#c7d2fe',
  '#4f46e5', '#4338ca', '#3730a3', '#312e81',
  '#8b5cf6', '#7c3aed', '#10b981', '#f59e0b',
];

const SEVERITY_COLORS: Record<string, string> = {
  GREEN: '#10b981',
  YELLOW: '#f59e0b',
  ORANGE: '#f97316',
  RED: '#ef4444',
};

const DENSITY_COLORS: Record<string, string> = {
  LOW: '#10b981',
  MEDIUM: '#f59e0b',
  HIGH: '#f97316',
  CRITICAL: '#ef4444',
};

// ── Helpers ────────────────────────────────────────────────────────────

function getTimeRangeParams(range: TimeRange): { startTime?: string; endTime?: string } {
  const now = new Date();
  const end = now.toISOString();
  let start: Date;
  switch (range) {
    case 'today':
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      break;
    case '7d':
      start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case '30d':
      start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      break;
  }
  return { startTime: start.toISOString(), endTime: end };
}

function formatNumber(n: number | null | undefined): string {
  if (n == null) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

// ── Custom Tooltip ─────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-zinc-900 border border-white/10 rounded-lg px-3 py-2 shadow-xl">
      <p className="text-zinc-400 text-[11px] font-mono mb-1">{label}</p>
      {payload.map((entry: any, i: number) => (
        <p key={i} className="text-zinc-100 text-xs font-mono">
          <span className="inline-block w-2 h-2 rounded-full mr-2" style={{ background: entry.color }} />
          {entry.name}: {formatNumber(entry.value)}
        </p>
      ))}
    </div>
  );
}

// ── Stat Card ──────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon: Icon,
  badge,
  badgeVariant,
  loading,
}: {
  label: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
  badgeVariant?: 'success' | 'warning' | 'danger' | 'info' | 'default';
  loading?: boolean;
}) {
  if (loading) {
    return (
      <Card>
        <CardContent className="p-4">
          <Skeleton className="h-4 w-24 mb-3" />
          <Skeleton className="h-7 w-20 mb-2" />
          <Skeleton className="h-4 w-16" />
        </CardContent>
      </Card>
    );
  }
  return (
    <Card className="group hover:border-indigo-500/20 transition-colors border border-white/5 bg-zinc-900/30 backdrop-blur-sm">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[11px] font-mono tracking-widest text-zinc-500">{label}</span>
          <Icon className="h-3.5 w-3.5 text-zinc-600" />
        </div>
        <div className="text-2xl font-mono font-bold text-zinc-100 mb-1">{typeof value === 'number' ? formatNumber(value) : value}</div>
        {badge && <HudBadge variant={badgeVariant || 'default'} size="sm">{badge}</HudBadge>}
      </CardContent>
    </Card>
  );
}

// ── Chart Wrapper ──────────────────────────────────────────────────────

function ChartCard({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <Card className={`border border-white/5 bg-zinc-900/30 backdrop-blur-sm ${className || ''}`}>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-mono tracking-wider text-zinc-400">{title}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {children}
      </CardContent>
    </Card>
  );
}

// ── Main Component ─────────────────────────────────────────────────────

export function AnalyticsPage() {
  const [timeRange, setTimeRange] = useState<TimeRange>('7d');
  const [activeTab, setActiveTab] = useState('traffic');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState<AllStats>({
    vehicles: null,
    vcc: null,
    alerts: null,
    hotspots: null,
    frsPersons: null,
    frsDetections: null,
  });

  const fetchData = useCallback(async () => {
    try {
      const timeParams = getTimeRangeParams(timeRange);
      const [vehicles, vcc, alerts, hotspots, frsPersons, frsDetections] = await Promise.allSettled([
        apiClient.getVehicleStats(),
        apiClient.getVCCStats(timeParams),
        apiClient.getAlertStats(),
        apiClient.getHotspots(),
        apiClient.getPersons(),
        apiClient.getFRSDetections({ limit: 1000 }),
      ]);
      setStats({
        vehicles: vehicles.status === 'fulfilled' ? vehicles.value : null,
        vcc: vcc.status === 'fulfilled' ? vcc.value : null,
        alerts: alerts.status === 'fulfilled' ? alerts.value : null,
        hotspots: hotspots.status === 'fulfilled' ? hotspots.value : null,
        frsPersons: frsPersons.status === 'fulfilled' ? frsPersons.value : null,
        frsDetections: frsDetections.status === 'fulfilled' ? frsDetections.value : null,
      });
    } catch (err) {
      console.error('Analytics fetch error:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [timeRange]);

  useEffect(() => {
    setLoading(true);
    fetchData();
  }, [fetchData]);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchData();
  };

  // ── Derived data ─────────────────────────────────────────────────────

  const vehiclesByType = stats.vehicles?.byType
    ? Object.entries(stats.vehicles.byType).map(([name, value]) => ({ name, value }))
    : [];

  const vccByTime = stats.vcc?.byTime
    ? stats.vcc.byTime.map((d) => ({ time: d.hour || d.day || d.week || d.month || '', count: d.count }))
    : [];

  const vccByVehicleType = stats.vcc?.byVehicleType
    ? Object.entries(stats.vcc.byVehicleType).map(([name, value]) => ({ name, value }))
    : [];

  const hotspotsBySeverity = stats.hotspots
    ? (['GREEN', 'YELLOW', 'ORANGE', 'RED'] as const).map((sev) => ({
        name: sev,
        value: stats.hotspots!.filter((h) => h.hotspotSeverity === sev).length,
      })).filter((d) => d.value > 0)
    : [];

  const hotspotsByDensity = stats.hotspots
    ? (['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const).map((level) => ({
        name: level,
        value: stats.hotspots!.filter((h) => h.densityLevel === level).length,
      })).filter((d) => d.value > 0)
    : [];

  const alertsByType = stats.alerts?.byType
    ? Object.entries(stats.alerts.byType).map(([name, value]) => ({ name: name.replace(/_/g, ' '), value }))
    : [];

  const timeWindowStart = (() => {
    const p = getTimeRangeParams(timeRange);
    return p.startTime ? new Date(p.startTime).getTime() : 0;
  })();

  const frsWindowDetections = (stats.frsDetections || []).filter((d) => {
    const ts = new Date(d.timestamp).getTime();
    return Number.isFinite(ts) && ts >= timeWindowStart;
  });

  const frsKnownDetections = frsWindowDetections.filter((d) => Boolean(d.personId)).length;
  const frsUnknownDetections = frsWindowDetections.length - frsKnownDetections;
  const frsAverageConfidence = frsWindowDetections.length > 0
    ? frsWindowDetections.reduce((sum, d) => sum + (Number(d.confidence) || 0), 0) / frsWindowDetections.length
    : 0;

  const frsByDevice = Object.entries(
    frsWindowDetections.reduce((acc: Record<string, number>, d) => {
      const key = d.device?.name || d.deviceId || 'Unknown';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {})
  ).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 12);

  const frsByThreat = Object.entries(
    (stats.frsPersons || []).reduce((acc: Record<string, number>, p) => {
      const level = (p.threatLevel || 'UNKNOWN').toUpperCase();
      acc[level] = (acc[level] || 0) + 1;
      return acc;
    }, {})
  ).map(([name, value]) => ({ name, value }));

  // ── Render ───────────────────────────────────────────────────────────

  return (
    <div className="h-full overflow-hidden relative iris-dashboard-root">
      <div className="h-full p-4 md:p-6 lg:p-8 flex flex-col gap-6 overflow-hidden">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <BarChart3 className="h-5 w-5 text-indigo-400" />
          <h1 className="text-lg font-mono font-bold text-zinc-100">
            Analytics
          </h1>
          <HudBadge variant="default" size="sm">Live</HudBadge>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={handleRefresh}
            disabled={refreshing}
            variant="outline"
            size="sm"
            className="h-8 w-8 p-0"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          </Button>
          <div className="flex bg-white/5 rounded-lg border border-white/5 p-1">
            {(['today', '7d', '30d'] as TimeRange[]).map((range) => (
              <button
                key={range}
                onClick={() => setTimeRange(range)}
                className={`px-2.5 py-1 text-[11px] font-mono tracking-wider rounded-md transition-colors btn-glass ${
                  timeRange === range
                    ? 'btn-glass-indigo text-white shadow-sm'
                    : 'btn-glass-outline text-zinc-300 hover:text-zinc-100'
                }`}
              >
                {range === 'today' ? 'Today' : range}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Top Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard
          label="Total Vehicles"
          value={stats.vehicles?.total ?? 0}
          icon={Car}
          badge={stats.vehicles ? `${formatNumber(stats.vehicles.detectionsToday)} Today` : undefined}
          badgeVariant="info"
          loading={loading}
        />
        <StatCard
          label="Active Alerts"
          value={stats.alerts?.unread ?? 0}
          icon={Shield}
          badge={stats.alerts ? `${stats.alerts.today} Today` : undefined}
          badgeVariant="danger"
          loading={loading}
        />
        <StatCard
          label="Watchlisted"
          value={stats.vehicles?.watchlisted ?? 0}
          icon={Eye}
          badge="Monitoring"
          badgeVariant="warning"
          loading={loading}
        />
        <StatCard
          label="Crowd Hotspots"
          value={stats.hotspots?.length ?? 0}
          icon={Users}
          badge={
            stats.hotspots
              ? `${stats.hotspots.filter((h) => h.hotspotSeverity === 'RED').length} Critical`
              : undefined
          }
          badgeVariant="danger"
          loading={loading}
        />
        <StatCard
          label="FRS Detections"
          value={frsWindowDetections.length}
          icon={ScanFace}
          badge={`${frsKnownDetections} Known / ${frsUnknownDetections} Unknown`}
          badgeVariant="info"
          loading={loading}
        />
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 min-h-0 overflow-hidden">
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger className="text-xs" value="traffic">Traffic</TabsTrigger>
          <TabsTrigger className="text-xs" value="crowd">Crowd</TabsTrigger>
          <TabsTrigger className="text-xs" value="frs">FRS</TabsTrigger>
          <TabsTrigger className="text-xs" value="alerts">Alerts</TabsTrigger>
        </TabsList>

        {/* ── Traffic Tab ─────────────────────────────────────────────── */}
        <TabsContent value="traffic" className="h-full overflow-y-auto pr-1">
          {loading ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
              <Skeleton className="h-80" />
              <Skeleton className="h-80" />
              <Skeleton className="h-64 lg:col-span-2" />
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
              {/* Vehicle Type Pie */}
              <ChartCard title="Vehicle Type Distribution">
                {vehiclesByType.length > 0 ? (
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={vehiclesByType}
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={100}
                          dataKey="value"
                          nameKey="name"
                          paddingAngle={2}
                          stroke="none"
                        >
                          {vehiclesByType.map((_, i) => (
                            <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip content={<ChartTooltip />} />
                        <Legend
                          formatter={(value: string) => <span className="text-zinc-400 text-xs font-mono">{value}</span>}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <Empty className="min-h-0 h-72">
                    <EmptyIcon><PieChartIcon /></EmptyIcon>
                    <EmptyTitle>No vehicle type data</EmptyTitle>
                    <EmptyDescription>Vehicle type distribution will appear when detections are recorded.</EmptyDescription>
                  </Empty>
                )}
              </ChartCard>

              {/* VCC Stats Summary */}
              <ChartCard title="VCC Classification Stats">
                <div className="space-y-4 mt-2">
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { label: 'Total Detections', value: stats.vcc?.totalDetections ?? 0, icon: Activity },
                      { label: 'Unique Vehicles', value: stats.vcc?.uniqueVehicles ?? 0, icon: Car },
                      { label: 'Peak Hour', value: stats.vcc?.peakHour != null ? `${String(stats.vcc.peakHour).padStart(2, '0')}:00` : '--', icon: Clock },
                      { label: 'Avg / Hour', value: stats.vcc?.averagePerHour ?? 0, icon: TrendingUp },
                    ].map((item) => (
                      <div key={item.label} className="bg-white/[0.02] rounded-lg p-3 border border-white/5">
                        <div className="flex items-center gap-2 mb-1">
                          <item.icon className="h-3 w-3 text-zinc-600" />
                          <span className="text-[10px] font-mono tracking-widest text-zinc-500">{item.label}</span>
                        </div>
                        <div className="text-lg font-mono font-bold text-zinc-100">
                          {typeof item.value === 'number' ? formatNumber(item.value) : item.value}
                        </div>
                      </div>
                    ))}
                  </div>
                  {stats.vcc?.classification && (
                    <div className="space-y-2">
                      <span className="text-[10px] font-mono tracking-widest text-zinc-500">Classification Breakdown</span>
                      {[
                        { label: 'With Plates', value: stats.vcc.classification.withPlates, total: stats.vcc.totalDetections, color: '#6366f1' },
                        { label: 'With Make/Model', value: stats.vcc.classification.withMakeModel, total: stats.vcc.totalDetections, color: '#818cf8' },
                        { label: 'Full Classification', value: stats.vcc.classification.fullClassification, total: stats.vcc.totalDetections, color: '#10b981' },
                      ].map((bar) => {
                        const pct = bar.total > 0 ? (bar.value / bar.total) * 100 : 0;
                        return (
                          <div key={bar.label}>
                            <div className="flex justify-between text-xs mb-1">
                              <span className="font-mono text-zinc-400">{bar.label}</span>
                              <span className="font-mono text-zinc-300">{formatNumber(bar.value)} ({pct.toFixed(1)}%)</span>
                            </div>
                            <div className="w-full bg-white/5 rounded-full h-1.5">
                              <div className="h-1.5 rounded-full transition-all" style={{ width: `${pct}%`, background: bar.color }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </ChartCard>

              {/* VCC by Vehicle Type Bar Chart */}
              <ChartCard title="VCC by Vehicle Type">
                {vccByVehicleType.length > 0 ? (
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={vccByVehicleType} margin={{ left: 0, right: 20, top: 10, bottom: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                        <XAxis dataKey="name" tick={{ fill: '#a1a1aa', fontSize: 11, fontFamily: 'monospace' }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fill: '#71717a', fontSize: 11, fontFamily: 'monospace' }} axisLine={false} tickLine={false} />
                        <Tooltip content={<ChartTooltip />} />
                        <Bar dataKey="value" name="Count" radius={[4, 4, 0, 0]}>
                          {vccByVehicleType.map((_, i) => (
                            <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <Empty className="min-h-0 h-72">
                    <EmptyIcon><Car /></EmptyIcon>
                    <EmptyTitle>No VCC data</EmptyTitle>
                    <EmptyDescription>Vehicle classification data will appear when detections are processed.</EmptyDescription>
                  </Empty>
                )}
              </ChartCard>

              {/* Detections Timeline */}
              <ChartCard title="Detections Timeline">
                {vccByTime.length > 0 ? (
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={vccByTime} margin={{ left: 0, right: 20, top: 10, bottom: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                        <XAxis dataKey="time" tick={{ fill: '#71717a', fontSize: 10, fontFamily: 'monospace' }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fill: '#71717a', fontSize: 11, fontFamily: 'monospace' }} axisLine={false} tickLine={false} />
                        <Tooltip content={<ChartTooltip />} />
                        <Line type="monotone" dataKey="count" name="Detections" stroke="#818cf8" strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <Empty className="min-h-0 h-72">
                    <EmptyIcon><TrendingUp /></EmptyIcon>
                    <EmptyTitle>No detection timeline</EmptyTitle>
                    <EmptyDescription>Detection timeline will populate as vehicle data is recorded.</EmptyDescription>
                  </Empty>
                )}
              </ChartCard>
            </div>
          )}
        </TabsContent>

        {/* ── FRS Tab ─────────────────────────────────────────────── */}
        <TabsContent value="frs" className="h-full overflow-y-auto pr-1">
          {loading ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
              <Skeleton className="h-64" />
              <Skeleton className="h-64" />
              <Skeleton className="h-72 lg:col-span-2" />
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
              <ChartCard title="FRS Overview">
                <div className="grid grid-cols-2 gap-3 mt-2">
                  <div className="bg-white/[0.02] rounded-lg p-4 border border-white/5">
                    <span className="text-[10px] font-mono tracking-widest text-zinc-500">Indexed Persons</span>
                    <div className="text-xl font-mono font-bold mt-1 text-zinc-100">{formatNumber(stats.frsPersons?.length ?? 0)}</div>
                  </div>
                  <div className="bg-cyan-500/10 rounded-lg p-4 border border-cyan-500/20">
                    <span className="text-[10px] font-mono tracking-widest text-zinc-500">Detections ({timeRange})</span>
                    <div className="text-xl font-mono font-bold mt-1 text-cyan-300">{formatNumber(frsWindowDetections.length)}</div>
                  </div>
                  <div className="bg-emerald-500/10 rounded-lg p-4 border border-emerald-500/20">
                    <span className="text-[10px] font-mono tracking-widest text-zinc-500">Known Matches</span>
                    <div className="text-xl font-mono font-bold mt-1 text-emerald-300">{formatNumber(frsKnownDetections)}</div>
                  </div>
                  <div className="bg-amber-500/10 rounded-lg p-4 border border-amber-500/20">
                    <span className="text-[10px] font-mono tracking-widest text-zinc-500">Unknown Faces</span>
                    <div className="text-xl font-mono font-bold mt-1 text-amber-300">{formatNumber(frsUnknownDetections)}</div>
                  </div>
                </div>
                <div className="mt-4 text-xs font-mono text-zinc-400 flex items-center gap-2">
                  <TrendingUp className="h-3.5 w-3.5 text-zinc-600" />
                  Average Confidence: <span className="text-zinc-200">{(frsAverageConfidence * 100).toFixed(1)}%</span>
                </div>
              </ChartCard>

              <ChartCard title="Watchlist by Threat Level">
                {frsByThreat.length > 0 ? (
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={frsByThreat}
                          cx="50%"
                          cy="50%"
                          innerRadius={52}
                          outerRadius={88}
                          dataKey="value"
                          nameKey="name"
                          paddingAngle={2}
                          stroke="none"
                        >
                          {frsByThreat.map((_, i) => (
                            <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip content={<ChartTooltip />} />
                        <Legend formatter={(value: string) => <span className="text-zinc-400 text-xs font-mono">{value}</span>} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <Empty className="min-h-0 h-64">
                    <EmptyIcon><UserCheck /></EmptyIcon>
                    <EmptyTitle>No watchlist profile data</EmptyTitle>
                    <EmptyDescription>Threat-level distribution appears when watchlist persons are enrolled.</EmptyDescription>
                  </Empty>
                )}
              </ChartCard>

              <ChartCard title="Top FRS Devices" className="lg:col-span-2">
                {frsByDevice.length > 0 ? (
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={frsByDevice} margin={{ left: 0, right: 20, top: 10, bottom: 40 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                        <XAxis dataKey="name" tick={{ fill: '#a1a1aa', fontSize: 10, fontFamily: 'monospace' }} axisLine={false} tickLine={false} angle={-20} textAnchor="end" height={55} />
                        <YAxis tick={{ fill: '#71717a', fontSize: 11, fontFamily: 'monospace' }} axisLine={false} tickLine={false} allowDecimals={false} />
                        <Tooltip content={<ChartTooltip />} />
                        <Bar dataKey="value" name="Detections" radius={[4, 4, 0, 0]}>
                          {frsByDevice.map((_, i) => (
                            <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <Empty className="min-h-0 h-72">
                    <EmptyIcon><UserX /></EmptyIcon>
                    <EmptyTitle>No FRS detections in range</EmptyTitle>
                    <EmptyDescription>Detections will appear here when FRS ingest is active for selected cameras.</EmptyDescription>
                  </Empty>
                )}
              </ChartCard>
            </div>
          )}
        </TabsContent>

        {/* ── Crowd Tab ──────────────────────────────────────────────── */}
        <TabsContent value="crowd" className="h-full overflow-y-auto pr-1">
          {loading ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
              <Skeleton className="h-80" />
              <Skeleton className="h-80" />
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
              {/* Hotspot Severity Breakdown */}
              <ChartCard title="Hotspot Severity Distribution">
                {hotspotsBySeverity.length > 0 ? (
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={hotspotsBySeverity}
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={100}
                          dataKey="value"
                          nameKey="name"
                          paddingAngle={2}
                          stroke="none"
                        >
                          {hotspotsBySeverity.map((entry) => (
                            <Cell key={entry.name} fill={SEVERITY_COLORS[entry.name]} />
                          ))}
                        </Pie>
                        <Tooltip content={<ChartTooltip />} />
                        <Legend
                          formatter={(value: string) => <span className="text-zinc-400 text-xs font-mono">{value}</span>}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <Empty className="min-h-0 h-72">
                    <EmptyIcon><Users /></EmptyIcon>
                    <EmptyTitle>No hotspot data</EmptyTitle>
                    <EmptyDescription>Hotspot severity data will appear when crowd analysis is active.</EmptyDescription>
                  </Empty>
                )}
              </ChartCard>

              {/* Density Levels */}
              <ChartCard title="Crowd Density Levels">
                {hotspotsByDensity.length > 0 ? (
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={hotspotsByDensity} margin={{ left: 0, right: 20, top: 10, bottom: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                        <XAxis dataKey="name" tick={{ fill: '#a1a1aa', fontSize: 11, fontFamily: 'monospace' }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fill: '#71717a', fontSize: 11, fontFamily: 'monospace' }} axisLine={false} tickLine={false} allowDecimals={false} />
                        <Tooltip content={<ChartTooltip />} />
                        <Bar dataKey="value" name="Locations" radius={[4, 4, 0, 0]}>
                          {hotspotsByDensity.map((entry) => (
                            <Cell key={entry.name} fill={DENSITY_COLORS[entry.name]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <Empty className="min-h-0 h-72">
                    <EmptyIcon><Activity /></EmptyIcon>
                    <EmptyTitle>No density data</EmptyTitle>
                    <EmptyDescription>Crowd density levels will appear when monitoring locations are active.</EmptyDescription>
                  </Empty>
                )}
              </ChartCard>

              {/* Hotspot Details Table */}
              <ChartCard title="Active Hotspots" className="lg:col-span-2">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/5">
                        <th className="text-left py-3 px-4 text-[11px] font-mono tracking-wider text-zinc-500">Location</th>
                        <th className="text-right py-3 px-4 text-[11px] font-mono tracking-wider text-zinc-500">People Count</th>
                        <th className="text-center py-3 px-4 text-[11px] font-mono tracking-wider text-zinc-500">Severity</th>
                        <th className="text-center py-3 px-4 text-[11px] font-mono tracking-wider text-zinc-500">Density</th>
                        <th className="text-right py-3 px-4 text-[11px] font-mono tracking-wider text-zinc-500">Congestion</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(stats.hotspots || [])
                        .sort((a, b) => {
                          const sevOrder = { RED: 0, ORANGE: 1, YELLOW: 2, GREEN: 3 };
                          return (sevOrder[a.hotspotSeverity] ?? 4) - (sevOrder[b.hotspotSeverity] ?? 4);
                        })
                        .slice(0, 15)
                        .map((h) => (
                          <tr key={h.deviceId} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                            <td className="py-3 px-4 font-mono text-zinc-300 text-xs flex items-center gap-2">
                              <MapPin className="h-3 w-3 text-zinc-600 flex-shrink-0" />
                              {h.name}
                            </td>
                            <td className="py-3 px-4 text-right font-mono text-zinc-100">{h.peopleCount ?? '--'}</td>
                            <td className="py-3 px-4 text-center">
                              <HudBadge
                                variant={
                                  h.hotspotSeverity === 'RED' ? 'danger'
                                    : h.hotspotSeverity === 'ORANGE' ? 'warning'
                                    : h.hotspotSeverity === 'YELLOW' ? 'warning'
                                    : 'success'
                                }
                                size="sm"
                              >
                                {h.hotspotSeverity}
                              </HudBadge>
                            </td>
                            <td className="py-3 px-4 text-center">
                              <HudBadge
                                variant={
                                  h.densityLevel === 'CRITICAL' ? 'danger'
                                    : h.densityLevel === 'HIGH' ? 'warning'
                                    : h.densityLevel === 'MEDIUM' ? 'info'
                                    : 'success'
                                }
                                size="sm"
                              >
                                {h.densityLevel}
                              </HudBadge>
                            </td>
                            <td className="py-3 px-4 text-right font-mono text-zinc-400">
                              {h.congestionLevel != null ? `${h.congestionLevel}%` : '--'}
                            </td>
                          </tr>
                        ))}
                      {(!stats.hotspots || stats.hotspots.length === 0) && (
                        <tr>
                          <td colSpan={5}>
                            <Empty className="min-h-0 py-8">
                              <EmptyIcon><MapPin /></EmptyIcon>
                              <EmptyTitle>No active hotspots</EmptyTitle>
                              <EmptyDescription>Hotspot data will appear when crowd monitoring devices are active.</EmptyDescription>
                            </Empty>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </ChartCard>
            </div>
          )}
        </TabsContent>

        {/* ── Alerts Tab ─────────────────────────────────────────────── */}
        <TabsContent value="alerts" className="h-full overflow-y-auto pr-1">
          {loading ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
              <Skeleton className="h-64" />
              <Skeleton className="h-64" />
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
              {/* Alert Stats */}
              <ChartCard title="Alert Overview">
                <div className="grid grid-cols-2 gap-3 mt-2">
                  {[
                    { label: 'Total', value: stats.alerts?.total ?? 0, color: 'text-zinc-100', bg: 'bg-white/[0.02]' },
                    { label: 'Unread', value: stats.alerts?.unread ?? 0, color: 'text-red-400', bg: 'bg-red-500/10' },
                    { label: 'Read', value: stats.alerts?.read ?? 0, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
                    { label: 'Today', value: stats.alerts?.today ?? 0, color: 'text-indigo-400', bg: 'bg-indigo-500/10' },
                  ].map((s) => (
                    <div key={s.label} className={`${s.bg} rounded-lg p-4 border border-white/5`}>
                      <span className="text-[10px] font-mono tracking-widest text-zinc-500">{s.label}</span>
                      <div className={`text-xl font-mono font-bold mt-1 ${s.color}`}>{formatNumber(s.value)}</div>
                    </div>
                  ))}
                </div>
              </ChartCard>

              {/* Alert Type Breakdown */}
              <ChartCard title="Alerts by Type">
                {alertsByType.length > 0 ? (
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={alertsByType} margin={{ left: 0, right: 20, top: 10, bottom: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                        <XAxis dataKey="name" tick={{ fill: '#a1a1aa', fontSize: 11, fontFamily: 'monospace' }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fill: '#71717a', fontSize: 11, fontFamily: 'monospace' }} axisLine={false} tickLine={false} allowDecimals={false} />
                        <Tooltip content={<ChartTooltip />} />
                        <Bar dataKey="value" name="Alerts" radius={[4, 4, 0, 0]}>
                          {alertsByType.map((_, i) => (
                            <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <Empty className="min-h-0 h-64">
                    <EmptyIcon><Bell /></EmptyIcon>
                    <EmptyTitle>No alert type data</EmptyTitle>
                    <EmptyDescription>Alert type breakdown will appear when alerts are generated.</EmptyDescription>
                  </Empty>
                )}
              </ChartCard>

              {/* Read vs Unread donut */}
              <ChartCard title="Read vs Unread" className="lg:col-span-2">
                <div className="flex flex-col sm:flex-row items-center justify-center gap-8 py-4">
                  <div className="h-48 w-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={[
                            { name: 'Unread', value: stats.alerts?.unread ?? 0 },
                            { name: 'Read', value: stats.alerts?.read ?? 0 },
                          ]}
                          cx="50%"
                          cy="50%"
                          innerRadius={50}
                          outerRadius={75}
                          dataKey="value"
                          nameKey="name"
                          paddingAngle={2}
                          stroke="none"
                        >
                          <Cell fill="#ef4444" />
                          <Cell fill="#10b981" />
                        </Pie>
                        <Tooltip content={<ChartTooltip />} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <div className="w-3 h-3 rounded-full bg-red-500" />
                      <span className="text-zinc-400 font-mono text-xs">Unread</span>
                      <span className="text-zinc-100 font-mono font-bold text-base ml-2">{formatNumber(stats.alerts?.unread ?? 0)}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="w-3 h-3 rounded-full bg-emerald-500" />
                      <span className="text-zinc-400 font-mono text-xs">Read</span>
                      <span className="text-zinc-100 font-mono font-bold text-base ml-2">{formatNumber(stats.alerts?.read ?? 0)}</span>
                    </div>
                  </div>
                </div>
              </ChartCard>
            </div>
          )}
        </TabsContent>
      </Tabs>
      </div>
    </div>
  );
}
