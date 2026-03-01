import { useState, useEffect, useCallback } from 'react';
import { apiClient, type Device } from '@/lib/api';
import { Search, Loader2, Settings, Save, AlertCircle, CheckCircle2, Server } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { HudBadge } from '@/components/ui/hud-badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { formatDateTime } from './widgets/utils';
import type { WorkerWithCounts } from '@/lib/worker-types';
import { ITMSLayout } from './components/ITMSLayout';
import { Empty, EmptyIcon, EmptyTitle, EmptyDescription } from '@/components/ui/empty';

export function DeviceManagement() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [workers, setWorkers] = useState<WorkerWithCounts[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [devicesData, workersData] = await Promise.all([
        apiClient.getDevices(),
        apiClient.getWorkers(),
      ]);
      const devicesList = devicesData as Device[];
      setDevices(devicesList);
      setWorkers(workersData);
      if (!selectedDevice && devicesList.length > 0) {
        setSelectedDevice(devicesList[0]);
      }
    } catch (err) {
      console.error('Failed to fetch device data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const getStatusBadge = (status: string) => {
    const statusLower = status.toLowerCase();
    if (statusLower === 'active') {
      return <HudBadge variant="success">Active</HudBadge>;
    } else if (statusLower === 'inactive') {
      return <HudBadge variant="danger">Inactive</HudBadge>;
    } else {
      return <HudBadge variant="secondary">Maintenance</HudBadge>;
    }
  };

  const filteredDevices = devices.filter((d) => {
    if (searchQuery) {
      return (
        d.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        d.id.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }
    return true;
  });

  return (
    <ITMSLayout>
      <div className="h-full w-full flex flex-col lg:flex-row gap-4 p-4">
        {/* Left Panel - Device List */}
        <div className="w-full lg:w-96 flex flex-col gap-4 relative z-10">
          <Card className="bg-card/70 backdrop-blur-sm p-4">
          <h2 className="text-xl font-bold text-foreground mb-4">Devices</h2>
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search devices..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 bg-muted/40 border-border text-foreground"
            />
          </div>

          <div className="flex-1 overflow-y-auto space-y-2 p-0.5 -m-0.5">
            {loading && <Loader2 className="w-4 h-4 animate-spin text-indigo-400 mx-auto" />}
            {filteredDevices.map((device) => (
              <Card
                key={device.id}
                className={cn(
                  "p-3 cursor-pointer transition-all bg-muted/40 border",
                  selectedDevice?.id === device.id
                    ? "border-indigo-500 ring-2 ring-indigo-500"
                    : "border-border hover:border-indigo-500"
                )}
                onClick={() => setSelectedDevice(device)}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-bold text-foreground">
                    {device.name || device.id}
                  </div>
                  {getStatusBadge(device.status)}
                </div>
                <div className="text-xs text-muted-foreground">
                  {device.type} • <span className="font-mono">{device.lat.toFixed(4)}, {device.lng.toFixed(4)}</span>
                </div>
              </Card>
            ))}
          </div>
        </Card>
      </div>

        {/* Right Panel - Device Details */}
        <div className="flex-1 relative z-10">
          {selectedDevice ? (
            <DeviceDetailView device={selectedDevice} workers={workers} />
          ) : (
            <Card className="h-full bg-card/70 backdrop-blur-sm">
              <Empty>
                <EmptyIcon><Server /></EmptyIcon>
                <EmptyTitle>No device selected</EmptyTitle>
                <EmptyDescription>Select a device from the list to view its details and configuration.</EmptyDescription>
              </Empty>
            </Card>
          )}
        </div>
      </div>
    </ITMSLayout>
  );
}

function DeviceDetailView({ device, workers }: { device: Device; workers: WorkerWithCounts[] }) {
  const [activeTab, setActiveTab] = useState('overview');
  const assignedWorker = workers.find((w) => w.id === device.workerId);

  // Config editor state
  const [configText, setConfigText] = useState('');
  const [configError, setConfigError] = useState<string | null>(null);
  const [configSaving, setConfigSaving] = useState(false);
  const [configSaved, setConfigSaved] = useState(false);

  useEffect(() => {
    setConfigText(JSON.stringify(device.config ?? {}, null, 2));
    setConfigError(null);
    setConfigSaved(false);
  }, [device.id, device.config]);

  const handleConfigSave = async () => {
    try {
      const parsed = JSON.parse(configText);
      setConfigError(null);
      setConfigSaving(true);
      await apiClient.updateDevice(device.id, { config: parsed });
      setConfigSaved(true);
      setTimeout(() => setConfigSaved(false), 3000);
    } catch (err: any) {
      if (err instanceof SyntaxError) {
        setConfigError('Invalid JSON: ' + err.message);
      } else {
        setConfigError('Failed to save: ' + (err.message || 'Unknown error'));
      }
    } finally {
      setConfigSaving(false);
    }
  };

  return (
    <Card className="h-full bg-card/70 backdrop-blur-sm flex flex-col">
      <div className="p-6 border-b border-border">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-2xl font-bold text-foreground mb-2">
              {device.name || device.id}
            </div>
            <div className="flex items-center gap-2">
              {getStatusBadge(device.status)}
              <Badge className="bg-rose-500/10 text-rose-400 border border-rose-500/20 text-xs">
                {device.type}
              </Badge>
            </div>
          </div>
          <Button
            variant="outline"
            className="border-border text-foreground/80 hover:bg-muted/60"
          >
            <Settings className="w-4 h-4 mr-2" />
            Configure
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-3 mb-4 bg-muted/40 border border-border">
            <TabsTrigger value="overview" className="text-xs">Overview</TabsTrigger>
            <TabsTrigger value="config" className="text-xs">Config</TabsTrigger>
            <TabsTrigger value="events" className="text-xs">Events</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            <Card className="bg-muted/40 p-4">
              <h3 className="text-lg font-semibold text-foreground mb-4">Device Information</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Device ID</div>
                  <div className="text-foreground/80 font-mono">{device.id}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Status</div>
                  <div>{getStatusBadge(device.status)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Location</div>
                  <div className="text-foreground/80 font-mono">
                    {device.lat.toFixed(6)}, {device.lng.toFixed(6)}
                  </div>
                </div>
                {assignedWorker && (
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">Assigned Worker</div>
                    <div className="text-foreground/80 font-mono">{assignedWorker.name || assignedWorker.id}</div>
                  </div>
                )}
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Created</div>
                  <div className="text-foreground/80 font-mono">{formatDateTime(device.createdAt)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Updated</div>
                  <div className="text-foreground/80 font-mono">{formatDateTime(device.updatedAt)}</div>
                </div>
              </div>
            </Card>

            <Card className="bg-muted/40 p-4">
              <h3 className="text-lg font-semibold text-foreground mb-4">Health Metrics</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="text-center">
                  <div className="text-xs text-muted-foreground mb-1">Uptime</div>
                  <div className="text-2xl font-bold text-emerald-400 font-mono">99.5%</div>
                </div>
                <div className="text-center">
                  <div className="text-xs text-muted-foreground mb-1">Last Event</div>
                  <div className="text-sm font-bold text-foreground/80 font-mono">
                    {device.latestEvent ? formatDateTime(device.latestEvent.timestamp) : 'N/A'}
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-xs text-muted-foreground mb-1">Data Rate</div>
                  <div className="text-sm font-bold text-indigo-400">Live</div>
                </div>
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="config" className="space-y-4">
            <Card className="bg-muted/40 p-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-foreground">Configuration</h3>
                <div className="flex items-center gap-2">
                  {configSaved && (
                    <span className="flex items-center gap-1 text-xs text-emerald-400">
                      <CheckCircle2 className="w-3 h-3" /> Saved
                    </span>
                  )}
                  <Button
                    size="sm"
                    onClick={handleConfigSave}
                    disabled={configSaving}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs"
                  >
                    {configSaving ? (
                      <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                    ) : (
                      <Save className="w-3 h-3 mr-1" />
                    )}
                    Save Config
                  </Button>
                </div>
              </div>
              {configError && (
                <div className="flex items-center gap-2 mb-3 p-2 bg-red-500/10 border border-red-500/20 rounded text-red-400 text-xs">
                  <AlertCircle className="w-3 h-3 flex-shrink-0" />
                  {configError}
                </div>
              )}
              <textarea
                value={configText}
                onChange={(e) => {
                  setConfigText(e.target.value);
                  setConfigError(null);
                  setConfigSaved(false);
                }}
                rows={14}
                className="w-full bg-muted/40 border border-border text-foreground/80 font-mono text-sm rounded-lg p-3 resize-y focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                spellCheck={false}
              />
            </Card>

            {device.metadata && Object.keys(device.metadata).length > 0 && (
              <Card className="bg-muted/40 p-4">
                <h3 className="text-lg font-semibold text-foreground mb-4">Metadata</h3>
                <pre className="w-full bg-muted/40 border border-border text-foreground/80 font-mono text-sm rounded-lg p-3 overflow-auto max-h-60">
                  {JSON.stringify(device.metadata, null, 2)}
                </pre>
              </Card>
            )}

            {device.rtspUrl && (
              <Card className="bg-muted/40 p-4">
                <h3 className="text-lg font-semibold text-foreground mb-4">RTSP Stream</h3>
                <div className="flex items-center gap-2">
                  <div className="text-xs text-muted-foreground">URL</div>
                  <div className="flex-1 bg-muted/40 border border-border rounded-lg px-3 py-2 text-foreground/80 font-mono text-sm truncate">
                    {device.rtspUrl}
                  </div>
                </div>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="events" className="space-y-4">
            <Card className="bg-muted/40 p-4">
              <h3 className="text-lg font-semibold text-foreground mb-4">Recent Events</h3>
              {device.latestEvent ? (
                <div className="space-y-2">
                  <div className="p-3 bg-card/70 rounded border border-border">
                    <div className="text-sm font-bold text-foreground mb-1">
                      {device.latestEvent.eventType}
                    </div>
                    <div className="text-xs text-muted-foreground font-mono">
                      {formatDateTime(device.latestEvent.timestamp)}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center text-muted-foreground py-8">
                  No recent events
                </div>
              )}
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </Card>
  );
}

function getStatusBadge(status: string) {
  const statusLower = status.toLowerCase();
  if (statusLower === 'active') {
    return <HudBadge variant="success">Active</HudBadge>;
  } else if (statusLower === 'inactive') {
    return <HudBadge variant="danger">Inactive</HudBadge>;
  } else {
    return <HudBadge variant="secondary">Maintenance</HudBadge>;
  }
}
