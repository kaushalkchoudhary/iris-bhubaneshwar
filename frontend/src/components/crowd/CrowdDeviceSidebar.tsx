import { useState, useEffect, useRef } from 'react';
import { X, Camera, TrendingUp } from 'lucide-react';
import { Empty, EmptyIcon, EmptyTitle } from '@/components/ui/empty';
import { apiClient, type CrowdAnalysis } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import Hls from 'hls.js';

interface CrowdDeviceSidebarProps {
  analysis: CrowdAnalysis;
  onClose: () => void;
}

// Video player component (reused from CameraView)
function VideoPlayer({ src }: { src: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [hasError, setHasError] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);

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

  return (
    <div className={cn("relative w-full bg-zinc-900 overflow-hidden aspect-video rounded-lg")}>
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
    </div>
  );
}

// Simple trend graph component
function TrendGraph({ data }: { data: Array<{ timestamp: string; crowdLevel: number }> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || data.length === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const padding = 20;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Sort data by timestamp
    const sortedData = [...data].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    // Calculate min/max for scaling
    const crowdLevels = sortedData.map((d) => d.crowdLevel);
    const minLevel = Math.min(...crowdLevels, 0);
    const maxLevel = Math.max(...crowdLevels, 100);

    const graphWidth = width - padding * 2;
    const graphHeight = height - padding * 2;

    // Draw grid lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = padding + (graphHeight / 4) * i;
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(width - padding, y);
      ctx.stroke();
    }

    // Draw trend line
    if (sortedData.length > 1) {
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 2;
      ctx.beginPath();

      sortedData.forEach((point, index) => {
        const x = padding + (graphWidth / (sortedData.length - 1)) * index;
        const normalizedLevel = (point.crowdLevel - minLevel) / (maxLevel - minLevel || 1);
        const y = padding + graphHeight - normalizedLevel * graphHeight;

        if (index === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });

      ctx.stroke();

      // Draw points
      ctx.fillStyle = '#3b82f6';
      sortedData.forEach((point, index) => {
        const x = padding + (graphWidth / (sortedData.length - 1)) * index;
        const normalizedLevel = (point.crowdLevel - minLevel) / (maxLevel - minLevel || 1);
        const y = padding + graphHeight - normalizedLevel * graphHeight;

        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    // Draw labels
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('0%', padding / 2, height - padding);
    ctx.fillText('100%', padding / 2, padding + 5);
  }, [data]);

  return (
    <canvas
      ref={canvasRef}
      width={400}
      height={200}
      className="w-full h-full"
    />
  );
}

export function CrowdDeviceSidebar({ analysis, onClose }: CrowdDeviceSidebarProps) {
  const [historicalData, setHistoricalData] = useState<CrowdAnalysis[]>([]);
  const [loading, setLoading] = useState(true);

  // Get MediaMTX server URL
  const mediaServerUrl = '/media';
  const videoSrc = `${mediaServerUrl}/camera_${analysis.deviceId}`;

  useEffect(() => {
    // Fetch last 24 hours of data for trend graph
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - 24 * 60 * 60 * 1000); // 24 hours ago

    apiClient
      .getCrowdAnalysis({
        deviceId: analysis.deviceId,
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        limit: 100,
      })
      .then((data) => {
        // Calculate crowdLevel for historical data (relative to min/max in the dataset)
        const peopleCounts = data
          .map((d) => d.peopleCount)
          .filter((count) => count !== null && count !== undefined) as number[];
        
        const minCount = peopleCounts.length > 0 ? Math.min(...peopleCounts) : 0;
        const maxCount = peopleCounts.length > 0 ? Math.max(...peopleCounts) : 0;
        const range = maxCount - minCount;

        const dataWithCrowdLevel = data.map((item) => {
          const count = item.peopleCount ?? 0;
          let crowdLevel = 0;
          
          if (range > 0) {
            crowdLevel = Math.round(((count - minCount) / range) * 100);
          } else if (count > 0) {
            crowdLevel = 100;
          }
          
          return { ...item, crowdLevel };
        });

        setHistoricalData(dataWithCrowdLevel);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to fetch historical data:', err);
        setLoading(false);
      });
  }, [analysis.deviceId]);

  // Prepare trend data
  const trendData = historicalData.map((item) => ({
    timestamp: item.timestamp,
    crowdLevel: item.crowdLevel || 0,
  }));

  return (
    <div className="fixed right-0 top-16 bottom-0 w-96 glass border-l border-white/10 dark:border-white/5 z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/10 dark:border-white/5">
        <div className="flex-1">
          <h2 className="text-lg font-semibold text-zinc-100 truncate">
            {analysis.device.name}
          </h2>
          <p className="text-xs text-zinc-400">
            Device ID: {analysis.deviceId}
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
        <div>
          <h3 className="text-sm font-medium text-zinc-300 mb-2">
            Live Stream
          </h3>
          <VideoPlayer src={videoSrc} />
        </div>

        {/* Current Crowd Data */}
        <div className="glass rounded-lg p-4">
          <h3 className="text-sm font-medium text-zinc-300 mb-3">
            Current Status
          </h3>
          <div className="space-y-3">
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-zinc-400">Crowd Level</span>
                <span className="text-sm font-semibold text-zinc-100">
                  {analysis.crowdLevel}%
                </span>
              </div>
              <div className="w-full bg-zinc-800 rounded-full h-2">
                <div
                  className={cn(
                    "h-2 rounded-full transition-all",
                    analysis.crowdLevel >= 75
                      ? "bg-red-500"
                      : analysis.crowdLevel >= 50
                      ? "bg-orange-500"
                      : analysis.crowdLevel >= 25
                      ? "bg-yellow-500"
                      : "bg-green-500"
                  )}
                  style={{ width: `${analysis.crowdLevel}%` }}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-2 border-t border-white/10 dark:border-white/5">
              <div>
                <p className="text-xs text-zinc-400">Density</p>
                <p className="text-sm font-semibold text-zinc-100">
                  {analysis.densityLevel}
                </p>
              </div>
              <div>
                <p className="text-xs text-zinc-400">Movement</p>
                <p className="text-sm font-semibold text-zinc-100">
                  {analysis.movementType}
                </p>
              </div>
              {analysis.congestionLevel !== null && (
                <div>
                  <p className="text-xs text-zinc-400">Congestion</p>
                  <p className="text-sm font-semibold text-zinc-100">
                    {analysis.congestionLevel}/10
                  </p>
                </div>
              )}
              {analysis.freeSpace !== null && (
                <div>
                  <p className="text-xs text-zinc-400">Free Space</p>
                  <p className="text-sm font-semibold text-zinc-100">
                    {analysis.freeSpace.toFixed(1)}%
                  </p>
                </div>
              )}
            </div>

            <div className="pt-2 border-t border-white/10 dark:border-white/5">
              <p className="text-xs text-zinc-400">
                Last Updated: {new Date(analysis.timestamp).toLocaleString()}
              </p>
            </div>
          </div>
        </div>

        {/* Trend Graph */}
        <div className="glass rounded-lg p-4">
          <h3 className="text-sm font-medium text-zinc-300 mb-3">
            Crowd Level Trend (24h)
          </h3>
          {loading ? (
            <div className="flex items-center justify-center h-48">
              <p className="text-sm text-zinc-400">Loading trend data...</p>
            </div>
          ) : trendData.length > 0 ? (
            <div className="h-48 bg-zinc-900 rounded-lg p-2">
              <TrendGraph data={trendData} />
            </div>
          ) : (
            <Empty className="min-h-0 h-48">
              <EmptyIcon><TrendingUp /></EmptyIcon>
              <EmptyTitle>No trend data available</EmptyTitle>
            </Empty>
          )}
        </div>
      </div>
    </div>
  );
}
