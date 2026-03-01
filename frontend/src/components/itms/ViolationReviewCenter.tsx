import { useState, useEffect, useCallback } from 'react';
import { apiClient, sendWhatsAppNotification, type TrafficViolation } from '@/lib/api';
import { CheckCircle2, XCircle, Search, Eye, MapPin, Clock, Camera, Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { HudBadge } from '@/components/ui/hud-badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { playSound } from '@/hooks/useSound';
import { formatDateTime, formatTimeAgo, getViolationTypeColor, getViolationTypeLabel } from './widgets/utils';
import { Empty, EmptyIcon, EmptyTitle, EmptyDescription } from '@/components/ui/empty';

export function ViolationReviewCenter() {
  const [violations, setViolations] = useState<TrafficViolation[]>([]);
  const [selectedViolation, setSelectedViolation] = useState<TrafficViolation | null>(null);
  const [_loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'PENDING' | 'APPROVED' | 'REJECTED'>('PENDING');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [total, setTotal] = useState(0);

  const fetchViolations = useCallback(async () => {
    try {
      setLoading(true);
      const result = await apiClient.getViolations({
        status: filter === 'all' ? undefined : filter,
        limit: 100,
        plateNumber: searchQuery || undefined,
      });
      setViolations(result.violations);
      setTotal(result.total);
      if (selectedViolation && !result.violations.find((v) => v.id === selectedViolation.id)) {
        setSelectedViolation(result.violations.length > 0 ? result.violations[0] : null);
      } else if (!selectedViolation && result.violations.length > 0) {
        setSelectedViolation(result.violations[0]);
      }
    } catch (err) {
      console.error('Failed to fetch violations:', err);
    } finally {
      setLoading(false);
    }
  }, [filter, searchQuery, selectedViolation]);

  useEffect(() => {
    fetchViolations();
    const interval = setInterval(fetchViolations, 30000);
    return () => clearInterval(interval);
  }, [fetchViolations]);

  const handleApprove = async (id: string) => {
    try {
      const approved = await apiClient.approveViolation(id);
      playSound('success');
      const ownerPhone = approved.plateNumber
        ? await apiClient.fetchRCToMobile(approved.plateNumber).catch(() => null)
        : null;
      sendWhatsAppNotification(approved, ownerPhone ?? undefined).catch(() => { });
      fetchViolations();
      if (selectedViolation?.id === id) {
        setSelectedViolation({ ...selectedViolation, status: 'APPROVED' });
      }
    } catch (err) {
      console.error('Failed to approve violation:', err);
    }
  };

  const handleReject = async (id: string) => {
    try {
      await apiClient.rejectViolation(id, { rejectionReason: 'Rejected by reviewer' });
      playSound('error');
      fetchViolations();
      if (selectedViolation?.id === id) {
        setSelectedViolation({ ...selectedViolation, status: 'REJECTED' });
      }
    } catch (err) {
      console.error('Failed to reject violation:', err);
    }
  };

  const handleBulkApprove = async () => {
    try {
      const results = await Promise.all(Array.from(selectedIds).map((id) => apiClient.approveViolation(id)));
      playSound('success');
      results.forEach(async (v) => {
        const ownerPhone = v.plateNumber
          ? await apiClient.fetchRCToMobile(v.plateNumber).catch(() => null)
          : null;
        sendWhatsAppNotification(v, ownerPhone ?? undefined).catch(() => { });
      });
      setSelectedIds(new Set());
      fetchViolations();
    } catch (err) {
      console.error('Failed to bulk approve:', err);
    }
  };

  const handleBulkReject = async () => {
    try {
      await Promise.all(Array.from(selectedIds).map((id) => apiClient.rejectViolation(id, { rejectionReason: 'Bulk rejected by reviewer' })));
      playSound('error');
      setSelectedIds(new Set());
      fetchViolations();
    } catch (err) {
      console.error('Failed to bulk reject:', err);
    }
  };

  const toggleSelection = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedIds(newSet);
  };

  const filteredViolations = violations.filter((v) => {
    if (searchQuery) {
      return (
        v.plateNumber?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        v.id.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }
    return true;
  });

  return (
    <div className="h-full w-full flex flex-col lg:flex-row gap-4 p-4 relative">
      {/* Left Panel - Violation Queue */}
      <div className="w-full lg:w-96 flex flex-col gap-4 relative z-10 h-full">
        <Card className="border border-white/5 bg-zinc-900/30 rounded-xl p-4 flex flex-col h-full">
          <div className="flex items-center justify-between mb-4 flex-shrink-0">
            <h2 className="text-xl font-bold text-zinc-100">Violation Queue</h2>
            <Badge className="bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              {total}
            </Badge>
          </div>

          {/* Search */}
          <div className="relative mb-4 flex-shrink-0">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-zinc-500" />
            <Input
              placeholder="Search plate or ID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>

          {/* Filters */}
          <div className="flex-shrink-0 mb-4">
            <Tabs value={filter} onValueChange={(v) => setFilter(v as any)}>
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="PENDING" className="text-xs">
                  Pending
                </TabsTrigger>
                <TabsTrigger value="all" className="text-xs">
                  All
                </TabsTrigger>
                <TabsTrigger value="APPROVED" className="text-xs">
                  Approved
                </TabsTrigger>
                <TabsTrigger value="REJECTED" className="text-xs">
                  Rejected
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {/* Bulk Actions */}
          {selectedIds.size > 0 && (
            <div className="flex gap-2 mb-4 flex-shrink-0">
              <Button
                size="sm"
                onClick={handleBulkApprove}
                className="flex-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 text-xs"
              >
                <CheckCircle2 className="w-3 h-3 mr-1" />
                Approve ({selectedIds.size})
              </Button>
              <Button
                size="sm"
                onClick={handleBulkReject}
                className="flex-1 bg-rose-500/10 text-rose-400 border border-rose-500/20 hover:bg-rose-500/20 text-xs"
              >
                <XCircle className="w-3 h-3 mr-1" />
                Reject ({selectedIds.size})
              </Button>
            </div>
          )}

          {/* Violations List */}
          <div className="flex-1 overflow-y-auto space-y-2 min-h-0 p-0.5 -m-0.5">
            {filteredViolations.map((violation) => (
              <Card
                key={violation.id}
                className={cn(
                  "border border-white/5 bg-zinc-900/50 hover:bg-zinc-800/50 rounded-xl p-3 cursor-pointer transition-all",
                  selectedViolation?.id === violation.id && "ring-2 ring-indigo-500 border-indigo-500/30",
                  selectedIds.has(violation.id) && "bg-zinc-800/50"
                )}
                onClick={() => setSelectedViolation(violation)}
              >
                <div className="flex items-start gap-2 mb-2">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(violation.id)}
                    onChange={(e) => {
                      e.stopPropagation();
                      toggleSelection(violation.id);
                    }}
                    className="mt-1 h-4 w-4 rounded border-white/20 bg-black/20 accent-indigo-500 cursor-pointer"
                  />
                  <Badge className={cn("text-[10px] px-1.5 py-0.5", getViolationTypeColor(violation.violationType))}>
                    {getViolationTypeLabel(violation.violationType)}
                  </Badge>
                  <HudBadge
                    variant={
                      violation.status === 'PENDING' ? 'warning' :
                        violation.status === 'APPROVED' ? 'success' : 'danger'
                    }
                    size="sm"
                  >
                    {violation.status}
                  </HudBadge>
                </div>
                {violation.plateNumber && (
                  <div className="text-sm font-bold text-zinc-100 font-mono mb-1">
                    {violation.plateNumber}
                  </div>
                )}
                <div className="text-xs text-zinc-400 mb-1">
                  {violation.device?.name || violation.deviceId}
                </div>
                <div className="text-[10px] text-zinc-500">
                  {formatTimeAgo(violation.timestamp)}
                </div>
              </Card>
            ))}
            {filteredViolations.length === 0 && (
              <Empty>
                <EmptyIcon><Eye /></EmptyIcon>
                <EmptyTitle>No violations found</EmptyTitle>
                <EmptyDescription>No violations match the current filters.</EmptyDescription>
              </Empty>
            )}
          </div>
        </Card>
      </div>

      {/* Right Panel - Detail View */}
      <div className="flex-1 relative z-10">
        {selectedViolation ? (
          <ViolationDetailView
            violation={selectedViolation}
            onApprove={() => handleApprove(selectedViolation.id)}
            onReject={() => handleReject(selectedViolation.id)}
            onAddToWatchlist={async () => {
              if (selectedViolation.plateNumber) {
                try {
                  await apiClient.createWatchlistByPlate({
                    plateNumber: selectedViolation.plateNumber,
                    reason: 'Traffic Violation',
                    addedBy: 'System',
                    alertOnDetection: true,
                    alertOnViolation: true,
                  });
                  alert('Added to watchlist');
                } catch (err) {
                  console.error('Failed to add to watchlist:', err);
                }
              }
            }}
          />
        ) : (
          <Card className="border border-white/5 bg-zinc-900/30 rounded-xl h-full">
            <Empty>
              <EmptyIcon><Eye /></EmptyIcon>
              <EmptyTitle>No violation selected</EmptyTitle>
              <EmptyDescription>Select a violation from the queue to review evidence and take action.</EmptyDescription>
            </Empty>
          </Card>
        )}
      </div>
    </div>
  );
}

function ViolationDetailView({
  violation,
  onApprove,
  onReject,
  onAddToWatchlist,
}: {
  violation: TrafficViolation;
  onApprove: () => void;
  onReject: () => void;
  onAddToWatchlist: () => void;
}) {
  return (
    <Card className="border border-white/5 bg-zinc-900/30 rounded-xl h-full flex flex-col">
      {/* Header */}
      <div className="p-6 border-b border-white/5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <Badge className={cn("text-sm px-3 py-1", getViolationTypeColor(violation.violationType))}>
                {getViolationTypeLabel(violation.violationType)}
              </Badge>
              <HudBadge
                variant={
                  violation.status === 'PENDING' ? 'warning' :
                    violation.status === 'APPROVED' ? 'success' : 'danger'
                }
              >
                {violation.status}
              </HudBadge>
            </div>
            {violation.plateNumber && (
              <div className="text-2xl font-bold text-zinc-100 font-mono mb-2">
                {violation.plateNumber}
              </div>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2">
          {violation.status === 'PENDING' && (
            <>
              <Button
                variant="secondary"
                onClick={onApprove}
                className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20"
              >
                <CheckCircle2 className="w-4 h-4 mr-2" />
                Approve
              </Button>
              <Button
                variant="secondary"
                onClick={onReject}
                className="bg-rose-500/10 text-rose-400 border border-rose-500/20 hover:bg-rose-500/20"
              >
                <XCircle className="w-4 h-4 mr-2" />
                Reject
              </Button>
            </>
          )}
          <Button variant="secondary" onClick={onAddToWatchlist}>
            <Plus className="w-4 h-4 mr-2" />
            Add to Watchlist
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 h-full">
          {/* Left Column - Image */}
          <div className="flex flex-col">
            <h3 className="text-lg font-semibold text-zinc-100 mb-3">Evidence</h3>
            {(violation.fullSnapshotUrl || violation.plateImageUrl) ? (
              <Card className="border border-white/5 bg-zinc-900/50 rounded-xl p-4 flex-1 flex items-center justify-center">
                <div className="relative w-full h-full bg-black rounded-lg overflow-hidden flex items-center justify-center">
                  <img
                    src={violation.fullSnapshotUrl || violation.plateImageUrl || ''}
                    alt="Violation"
                    className="max-w-full max-h-full w-auto h-auto object-contain"
                  />
                </div>
              </Card>
            ) : (
              <Card className="border border-white/5 bg-zinc-900/50 rounded-xl p-4 flex-1 flex items-center justify-center">
                <div className="text-center text-zinc-500">
                  <Camera className="w-16 h-16 mx-auto mb-2 opacity-50" />
                  <p>No image available</p>
                </div>
              </Card>
            )}
          </div>

          {/* Right Column - Metadata */}
          <div className="flex flex-col">
            <h3 className="text-lg font-semibold text-zinc-100 mb-3">Details</h3>
            <Card className="border border-white/5 bg-zinc-900/50 rounded-xl p-4 flex-1">
              <div className="space-y-4 text-sm">
                <div>
                  <div className="text-xs text-zinc-500 mb-1">Timestamp</div>
                  <div className="text-zinc-300 flex items-center gap-2">
                    <Clock className="w-3 h-3" />
                    {formatDateTime(violation.timestamp)}
                  </div>
                </div>
                {violation.device && (
                  <div>
                    <div className="text-xs text-zinc-500 mb-1">Device</div>
                    <div className="text-zinc-300 flex items-center gap-2">
                      <MapPin className="w-3 h-3" />
                      {violation.device.name || violation.deviceId}
                    </div>
                  </div>
                )}
                {violation.detectedSpeed && (
                  <div>
                    <div className="text-xs text-zinc-500 mb-1">Speed</div>
                    <div className="text-zinc-300">
                      {violation.detectedSpeed.toFixed(1)} km/h
                    </div>
                  </div>
                )}
                {violation.confidence && (
                  <div>
                    <div className="text-xs text-zinc-500 mb-1">Confidence</div>
                    <div className="text-zinc-300">
                      {(violation.confidence * 100).toFixed(1)}%
                    </div>
                  </div>
                )}
                {violation.speedLimit2W && (
                  <div>
                    <div className="text-xs text-zinc-500 mb-1">Speed Limit (2W)</div>
                    <div className="text-zinc-300">
                      {violation.speedLimit2W} km/h
                    </div>
                  </div>
                )}
                {violation.speedLimit4W && (
                  <div>
                    <div className="text-xs text-zinc-500 mb-1">Speed Limit (4W)</div>
                    <div className="text-zinc-300">
                      {violation.speedLimit4W} km/h
                    </div>
                  </div>
                )}
                {violation.speedOverLimit && (
                  <div>
                    <div className="text-xs text-zinc-500 mb-1">Over Limit</div>
                    <div className="text-zinc-300">
                      {violation.speedOverLimit.toFixed(1)} km/h
                    </div>
                  </div>
                )}
                {violation.plateConfidence && (
                  <div>
                    <div className="text-xs text-zinc-500 mb-1">Plate Confidence</div>
                    <div className="text-zinc-300">
                      {(violation.plateConfidence * 100).toFixed(1)}%
                    </div>
                  </div>
                )}
              </div>
            </Card>
          </div>
        </div>
      </div>
    </Card>
  );
}
