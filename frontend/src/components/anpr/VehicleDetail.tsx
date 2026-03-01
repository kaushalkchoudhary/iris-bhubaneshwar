import { useState, useEffect } from 'react';
import { apiClient, type Vehicle, type VehicleDetection, type TrafficViolation } from '@/lib/api';
import { X, Eye, EyeOff, AlertTriangle, Camera } from 'lucide-react';
import { Empty, EmptyIcon, EmptyTitle } from '@/components/ui/empty';
import { Badge } from '@/components/ui/badge';
import { HudBadge } from '@/components/ui/hud-badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ImageModal } from '@/components/ui/image-modal';
import { cn } from '@/lib/utils';

const WATCHLIST_REASONS = [
  'Stolen Vehicle',
  'Crime Involved',
  'Suspicious Activity',
  'Wanted Person',
  'Traffic Violation History',
  'Other',
];

interface VehicleDetailProps {
  vehicle: Vehicle;
  onClose: () => void;
  onUpdate: () => void;
}

export function VehicleDetail({ vehicle, onUpdate, onClose }: VehicleDetailProps) {
  const [detections, setDetections] = useState<VehicleDetection[]>([]);
  const [violations, setViolations] = useState<TrafficViolation[]>([]);
  const [_loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('detections');
  const [_editing, setEditing] = useState(false);
  const [editData, setEditData] = useState({
    plateNumber: vehicle.plateNumber || '',
    make: vehicle.make || '',
    model: vehicle.model || '',
    color: vehicle.color || '',
  });
  const [watchlistReason, setWatchlistReason] = useState('');
  const [showWatchlistDialog, setShowWatchlistDialog] = useState(false);
  const [modalImage, setModalImage] = useState<{ url: string; metadata: any } | null>(null);

  useEffect(() => {
    fetchDetections();
    fetchViolations();
  }, [vehicle.id]);

  const fetchDetections = async () => {
    try {
      setLoading(true);
      const data = await apiClient.getVehicleDetections(vehicle.id, { limit: 50 });
      setDetections(data);
    } catch (err) {
      console.error('Failed to fetch detections:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchViolations = async () => {
    try {
      const data = await apiClient.getVehicleViolations(vehicle.id);
      setViolations(data);
    } catch (err) {
      console.error('Failed to fetch violations:', err);
    }
  };

  const handleUpdate = async () => {
    try {
      await apiClient.updateVehicle(vehicle.id, {
        plateNumber: editData.plateNumber || undefined,
        make: editData.make || undefined,
        model: editData.model || undefined,
        color: editData.color || undefined,
      });
      setEditing(false);
      onUpdate();
    } catch (err) {
      console.error('Failed to update vehicle:', err);
      alert('Failed to update vehicle');
    }
  };

  const handleAddToWatchlist = async () => {
    if (!watchlistReason.trim()) {
      alert('Please provide a reason');
      return;
    }
    try {
      await apiClient.addToWatchlist(vehicle.id, {
        reason: watchlistReason,
        addedBy: 'user',
        alertOnDetection: true,
        alertOnViolation: true,
      });
      setShowWatchlistDialog(false);
      setWatchlistReason('');
      onUpdate();
    } catch (err) {
      console.error('Failed to add to watchlist:', err);
      alert('Failed to add to watchlist');
    }
  };

  const handleRemoveFromWatchlist = async () => {
    try {
      await apiClient.removeFromWatchlist(vehicle.id);
      onUpdate();
    } catch (err) {
      console.error('Failed to remove from watchlist:', err);
      alert('Failed to remove from watchlist');
    }
  };

  const getVehicleTypeColor = (type: string) => {
    const colors: Record<string, string> = {
      '2W': 'bg-blue-500',
      '4W': 'bg-green-500',
      'AUTO': 'bg-yellow-500',
      'TRUCK': 'bg-red-500',
      'BUS': 'bg-purple-500',
      'UNKNOWN': 'bg-zinc-500',
    };
    return colors[type] || 'bg-zinc-500';
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

  const getViolationTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      SPEED: 'Speed',
      HELMET: 'Helmet',
      WRONG_SIDE: 'Wrong Side',
      RED_LIGHT: 'Red Light',
      NO_SEATBELT: 'No Seatbelt',
      OVERLOADING: 'Overloading',
      ILLEGAL_PARKING: 'Parking',
      OTHER: 'Other',
    };
    return labels[type] || type;
  };


  const formatDateTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatDeviceName = (name: string | undefined | null): string => {
    if (!name) return '';
    let cleaned = name;
    const lower = cleaned.toLowerCase();
    if (lower.startsWith('camera_')) {
      cleaned = cleaned.slice(7);
    }
    if (cleaned.toLowerCase().startsWith('camera ')) {
      cleaned = cleaned.slice(7);
    }
    if (cleaned.toLowerCase().endsWith('_camera')) {
      cleaned = cleaned.slice(0, -7);
    }
    if (cleaned.toLowerCase().endsWith(' camera')) {
      cleaned = cleaned.slice(0, -7);
    }
    cleaned = cleaned
      .split(/[\s_]+/)
      .filter((part) => part.toLowerCase() !== 'camera')
      .join(' ');
    return cleaned.trim();
  };

  return (
    <Card className="border border-white/5 bg-zinc-950 rounded-xl h-full flex flex-col">
      {/* Header */}
      <div className="p-3 sm:p-6 border-b border-white/5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-2 flex-wrap">
              <h2 className="text-xl sm:text-2xl font-semibold text-zinc-100 truncate">
                {vehicle.plateNumber || 'UNKNOWN VEHICLE'}
              </h2>
              {vehicle.isWatchlisted && (
                <Badge variant="warning" className="gap-1">
                  <Eye className="w-3 h-3" />
                  Watchlisted
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2 sm:gap-4 text-sm text-zinc-300 flex-wrap">
              {vehicle.make && vehicle.model && (
                <span>{vehicle.make} {vehicle.model}</span>
              )}
              <Badge className={cn("text-xs", getVehicleTypeColor(vehicle.vehicleType))}>
                {vehicle.vehicleType}
              </Badge>
              {vehicle.color && <span>Color: {vehicle.color}</span>}
              <span className="font-mono text-xs sm:text-sm">Plate: {vehicle.plateNumber || 'Not identified'}</span>
            </div>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            {vehicle.isWatchlisted ? (
              <Button variant="outline" size="sm" onClick={handleRemoveFromWatchlist}>
                <EyeOff className="w-4 h-4 mr-2" />
                <span className="hidden sm:inline">Remove from Watchlist</span>
                <span className="sm:hidden">Remove</span>
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setShowWatchlistDialog(true)}>
                <Eye className="w-4 h-4 mr-2" />
                <span className="hidden sm:inline">Add to Watchlist</span>
                <span className="sm:hidden">Watch</span>
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Stats and Info */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mt-4">
          <div>
            <div className="text-sm text-zinc-500">Detections</div>
            <div className="text-2xl font-semibold text-white">{vehicle.detectionCount}</div>
          </div>
          <div>
            <div className="text-sm text-zinc-500">Violations</div>
            <div className="text-2xl font-semibold text-white">{violations.length}</div>
          </div>
          <div>
            <div className="text-sm text-zinc-500">First Seen</div>
            <div className="text-sm font-medium text-white">{new Date(vehicle.firstSeen).toLocaleDateString()}</div>
          </div>
          <div>
            <div className="text-sm text-zinc-500">Last Seen</div>
            <div className="text-sm font-medium text-white">{new Date(vehicle.lastSeen).toLocaleDateString()}</div>
          </div>
          {vehicle.watchlist && (
            <>
              <div>
                <div className="text-sm text-zinc-500">Watchlist Reason</div>
                <div className="text-sm font-medium text-white">{vehicle.watchlist.reason}</div>
              </div>
              <div>
                <div className="text-sm text-zinc-500">Added By</div>
                <div className="text-sm font-medium text-white">{vehicle.watchlist.addedBy}</div>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 sm:p-6">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <div className="mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4">
            <h3 className="text-sm font-semibold text-zinc-300">
              Activity timeline
            </h3>
            <TabsList className="flex gap-2 flex-wrap">
            <TabsTrigger value="detections">Detections ({detections.length})</TabsTrigger>
            <TabsTrigger value="violations">Violations ({violations.length})</TabsTrigger>
            <TabsTrigger value="edit">Edit</TabsTrigger>
          </TabsList>
            </div>

          <TabsContent value="detections">
            <div className="space-y-4">
              {detections.map((detection) => (
                <Card key={detection.id} className="border border-white/5 bg-zinc-900/30 rounded-xl p-3 sm:p-4">
                  {/* Image and Metadata - Left Image, Right Metadata */}
                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                    {/* Left Column - Main Image */}
                    <div className="sm:col-span-6">
                      {(detection.vehicleImageUrl || detection.fullImageUrl) ? (
                        <div className="relative w-full aspect-video sm:aspect-[9/16] max-h-[40vh] sm:max-h-[50vh] bg-black overflow-hidden rounded-lg cursor-pointer"
                          onClick={() => {
                            setModalImage({
                              url: detection.vehicleImageUrl || detection.fullImageUrl || '',
                              metadata: {
                                title: 'Vehicle Detection',
                                plateNumber: detection.plateNumber,
                                timestamp: detection.timestamp,
                                vehicleType: detection.vehicleType,
                                device: detection.device,
                                confidence: detection.confidence,
                              },
                            });
                          }}
                        >
                          <img
                            src={detection.vehicleImageUrl || detection.fullImageUrl || ''}
                            alt="Vehicle"
                            className="w-full h-full object-cover"
                          />
                        </div>
                      ) : (
                        <div className="w-full aspect-video sm:aspect-[9/16] max-h-[40vh] sm:max-h-[50vh] bg-black flex items-center justify-center text-zinc-500 text-xs rounded-lg">
                          <Camera className="w-16 h-16 text-zinc-700" />
                        </div>
                      )}
                    </div>
                    {/* Right Column - Metadata */}
                    <div className="sm:col-span-6">
                      <div className="bg-zinc-900/30 rounded-lg p-3 sm:p-4 h-full border border-white/5">
                        {detection.plateNumber && (
                          <div className="mb-4">
                            <div className="inline-flex items-center bg-[#f9fafb] text-[#111827] px-2 sm:px-3 py-1 sm:py-1.5 rounded-md border-2 border-[#111827]">
                              <div className="text-base sm:text-xl font-black tracking-[0.2em] sm:tracking-[0.3em] font-mono">
                                {detection.plateNumber}
                              </div>
                            </div>
                          </div>
                        )}
                        <div className="space-y-3">
                          {detection.vehicleType && (
                            <div>
                              <div className="text-xs text-zinc-500 mb-1">
                                Vehicle Type
                              </div>
                              <Badge className={cn("text-xs px-2 py-1", getVehicleTypeColor(detection.vehicleType))}>
                                {detection.vehicleType}
                              </Badge>
                            </div>
                          )}
                          {detection.device && (
                            <div>
                              <div className="text-xs text-zinc-500 mb-1">
                                Location
                              </div>
                              <div className="text-sm text-zinc-300">
                                {formatDeviceName(detection.device.name || detection.device.id) || 'Unknown'}
                              </div>
                            </div>
                          )}
                          <div>
                            <div className="text-xs text-zinc-500 mb-1">
                              Timestamp
                            </div>
                            <div className="text-sm text-indigo-400">
                              {formatDateTime(detection.timestamp)}
                            </div>
                          </div>
                          {detection.confidence && (
                            <div>
                              <div className="text-xs text-zinc-500 mb-1">
                                Confidence
                              </div>
                              <div className="text-lg text-emerald-400 font-mono font-semibold">
                                {Math.round(detection.confidence * 100)}%
                              </div>
                            </div>
                          )}
                          {detection.plateDetected && (
                            <div>
                              <Badge variant="success" className="text-xs">Plate Detected</Badge>
                            </div>
                          )}
                          {detection.makeModelDetected && (
                            <div>
                              <Badge variant="success" className="text-xs">Make/Model Detected</Badge>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
              {detections.length === 0 && (
                <Empty className="min-h-0 py-8">
                  <EmptyIcon><Camera /></EmptyIcon>
                  <EmptyTitle>No detections found</EmptyTitle>
                </Empty>
              )}
            </div>
          </TabsContent>

          <TabsContent value="violations">
            <div className="space-y-4">
              {violations.map((violation) => (
                <Card key={violation.id} className="border border-white/5 bg-zinc-900/30 rounded-xl p-3 sm:p-4">
                  {/* Image and Metadata - Left Image, Right Metadata */}
                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                    {/* Left Column - Main Violation Image */}
                    <div className="sm:col-span-6">
                      {violation.fullSnapshotUrl ? (
                        <div className="relative w-full aspect-video sm:aspect-[9/16] max-h-[40vh] sm:max-h-[50vh] bg-black overflow-hidden rounded-lg cursor-pointer"
                          onClick={() => {
                            setModalImage({
                              url: violation.fullSnapshotUrl || '',
                              metadata: {
                                title: 'Violation',
                                plateNumber: violation.plateNumber,
                                timestamp: violation.timestamp,
                                violationType: violation.violationType,
                                device: violation.device,
                                status: violation.status,
                                detectedSpeed: violation.detectedSpeed,
                                confidence: violation.confidence,
                              },
                            });
                          }}
                        >
                          <img
                            src={violation.fullSnapshotUrl}
                            alt="Violation"
                            className="w-full h-full object-cover"
                          />
                        </div>
                      ) : (
                        <div className="w-full aspect-video sm:aspect-[9/16] max-h-[40vh] sm:max-h-[50vh] bg-black flex items-center justify-center text-rose-400/50 text-xs rounded-lg">
                          <Camera className="w-16 h-16 text-rose-400/20" />
                        </div>
                      )}
                    </div>
                    {/* Right Column - Metadata */}
                    <div className="sm:col-span-6">
                      <div className="bg-zinc-900/30 rounded-lg p-3 sm:p-4 h-full border border-white/5">
                        {violation.plateNumber && (
                          <div className="mb-4">
                            <div className="inline-flex items-center bg-[#f9fafb] text-[#111827] px-2 sm:px-3 py-1 sm:py-1.5 rounded-md border-2 border-[#111827]">
                              <div className="text-base sm:text-xl font-black tracking-[0.2em] sm:tracking-[0.3em] font-mono">
                                {violation.plateNumber}
                              </div>
                            </div>
                          </div>
                        )}
                        <div className="space-y-3">
                          <div>
                            <div className="text-xs text-rose-400 mb-1">
                              Violation Type
                            </div>
                            <Badge className={cn("text-xs px-2 py-1", getViolationTypeColor(violation.violationType))}>
                              {getViolationTypeLabel(violation.violationType)}
                            </Badge>
                          </div>
                          <div>
                            <div className="text-xs text-rose-400 mb-1">
                              Status
                            </div>
                            <HudBadge variant={
                              violation.status === 'APPROVED' ? 'success' :
                              violation.status === 'PENDING' ? 'warning' :
                              violation.status === 'REJECTED' ? 'danger' :
                              violation.status === 'FINED' ? 'info' :
                              'default'
                            } size="sm">
                              {violation.status}
                            </HudBadge>
                          </div>
                          {violation.detectedSpeed && (
                            <div>
                              <div className="text-xs text-rose-400 mb-1">
                                Speed
                              </div>
                              <div className="text-lg text-amber-400 font-mono font-semibold">
                                {violation.detectedSpeed.toFixed(1)} km/h
                              </div>
                            </div>
                          )}
                          {violation.device && (
                            <div>
                              <div className="text-xs text-rose-400 mb-1">
                                Location
                              </div>
                              <div className="text-sm text-zinc-300">
                                {formatDeviceName(violation.device.name || violation.device.id) || 'Unknown'}
                              </div>
                            </div>
                          )}
                          <div>
                            <div className="text-xs text-rose-400 mb-1">
                              Timestamp
                            </div>
                            <div className="text-sm text-indigo-400">
                              {formatDateTime(violation.timestamp)}
                            </div>
                          </div>
                          {violation.confidence && (
                            <div>
                              <div className="text-xs text-rose-400 mb-1">
                                Confidence
                              </div>
                              <div className="text-lg text-emerald-400 font-mono font-semibold">
                                {Math.round(violation.confidence * 100)}%
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
              {violations.length === 0 && (
                <Empty className="min-h-0 py-8">
                  <EmptyIcon><AlertTriangle /></EmptyIcon>
                  <EmptyTitle>No violations found</EmptyTitle>
                </Empty>
              )}
            </div>
          </TabsContent>

          <TabsContent value="edit">
            <Card className="p-4">
              <h3 className="font-semibold mb-4">Edit Vehicle Information</h3>
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium mb-1 block">Plate Number</label>
                  <Input
                    value={editData.plateNumber}
                    onChange={(e) => setEditData({ ...editData, plateNumber: e.target.value })}
                    placeholder="KA01AB1234"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium mb-1 block">Make</label>
                    <Input
                      value={editData.make}
                      onChange={(e) => setEditData({ ...editData, make: e.target.value })}
                      placeholder="Honda"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">Model</label>
                    <Input
                      value={editData.model}
                      onChange={(e) => setEditData({ ...editData, model: e.target.value })}
                      placeholder="City"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Color</label>
                  <Input
                    value={editData.color}
                    onChange={(e) => setEditData({ ...editData, color: e.target.value })}
                    placeholder="White"
                  />
                </div>
                <div className="flex gap-2">
                  <Button onClick={handleUpdate}>Save Changes</Button>
                  <Button variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
                </div>
              </div>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Watchlist Dialog */}
      {showWatchlistDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <Card className="border border-white/10 bg-zinc-950 rounded-xl p-6 w-full max-w-sm mx-4 sm:mx-0">
            <h3 className="text-lg font-semibold mb-4">Add to Watchlist</h3>
            <p className="text-sm text-zinc-500 mb-4">
              Please select a reason for adding this vehicle to the watchlist:
            </p>
            <select
              value={watchlistReason}
              onChange={(e) => setWatchlistReason(e.target.value)}
              className="w-full h-10 rounded-md border border-white/10 bg-zinc-900/30 px-3 py-2 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">Select a reason...</option>
              {WATCHLIST_REASONS.map((reason) => (
                <option key={reason} value={reason}>
                  {reason}
                </option>
              ))}
            </select>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => {
                setShowWatchlistDialog(false);
                setWatchlistReason('');
              }}>
                Cancel
              </Button>
              <Button onClick={handleAddToWatchlist}>Add to Watchlist</Button>
            </div>
          </Card>
        </div>
      )}

      {/* Image Modal */}
      <ImageModal
        isOpen={!!modalImage}
        onClose={() => setModalImage(null)}
        imageUrl={modalImage?.url || ''}
        metadata={modalImage?.metadata || {}}
      />
    </Card>
  );
}
