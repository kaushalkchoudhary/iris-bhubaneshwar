import { AlertTriangle, Clock, Eye, RefreshCw, ScanFace, Crosshair, Maximize2 } from 'lucide-react';
import { type CrowdAlert } from './FRSShared';
import { cn } from '@/lib/utils';
import { useState, useRef, useCallback, useEffect } from 'react';
import { resolveBoxRect } from './FRSShared';

interface AlertHistoryTabProps {
  alerts: CrowdAlert[];
  selectedAlert: CrowdAlert | null;
  loadingAlerts: boolean;
  onRefresh: () => void;
  onSelectAlert: (alert: CrowdAlert) => void;
}

export function AlertHistoryTab({
  alerts,
  selectedAlert,
  loadingAlerts,
  onRefresh,
  onSelectAlert,
}: AlertHistoryTabProps) {
  const [zoomMode, setZoomMode] = useState<'target' | 'full'>('target');
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const [frameSize, setFrameSize] = useState({ width: 0, height: 0 });

  useEffect(() => { setPan({ x: 0, y: 0 }); }, [selectedAlert?.id, zoomMode]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (zoomMode !== 'full') return;
    e.preventDefault();
    setIsDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
  }, [zoomMode, pan]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return;
    setPan({ x: dragStart.current.panX + (e.clientX - dragStart.current.x), y: dragStart.current.panY + (e.clientY - dragStart.current.y) });
  }, [isDragging]);

  const handleMouseUp = useCallback(() => setIsDragging(false), []);

  const faceUrl = selectedAlert?.metadata?.images?.['face.jpg'];
  const frameUrl = selectedAlert?.metadata?.images?.['frame.jpg'] || selectedAlert?.metadata?.images?.['face.jpg'];
  // Enrolled person's watchlist photo — set in mapToAlert via d.person?.faceImageUrl
  const referenceUrl = selectedAlert?.metadata?.person_face_url;
  const confidence = ((selectedAlert?.metadata?.confidence || 0) * 100).toFixed(1);

  const rawBox = selectedAlert?.metadata?.box || selectedAlert?.metadata?.bounding_box || selectedAlert?.metadata?.bbox;
  const rect = resolveBoxRect(rawBox, frameSize);

  let targetOrigin = 'center';
  let targetScale = 3;
  if (rect) {
    targetOrigin = `${rect.left + rect.width / 2}% ${rect.top + rect.height / 2}%`;
    targetScale = 5; // Good facial zoom
  }

  return (
    <div className="h-full flex flex-col lg:flex-row gap-4 overflow-hidden p-1">
      {/* ── Left: alert list ─────────────────────── */}
      <div className="w-full lg:w-[260px] xl:w-[300px] shrink-0 flex flex-col bg-zinc-900/30 border border-border/40 backdrop-blur-sm rounded-xl overflow-hidden">
        {/* List header */}
        <div className="px-5 py-3 border-b border-white/5 flex items-center justify-between">
          <div>
            <p className="text-[11px] font-mono tracking-widest text-zinc-500 uppercase">Alert History</p>
            <p className="text-[10px] text-zinc-700 mt-0.5">Recent identified detections</p>
          </div>
          <button
            onClick={onRefresh}
            disabled={loadingAlerts}
            className="h-6 w-6 flex items-center justify-center text-zinc-600 hover:text-zinc-300 transition-colors disabled:opacity-30"
          >
            <RefreshCw className={cn('h-3 w-3', loadingAlerts && 'animate-spin')} />
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto iris-scroll-area">
          {alerts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <Clock className="h-8 w-8 text-zinc-800 opacity-40" />
              <p className="text-[10px] font-mono text-zinc-600 tracking-wider">No alert history</p>
            </div>
          ) : alerts.map((alert) => {
            const isActive = selectedAlert?.id === alert.id;
            return (
              <button
                key={alert.id}
                type="button"
                onClick={() => onSelectAlert(alert)}
                className={cn(
                  'w-full text-left flex gap-3 items-center px-5 py-3 border-b border-white/[0.04] transition-colors group',
                  isActive ? 'bg-indigo-500/[0.08]' : 'hover:bg-white/[0.02]'
                )}
              >
                <div className={cn('w-10 h-10 shrink-0 overflow-hidden bg-black/50', isActive && 'ring-1 ring-indigo-500/40')}>
                  <img src={alert.metadata?.images?.['face.jpg'] || alert.metadata?.images?.['frame.jpg']} className="w-full h-full object-cover" alt="" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className={cn('text-[11px] font-semibold truncate uppercase tracking-tight', isActive ? 'text-indigo-300' : 'text-zinc-300 group-hover:text-zinc-100')}>
                    {alert.title}
                  </p>
                  <p className="text-[10px] font-mono text-zinc-600 mt-0.5 uppercase truncate">{alert.deviceId}</p>
                  <p className="text-[10px] font-mono text-zinc-700">{new Date(alert.timestamp).toLocaleTimeString([], { hour12: false })}</p>
                </div>
                <Eye className={cn('h-3.5 w-3.5 shrink-0', isActive ? 'text-indigo-400' : 'text-zinc-700 group-hover:text-zinc-400')} />
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Right: detail panel ───────────────────── */}
      <div className="flex-1 min-w-0 flex flex-col bg-zinc-900/30 border border-border/40 backdrop-blur-sm rounded-xl overflow-hidden">
        {selectedAlert ? (
          <>
            {/* Header bar */}
            <div className="shrink-0 px-6 py-3 border-b border-white/5 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                  <span className="text-sm font-mono font-bold text-zinc-100 truncate">{selectedAlert.title}</span>
                </div>
                <p className="text-[10px] font-mono text-zinc-600 mt-0.5">
                  {new Date(selectedAlert.timestamp).toLocaleString()} &nbsp;·&nbsp;
                  <span className="uppercase">{selectedAlert.deviceId}</span> &nbsp;·&nbsp;
                  {confidence}% confidence
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {/* MODE TOGGLE — same pill style as Analytics time range picker */}
                <div className="flex bg-white/5 rounded-lg border border-white/5 p-1">
                  {(['target', 'full'] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setZoomMode(mode)}
                      className={cn(
                        'px-2.5 py-1 text-[11px] font-mono tracking-wider rounded-md transition-colors flex items-center gap-1.5',
                        zoomMode === mode
                          ? 'bg-indigo-500/15 text-white shadow-sm'
                          : 'text-zinc-400 hover:text-zinc-100 hover:bg-white/5'
                      )}
                    >
                      {mode === 'target' ? <><ScanFace className="h-3 w-3" /> TARGET</> : <><Maximize2 className="h-3 w-3" /> Full Frame</>}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => setPan({ x: 0, y: 0 })}
                  className="px-2.5 py-1 text-[11px] font-mono text-zinc-500 hover:text-zinc-200 bg-white/5 border border-white/5 rounded-lg flex items-center gap-1.5 transition-colors"
                >
                  <Crosshair className="h-3 w-3" /> RESET
                </button>
              </div>
            </div>

            {/* Main image area — flex row: reference col + full frame col */}
            <div className="flex-1 min-h-0 flex overflow-hidden">
              {/* Left col: reference photo + face crop accent */}
              <div className="w-[200px] xl:w-[240px] shrink-0 border-r border-white/5 flex flex-col bg-black/20">
                <p className="shrink-0 px-4 py-2 text-[9px] font-mono tracking-[0.2em] text-zinc-700 uppercase border-b border-white/5">Reference</p>
                <div className="flex-1 relative overflow-hidden">
                  {/* Enrolled person photo */}
                  {referenceUrl ? (
                    <img src={referenceUrl} className="w-full h-full object-cover object-top" alt="" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <ScanFace className="h-8 w-8 text-zinc-800" />
                    </div>
                  )}
                  {/* Face crop corner accent — bottom-right overlay */}
                  {faceUrl && (
                    <div className="absolute bottom-2 right-2 z-10">
                      <div className="relative w-16 h-16 border border-indigo-400/40 bg-black/80 overflow-hidden shadow-xl">
                        <img src={faceUrl} className="w-full h-full object-cover" alt="" />
                        {/* Corner accent lines */}
                        <div className="absolute top-0 left-0 w-3 h-px bg-indigo-400/80" />
                        <div className="absolute top-0 left-0 w-px h-3 bg-indigo-400/80" />
                        <div className="absolute bottom-0 right-0 w-3 h-px bg-indigo-400/80" />
                        <div className="absolute bottom-0 right-0 w-px h-3 bg-indigo-400/80" />
                      </div>
                      <p className="text-[8px] font-mono text-indigo-400/60 text-center mt-0.5 tracking-widest">DETECTION</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Right col: full frame (pannable in full mode) */}
              <div
                className={cn(
                  'flex-1 bg-black/60 flex items-center justify-center overflow-hidden',
                  zoomMode === 'full' ? 'cursor-move' : 'cursor-default'
                )}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
              >
                {zoomMode === 'target' ? (
                  // TARGET: use full frame and zoom to target
                  <img
                    src={frameUrl || faceUrl}
                    className="select-none transition-transform duration-500 ease-out"
                    style={{
                      transform: `scale(${targetScale})`,
                      transformOrigin: targetOrigin,
                      maxWidth: 'none',
                      width: '100%',
                      height: '100%',
                      objectFit: 'contain'
                    }}
                    onLoad={(e) => {
                      const img = e.currentTarget;
                      setFrameSize({ width: img.naturalWidth || 0, height: img.naturalHeight || 0 });
                    }}
                    alt=""
                    draggable={false}
                  />
                ) : (
                  // FULL FRAME: pannable
                  <img
                    src={frameUrl}
                    className="select-none"
                    style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(1.4)`, transformOrigin: 'center', maxWidth: 'none' }}
                    alt=""
                    draggable={false}
                  />
                )}
              </div>
            </div>

            {/* Bottom metadata — same stat-card style as Analytics dashboard */}
            <div className="shrink-0 border-t border-white/5 grid grid-cols-4 bg-black/20 backdrop-blur-md">
              {[
                { label: 'Alert ID', value: `INC-${selectedAlert.id}`, cls: 'text-zinc-100' },
                { label: 'Camera', value: (selectedAlert.deviceId || '—').toUpperCase(), cls: 'text-zinc-100' },
                { label: 'Status', value: selectedAlert.isResolved ? 'Resolved' : 'Open', cls: selectedAlert.isResolved ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400' },
                { label: 'Confidence', value: `${confidence}%`, cls: 'text-indigo-300' },
              ].map((s, i) => (
                <div key={s.label} className={cn('px-6 py-4 group hover:bg-white/[0.02] transition-colors', i < 3 && 'border-r border-white/5')}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-mono tracking-widest text-zinc-500 uppercase">{s.label}</span>
                  </div>
                  <p className={cn('text-lg font-mono font-bold tracking-tight', s.cls)}>{s.value}</p>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-3">
            <AlertTriangle className="h-10 w-10 text-zinc-800" />
            <p className="text-xs font-mono text-zinc-600 tracking-wider">Select an alert to inspect</p>
          </div>
        )}
      </div>
    </div>
  );
}
