import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Server, Plus, RefreshCw, CheckCircle, XCircle, AlertTriangle,
  Cpu, HardDrive, Thermometer, Camera, Key, Copy, Trash2, Link,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Empty, EmptyIcon, EmptyTitle, EmptyDescription, EmptyActions } from '@/components/ui/empty';
import { Button } from '@/components/ui/button';
import { HudBadge } from '@/components/ui/hud-badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiClient } from '@/lib/api';
import type { Device } from '@/lib/api';
import type {
  WorkerApprovalRequest,
  WorkerTokenWithStatus,
  WorkerStatus,
  WorkerLiveStat,
} from '@/lib/worker-types';

// ─── Toggle Switch ────────────────────────────────────────────────────────────

function Toggle({ checked, onChange, disabled }: {
  checked: boolean; onChange: (v: boolean) => void; disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none ${
        disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'
      } ${checked ? 'bg-indigo-500' : 'bg-zinc-700'}`}
    >
      <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${
        checked ? 'translate-x-[18px]' : 'translate-x-[3px]'
      }`} />
    </button>
  );
}

// ─── Only FRS analytic ────────────────────────────────────────────────────────

const ANALYTIC_OPTIONS = [
  { code: 'frs', label: 'FRS', active: 'bg-pink-600/20 border-pink-500/60 text-pink-300' },
];

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ online, status }: { online: boolean; status: WorkerStatus }) {
  if (status === 'revoked') return <HudBadge variant="danger">Revoked</HudBadge>;
  if (status === 'pending') return <HudBadge variant="warning">Pending</HudBadge>;
  if (online) return <HudBadge variant="success">Online</HudBadge>;
  return <HudBadge variant="danger">Offline</HudBadge>;
}

// ─── Time Ago ─────────────────────────────────────────────────────────────────

