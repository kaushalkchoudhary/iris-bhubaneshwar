import { X } from 'lucide-react';
import { Button } from './button';
import { Card } from './card';
import { Badge } from './badge';
import { cn } from '@/lib/utils';

interface ImageModalProps {
  isOpen: boolean;
  onClose: () => void;
  imageUrl: string;
  metadata?: {
    title?: string;
    subtitle?: string;
    plateNumber?: string;
    timestamp?: string;
    violationType?: string;
    vehicleType?: string;
    device?: {
      name?: string;
      id?: string;
    };
    [key: string]: any;
  };
  getViolationTypeColor?: (type: string) => string;
  getViolationTypeLabel?: (type: string) => string;
}

export function ImageModal({
  isOpen,
  onClose,
  imageUrl,
  metadata = {},
  getViolationTypeColor,
  getViolationTypeLabel,
}: ImageModalProps) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full h-full max-w-7xl max-h-[95vh] p-4 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close Button */}
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="absolute top-4 right-4 z-10 text-white hover:bg-white/20"
        >
          <X className="w-5 h-5" />
        </Button>

        {/* Image Container */}
        <div className="flex-1 flex items-center justify-center mb-4">
          <div className="relative w-full h-full max-h-[80vh] flex items-center justify-center">
            <img
              src={imageUrl}
              alt={metadata.title || 'Image'}
              className="max-w-full max-h-full object-contain rounded-lg shadow-[0_25px_50px_rgba(0,0,0,0.8)]"
            />
          </div>
        </div>

        {/* Metadata Panel */}
        {Object.keys(metadata).length > 0 && (
          <Card className="border-0 bg-[#111827]/95 rounded-xl p-4 shadow-[0_22px_45px_rgba(15,23,42,0.95)]">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {metadata.title && (
                <div>
                  <div className="text-xs text-zinc-400 mb-1">Title</div>
                  <div className="text-sm font-semibold text-white">{metadata.title}</div>
                </div>
              )}
              {metadata.plateNumber && (
                <div>
                  <div className="text-xs text-zinc-400 mb-1">Plate Number</div>
                  <div className="text-sm font-mono font-semibold text-white">{metadata.plateNumber}</div>
                </div>
              )}
              {metadata.timestamp && (
                <div>
                  <div className="text-xs text-zinc-400 mb-1">Timestamp</div>
                  <div className="text-sm text-white">
                    {new Date(metadata.timestamp).toLocaleString()}
                  </div>
                </div>
              )}
              {metadata.violationType && (
                <div>
                  <div className="text-xs text-zinc-400 mb-1">Violation Type</div>
                  <Badge
                    className={cn(
                      "text-xs",
                      getViolationTypeColor?.(metadata.violationType) || "bg-blue-500"
                    )}
                  >
                    {getViolationTypeLabel?.(metadata.violationType) || metadata.violationType}
                  </Badge>
                </div>
              )}
              {metadata.vehicleType && (
                <div>
                  <div className="text-xs text-zinc-400 mb-1">Vehicle Type</div>
                  <div className="text-sm text-white">{metadata.vehicleType}</div>
                </div>
              )}
              {metadata.device?.name && (
                <div>
                  <div className="text-xs text-zinc-400 mb-1">Device</div>
                  <div className="text-sm text-white">{metadata.device.name}</div>
                </div>
              )}
              {metadata.subtitle && (
                <div>
                  <div className="text-xs text-zinc-400 mb-1">Subtitle</div>
                  <div className="text-sm text-white">{metadata.subtitle}</div>
                </div>
              )}
              {/* Render any additional metadata */}
              {Object.entries(metadata).map(([key, value]) => {
                if (
                  ['title', 'subtitle', 'plateNumber', 'timestamp', 'violationType', 'vehicleType', 'device'].includes(key) ||
                  !value ||
                  (typeof value === 'object' && !Array.isArray(value))
                ) {
                  return null;
                }
                return (
                  <div key={key}>
                    <div className="text-xs text-zinc-400 mb-1 capitalize">
                      {key.replace(/([A-Z])/g, ' $1').trim()}
                    </div>
                    <div className="text-sm text-white">
                      {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

