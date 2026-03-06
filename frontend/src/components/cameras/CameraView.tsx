import { useState, useEffect, useMemo } from 'react';
import { apiClient, type Device } from '@/lib/api';
import {
  Camera, ChevronDown, ChevronRight, LayoutGrid,
  Maximize2, Server,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { HudBadge } from '@/components/ui/hud-badge';
import { useCameraGrid } from '@/contexts/CameraGridContext';
import { cn } from '@/lib/utils';
import { DirectWebRTCFrame } from './DirectWebRTCFrame';

// ─── Types ────────────────────────────────────────────────────────────────────

interface WorkerInfo {
  id: string;
  name: string;
  ip: string;
  online: boolean;
}

interface GridSlot {
  id: string | null;
  deviceId: string | null;
  device: Device | null;
  fullscreenRef?: React.RefObject<(() => void) | undefined>;
}

// ─── No-Jetson placeholder ────────────────────────────────────────────────────

function NoJetsonSlot({ camera }: { camera: Device }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-zinc-900/80">
      <div className="text-center px-4">
        <Server className="w-8 h-8 text-zinc-600 mx-auto mb-2" />
        <p className="text-xs text-zinc-500">No Jetson assigned</p>
        <p className="text-[10px] text-zinc-600 mt-0.5 font-mono truncate">{camera.id}</p>
      </div>
    </div>
  );
}

// ─── CameraView ────────────────────────────────────────────────────────────────

