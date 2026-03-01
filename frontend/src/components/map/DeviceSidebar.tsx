import { useState, useEffect, useRef } from 'react';
import { X, Camera, Maximize2, Minimize2, MapPin, Radio, Plane } from 'lucide-react';
import { type Device } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { HudBadge } from '@/components/ui/hud-badge';
import Hls from 'hls.js';

interface DeviceSidebarProps {
  device: Device;
  onClose: () => void;
}

// Video player component
function VideoPlayer({ src }: { src: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [hasError, setHasError] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const hlsUrl = `${src}/index.m3u8`;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const isNativeHlsSupported = video.canPlayType('application/vnd.apple.mpegurl');

    if (isNativeHlsSupported) {
      video.src = hlsUrl;
      video.addEventListener('loadedmetadata', () => {
        video.muted = true;
        video.play().catch(() => {});
      });
    } else if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 90,
      });

      hlsRef.current = hls;
      hls.loadSource(hlsUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.muted = true;
        video.play().catch(() => {});
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              hls.recoverMediaError();
              break;
            default:
              hls.destroy();
              setHasError(true);
              break;
          }
        }
      });
    } else {
      setHasError(true);
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
      }
    };
  }, [hlsUrl]);

  const handleInteraction = async (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const video = videoRef.current;
    if (video && !isPlaying) {
      try {
        video.muted = true;
        await video.play();
        setIsPlaying(true);
      } catch (err) {
        console.error('Failed to play video:', err);
      }
    }
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);

    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);

    return () => {
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
    };
  }, []);

  // Track fullscreen state
  useEffect(() => {
    const handleFullscreenChange = () => {
      const isFs = !!(
        document.fullscreenElement ||
        (document as any).webkitFullscreenElement ||
        (document as any).mozFullScreenElement ||
        (document as any).msFullscreenElement
      );
      setIsFullscreen(isFs);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);
    document.addEventListener('MSFullscreenChange', handleFullscreenChange);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      document.removeEventListener('mozfullscreenchange', handleFullscreenChange);
      document.removeEventListener('MSFullscreenChange', handleFullscreenChange);
    };
  }, []);

  // Toggle fullscreen
  const toggleFullscreen = async () => {
    const container = containerRef.current;
    if (!container) return;

    try {
      if (!isFullscreen) {
        if (container.requestFullscreen) {
          await container.requestFullscreen();
        } else if ((container as any).webkitRequestFullscreen) {
          await (container as any).webkitRequestFullscreen();
        } else if ((container as any).mozRequestFullScreen) {
          await (container as any).mozRequestFullScreen();
        } else if ((container as any).msRequestFullscreen) {
          await (container as any).msRequestFullscreen();
        }
      } else {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if ((document as any).webkitExitFullscreen) {
          await (document as any).webkitExitFullscreen();
        } else if ((document as any).mozCancelFullScreen) {
          await (document as any).mozCancelFullScreen();
        } else if ((document as any).msExitFullscreen) {
          await (document as any).msExitFullscreen();
        }
      }
    } catch (err) {
      console.error('Error toggling fullscreen:', err);
    }
  };

  return (
    <div 
      ref={containerRef}
      className="relative w-full aspect-video bg-zinc-900 rounded-lg overflow-hidden"
    >
      {hasError && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-red-900/50">
          <div className="text-center">
            <Camera className="w-12 h-12 text-red-400 mx-auto mb-2" />
            <p className="text-xs text-red-400">Stream unavailable</p>
          </div>
        </div>
      )}
      <video
        ref={videoRef}
        className="w-full h-full object-cover cursor-pointer"
        playsInline
        muted
        autoPlay={false}
        controls={false}
        onClick={handleInteraction}
        onTouchStart={handleInteraction}
      />
      {/* Fullscreen button */}
      <Button
        variant="ghost"
        size="icon"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          toggleFullscreen();
        }}
        className="absolute top-2 right-2 z-10 p-2 bg-black/70 hover:bg-black/90 rounded-lg h-auto w-auto"
        aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
      >
        {isFullscreen ? (
          <Minimize2 className="w-4 h-4 text-white" />
        ) : (
          <Maximize2 className="w-4 h-4 text-white" />
        )}
      </Button>
    </div>
  );
}

const deviceTypeIcons: Record<string, typeof Camera> = {
  CAMERA: Camera,
  DRONE: Plane,
  SENSOR: Radio,
};

const deviceTypeColors: Record<string, string> = {
  CAMERA: 'text-blue-500',
  DRONE: 'text-green-500',
  SENSOR: 'text-amber-500',
};

export function DeviceSidebar({ device, onClose }: DeviceSidebarProps) {
  // Get MediaMTX server URL
  const mediaServerUrl = '/media';
  // Show video for CAMERA type devices (same pattern as CameraView)
  const videoSrc = device.type === 'CAMERA' ? `${mediaServerUrl}/camera_${device.id}` : null;

  const IconComponent = deviceTypeIcons[device.type] || Camera;
  const iconColor = deviceTypeColors[device.type] || 'text-zinc-500';

  return (
    <div className="fixed right-0 top-16 bottom-0 w-96 glass border-l border-white/10 dark:border-white/5 z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/10 dark:border-white/5">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <IconComponent className={cn("w-5 h-5", iconColor)} />
            <h2 className="text-lg font-semibold text-zinc-100 truncate">
              {device.name}
            </h2>
          </div>
          <p className="text-xs text-zinc-400">
            Device ID: {device.id}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
        >
          <X className="w-5 h-5 text-zinc-400" />
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Video Player */}
        {videoSrc && (
          <div>
            <h3 className="text-sm font-medium text-zinc-300 mb-2">
              Live Stream
            </h3>
            <VideoPlayer src={videoSrc} />
          </div>
        )}

        {/* Device Details */}
        <div className="glass rounded-lg p-4">
          <h3 className="text-sm font-medium text-zinc-300 mb-3">
            Device Information
          </h3>
          <div className="space-y-3">
            <div>
              <p className="text-xs text-zinc-400 mb-1">Type</p>
              <p className="text-sm font-semibold text-zinc-100">
                {device.type}
              </p>
            </div>

            {device.status && (
              <div>
                <p className="text-xs text-zinc-400 mb-1">Status</p>
                <HudBadge
                  variant={(device.status === 'ACTIVE' || device.status === 'active') ? 'success' : 'danger'}
                  size="sm"
                >
                  {device.status}
                </HudBadge>
              </div>
            )}

            {(device.lat !== 0 || device.lng !== 0) && (
              <div>
                <p className="text-xs text-zinc-400 mb-1">Location</p>
                <div className="flex items-center gap-1 text-sm text-zinc-100">
                  <MapPin className="w-4 h-4" />
                  <span>{device.lat.toFixed(6)}, {device.lng.toFixed(6)}</span>
                </div>
              </div>
            )}

            {device.zoneId && (
              <div>
                <p className="text-xs text-zinc-400 mb-1">Zone ID</p>
                <p className="text-sm font-semibold text-zinc-100">
                  {device.zoneId}
                </p>
              </div>
            )}

            {(device as any).description && (
              <div>
                <p className="text-xs text-zinc-400 mb-1">Description</p>
                <p className="text-sm text-zinc-100">
                  {(device as any).description}
                </p>
              </div>
            )}

            {device.createdAt && (
              <div className="pt-2 border-t border-white/10 dark:border-white/5">
                <p className="text-xs text-zinc-400">
                  Created: {new Date(device.createdAt).toLocaleString()}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

