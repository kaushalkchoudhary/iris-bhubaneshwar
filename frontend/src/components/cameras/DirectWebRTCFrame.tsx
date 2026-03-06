import { cn } from '@/lib/utils';
import { resolveWebRTCEndpoint } from '@/lib/webrtcStreams';
import { WebRTCPlayer } from './WebRTCPlayer';

interface DirectWebRTCFrameProps {
  workerIp?: string;
  cameraId: string;
  streamPath?: string;
  className?: string;
}

function toStreamName(cameraId: string): string {
  const trimmed = (cameraId || '').trim();
  if (!trimmed) return 'camera_unknown';
  return trimmed.startsWith('camera_') ? trimmed : `camera_${trimmed}`;
}

function buildWebRTCUrl(workerIp: string | undefined, cameraId: string, streamPath?: string): string | null {
  const endpoint = resolveWebRTCEndpoint(workerIp, cameraId, streamPath);
  const ip = endpoint?.ip?.trim();
  if (!ip) return null;
  const port = import.meta.env.VITE_JETSON_WEBRTC_PORT || '8889';
  const resolved = endpoint?.streamPath?.trim() || toStreamName(cameraId);
  const streamName = encodeURIComponent(resolved);
  return `http://${ip}:${port}/${streamName}/`;
}

export function DirectWebRTCFrame({ workerIp, cameraId, streamPath, className }: DirectWebRTCFrameProps) {
  const src = buildWebRTCUrl(workerIp, cameraId, streamPath);

  if (!src) {
    return (
      <div className={cn('w-full h-full flex items-center justify-center bg-zinc-950 text-zinc-600 text-xs font-mono', className)}>
        Missing worker IP
      </div>
    );
  }

  return <WebRTCPlayer streamUrl={src} className={cn('w-full h-full bg-black', className)} />;
}
