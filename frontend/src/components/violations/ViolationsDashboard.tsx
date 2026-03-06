import { useState, useEffect, useCallback, useRef } from 'react';
import { apiClient, sendWhatsAppNotification, type TrafficViolation, type ViolationStatus, type ViolationType } from '@/lib/api';
import { AlertTriangle, Loader2, Download, Calendar, Filter, ChevronLeft, ChevronRight } from 'lucide-react';
import { Empty, EmptyIcon, EmptyTitle } from '@/components/ui/empty';
import { playSound } from '@/hooks/useSound';
import { HudBadge } from '@/components/ui/hud-badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { ViolationDetail } from './ViolationDetail';
import { ImageModal } from '@/components/ui/image-modal';
import { pdf } from '@react-pdf/renderer';
import { ViolationsReportPDF } from './ViolationsReportPDF';
import { recordReportEvent } from '@/lib/reportHistory';
import { saveReportBlob } from '@/lib/reportStorage';

export function ViolationsDashboard() {
  const [violations, setViolations] = useState<TrafficViolation[]>([]);
  const [selectedViolation, setSelectedViolation] = useState<TrafficViolation | null>(null);
  const [loading, setLoading] = useState(true);
  const [_error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>('PENDING');
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState({
    violationType: '' as ViolationType | '',
    deviceId: '',
    plateNumber: '',
    date: '',
  });
  const [modalImage, setModalImage] = useState<{ url: string; metadata: any } | null>(null);
  const [page, setPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(50);

  const isFetchingRef = useRef(false);

  const fetchViolations = useCallback(async (isInitialLoad = false) => {
    // Skip if already fetching
    if (isFetchingRef.current && !isInitialLoad) {
      return;
    }

    try {
      isFetchingRef.current = true;
      if (isInitialLoad) {
        setLoading(true);
      }
      setError(null);
      const offset = (page - 1) * itemsPerPage;
      const result = await apiClient.getViolations({
        status: activeTab === 'ALL' ? undefined : (activeTab as ViolationStatus),
        violationType: filters.violationType || undefined,
        deviceId: filters.deviceId || undefined,
        plateNumber: filters.plateNumber || undefined,
        startTime: filters.date ? new Date(filters.date).toISOString() : undefined,
        limit: itemsPerPage,
        offset: offset,
      });
      setViolations(result.violations);
      setTotal(result.total);
      // Auto-select first violation if none selected
      if (!selectedViolation && result.violations.length > 0 && isInitialLoad) {
        setSelectedViolation(result.violations[0]);
      }
    } catch (err) {
      console.error('Failed to fetch violations:', err);
      setError('Failed to load violations');
    } finally {
      isFetchingRef.current = false;
      if (isInitialLoad) {
        setLoading(false);
      }
    }
  }, [activeTab, filters, page, itemsPerPage]);

  useEffect(() => {
    // Reset to page 1 when filters change
    setPage(1);
  }, [activeTab, filters.violationType, filters.deviceId, filters.plateNumber, filters.date]);

  useEffect(() => {
    // Initial load
    fetchViolations(true);

    // Set up polling every second
    const intervalId = setInterval(() => {
      fetchViolations(false);
    }, 1000);

    // Cleanup interval on unmount or when dependencies change
    return () => {
      clearInterval(intervalId);
    };
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
        setSelectedViolation(null);
      }
    } catch (err) {
      console.error('Failed to approve violation:', err);
      playSound('error');
      alert('Failed to approve violation');
    }
  };

  const handleReject = async (id: string, reason: string) => {
    try {
      await apiClient.rejectViolation(id, { rejectionReason: reason });
      playSound('success');
      fetchViolations();
      if (selectedViolation?.id === id) {
        setSelectedViolation(null);
      }
    } catch (err) {
      console.error('Failed to reject violation:', err);
      playSound('error');
      alert('Failed to reject violation');
    }
  };

  const getViolationTypeVariant = (type: string): "danger" | "warning" | "info" | "secondary" | "default" | "success" => {
    const variants: Record<string, "danger" | "warning" | "info" | "secondary" | "default" | "success"> = {
      SPEED: 'danger',
      HELMET: 'warning',
      WRONG_SIDE: 'warning',
      RED_LIGHT: 'danger',
      NO_SEATBELT: 'warning',
      OVERLOADING: 'info',
      ILLEGAL_PARKING: 'secondary',
      TRIPLE_RIDING: 'info',
      OTHER: 'default',
    };
    return variants[type] || 'secondary';
  };

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  };

  const handleGenerateReport = async () => {
    try {
      const generatedAt = new Date().toLocaleString('en-IN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });

      const reportTitle = `Traffic Violations Report - ${activeTab === 'ALL' ? 'All Violations' : activeTab + ' Violations'}`;

      const blob = await pdf(
        <ViolationsReportPDF
          violations={violations}
          reportTitle={reportTitle}
          generatedAt={generatedAt}
          filters={{
            status: activeTab === 'ALL' ? undefined : activeTab,
            violationType: filters.violationType || undefined,
            dateRange: filters.date || undefined,
          }}
        />
      ).toBlob();

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const filename = `Violations-Report-${Date.now()}.pdf`;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      // Record in history first to get the generated ID
      const entry = recordReportEvent({
        title: reportTitle,
        module: 'ITMS',
        route: '/itms/anpr',
        format: 'pdf',
        status: 'downloaded',
        query: JSON.stringify({
          status: activeTab,
          violationType: filters.violationType || undefined,
          date: filters.date || undefined,
          filename,
        }),
      });

      // Save to IndexedDB using the record's ID for persistent viewing on Reports page
      await saveReportBlob(entry.id, blob);
    } catch (err) {
      console.error('Failed to generate report:', err);
      alert('Failed to generate report PDF');
    }
  };

  if (loading && violations.length === 0) {
    return (
      <div className="flex items-center justify-center h-full w-full relative text-white">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500 mx-auto mb-2" />
          <p className="text-zinc-400">Loading violations...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full flex flex-col lg:flex-row gap-3 p-3 relative text-white overflow-hidden">
      {/* Left Panel - Filters and List */}
      <div className="w-full lg:w-96 flex flex-col min-h-0 shrink-0">
        <Card className="border border-white/5 bg-zinc-900/30 rounded-xl p-3 flex flex-col min-h-0 h-full">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold">Violations</h2>
            <Button variant="outline" size="sm" onClick={handleGenerateReport}>
              <Download className="w-4 h-4 mr-2" />
              Report
            </Button>
          </div>

          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v)}>
            <TabsList className="grid w-full grid-cols-4 mb-4">
              <TabsTrigger value="PENDING">Pending</TabsTrigger>
              <TabsTrigger value="APPROVED">Approved</TabsTrigger>
              <TabsTrigger value="FINED">Fines</TabsTrigger>
              <TabsTrigger value="ALL">All</TabsTrigger>
            </TabsList>
          </Tabs>

          {/* Filters */}
          <div className="space-y-2 mb-4">
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-zinc-500" />
              <span className="text-sm font-medium">Filters</span>
            </div>
            <Input
              placeholder="Plate Number"
              value={filters.plateNumber}
              onChange={(e) => setFilters({ ...filters, plateNumber: e.target.value })}
              className="h-8"
            />
            <Input
              type="date"
              value={filters.date}
              onChange={(e) => setFilters({ ...filters, date: e.target.value })}
              className="h-8"
            />
            <select
              value={filters.violationType}
              onChange={(e) => setFilters({ ...filters, violationType: e.target.value as ViolationType | '' })}
              className="h-9 rounded-lg border border-white/10 bg-black/20 px-3 text-sm text-zinc-300 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-white/20"
            >
              <option value="" className="bg-[#0a0a0a] text-zinc-100">All Types</option>
              <option value="SPEED" className="bg-[#0a0a0a] text-zinc-100">Speed</option>
              <option value="HELMET" className="bg-[#0a0a0a] text-zinc-100">Helmet</option>
              <option value="WRONG_SIDE" className="bg-[#0a0a0a] text-zinc-100">Wrong Side</option>
              <option value="RED_LIGHT" className="bg-[#0a0a0a] text-zinc-100">Red Light</option>
              <option value="NO_SEATBELT" className="bg-[#0a0a0a] text-zinc-100">No Seatbelt</option>
              <option value="OVERLOADING" className="bg-[#0a0a0a] text-zinc-100">Overloading</option>
              <option value="ILLEGAL_PARKING" className="bg-[#0a0a0a] text-zinc-100">Illegal Parking</option>
              <option value="TRIPLE_RIDING" className="bg-[#0a0a0a] text-zinc-100">Triple Riding</option>
              <option value="OTHER" className="bg-[#0a0a0a] text-zinc-100">Other</option>
            </select>
          </div>

          <div className="text-sm text-zinc-400 mb-4">
            {total} Violations
          </div>

          {/* Pagination Controls */}
          <div className="flex flex-wrap items-center justify-between mb-4 gap-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-500 hidden sm:inline">Items per page:</span>
              <select
                value={itemsPerPage}
                onChange={(e) => {
                  setItemsPerPage(Number(e.target.value));
                  setPage(1);
                }}
                className="h-9 rounded-lg border border-white/10 bg-black/20 px-3 text-sm text-zinc-300 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-white/20"
              >
                <option value={25} className="bg-[#0a0a0a] text-zinc-100">25</option>
                <option value={50} className="bg-[#0a0a0a] text-zinc-100">50</option>
                <option value={100} className="bg-[#0a0a0a] text-zinc-100">100</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="h-7 px-2"
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <span className="text-xs text-zinc-500">
                Page {page} of {Math.ceil(total / itemsPerPage) || 1}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(Math.ceil(total / itemsPerPage), p + 1))}
                disabled={page >= Math.ceil(total / itemsPerPage)}
                className="h-7 px-2"
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Violations List */}
          <div className="space-y-2 flex-1 overflow-y-auto pr-1 min-h-0">
            {violations.map((violation) => (
              <Card
                key={violation.id}
                className={cn(
                  "border border-white/5 bg-zinc-900/30 hover:bg-zinc-900/50 rounded-xl p-3 cursor-pointer transition-all",
                  selectedViolation?.id === violation.id && "ring-2 ring-blue-500"
                )}
                onClick={() => setSelectedViolation(violation)}
              >
                <div className="flex items-start gap-3">
                  {violation.fullSnapshotUrl && (
                    <div className="w-16 h-11 rounded-lg overflow-hidden bg-black flex-shrink-0 cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation();
                        setModalImage({
                          url: violation.fullSnapshotUrl || '',
                          metadata: {
                            title: violation.device?.name || 'Violation',
                            plateNumber: violation.plateNumber,
                            timestamp: violation.timestamp,
                            violationType: violation.violationType,
                            device: violation.device,
                            status: violation.status,
                            detectedSpeed: violation.detectedSpeed,
                          },
                        });
                      }}
                    >
                      <img
                        src={violation.fullSnapshotUrl}
                        alt="Violation snapshot"
                        className="w-full h-full object-cover"
                      />
                    </div>
                  )}
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm font-mono text-white">
                          {violation.plateNumber || 'UNKNOWN'}
                        </span>
                        <HudBadge variant={getViolationTypeVariant(violation.violationType)}>
                          {violation.violationType}
                        </HudBadge>
                      </div>
                      <HudBadge
                        variant={
                          violation.status === 'APPROVED' ? 'success' :
                            violation.status === 'REJECTED' ? 'danger' :
                              violation.status === 'FINED' ? 'info' : 'warning'
                        }
                      >
                        {violation.status}
                      </HudBadge>
                    </div>
                    <div className="text-xs text-zinc-400 flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {formatTime(violation.timestamp)}
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </Card>
      </div>

      {/* Right Panel - Detail View */}
      <div className={cn("flex-1 min-w-0", !selectedViolation && "hidden lg:block")}>
        {selectedViolation ? (
          <ViolationDetail
            violation={selectedViolation}
            onApprove={handleApprove}
            onReject={handleReject}
            onClose={() => setSelectedViolation(null)}
          />
        ) : (
          <Card className="border border-white/5 bg-zinc-900/20 rounded-xl h-full">
            <Empty>
              <EmptyIcon><AlertTriangle /></EmptyIcon>
              <EmptyTitle>Select a violation to view details</EmptyTitle>
            </Empty>
          </Card>
        )}
      </div>

      {/* Image Modal */}
      <ImageModal
        isOpen={!!modalImage}
        onClose={() => setModalImage(null)}
        imageUrl={modalImage?.url || ''}
        metadata={modalImage?.metadata || {}}
      />
    </div>
  );
}
