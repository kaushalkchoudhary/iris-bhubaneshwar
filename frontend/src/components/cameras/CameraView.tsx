import { useState, useEffect, useMemo, useRef } from 'react';
import { apiClient, type Device } from '@/lib/api';
import {
  Camera, ChevronDown, ChevronRight, LayoutGrid,
  Maximize2, Minimize2, Server,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { HudBadge } from '@/components/ui/hud-badge';
import { useCameraGrid } from '@/contexts/CameraGridContext';
import { cn } from '@/lib/utils';
import { WebSocketVideoFrame } from './WebSocketVideoFrame';

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
  const [fullscreenStates, setFullscreenStates] = useState<Record<number, boolean>>({});
  const [expandedWorkers, setExpandedWorkers] = useState<Set<string>>(new Set());
  const [gridSlots, setGridSlots] = useState<GridSlot[]>([]);
  const [draggedDevice, setDraggedDevice] = useState<Device | null>(null);
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
      } catch {}
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
    } catch {}
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

  // ── Grid / Drag helpers ───────────────────────────────────────────────────

  const saveGrid = (slots: GridSlot[]) => {
    try {
      localStorage.setItem('cameraGridState', JSON.stringify({
        gridSize, slots: slots.map((s) => ({ id: s.id, deviceId: s.deviceId })),
      }));
    } catch {}
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
      <div className="w-64 bg-zinc-900/40 border-r border-white/5 overflow-y-auto flex flex-col shrink-0">
        {/* Header */}
        <div className="p-4 border-b border-white/8 shrink-0">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
              <Camera className="w-4 h-4" /> Live Feed
            </h2>
            <HudBadge variant="success" size="sm">FRS</HudBadge>
          </div>
          <p className="text-[10px] text-zinc-500 mt-1">{cameras.length} cameras · {workers.filter(w => w.online).length}/{workers.length} Jetsons online</p>
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
                    <Server className={`w-3.5 h-3.5 shrink-0 ${worker?.online ? 'text-green-400' : 'text-zinc-600'}`} />
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
                              'px-3 py-2 rounded-lg cursor-pointer transition-all select-none',
                              'bg-white/4 border border-white/8 hover:bg-white/8 active:scale-95',
                              isInGrid && 'opacity-50'
                            )}
                            style={{ WebkitUserSelect: 'none', userSelect: 'none', touchAction: 'manipulation' }}
                          >
                            <div className="flex items-center gap-2">
                              <Camera className="w-3 h-3 text-pink-500 shrink-0" />
                              <span className="text-xs text-zinc-300 truncate flex-1">{camera.name || camera.id}</span>
                              {isInGrid && <span className="text-[10px] text-green-500">●</span>}
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
      <div className="flex-1 flex flex-col overflow-hidden p-3">
        {/* Grid controls bar */}
        <div className="shrink-0 mb-2.5 rounded-xl border border-white/5 bg-zinc-900/30 px-3 py-2 flex items-center justify-between">
          <span className="text-xs text-zinc-400">
            Grid {gridDimensions.cols}×{gridDimensions.rows}
            <span className="text-zinc-600 ml-2">· Jetson-streamed FRS feeds</span>
          </span>
          <span className="text-[10px] text-zinc-600">Drag or tap to place</span>
        </div>

        <div className="flex-1 overflow-hidden rounded-xl border border-white/5 bg-zinc-900/25 p-2.5">
          <div
            className="grid gap-2 h-full"
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
                  'relative rounded-lg border-2 border-dashed transition-all select-none overflow-hidden flex flex-col',
                  slot.device ? 'border-pink-500/30 bg-zinc-900/90' : 'border-white/8 bg-zinc-900/30',
                  (draggedDevice || touchDraggedDevice) && !slot.device && 'border-pink-400/60 bg-pink-900/10'
                )}
                style={{ WebkitUserSelect: 'none', userSelect: 'none', touchAction: 'none' }}
              >
                {slot.device ? (
                  <>
                    {/* Camera name overlay */}
                    <div className="absolute top-2 left-2 z-10 pointer-events-none">
                      <div className="bg-black/65 rounded px-2 py-0.5">
                        <p className="text-[11px] text-white font-medium truncate max-w-[180px]">
                          {slot.device.name || slot.device.id}
                        </p>
                      </div>
                    </div>

                    {/* Video feed */}
                    <div className="flex-1 relative">
                      {slot.device.workerId ? (
                        <WebSocketVideoFrame
                          workerId={slot.device.workerId}
                          cameraId={slot.device.id}
                          showOverlays={true}
                          enabledServices={['frs']}
                          serviceFilter="frs"
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
                          onClick={() => slot.fullscreenRef?.current?.()}
                          className="h-6 w-6 p-0 bg-white/15 hover:bg-white/25 rounded"
                          title={fullscreenStates[index] ? 'Exit fullscreen' : 'Fullscreen'}
                        >
                          {fullscreenStates[index]
                            ? <Minimize2 className="w-3 h-3 text-white" />
                            : <Maximize2 className="w-3 h-3 text-white" />}
                        </Button>
                        <Button
                          variant="ghost" size="icon"
                          onClick={() => removeFromGrid(index)}
                          className="h-6 w-6 p-0 bg-red-500/70 hover:bg-red-600 rounded"
                          title="Remove"
                        >
                          <span className="text-white text-xs font-bold">×</span>
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
    </div>
  );
}