function fmt(secs: number): string {
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

function timeAgo(iso: string): string {
  return fmt(Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
}

// ─── Camera Config Row ────────────────────────────────────────────────────────

type CamCfg = { enabled: boolean; fps: number; resolution: string; analytics: string[]; rtspUrl: string };

function CameraConfigRow({ camera, cfg, onToggle, onSetField, onToggleAnalytic, onSetRtsp }: {
  camera: Device;
  cfg: CamCfg;
  onToggle: (v: boolean) => void;
  onSetField: (f: 'fps' | 'resolution', v: number | string) => void;
  onToggleAnalytic: (code: string, checked: boolean) => void;
  onSetRtsp: (url: string) => void;
}) {
  return (
    <div className={`rounded-lg border transition-colors ${
      cfg.enabled ? 'border-indigo-500/25 bg-indigo-950/15' : 'border-white/6 bg-zinc-900/30'
    }`}>
      <div className="flex items-center gap-3 p-3">
        <Toggle checked={cfg.enabled} onChange={onToggle} />
        <div className="min-w-0 flex-1">
          <p className={`text-sm font-medium truncate ${cfg.enabled ? 'text-zinc-100' : 'text-zinc-500'}`}>
            {camera.name || camera.id}
          </p>
          <p className="text-[10px] text-zinc-600 font-mono truncate">{camera.id}</p>
        </div>
      </div>

      {cfg.enabled && (
        <div className="px-3 pb-3 pt-2.5 border-t border-white/5 space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs flex items-center gap-1 text-zinc-500">
              <Link className="w-3 h-3" /> RTSP URL
            </Label>
            <Input
              value={cfg.rtspUrl}
              onChange={(e) => onSetRtsp(e.target.value)}
              placeholder="rtsp://user:pass@host/stream"
              className="font-mono text-xs h-8"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label className="text-xs text-zinc-500">FPS</Label>
              <Input type="number" min={1} max={60} value={cfg.fps}
                onChange={(e) => onSetField('fps', Number(e.target.value) || 15)} className="h-8" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-zinc-500">Resolution</Label>
              <select value={cfg.resolution}
                onChange={(e) => onSetField('resolution', e.target.value)}
                className="flex h-8 w-full rounded-md border border-white/10 bg-zinc-900 px-2 py-1 text-sm text-zinc-300 focus:outline-none focus:ring-1 focus:ring-indigo-500/50">
                <option value="480p">480p</option>
                <option value="720p">720p</option>
                <option value="1080p">1080p</option>
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-zinc-500">Analytics</Label>
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {ANALYTIC_OPTIONS.map((opt) => {
                const isActive = cfg.analytics.includes(opt.code);
                return (
                  <button
                    key={opt.code}
                    type="button"
                    onClick={() => onToggleAnalytic(opt.code, !isActive)}
                    className={`px-2.5 py-1 text-xs rounded-md border transition-all font-medium ${
                      isActive ? opt.active : 'bg-zinc-800/60 border-zinc-700 text-zinc-500'
                    } cursor-pointer hover:border-zinc-500`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Worker Live Card (compact row) ───────────────────────────────────────────

function WorkerLiveCard({ stat, onConfigure, onDelete }: {
  stat: WorkerLiveStat;
  onConfigure: () => void;
  onDelete: () => void;
}) {
  const online = stat.reachable && stat.status !== 'revoked' && stat.status !== 'pending';
  const r = stat.resources;
  const cpuPct = r?.cpu_percent ?? (r?.cpu_load_1m != null ? Math.min(100, (r.cpu_load_1m / 6) * 100) : null);
  const memPct = r?.memory_percent ?? null;
  const tempC  = r?.temperature_c ?? null;

  return (
    <div className={`flex items-center justify-between gap-4 px-4 py-3 rounded-xl border ${
      online ? 'border-green-500/15 bg-zinc-900/60' :
      stat.status === 'pending' ? 'border-yellow-500/20 bg-zinc-900/40' :
      'border-white/5 bg-zinc-900/40'
    }`}>
      {/* Left: icon + identity */}
      <div className="flex items-center gap-3 min-w-0">
        <div className={`w-8 h-8 rounded-lg shrink-0 flex items-center justify-center relative ${
          online ? 'bg-green-900/30' : 'bg-zinc-800/50'
        }`}>
          <Server className={`w-4 h-4 ${online ? 'text-green-400' : 'text-zinc-500'}`} />
          <span className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full border border-zinc-900 ${
            online ? 'bg-green-400' : 'bg-zinc-600'
          }`} />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm">{stat.name}</span>
            <StatusBadge online={online} status={stat.status} />
          </div>
          <p className="text-[11px] text-zinc-500">{stat.model || 'Jetson Orin Nano'} · {stat.ip || 'No IP'}</p>
          {online && stat.latencyMs != null ? (
            <p className="text-[10px] text-zinc-600">Ping {stat.latencyMs}ms</p>
          ) : !online ? (
            <p className="text-[10px] text-zinc-600">Last seen {fmt(stat.lastSeenAgo)}</p>
          ) : null}
        </div>
      </div>

      {/* Right: stats + actions */}
      <div className="flex items-center gap-3 shrink-0">
        {/* CPU */}
        <div className="flex items-center gap-1 text-[11px] text-zinc-400">
          <Cpu className="w-3 h-3" />
          <span>{cpuPct != null ? `${cpuPct.toFixed(0)}%` : '—'}</span>
        </div>
        {/* RAM */}
        <div className="flex items-center gap-1 text-[11px] text-zinc-400">
          <HardDrive className="w-3 h-3" />
          <span>{memPct != null ? `${memPct.toFixed(0)}%` : '—'}</span>
        </div>
        {/* Temp */}
        <div className={`flex items-center gap-1 text-[11px] ${
          tempC == null ? 'text-zinc-600' :
          tempC > 80 ? 'text-red-400' : tempC > 65 ? 'text-amber-400' : tempC > 50 ? 'text-yellow-400' : 'text-sky-400'
        }`}>
          <Thermometer className="w-3 h-3" />
          <span>{tempC != null ? `${tempC.toFixed(1)}°C` : '—'}</span>
        </div>
        {/* Camera count */}
        <div className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-purple-900/20 border border-purple-500/15 text-[11px] text-purple-400">
          <Camera className="w-3 h-3" />
          <span>{stat.cameraCount} cams</span>
        </div>
        {/* Configure + Delete */}
        <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs" onClick={onConfigure}>
          Configure
        </Button>
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-500 hover:text-red-400 hover:bg-red-900/20" onClick={onDelete}>
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export function WorkersDashboard() {
  const { id: routeWorkerID } = useParams<{ id?: string }>();
  const navigate = useNavigate();

  // Live stats (combined ping + resources)
  const [liveStats, setLiveStats] = useState<WorkerLiveStat[]>([]);
  const [liveLoading, setLiveLoading] = useState(true);
  const [lastChecked, setLastChecked] = useState<string | null>(null);

  // Full worker list (for config modal)
  const [approvalRequests, setApprovalRequests] = useState<WorkerApprovalRequest[]>([]);
  const [tokens, setTokens] = useState<WorkerTokenWithStatus[]>([]);
  const [activeTab, setActiveTab] = useState('workers');
  const [creating, setCreating] = useState(false);

  // Config modal
  const [configOpen, setConfigOpen] = useState(false);
  const [configLoading, setConfigLoading] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);
  const [configWorkerID, setConfigWorkerID] = useState('');
  const [availableCameras, setAvailableCameras] = useState<Device[]>([]);
  const [workerForm, setWorkerForm] = useState({
    name: '', ip: '', mac: '', model: '', status: 'approved' as WorkerStatus, tagsText: '',
  });
  const [cameraConfigMap, setCameraConfigMap] = useState<Record<string, CamCfg>>({});

  // Add Worker dialog
  const [addOpen, setAddOpen] = useState(false);
  const [addSaving, setAddSaving] = useState(false);
  const [addForm, setAddForm] = useState({ name: '', ip: '', mac: '', model: 'Jetson Orin NX 8GB' });

  // ── Polling ──────────────────────────────────────────────────────────────────

  const fetchLiveStats = useCallback(async (silent = false) => {
    if (!silent) setLiveLoading(true);
    try {
      const data = await apiClient.getWorkerLiveStats();
      setLiveStats(data.workers || []);
      setLastChecked(data.checkedAt);
    } catch (e) {
      console.error('Live stats fetch failed:', e);
    } finally {
      setLiveLoading(false);
    }
  }, []);

  const fetchSupplementary = useCallback(async () => {
    try {
      const [, requestsData, tokensData] = await Promise.all([
        apiClient.getWorkers(),
        apiClient.getApprovalRequests('pending'),
        apiClient.getWorkerTokens(),
      ]);
      setApprovalRequests(requestsData);
      setTokens(tokensData);
    } catch (e) {
      console.error('Supplementary fetch failed:', e);
    }
  }, []);

  // Fast poll: live stats every 10s
  const liveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetchLiveStats();
    fetchSupplementary();

    liveTimerRef.current = setInterval(() => fetchLiveStats(true), 10_000);
    const slowTimer = setInterval(fetchSupplementary, 30_000);

    return () => {
      if (liveTimerRef.current) clearInterval(liveTimerRef.current);
      clearInterval(slowTimer);
    };
  }, [fetchLiveStats, fetchSupplementary]);

  useEffect(() => {
    if (routeWorkerID) void openConfigModal(routeWorkerID);
  }, [routeWorkerID]);

  // ── Config modal ─────────────────────────────────────────────────────────────

  const openConfigModal = async (workerID: string) => {
    setConfigOpen(true);
    setConfigLoading(true);
    setConfigWorkerID(workerID);
    try {
      const [worker, workerCameras, devicesRaw] = await Promise.all([
        apiClient.getWorker(workerID),
        apiClient.getWorkerCameras(workerID),
        apiClient.getDevices({ type: 'CAMERA' }),
      ]);
      const devices = devicesRaw as Device[];
      setWorkerForm({
        name: worker.name || '',
        ip: worker.ip || '',
        mac: worker.mac || '',
        model: worker.model || '',
        status: (worker.status || 'approved') as WorkerStatus,
        tagsText: Array.isArray(worker.tags) ? worker.tags.join(', ') : '',
      });

      // Only show cameras assigned to this worker
      const assignedIds = new Set(workerCameras.map((a) => a.deviceId));
      const workerDevices = devices.filter((d) => assignedIds.has(d.id));
      setAvailableCameras(workerDevices);

      const map: Record<string, CamCfg> = {};
      for (const d of workerDevices) {
        map[d.id] = { enabled: false, fps: 15, resolution: '720p', analytics: ['frs'], rtspUrl: d.rtspUrl || '' };
      }
      for (const a of workerCameras) {
        const dev = devices.find((d) => d.id === a.deviceId);
        if (!dev) continue;
        map[a.deviceId] = {
          enabled: true,
          fps: a.fps || 15,
          resolution: a.resolution || '720p',
          analytics: Array.isArray(a.analytics) && a.analytics.length > 0 ? a.analytics : ['frs'],
          rtspUrl: dev.rtspUrl || '',
        };
      }
      setCameraConfigMap(map);
    } catch (e) {
      console.error('Config load failed:', e);
    } finally {
      setConfigLoading(false);
    }
  };

  const toggleCamera = (id: string, v: boolean) => setCameraConfigMap((p) => ({
    ...p, [id]: { ...(p[id] || { enabled: false, fps: 15, resolution: '720p', analytics: ['frs'], rtspUrl: '' }), enabled: v },
  }));

  const setCameraField = (id: string, f: 'fps' | 'resolution', v: number | string) => setCameraConfigMap((p) => ({
    ...p, [id]: { ...(p[id] || { enabled: false, fps: 15, resolution: '720p', analytics: ['frs'], rtspUrl: '' }), [f]: v },
  }));

  const toggleAnalytic = (id: string, code: string, checked: boolean) => setCameraConfigMap((p) => {
    const cur = p[id] || { enabled: false, fps: 15, resolution: '720p', analytics: ['frs'], rtspUrl: '' };
    return {
      ...p, [id]: {
        ...cur,
        analytics: checked
          ? Array.from(new Set([...cur.analytics, code]))
          : cur.analytics.filter((a) => a !== code),
      },
    };
  });

  const setCameraRtsp = (id: string, url: string) => setCameraConfigMap((p) => ({
    ...p, [id]: { ...(p[id] || { enabled: false, fps: 15, resolution: '720p', analytics: ['frs'], rtspUrl: '' }), rtspUrl: url },
  }));

  const saveWorkerConfig = async () => {
    if (!configWorkerID) return;
    const selected = Object.entries(cameraConfigMap).filter(([, c]) => c.enabled).map(([id, c]) => ({ id, c }));
    const invalid = selected.find((r) => r.c.analytics.length === 0);
    if (invalid) { alert(`Select at least one analytic for camera ${invalid.id}.`); return; }

    setConfigSaving(true);
    try {
      await apiClient.updateWorker(configWorkerID, {
        name: workerForm.name.trim(), ip: workerForm.ip.trim(), mac: workerForm.mac.trim(),
        model: workerForm.model.trim(), status: workerForm.status,
        tags: workerForm.tagsText.split(',').map((t) => t.trim()).filter(Boolean),
      });

      // Update RTSP URLs for cameras whose URL changed
      await Promise.all(Object.entries(cameraConfigMap).map(async ([devID, cfg]) => {
        const original = availableCameras.find((d) => d.id === devID);
        if (original && cfg.rtspUrl.trim() !== (original.rtspUrl || '').trim()) {
          await apiClient.updateDevice(devID, { rtspUrl: cfg.rtspUrl.trim() || undefined });
        }
      }));

      await apiClient.assignCamerasToWorker(configWorkerID, selected.map(({ id, c }) => ({
        device_id: id, analytics: c.analytics, fps: Number(c.fps) || 15, resolution: c.resolution || '720p',
      })));

      await Promise.all([fetchLiveStats(true), fetchSupplementary()]);
      setConfigOpen(false);
      if (routeWorkerID) navigate('/settings/workers', { replace: true });
    } catch (e) {
      console.error('Save failed:', e);
      alert('Failed to save configuration.');
    } finally {
      setConfigSaving(false);
    }
  };

  // ── Add Worker ───────────────────────────────────────────────────────────────

  const handleAddWorker = async () => {
    if (!addForm.name.trim()) { alert('Worker name is required.'); return; }
    setAddSaving(true);
    try {
      await apiClient.createWorker({
        name: addForm.name.trim(),
        ip: addForm.ip.trim(),
        mac: addForm.mac.trim() || undefined,
        model: addForm.model.trim(),
      });
      setAddOpen(false);
      setAddForm({ name: '', ip: '', mac: '', model: 'Jetson Orin NX 8GB' });
      await Promise.all([fetchLiveStats(), fetchSupplementary()]);
    } catch (e) {
      console.error('Add worker failed:', e);
      alert('Failed to create worker.');
    } finally {
      setAddSaving(false);
    }
  };

  // ── Approval / tokens ────────────────────────────────────────────────────────

  const handleApprove = async (id: string) => {
    try { await apiClient.approveWorkerRequest(id); fetchSupplementary(); } catch (e) { console.error(e); }
  };
  const handleReject = async (id: string) => {
    try { await apiClient.rejectWorkerRequest(id, 'Rejected by admin'); fetchSupplementary(); } catch (e) { console.error(e); }
  };
  const handleCreateToken = async () => {
    setCreating(true);
    try { await apiClient.createWorkerToken({ name: `Token ${new Date().toLocaleDateString()}`, expires_in: 168 }); fetchSupplementary(); }
    catch (e) { console.error(e); }
    finally { setCreating(false); }
  };
  const handleCopyToken = (token: string) => navigator.clipboard.writeText(token);
  const handleRevokeToken = async (id: string) => {
    try { await apiClient.revokeWorkerToken(id); fetchSupplementary(); } catch (e) { console.error(e); }
  };
  const handleDeleteWorker = async (id: string) => {
    if (!confirm('Delete this worker?')) return;
    try { await apiClient.deleteWorker(id); await Promise.all([fetchLiveStats(), fetchSupplementary()]); }
    catch (e) { console.error(e); }
  };

  // ── Derived ──────────────────────────────────────────────────────────────────

  const online = liveStats.filter((s) => s.reachable).length;
  const offline = liveStats.length - online;
  const totalCams = liveStats.reduce((s, w) => s + w.cameraCount, 0);
  const enabledCount = Object.values(cameraConfigMap).filter((c) => c.enabled).length;

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="h-full overflow-hidden">
      <div className="h-full overflow-y-auto overflow-x-hidden p-4 md:p-6 space-y-5 iris-scroll-area">

        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Server className="w-6 h-6" /> Edge Workers
            </h1>
            <p className="text-sm text-zinc-400 mt-0.5">
              Jetson fleet · camera assignments · RTSP streams
              {lastChecked && (
                <span className="text-zinc-600 ml-2">· last polled {timeAgo(lastChecked)}</span>
              )}
            </p>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => setAddOpen(true)} variant="default" size="sm">
              <Plus className="w-4 h-4 mr-1.5" /> Add Jetson
            </Button>
            <Button onClick={() => { fetchLiveStats(); fetchSupplementary(); }} variant="outline" size="sm" disabled={liveLoading}>
              <RefreshCw className={`w-4 h-4 mr-1.5 ${liveLoading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Total Workers', value: liveStats.length, icon: Server, color: 'text-blue-400' },
            { label: 'Online', value: online, icon: CheckCircle, color: 'text-emerald-400' },
            { label: 'Offline', value: offline, icon: XCircle, color: 'text-zinc-500' },
            { label: 'Cameras', value: totalCams, icon: Camera, color: 'text-purple-400' },
          ].map(({ label, value, icon: Icon, color }) => (
            <Card key={label}>
              <CardContent className="pt-4 pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-zinc-500">{label}</p>
                    <p className={`text-2xl font-bold mt-0.5 ${color}`}>{value}</p>
                  </div>
                  <Icon className={`w-7 h-7 opacity-25 ${color}`} />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Pending Approvals */}
        {approvalRequests.length > 0 && (
          <Card className="border-yellow-500/20 bg-yellow-900/8">
            <CardHeader className="pb-2 pt-4">
              <CardTitle className="text-sm flex items-center gap-2 text-yellow-400">
                <AlertTriangle className="w-4 h-4" />
                {approvalRequests.length} Pending Approval{approvalRequests.length > 1 ? 's' : ''}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {approvalRequests.map((req) => (
                  <div key={req.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-zinc-900 p-3 rounded-lg border border-white/5">
                    <div>
                      <p className="font-medium text-sm">{req.deviceName}</p>
                      <p className="text-xs text-zinc-500">{req.model} · {req.ip} · {timeAgo(req.createdAt)}</p>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => handleApprove(req.id)} className="bg-emerald-700 hover:bg-emerald-600 text-white h-7 text-xs">
                        <CheckCircle className="w-3 h-3 mr-1" /> Approve
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => handleReject(req.id)} className="h-7 text-xs">
                        <XCircle className="w-3 h-3 mr-1" /> Reject
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="workers">Workers ({liveStats.length})</TabsTrigger>
            <TabsTrigger value="tokens">Registration Tokens</TabsTrigger>
          </TabsList>

          {/* Workers tab */}
          <TabsContent value="workers" className="mt-4 space-y-2">
            {liveStats.map((stat) => (
              <WorkerLiveCard
                key={stat.workerId}
                stat={stat}
                onConfigure={() => void openConfigModal(stat.workerId)}
                onDelete={() => handleDeleteWorker(stat.workerId)}
              />
            ))}
            {liveStats.length === 0 && !liveLoading && (
              <Card>
                <CardContent className="py-10">
                  <Empty>
                    <EmptyIcon><Server /></EmptyIcon>
                    <EmptyTitle>No workers registered</EmptyTitle>
                    <EmptyDescription>Add a Jetson above or generate a registration token.</EmptyDescription>
                    <EmptyActions>
                      <Button size="sm" onClick={() => setAddOpen(true)}>
                        <Plus className="w-4 h-4 mr-2" /> Add Jetson
                      </Button>
                    </EmptyActions>
                  </Empty>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Tokens tab */}
          <TabsContent value="tokens" className="mt-4">
            <Card>
              <CardHeader>
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                  <div>
                    <CardTitle>Registration Tokens</CardTitle>
                    <CardDescription>One-time tokens for Jetsons to self-register</CardDescription>
                  </div>
                  <Button onClick={handleCreateToken} disabled={creating} size="sm">
                    <Plus className="w-4 h-4 mr-2" />
                    {creating ? 'Creating…' : 'Generate Token'}
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {tokens.map((token) => (
                    <div key={token.id} className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-lg border ${
                      token.status === 'active' ? 'border-white/10 bg-zinc-900/40' :
                      token.status === 'used' ? 'border-emerald-500/20 bg-emerald-900/10' :
                      'border-white/5 bg-zinc-900/20'
                    }`}>
                      <div className="flex items-center gap-3">
                        <Key className={`w-4 h-4 shrink-0 ${
                          token.status === 'active' ? 'text-blue-400' :
                          token.status === 'used' ? 'text-emerald-400' : 'text-zinc-500'
                        }`} />
                        <div>
                          <p className="text-sm font-medium">{token.name}</p>
                          <p className="text-xs font-mono text-zinc-500 mt-0.5">{token.token.substring(0, 28)}…</p>
                          <p className="text-[11px] text-zinc-500 mt-0.5">
                            Created {timeAgo(token.createdAt)}
                            {token.expiresAt && ` · Expires ${new Date(token.expiresAt).toLocaleDateString()}`}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <HudBadge variant={
                          token.status === 'active' ? 'success' : token.status === 'used' ? 'info' :
                          token.status === 'expired' ? 'secondary' : 'default'
                        } size="sm">{token.status}</HudBadge>
                        {token.status === 'active' && (
                          <>
                            <Button size="sm" variant="ghost" onClick={() => handleCopyToken(token.token)} title="Copy token" className="h-7 w-7 p-0">
                              <Copy className="w-3.5 h-3.5" />
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => handleRevokeToken(token.id)} title="Revoke" className="h-7 w-7 p-0">
                              <XCircle className="w-3.5 h-3.5 text-red-500" />
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                  {tokens.length === 0 && (
                    <Empty>
                      <EmptyIcon><Key /></EmptyIcon>
                      <EmptyTitle>No tokens created</EmptyTitle>
                      <EmptyDescription>Generate a token to let Jetsons self-register.</EmptyDescription>
                      <EmptyActions>
                        <Button size="sm" onClick={handleCreateToken} disabled={creating}>
                          <Plus className="w-4 h-4 mr-2" /> Generate Token
                        </Button>
                      </EmptyActions>
                    </Empty>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* ── Add Worker Dialog ── */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Server className="w-5 h-5 text-indigo-400" /> Add Jetson Worker
            </DialogTitle>
            <DialogDescription>
              Create a worker record manually. The Jetson can later connect using a registration token.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Name <span className="text-red-400">*</span></Label>
              <Input value={addForm.name} onChange={(e) => setAddForm((p) => ({ ...p, name: e.target.value }))}
                placeholder="Jetson-01" />
            </div>
            <div className="space-y-1.5">
              <Label>IP Address</Label>
              <Input value={addForm.ip} onChange={(e) => setAddForm((p) => ({ ...p, ip: e.target.value }))}
                placeholder="172.16.0.101" />
            </div>
            <div className="space-y-1.5">
              <Label>MAC Address <span className="text-zinc-500 text-xs">(optional — auto-generated if empty)</span></Label>
              <Input value={addForm.mac} onChange={(e) => setAddForm((p) => ({ ...p, mac: e.target.value }))}
                placeholder="aa:bb:cc:dd:ee:ff" className="font-mono" />
            </div>
            <div className="space-y-1.5">
              <Label>Model</Label>
              <Input value={addForm.model} onChange={(e) => setAddForm((p) => ({ ...p, model: e.target.value }))}
                placeholder="Jetson Orin NX 8GB" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)} disabled={addSaving}>Cancel</Button>
            <Button onClick={handleAddWorker} disabled={addSaving || !addForm.name.trim()}>
              {addSaving ? 'Creating…' : 'Create Worker'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Configure Worker Dialog ── */}
      <Dialog open={configOpen} onOpenChange={(open) => {
        setConfigOpen(open);
        if (!open && routeWorkerID) navigate('/settings/workers', { replace: true });
      }}>
        <DialogContent className="max-w-2xl max-h-[92vh] flex flex-col overflow-hidden p-0">
          <DialogHeader className="px-6 pt-6 pb-4 border-b border-white/8 shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <Server className="w-5 h-5 text-indigo-400" /> Configure Edge Worker
            </DialogTitle>
            <DialogDescription>
              Edit worker details, RTSP streams, and FRS analytics. Config is fetched by the Jetson on next poll.
            </DialogDescription>
          </DialogHeader>

          {configLoading ? (
            <div className="flex items-center justify-center py-16 text-zinc-400 text-sm">Loading…</div>
          ) : (
            <div className="overflow-y-auto flex-1 iris-scroll-area">
              {/* Worker metadata */}
              <div className="px-6 py-4 space-y-4 border-b border-white/5">
                <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Worker Details</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {[
                    { label: 'Name', key: 'name', placeholder: 'Jetson-01' },
                    { label: 'IP Address', key: 'ip', placeholder: '172.16.0.x' },
                    { label: 'MAC Address', key: 'mac', placeholder: 'aa:bb:cc:dd:ee:ff' },
                    { label: 'Model', key: 'model', placeholder: 'Jetson Orin NX 8GB' },
                    { label: 'Tags', key: 'tagsText', placeholder: 'floor-lg, zone-a' },
                  ].map(({ label, key, placeholder }) => (
                    <div key={key} className="space-y-1.5">
                      <Label className="text-xs">{label}</Label>
                      <Input value={(workerForm as any)[key]} placeholder={placeholder}
                        onChange={(e) => setWorkerForm((p) => ({ ...p, [key]: e.target.value }))} />
                    </div>
                  ))}
                  <div className="space-y-1.5">
                    <Label className="text-xs">Status</Label>
                    <select value={workerForm.status}
                      onChange={(e) => setWorkerForm((p) => ({ ...p, status: e.target.value as WorkerStatus }))}
                      className="flex h-10 w-full rounded-md border border-white/10 bg-zinc-900 px-3 py-2 text-sm text-zinc-300 focus:outline-none focus:ring-1 focus:ring-indigo-500/50">
                      <option value="pending">Pending</option>
                      <option value="approved">Approved</option>
                      <option value="active">Active</option>
                      <option value="offline">Offline</option>
                      <option value="revoked">Revoked</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Camera Assignments */}
              <div className="px-6 py-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Camera Assignments</p>
                  <span className="text-xs text-zinc-500">{enabledCount} of {availableCameras.length} active</span>
                </div>
                <div className="space-y-2">
                  {availableCameras.length === 0 && (
                    <p className="text-sm text-zinc-500 text-center py-6">No cameras assigned to this worker.</p>
                  )}
                  {availableCameras.map((camera) => {
                    const cfg = cameraConfigMap[camera.id] || {
                      enabled: false, fps: 15, resolution: '720p', analytics: ['frs'], rtspUrl: camera.rtspUrl || '',
                    };
                    return (
                      <CameraConfigRow
                        key={camera.id}
                        camera={camera}
                        cfg={cfg}
                        onToggle={(v) => toggleCamera(camera.id, v)}
                        onSetField={(f, v) => setCameraField(camera.id, f, v)}
                        onToggleAnalytic={(code, checked) => toggleAnalytic(camera.id, code, checked)}
                        onSetRtsp={(url) => setCameraRtsp(camera.id, url)}
                      />
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          <DialogFooter className="px-6 py-4 border-t border-white/8 shrink-0">
            <Button variant="outline" onClick={() => setConfigOpen(false)} disabled={configSaving}>Cancel</Button>
            <Button onClick={saveWorkerConfig} disabled={configLoading || configSaving}>
              {configSaving ? 'Saving…' : 'Save Configuration'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
