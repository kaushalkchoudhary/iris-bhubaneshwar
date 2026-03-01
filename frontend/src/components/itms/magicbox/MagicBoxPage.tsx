import { useState, useEffect, useCallback } from 'react';
import { apiClient, type Device, type DeviceHeartbeatPoint } from '@/lib/api';
import { Search, Loader2, Server } from 'lucide-react';
import { HudBadge } from '@/components/ui/hud-badge';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Empty, EmptyIcon, EmptyTitle, EmptyDescription } from '@/components/ui/empty';
import { cn } from '@/lib/utils';
import { formatTimeAgo } from '../widgets/utils';
import { ITMSLayout } from '../components/ITMSLayout';
import { MagicBoxDetailView } from './MagicBoxDetailView';
import { CameraDetailView } from './CameraDetailView';

function onlineBadge(isOnline: boolean) {
  return isOnline ? (
    <HudBadge variant="success">Online</HudBadge>
  ) : (
    <HudBadge variant="danger">Offline</HudBadge>
  );
}

function uptimeBadge(percent: number | null | undefined) {
  const label = percent != null ? `${percent.toFixed(1)}%` : '—';
  return <HudBadge variant="default">Uptime {label}</HudBadge>;
}

export function MagicBoxPage() {
  const [magicboxes, setMagicboxes] = useState<Device[]>([]);
  const [selectedMagicBox, setSelectedMagicBox] = useState<Device | null>(null);
  const [selectedCamera, setSelectedCamera] = useState<Device | null>(null);
  const [cameras, setCameras] = useState<Device[]>([]);
  const [heartbeats, setHeartbeats] = useState<DeviceHeartbeatPoint[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [loadingCameras, setLoadingCameras] = useState(false);
  const [loadingHeartbeats, setLoadingHeartbeats] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const fetchMagicboxes = useCallback(async () => {
    try {
      setListLoading(true);
      const data = await apiClient.getDevices({ type: 'MAGICBOX' });
      const list = Array.isArray(data) ? (data as Device[]).filter((d) => d.type === 'MAGICBOX') : [];
      setMagicboxes(list);
      // Auto-select first magicbox if none selected
      if (!selectedMagicBox && list.length > 0) {
        setSelectedMagicBox(list[0]);
      }
    } catch (err) {
      console.error('Failed to fetch MagicBoxes:', err);
      setMagicboxes([]);
    } finally {
      setListLoading(false);
    }
  }, []);

  const refetchCameras = useCallback(async () => {
    if (!selectedMagicBox) return;
    try {
      const list = await apiClient.getDeviceCameras(selectedMagicBox.id);
      setCameras(list);
    } catch {
      setCameras([]);
    }
  }, [selectedMagicBox?.id]);

  useEffect(() => {
    fetchMagicboxes();
  }, [fetchMagicboxes]);

  const detailDevice = selectedCamera ?? selectedMagicBox;

  useEffect(() => {
    if (!selectedMagicBox) {
      setCameras([]);
      return;
    }
    let ok = true;
    setLoadingCameras(true);
    apiClient
      .getDeviceCameras(selectedMagicBox.id)
      .then((list) => {
        if (ok) setCameras(list);
      })
      .catch(() => {
        if (ok) setCameras([]);
      })
      .finally(() => {
        if (ok) setLoadingCameras(false);
      });
    return () => { ok = false; };
  }, [selectedMagicBox?.id]);

  useEffect(() => {
    if (!detailDevice) {
      setHeartbeats([]);
      return;
    }
    let ok = true;
    setLoadingHeartbeats(true);
    apiClient
      .getDeviceHeartbeats(detailDevice.id, { last: '24h' })
      .then((list) => {
        if (ok) setHeartbeats(list);
      })
      .catch(() => {
        if (ok) setHeartbeats([]);
      })
      .finally(() => {
        if (ok) setLoadingHeartbeats(false);
      });
    return () => { ok = false; };
  }, [detailDevice?.id]);

  const filtered = magicboxes.filter(
    (d) =>
      !searchQuery ||
      (d.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      d.id.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <ITMSLayout>
      <div className="h-full w-full flex flex-col lg:flex-row gap-4 p-4">
        <div className="w-full lg:w-96 flex flex-col gap-4 relative z-10">
          <Card className="bg-card/70 border border-border backdrop-blur-sm p-4">
            <h2 className="text-xl font-bold text-foreground mb-4">MagicBox</h2>
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 bg-muted/40 border-border text-foreground/80"
              />
            </div>
            <div className="flex-1 overflow-y-auto space-y-2 p-0.5 -m-0.5">
              {listLoading && <Loader2 className="w-4 h-4 animate-spin text-indigo-400 mx-auto" />}
              {filtered.map((d) => (
                <Card
                  key={d.id}
                  className={cn(
                    'p-3 cursor-pointer transition-all bg-muted/40 border border-border',
                    selectedMagicBox?.id === d.id && !selectedCamera
                      ? 'ring-2 ring-indigo-500/30'
                      : ''
                  )}
                  onClick={() => {
                    setSelectedMagicBox(d);
                    setSelectedCamera(null);
                  }}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-sm font-bold text-foreground">{d.name || d.id}</div>
                    <div className="flex items-center gap-2">
                      {onlineBadge(d.isOnline === true)}
                      {uptimeBadge(d.uptimePercent)}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Last online: {d.lastSeen ? formatTimeAgo(d.lastSeen) : '—'}
                    {(d.metadata as Record<string, unknown>)?.wg_interface_ip != null &&
                      ` · WG IP: ${(d.metadata as Record<string, unknown>).wg_interface_ip as string}`}
                  </div>
                </Card>
              ))}
            </div>
          </Card>
        </div>

        <div className="flex-1 relative z-10 min-w-0">
          {selectedCamera ? (
            <CameraDetailView
              device={selectedCamera}
              parent={selectedMagicBox}
              heartbeats={heartbeats}
              onBack={() => setSelectedCamera(null)}
              onDelete={() => {
                setSelectedCamera(null);
                refetchCameras();
              }}
              loading={loadingHeartbeats}
            />
          ) : selectedMagicBox ? (
            <MagicBoxDetailView
              device={selectedMagicBox}
              heartbeats={heartbeats}
              cameras={cameras}
              onSelectCamera={setSelectedCamera}
              onDelete={() => {
                setSelectedMagicBox(null);
                setSelectedCamera(null);
                fetchMagicboxes();
              }}
              onDeleteCamera={async (cam) => {
                try {
                  await apiClient.deleteDevice(cam.id);
                  refetchCameras();
                } catch (e) {
                  console.error(e);
                  window.alert('Failed to delete camera');
                }
              }}
              loading={loadingCameras || loadingHeartbeats}
            />
          ) : (
            <Card className="h-full bg-card/70 border border-border backdrop-blur-sm">
              <Empty>
                <EmptyIcon>
                  <Server />
                </EmptyIcon>
                <EmptyTitle>No device selected</EmptyTitle>
                <EmptyDescription>Select a MagicBox from the list to view its details and connected cameras.</EmptyDescription>
              </Empty>
            </Card>
          )}
        </div>
      </div>
    </ITMSLayout>
  );
}
