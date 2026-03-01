import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ArrowLeft, Loader2, Trash2 } from 'lucide-react';
import { apiClient } from '@/lib/api';
import type { Device, DeviceHeartbeatPoint } from '@/lib/api';
import { formatTimeAgo } from '../widgets/utils';
import { UptimeChart } from './UptimeChart';

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

export interface CameraDetailViewProps {
  device: Device;
  parent: Device | null;
  heartbeats: DeviceHeartbeatPoint[];
  onBack: () => void;
  onDelete: () => void;
  loading?: boolean;
}

export function CameraDetailView({
  device,
  parent,
  heartbeats,
  onBack,
  onDelete,
  loading,
}: CameraDetailViewProps) {
  if (loading) {
    return (
      <Card className="h-full bg-card/70 border border-border backdrop-blur-sm flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-400" />
      </Card>
    );
  }

  const cfg = device.config as Record<string, unknown> | undefined;

  const handleDelete = async () => {
    if (!window.confirm(`Delete camera "${device.name || device.id}"?`)) return;
    try {
      await apiClient.deleteDevice(device.id);
      onDelete();
    } catch (e) {
      console.error(e);
      window.alert('Failed to delete camera');
    }
  };

  return (
    <Card className="h-full bg-card/70 border border-border backdrop-blur-sm flex flex-col overflow-hidden">
      <div className="p-6 border-b border-border shrink-0">
        <div className="flex items-center justify-between gap-2 mb-3">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground hover:bg-muted/50 -ml-2"
            onClick={onBack}
          >
            <ArrowLeft className="w-4 h-4 mr-1" />
            Back to {parent?.name || parent?.id || 'MagicBox'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="border-red-500/50 text-red-400 hover:bg-red-500/20 hover:border-red-500"
            onClick={handleDelete}
          >
            <Trash2 className="w-4 h-4 mr-1" />
            Delete
          </Button>
        </div>
        <div className="text-2xl font-bold text-foreground mb-2">{device.name || device.id}</div>
        <div className="flex flex-wrap items-center gap-2">
          {onlineBadge(device.isOnline === true)}
          {statusBadge(device.status)}
          <Badge className="bg-rose-500/10 text-rose-400 border border-rose-500/20 text-xs">
            CAMERA
          </Badge>
        </div>
        <div className="mt-2 space-y-1 text-sm text-foreground/80">
          <div>ID: <span className="font-mono">{device.id}</span></div>
          {device.lastSeen && <div>Last online: {formatTimeAgo(device.lastSeen)}</div>}
          {device.rtspUrl && (
            <div className="text-xs truncate max-w-full" title={device.rtspUrl}>
              RTSP: <span className="font-mono">{device.rtspUrl}</span>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        <UptimeChart heartbeats={heartbeats} title="Uptime (24h)" height={180} />

        {cfg && Object.keys(cfg).length > 0 && (
          <Card className="bg-card/60 border border-border p-4">
            <h3 className="text-lg font-bold text-foreground mb-3">Config</h3>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              {Object.entries(cfg).map(([k, v]) => (
                <div key={k}>
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="text-foreground/80 font-mono">
                    {typeof v === 'object' ? JSON.stringify(v) : String(v ?? '')}
                  </dd>
                </div>
              ))}
            </dl>
          </Card>
        )}
      </div>
    </Card>
  );
}
