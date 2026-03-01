import { useState, useEffect } from 'react';
import { type TrafficViolation, type RCDetails } from '@/lib/api';
import { CheckCircle2, XCircle, Edit2, Camera, Clock, MapPin, FileText, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { apiClient } from '@/lib/api';
import { cn } from '@/lib/utils';
import { playSound } from '@/hooks/useSound';
import { pdf } from '@react-pdf/renderer';
import { ChallanPDF } from './ChallanPDF';

interface ViolationDetailProps {
  violation: TrafficViolation;
  onApprove: (id: string) => void;
  onReject: (id: string, reason: string) => void;
  onClose: () => void;
}

export function ViolationDetail({ violation, onApprove, onReject, onClose: _onClose }: ViolationDetailProps) {
  const [editingPlate, setEditingPlate] = useState(false);
  const [plateNumber, setPlateNumber] = useState(violation.plateNumber || '');
  const [rejectionReason, setRejectionReason] = useState('');
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [rcDetails, setRcDetails] = useState<RCDetails | null>(null);
  const [approving, setApproving] = useState(false);

  // Reset state and auto-fetch RC details when violation changes
  useEffect(() => {
    setRcDetails(null);
    setPlateNumber(violation.plateNumber || '');
    setSelectedMediaIndex(0);
    // Always fetch RC details immediately when a violation is selected
    // Always fetch RC details immediately when a violation is selected
    /* if (violation.plateNumber && violation.plateNumber !== 'UNKNOWN') {
      fetchRC(violation.plateNumber);
      apiClient.fetchRCToMobile(violation.plateNumber).then(setOwnerMobile).catch(() => { });
    } */
  }, [violation.id]);

  const handleApproveWithRC = async () => {
    setApproving(true);
    try {
      // RC details should already be fetched, but ensure they are
      // RC details should already be fetched, but ensure they are
      /* if (!rcDetails && violation.plateNumber) {
        await fetchRC(violation.plateNumber);
      } */
      // Then approve
      onApprove(violation.id);
    } finally {
      setApproving(false);
    }
  };

  const handleUpdatePlate = async () => {
    try {
      await apiClient.updateViolationPlate(violation.id, plateNumber);
      playSound('success');
      setEditingPlate(false);
    } catch (err) {
      console.error('Failed to update plate:', err);
      playSound('error');
      alert('Failed to update plate number');
    }
  };

  const handleReject = () => {
    if (!rejectionReason.trim()) {
      alert('Please provide a rejection reason');
      return;
    }
    onReject(violation.id, rejectionReason);
    setShowRejectDialog(false);
    setRejectionReason('');
  };

  const handleGenerateChallan = async () => {
    try {
      // Ensure RC details are fetched before generating challan
      // Ensure RC details are fetched before generating challan
      let rc = rcDetails;
      /* if (!rc && violation.plateNumber) {
        setRcLoading(true);
        rc = await apiClient.fetchRCDetails(violation.plateNumber);
        setRcDetails(rc);
        setRcLoading(false);
      } */

      const blob = await pdf(<ChallanPDF violation={violation} rcDetails={rc} />).toBlob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const violationIdStr = String(violation.id);
      const challanNumber = `KSP-BGM-${violationIdStr.slice(0, 8).toUpperCase()}-${Date.now().toString().slice(-6)}`;
      link.download = `Challan-${challanNumber}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      playSound('success');
    } catch (err) {
      console.error('Failed to generate challan:', err);
      playSound('error');
      alert('Failed to generate challan PDF');
    }
  };

  const getViolationTypeColor = (type: string) => {
    const colors: Record<string, string> = {
      SPEED: 'bg-red-500',
      HELMET: 'bg-orange-500',
      WRONG_SIDE: 'bg-yellow-500',
      RED_LIGHT: 'bg-purple-500',
      NO_SEATBELT: 'bg-pink-500',
      OVERLOADING: 'bg-indigo-500',
      ILLEGAL_PARKING: 'bg-zinc-500',
      OTHER: 'bg-blue-500',
    };
    return colors[type] || 'bg-zinc-500';
  };

  // Build media gallery: video first (if any), then main snapshot, then additional images
  const mediaItems: { type: 'video' | 'image'; url: string; label: string }[] = [];

  if (violation.video) {
    mediaItems.push({ type: 'video', url: violation.video, label: 'Video' });
  }
  if (violation.fullSnapshotUrl) {
    mediaItems.push({ type: 'image', url: violation.fullSnapshotUrl, label: 'Snapshot' });
  }
  const additionalImages = Array.isArray(violation.metadata?.additionalImages)
    ? (violation.metadata.additionalImages as string[])
    : [];
  additionalImages.forEach((url, idx) => {
    if (typeof url === 'string' && url) {
      mediaItems.push({ type: 'image', url, label: `Image ${idx + 1}` });
    }
  });

  const [selectedMediaIndex, setSelectedMediaIndex] = useState(0);
  const selectedMedia = mediaItems[selectedMediaIndex] || null;

  return (
    <Card key={violation.id} className="glass h-full flex flex-col overflow-hidden animate-in fade-in duration-200">
      {/* Header */}
      <div className="p-4 border-b border-white/10">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold mb-1">Verification Required</h2>
            <p className="text-xs text-zinc-400">
              Review the evidence below. Approving will move it to the Approved tab.
            </p>
          </div>
          <div className="flex gap-2">
            {(violation.status === 'APPROVED' || violation.status === 'FINED') && (
              <Button
                variant="default"
                onClick={handleGenerateChallan}
                className="gap-2 bg-blue-600 hover:bg-blue-700"
              >
                <FileText className="w-4 h-4" />
                Generate Challan
              </Button>
            )}
            {violation.status === 'PENDING' && (
              <>
                <Button
                  variant="destructive"
                  onClick={() => setShowRejectDialog(true)}
                  className="gap-2 bg-red-600 hover:bg-red-700 border-red-600"
                >
                  <XCircle className="w-4 h-4" />
                  Reject
                </Button>
                <Button
                  variant="default"
                  onClick={handleApproveWithRC}
                  disabled={approving}
                  className="gap-2 bg-green-600 hover:bg-green-700"
                >
                  {approving ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4" />
                  )}
                  {approving ? 'Fetching RC...' : 'Approve'}
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="grid grid-cols-12 gap-4">
          {/* Left Column - Media Gallery + RC Details */}
          <div className="col-span-9 space-y-3">
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold">Evidence</h3>
                <Badge className={cn("text-xs", getViolationTypeColor(violation.violationType))}>
                  {violation.violationType}
                </Badge>
              </div>

              {mediaItems.length > 0 ? (
                <div className="flex gap-3 items-stretch" style={{ height: 'clamp(200px, 40vh, 500px)' }}>
                  {/* Thumbnails - fixed width column on the left */}
                  <div className="flex flex-col gap-2 overflow-y-auto w-20 flex-shrink-0">
                    {mediaItems.map((item, index) => (
                      <Button
                        key={`${item.type}-${item.url}-${index}`}
                        variant="ghost"
                        type="button"
                        onClick={() => setSelectedMediaIndex(index)}
                        className={cn(
                          'relative w-20 h-14 rounded-md overflow-hidden border transition-all p-0 flex-shrink-0',
                          selectedMediaIndex === index
                            ? 'border-blue-500 ring-2 ring-blue-500/60'
                            : 'border-white/10 hover:border-blue-400/70'
                        )}
                      >
                        {item.type === 'video' ? (
                          <div className="w-full h-full bg-black flex items-center justify-center text-xs text-white">
                            <span className="px-1.5 py-0.5 bg-black/70 rounded text-[10px] font-mono">
                              Video
                            </span>
                          </div>
                        ) : (
                          <img
                            src={item.url}
                            alt={item.label}
                            className="w-full h-full object-cover"
                          />
                        )}
                      </Button>
                    ))}
                  </div>

                  {/* Main Viewer - dynamically fills available space */}
                  <div className="relative rounded-lg overflow-hidden border border-white/10 bg-black flex-1 flex items-center justify-center transition-all duration-300">
                    {selectedMedia ? (
                      selectedMedia.type === 'video' ? (
                        <video
                          src={selectedMedia.url}
                          controls
                          className="w-full h-full object-contain"
                        />
                      ) : (
                        <img
                          key={selectedMedia.url}
                          src={selectedMedia.url}
                          alt={selectedMedia.label}
                          className="w-full h-full object-contain animate-in fade-in duration-300"
                        />
                      )
                    ) : (
                      <div className="aspect-video bg-zinc-800 rounded-lg flex items-center justify-center w-full h-full">
                        <Camera className="w-12 h-12 text-zinc-400" />
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="bg-zinc-800 rounded-lg flex items-center justify-center" style={{ height: 'clamp(150px, 30vh, 300px)' }}>
                  <Camera className="w-12 h-12 text-zinc-400" />
                </div>
              )}
            </div>

          </div>

          {/* Right Column - Details (1/4 width) */}
          <div className="col-span-3 space-y-3">
            {/* Violation Type */}
            <div>
              <h3 className="text-xs font-medium text-zinc-400 mb-1">Violation Type</h3>
              <Badge className={cn("text-sm px-3 py-1", getViolationTypeColor(violation.violationType))}>
                {violation.violationType.toLowerCase()}
              </Badge>
            </div>

            {/* License Plate */}
            <div>
              <h3 className="text-xs font-medium text-zinc-400 mb-1">License Plate</h3>
              {violation.plateImageUrl ? (
                <div className="relative rounded-lg overflow-hidden border border-white/10 bg-black">
                  <img
                    src={violation.plateImageUrl}
                    alt="License plate"
                    className="w-full h-auto object-contain max-h-24"
                  />
                </div>
              ) : (
                <div className="h-16 bg-zinc-800 rounded-lg flex items-center justify-center">
                  <span className="text-zinc-400 text-xs">No plate image</span>
                </div>
              )}
            </div>

            {/* Plate Number */}
            <div>
              <h3 className="text-xs font-medium text-zinc-400 mb-1">Plate Number</h3>
              {editingPlate ? (
                <div className="flex gap-2">
                  <Input
                    value={plateNumber}
                    onChange={(e) => setPlateNumber(e.target.value)}
                    className="flex-1"
                  />
                  <Button size="sm" onClick={handleUpdatePlate}>Save</Button>
                  <Button size="sm" variant="outline" onClick={() => {
                    setEditingPlate(false);
                    setPlateNumber(violation.plateNumber || '');
                  }}>Cancel</Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <div className="px-3 py-2 bg-yellow-100 dark:bg-yellow-900/30 rounded-md font-mono font-semibold flex-1">
                    {violation.plateNumber || 'UNKNOWN'}
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setEditingPlate(true)}
                  >
                    <Edit2 className="w-4 h-4" />
                  </Button>
                </div>
              )}
            </div>

            {/* Confidence */}
            {violation.confidence && (
              <div>
                <h3 className="text-xs font-medium text-zinc-400 mb-1">Confidence</h3>
                <div className="text-2xl font-semibold">
                  {(violation.confidence * 100).toFixed(1)}%
                </div>
              </div>
            )}

            {/* Speed Details (for speed violations) */}
            {violation.violationType === 'SPEED' && violation.detectedSpeed && (
              <div className="space-y-3">
                <div>
                  <h3 className="text-xs font-medium text-zinc-400 mb-1">Speed</h3>
                  <div className="text-2xl font-semibold text-red-500">
                    {violation.detectedSpeed.toFixed(1)} km/h
                  </div>
                </div>
                <div>
                  <h3 className="text-xs font-medium text-zinc-400 mb-1">Speed Violation</h3>
                  <div className="space-y-2">
                    <Badge className="bg-purple-500">Radar</Badge>
                    <div className="text-sm">
                      <div>Detected Speed: {violation.detectedSpeed.toFixed(1)} km/h</div>
                      <div className="text-zinc-400">
                        Limit: {violation.speedLimit2W?.toFixed(0) || 'N/A'} km/h (2W) / {violation.speedLimit4W?.toFixed(0) || 'N/A'} km/h (4W)
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Time */}
            <div>
              <h3 className="text-xs font-medium text-zinc-400 mb-1">Time</h3>
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-zinc-400" />
                <span className="font-mono">
                  {new Date(violation.timestamp).toLocaleTimeString('en-US', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </span>
              </div>
            </div>

            {/* Device Info */}
            {violation.device && (
              <div>
                <h3 className="text-xs font-medium text-zinc-400 mb-1">Camera</h3>
                <div className="flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-zinc-400" />
                  <span>{violation.device.name || violation.device.id}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* RC Details — Full-width fixed bottom bar */}
      {/* RC Details — Full-width fixed bottom bar (DISABLED) */}
      {/* {rcLoading && (
        <div className="flex items-center gap-2 px-4 py-3 border-t border-white/5 bg-zinc-900/50 shrink-0">
          <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
          <span className="text-xs text-zinc-400">Fetching vehicle RC details...</span>
        </div>
      )}
      {rcDetails && !rcLoading && (
        <div className="border-t border-white/5 bg-zinc-900/40 px-4 py-3 shrink-0 animate-in fade-in slide-in-from-bottom-2 duration-300">
           ... (RC Details UI Hidden) ...
        </div>
      )} */ }

      {/* Reject Dialog */}
      {showRejectDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <Card className="glass p-6 w-96">
            <h3 className="text-lg font-semibold mb-4">Reject Violation</h3>
            <p className="text-sm text-zinc-400 mb-4">
              Please provide a reason for rejecting this violation:
            </p>
            <Input
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              placeholder="Rejection reason..."
              className="mb-4"
            />
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => {
                setShowRejectDialog(false);
                setRejectionReason('');
              }}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={handleReject}>
                Reject
              </Button>
            </div>
          </Card>
        </div>
      )}
    </Card>
  );
}