export function CameraView() {
  const { gridSize, setUsedSlots } = useCameraGrid();
  const [cameras, setCameras] = useState<Device[]>([]);
  const [workers, setWorkers] = useState<WorkerInfo[]>([]);
  const [expandedWorkers, setExpandedWorkers] = useState<Set<string>>(new Set());
  const [gridSlots, setGridSlots] = useState<GridSlot[]>([]);
  const [draggedDevice, setDraggedDevice] = useState<Device | null>(null);
  const [zoomedDevice, setZoomedDevice] = useState<Device | null>(null);
  const [loading, setLoading] = useState(true);
  const [touchStartPos, setTouchStartPos] = useState<{ x: number; y: number } | null>(null);
  const [touchDraggedDevice, setTouchDraggedDevice] = useState<Device | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const gridDimensions = useMemo(() => {
    const [cols, rows] = gridSize.split('x').map(Number);
    return { rows, cols, total: rows * cols };
  }, [gridSize]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [devices, liveStats] = await Promise.all([
        apiClient.getDevices({ type: 'CAMERA' }) as Promise<Device[]>,
        apiClient.getWorkerLiveStats().catch(() => ({ workers: [] })),
      ]);
      setCameras(devices);

      const ws: WorkerInfo[] = (liveStats.workers || []).map((w: any) => ({
        id: w.workerId,
        name: w.name,
        ip: w.ip || '',
        online: w.reachable,
      }));
      setWorkers(ws);

      // Auto-expand all workers
      setExpandedWorkers(new Set(ws.map((w) => w.id)));

      // Restore grid state
      try {
        const saved = localStorage.getItem('cameraGridState');
        if (saved) {
          const parsed = JSON.parse(saved);
          if (parsed.gridSize === gridSize && parsed.slots?.length === gridDimensions.total) {
            setGridSlots((prev) =>
              prev.map((slot, i) => {
                const s = parsed.slots[i];
                if (s?.deviceId) {
                  const device = devices.find((d) => d.id === s.deviceId);
                  return { ...slot, deviceId: s.deviceId, device: device || null };
                }
                return slot;
              })
            );
          }
        }
      } catch { }
    } catch (err) {
      console.error('Failed to fetch cameras:', err);
    } finally {
      setLoading(false);
    }
  };

  // Initialise grid slots from saved state or empty
  useEffect(() => {
    try {
      const saved = localStorage.getItem('cameraGridState');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.gridSize === gridSize && parsed.slots?.length === gridDimensions.total) {
          setGridSlots(parsed.slots.map((s: any, i: number) => ({
            id: s.id || `slot-${i}`,
            deviceId: s.deviceId,
            device: null,
            fullscreenRef: { current: undefined },
          })));
          return;
        }
      }
    } catch { }
    setGridSlots(Array.from({ length: gridDimensions.total }, (_, i) => ({
      id: `slot-${i}`, deviceId: null, device: null, fullscreenRef: { current: undefined },
    })));
  }, [gridSize, gridDimensions.total]);

  useEffect(() => { fetchData(); }, [gridSize]);
  useEffect(() => { setUsedSlots(gridSlots.filter((s) => s.device).length); }, [gridSlots, setUsedSlots]);

  // Cameras grouped by their assigned Jetson worker
  const camerasByWorker = useMemo(() => {
    const map = new Map<string, Device[]>();
    for (const cam of cameras) {
      const wid = cam.workerId || '__unassigned__';
      if (!map.has(wid)) map.set(wid, []);
      map.get(wid)!.push(cam);
    }
    return map;
  }, [cameras]);

  // Ordered list: known workers first (by online status), then unassigned
  const orderedWorkerIds = useMemo(() => {
    const known = workers.map((w) => w.id).filter((id) => camerasByWorker.has(id));
    const rest = [...camerasByWorker.keys()].filter((id) => !known.includes(id));
    return [...known, ...rest];
  }, [workers, camerasByWorker]);

  const workerIpMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const w of workers) {
      map.set(w.id, w.ip);
    }
    return map;
  }, [workers]);

  // ── Grid / Drag helpers ───────────────────────────────────────────────────

  const saveGrid = (slots: GridSlot[]) => {
    try {
      localStorage.setItem('cameraGridState', JSON.stringify({
        gridSize, slots: slots.map((s) => ({ id: s.id, deviceId: s.deviceId })),
      }));
    } catch { }
  };

  const toggleWorker = (id: string) =>
    setExpandedWorkers((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const handleDrop = (slotIndex: number, device?: Device) => {
    const dev = device || draggedDevice;
    if (!dev) return;
    setGridSlots((prev) => {
      const next = [...prev];
      const prevIdx = next.findIndex((s) => s.deviceId === dev.id);
      if (prevIdx !== -1) next[prevIdx] = { ...next[prevIdx], deviceId: null, device: null };
      next[slotIndex] = { ...next[slotIndex], deviceId: dev.id, device: dev };
      setUsedSlots(next.filter((s) => s.device).length);
      saveGrid(next);
      return next;
    });
    setDraggedDevice(null);
  };

  const removeFromGrid = (slotIndex: number) => {
    setGridSlots((prev) => {
      const next = [...prev];
      next[slotIndex] = { ...next[slotIndex], deviceId: null, device: null };
      setUsedSlots(next.filter((s) => s.device).length);
      saveGrid(next);
      return next;
    });
  };

  const handleCameraTap = (device: Device) => {
    const idx = gridSlots.findIndex((s) => !s.device);
    handleDrop(idx !== -1 ? idx : 0, device);
  };

  // Touch drag
  const handleTouchStart = (e: React.TouchEvent, device: Device) => {
    setTouchStartPos({ x: e.touches[0].clientX, y: e.touches[0].clientY });
    setTouchDraggedDevice(device);
    setIsDragging(false);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!touchStartPos || !touchDraggedDevice) return;
    const t = e.touches[0];
    if (Math.abs(t.clientX - touchStartPos.x) > 10 || Math.abs(t.clientY - touchStartPos.y) > 10) {
      if (!isDragging) setIsDragging(true);
      e.preventDefault(); e.stopPropagation();
    }
  };

  const handleTouchEnd = (_e?: React.TouchEvent, slotIndex?: number) => {
    if (touchDraggedDevice && isDragging && slotIndex !== undefined) handleDrop(slotIndex);
    setTouchStartPos(null); setTouchDraggedDevice(null); setIsDragging(false);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="h-full flex overflow-hidden relative iris-dashboard-root">

      {/* ── Sidebar ── */}
      <div className="w-64 bg-zinc-950/20 backdrop-blur-md border-r border-white/5 overflow-y-auto flex flex-col shrink-0">
        {/* Header */}
        <div className="p-4 border-b border-white/8 shrink-0">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-mono font-bold text-zinc-100 flex items-center gap-2 uppercase tracking-tight">
              <Camera className="w-4 h-4 text-indigo-400" /> Live Feed
            </h2>
            <HudBadge variant="info" size="sm">VMS</HudBadge>
          </div>
          <p className="text-[10px] font-mono text-zinc-500 mt-1 uppercase tracking-widest">{cameras.length} camera nodes</p>
        </div>

        {/* Camera list grouped by Jetson */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {loading ? (
            <div className="p-4 text-xs text-zinc-500">Loading…</div>
          ) : cameras.length === 0 ? (
            <div className="p-6 text-center">
              <Camera className="w-8 h-8 text-zinc-600 mx-auto mb-2" />
              <p className="text-xs text-zinc-500">No cameras found.</p>
              <p className="text-[10px] text-zinc-600 mt-1">Assign cameras to Jetsons in Edge Workers.</p>
            </div>
          ) : (
            orderedWorkerIds.map((wid) => {
              const cams = camerasByWorker.get(wid) || [];
              const worker = workers.find((w) => w.id === wid);
              const isExpanded = expandedWorkers.has(wid);
              const label = worker ? worker.name : wid === '__unassigned__' ? 'Unassigned' : wid;
              const sublabel = worker ? worker.ip : '';

              return (
                <div key={wid}>
                  <button
                    type="button"
                    onClick={() => toggleWorker(wid)}
                    className="w-full flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-white/5 text-left"
                  >
                    {isExpanded
                      ? <ChevronDown className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                      : <ChevronRight className="w-3.5 h-3.5 text-zinc-500 shrink-0" />}
                    <Server className={`w-3.5 h-3.5 shrink-0 ${worker?.online ? 'text-indigo-400' : 'text-zinc-600'}`} />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-zinc-200 truncate">{label}</p>
                      {sublabel && <p className="text-[10px] text-zinc-600">{sublabel}</p>}
                    </div>
                    <span className="text-[10px] text-zinc-600 shrink-0">{cams.length}</span>
                  </button>

                  {isExpanded && (
                    <div className="ml-5 mt-0.5 space-y-0.5">
                      {cams.map((camera) => {
                        const isInGrid = gridSlots.some((s) => s.deviceId === camera.id);
                        return (
                          <div
                            key={camera.id}
                            draggable={!('ontouchstart' in window)}
                            onDragStart={() => setDraggedDevice(camera)}
                            onDragEnd={() => setDraggedDevice(null)}
                            onTouchStart={(e) => handleTouchStart(e, camera)}
                            onTouchMove={handleTouchMove}
                            onTouchEnd={(e) => {
                              if (!isDragging) { e.preventDefault(); handleCameraTap(camera); setTouchStartPos(null); setTouchDraggedDevice(null); return; }
                              handleTouchEnd(e);
                            }}
                            onTouchCancel={() => { setTouchStartPos(null); setTouchDraggedDevice(null); setIsDragging(false); }}
                            onClick={() => { if (!isDragging && !touchDraggedDevice) handleCameraTap(camera); }}
                            className={cn(
                              'px-3 py-2 rounded-lg cursor-pointer transition-all select-none border',
                              isInGrid
                                ? 'bg-zinc-950/40 border-white/5 opacity-50 hover:opacity-100 hover:bg-zinc-900/60'
                                : 'bg-indigo-500/10 border-indigo-500/20 hover:bg-indigo-500/20 active:scale-95 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]'
                            )}
                            style={{ WebkitUserSelect: 'none', userSelect: 'none', touchAction: 'manipulation' }}
                          >
                            <div className="flex items-center gap-2">
                              <Camera className={cn("w-3.5 h-3.5 shrink-0 transition-colors", isInGrid ? "text-zinc-500" : "text-indigo-400")} />
                              <span className={cn("text-xs font-mono truncate flex-1 transition-colors", isInGrid ? "text-zinc-500" : "text-indigo-50")}>{camera.name || camera.id}</span>
                              {isInGrid && <span className="text-[9px] font-mono text-zinc-500/80 uppercase tracking-widest bg-zinc-800/50 px-1.5 py-0.5 rounded">Active</span>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ── Main Grid ── */}
      <div className="flex-1 flex flex-col overflow-hidden p-1">

        <div className="flex-1 overflow-hidden">
          <div
            className="grid gap-1 h-full"
            style={{
              gridTemplateColumns: `repeat(${gridDimensions.cols}, minmax(0, 1fr))`,
              gridTemplateRows: `repeat(${gridDimensions.rows}, minmax(0, 1fr))`,
            }}
          >
            {gridSlots.map((slot, index) => (
              <div
                key={slot.id}
                data-slot-index={index}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => handleDrop(index)}
                onTouchEnd={(e) => { if (touchDraggedDevice) { e.preventDefault(); handleTouchEnd(undefined, index); } }}
                onTouchMove={(e) => { if (touchDraggedDevice) e.preventDefault(); }}
                className={cn(
                  'relative rounded-sm border transition-all select-none overflow-hidden flex flex-col',
                  slot.device ? 'border-indigo-500/20 bg-zinc-950/40 shadow-none' : 'border-white/5 bg-white/[0.02] backdrop-blur-sm',
                  (draggedDevice || touchDraggedDevice) && !slot.device && 'border-indigo-400/40 bg-indigo-900/10'
                )}
                style={{ WebkitUserSelect: 'none', userSelect: 'none', touchAction: 'none' }}
              >
                {slot.device ? (
                  <>
                    {/* Camera name overlay */}
                    {/* Camera name overlay */}
                    <div className="absolute top-2 left-2 z-10 pointer-events-none">
                      <div className="bg-black/65 rounded px-2 py-0.5 w-fit">
                        <p className="text-[11px] text-white font-medium truncate max-w-[180px]">
                          {slot.device.name || slot.device.id}
                        </p>
                      </div>
                    </div>

                    {/* LIVE indicator - moved to top-right */}
                    <div className="absolute top-2 right-2 z-10 pointer-events-none">
                      <div className="bg-red-500/15 border border-red-500/30 rounded px-1.5 py-0.5 w-fit">
                        <p className="text-[10px] text-red-300 font-bold font-mono tracking-tight">LIVE</p>
                      </div>
                    </div>

                    {/* Video feed */}
                    <div className="flex-1 relative">
                      {slot.device.workerId ? (
                        <DirectWebRTCFrame
                          workerIp={workerIpMap.get(slot.device.workerId)}
                          cameraId={slot.device.id}
                          streamPath={String(slot.device.metadata?.webrtcPath || '') || undefined}
                          className="w-full h-full"
                        />
                      ) : (
                        <NoJetsonSlot camera={slot.device} />
                      )}
                    </div>

                    {/* Bottom bar */}
                    <div className="absolute bottom-0 left-0 right-0 z-10 bg-black/60 flex items-center justify-between px-2 py-1">
                      <span className="text-[11px] text-white/80 truncate flex-1">{slot.device.name || slot.device.id}</span>
                      <div className="flex items-center gap-1.5">
                        <Button
                          variant="ghost" size="icon"
                          onClick={() => setZoomedDevice(slot.device)}
                          className="h-6 w-6 p-0 bg-white/5 hover:bg-white/10 border border-white/10 rounded"
                          title="Expand feed"
                        >
                          <Maximize2 className="w-3 h-3 text-indigo-300" />
                        </Button>
                        <Button
                          variant="ghost" size="icon"
                          onClick={() => removeFromGrid(index)}
                          className="h-6 w-6 p-0 bg-red-500/20 hover:bg-red-500/40 border border-red-500/30 rounded"
                          title="Remove"
                        >
                          <span className="text-red-400 text-xs font-bold font-mono">×</span>
                        </Button>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <div className="text-center">
                      <LayoutGrid className="w-7 h-7 text-zinc-600 mx-auto mb-1.5" />
                      <p className="text-xs text-zinc-500">Drop camera here</p>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {zoomedDevice && (
        <div
          className="fixed inset-0 z-[80] bg-black/85 backdrop-blur-sm p-4 md:p-8"
          onClick={() => setZoomedDevice(null)}
        >
          <div className="relative w-full h-full max-w-[1600px] mx-auto rounded-xl overflow-hidden border border-white/10 bg-black">
            <div className="absolute top-3 left-3 z-10 pointer-events-none">
              <div className="bg-black/65 rounded px-2 py-0.5">
                <p className="text-xs text-white font-medium truncate max-w-[70vw]">
                  {zoomedDevice.name || zoomedDevice.id}
                </p>
              </div>
            </div>
            {zoomedDevice.workerId ? (
              <DirectWebRTCFrame
                workerIp={workerIpMap.get(zoomedDevice.workerId)}
                cameraId={zoomedDevice.id}
                streamPath={String(zoomedDevice.metadata?.webrtcPath || '') || undefined}
                className="w-full h-full"
              />
            ) : (
              <NoJetsonSlot camera={zoomedDevice} />
            )}
          </div>
        </div>
      )}

    </div>
  );
}
