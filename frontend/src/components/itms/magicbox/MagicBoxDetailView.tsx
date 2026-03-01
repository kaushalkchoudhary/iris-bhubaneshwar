import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Camera, Loader2, Trash2 } from 'lucide-react';
import { Empty, EmptyIcon, EmptyTitle } from '@/components/ui/empty';
import { apiClient } from '@/lib/api';
import type { Device, DeviceHeartbeatPoint } from '@/lib/api';
import { formatTimeAgo } from '../widgets/utils';
import { computeUptimePercent, UptimeChart } from './UptimeChart';

function statusBadge(status: string) {
  const s = (status || '').toLowerCase();
  if (s === 'active') return <Badge className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs">ACTIVE</Badge>;
  if (s === 'inactive') return <Badge className="bg-amber-500/10 text-amber-400 border border-amber-500/20 text-xs">INACTIVE</Badge>;
  return <Badge className="bg-rose-500/10 text-rose-400 border border-rose-500/20 text-xs">MAINTENANCE</Badge>;
}

function onlineBadge(isOnline: boolean) {
  return isOnline ? (
    <Badge className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs">Online</Badge>
  ) : (
    <Badge className="bg-rose-500/10 text-rose-400 border border-rose-500/20 text-xs">Offline</Badge>
  );
}

function heartbeatStatusBadge(s: string) {
  const v = (s || '').toLowerCase();
  if (v === 'online' || v === 'streaming') return <Badge className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs">{s}</Badge>;
  if (v === 'error') return <Badge className="bg-red-500/20 text-red-400 border border-red-500/50 text-xs">{s}</Badge>;
  return <Badge className="bg-muted/40 text-muted-foreground border border-border text-xs">{s || '—'}</Badge>;
}

function uptimeBadge(percent: number | null | undefined) {
  const label = percent != null ? `${percent.toFixed(1)}%` : '—';
  return (
    <Badge className="bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-mono text-xs">
      Uptime {label}
    </Badge>
  );
}

export interface MagicBoxDetailViewProps {
  device: Device;
  heartbeats: DeviceHeartbeatPoint[];
  cameras: Device[];
  onSelectCamera: (c: Device) => void;
  onDelete: () => void;
  onDeleteCamera: (c: Device) => void;
  loading?: boolean;
}

export function MagicBoxDetailView({
  device,
  heartbeats,
  cameras,
  onSelectCamera,
  onDelete,
  onDeleteCamera,
  loading,
}: MagicBoxDetailViewProps) {
  if (loading) {
    return (
      <Card className="h-full bg-card/70 border border-border backdrop-blur-sm flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-400" />
      </Card>
    );
  }

  const handleDelete = async () => {
    if (!window.confirm(`Delete MagicBox "${device.name || device.id}" and all its cameras?`)) return;
    try {
      await apiClient.deleteDevice(device.id);
      onDelete();
    } catch (e) {
      console.error(e);
      window.alert('Failed to delete device');
    }
  };

  return (
    <Card className="h-full bg-card/70 border border-border backdrop-blur-sm flex flex-col overflow-hidden">
      <div className="p-6 border-b border-border shrink-0">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="text-2xl font-bold text-foreground">{device.name || device.id}</div>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 border-red-500/50 text-red-400 hover:bg-red-500/20 hover:border-red-500"
            onClick={handleDelete}
          >
            <Trash2 className="w-4 h-4 mr-1" />
            Delete
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {onlineBadge(device.isOnline === true)}
          {statusBadge(device.status)}
          {uptimeBadge(computeUptimePercent(heartbeats))}
          <Badge className="bg-rose-500/10 text-rose-400 border border-rose-500/20 text-xs">
            MAGICBOX
          </Badge>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm text-foreground/80">
          <span>ID: <span className="font-mono">{device.id}</span></span>
          {device.lastSeen && <span>Last online: {formatTimeAgo(device.lastSeen)}</span>}
          {(device.metadata as Record<string, unknown>)?.wg_interface_ip != null && (
            <span>WG IP: <span className="font-mono">{(device.metadata as Record<string, unknown>).wg_interface_ip as string}</span></span>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        <UptimeChart heartbeats={heartbeats} title="Uptime (24h)" height={180} />

        <div className="flex gap-4 min-h-0">
          {/* Left: Cameras */}
          <Card className="flex-1 min-w-0 flex flex-col bg-card/60 border border-border">
            <div className="p-4 border-b border-border shrink-0">
              <h3 className="text-lg font-bold text-foreground">Cameras ({cameras.length})</h3>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {cameras.length === 0 ? (
                <Empty className="min-h-0 py-4">
                  <EmptyIcon><Camera /></EmptyIcon>
                  <EmptyTitle>No cameras</EmptyTitle>
                </Empty>
              ) : (
                <div className="space-y-2">
                  {cameras.map((cam) => (
                    <Card
                      key={cam.id}
                      className="p-3 cursor-pointer transition-all bg-muted/30 border border-border hover:bg-muted/50"
                      onClick={() => onSelectCamera(cam)}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-foreground">{cam.name || cam.id}</div>
                          <div className="text-xs text-muted-foreground mt-1">
                            Last online: {cam.lastSeen ? formatTimeAgo(cam.lastSeen) : '—'}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {uptimeBadge(cam.uptimePercent)}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-red-400/70 hover:text-red-400 hover:bg-red-500/20"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (window.confirm(`Delete camera "${cam.name || cam.id}"?`)) onDeleteCamera(cam);
                            }}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                          {onlineBadge(cam.isOnline === true)}
                          {statusBadge(cam.status)}
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          </Card>

          {/* Right: Last 10 heartbeats */}
          <Card className="w-full sm:w-72 shrink-0 flex flex-col bg-card/60 border border-border">
            <div className="p-4 border-b border-border shrink-0">
              <h3 className="text-lg font-bold text-foreground">Last 10 heartbeats</h3>
            </div>
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
              {(() => {
                const last10 = heartbeats.slice(-10).reverse();
                if (last10.length === 0) return <div className="text-muted-foreground text-sm">No heartbeats</div>;
                return (
                  <div className="space-y-1.5">
                    {last10.map((h, i) => (
                      <div key={`${h.timestamp}-${i}`} className="flex items-center justify-between gap-2 py-1.5 px-2 rounded bg-muted/30 border border-border">
                        <span className="text-foreground/80 font-mono text-sm truncate">{formatTimeAgo(h.timestamp)}</span>
                        {heartbeatStatusBadge(h.cameraStatus)}
                      </div>
                    ))}
                  </div>
                );
              })()}
              <div className="pt-2 border-t border-border">
                <div className="text-xs text-muted-foreground mb-1.5">Info</div>
                {(() => {
                  const latest = heartbeats.length > 0 ? heartbeats[heartbeats.length - 1] : null;
                  if (!latest) return <div className="text-muted-foreground text-sm">—</div>;
                  const meta = latest.metadata as Record<string, unknown> | undefined;
                  return (
                    <div className="space-y-1 text-sm text-foreground/80">
                      <div>Status: <span className="font-mono">{latest.cameraStatus || '—'}</span></div>
                      <div>At: {formatTimeAgo(latest.timestamp)}</div>
                      {meta?.wg_interface_ip != null && <div>WG IP: <span className="font-mono">{String(meta.wg_interface_ip)}</span></div>}
                    </div>
                  );
                })()}
              </div>
            </div>
          </Card>
        </div>
      </div>
    </Card>
  );
}
