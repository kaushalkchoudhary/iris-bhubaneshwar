export interface WebRTCEndpoint {
  ip: string;
  streamPath: string;
}

// Problematic streams that frequently flap/unready on edge and should be
// redirected to a healthy equivalent feed to avoid WHEP 404 loops in UI.
const STREAM_REDIRECTS: Record<string, { ip?: string; streamPath: string }> = {
  'camera_7c94effe-2a08-4e33-b30b-6069f8837a71': {
    ip: '10.10.0.23',
    streamPath: 'camera_da8df9ff-4694-430d-880b-82ea688e49b3',
  },
};

// Streams discovered from Jetson 150 (/usr/local/uss/USSstreamcontroller.yaml)
const CHANNEL_STREAM_150: Record<number, string> = {
  1: 'camera_055c5733-55b1-4429-9d42-5a4f02d661a3',
  2: 'camera_15f11730-a4b1-4e32-94f8-d541faaadd87',
  3: 'camera_040ab29f-b2ea-4d85-984f-eaafaa1ec70d',
  4: 'camera_40700177-4b0d-46e5-87fe-541d2099f822',
  5: 'camera_aa445fb5-0be0-4fc3-8e93-1bd667dbc675',
  6: 'camera_e64e1af1-9bc5-4c25-98c0-1e41ff0bba24',
  7: 'camera_bcd0173e-6289-4ee3-a728-04b13cefe1fa',
  8: 'camera_a721b889-0b59-44ac-aa74-346acd185474',
  9: 'camera_6eecbe47-fee2-4ee2-9994-a1ddc0a099ba',
  10: 'camera_618f5d2e-811e-40b3-82f4-f71a909cb8e4',
  11: 'camera_8dc1bc75-ca96-45e2-a5f9-3cc8c4c89fea',
  12: 'camera_6a4d4eeb-aef7-41c4-a066-31878d01bb5f',
  13: 'camera_ecf6a1b6-3a13-42e8-83df-2a0e11d0d03e',
  14: 'camera_c39e1146-3e5d-4aa1-b669-c64a54dae717',
  15: 'camera_386a557a-8907-43ca-9616-811bdc9d0dcf',
  16: 'camera_e80f9271-76ff-4a6e-a9ee-a4e9f7f7f327',
  17: 'camera_5bf4f4b1-6925-4962-9d1f-1ec1e9e7c3db',
  18: 'camera_44023c83-0627-42e3-995f-f107e06eda88',
  19: 'camera_db5f8118-3ca9-4a6c-8230-a56cb80eb07b',
  20: 'camera_1454eca2-1c1d-47de-a22d-388b8dee0ca2',
  21: 'camera_1d713384-1516-4b7a-a559-1ba8cad4ecd4',
  22: 'camera_8834526d-411e-4002-a0e9-91b65ffd2ef9',
};

// 23 has its own dedicated 4 cams.
const CAM_D_TO_ENDPOINT: Record<string, WebRTCEndpoint> = {
  cam_d23: { ip: '10.10.0.23', streamPath: 'camera_2f55c80d-03f5-4175-97a2-56910a114171' },
  cam_d24: { ip: '10.10.0.23', streamPath: 'camera_3c8d59ec-0ffd-44ef-92f5-29b9a2f26dc6' },
  // camera_7c94... is currently not ready on 10.10.0.23 (MediaMTX returns 404 on WHEP).
  // Route cam_d25 to a healthy local 23 stream to keep live UI stable.
  cam_d25: { ip: '10.10.0.23', streamPath: 'camera_da8df9ff-4694-430d-880b-82ea688e49b3' },
  cam_d26: { ip: '10.10.0.23', streamPath: 'camera_46f08d98-b022-4745-98fa-bfead086929b' },
};

// All other D-cams are served through Jetson 150.
for (let i = 1; i <= 22; i += 1) {
  const key = `cam_d${String(i).padStart(2, '0')}`;
  const stream = CHANNEL_STREAM_150[i];
  if (stream) {
    CAM_D_TO_ENDPOINT[key] = { ip: '10.10.0.150', streamPath: stream };
  }
}

function parseLegacyDcam(cameraId: string): string {
  return (cameraId || '').trim().toLowerCase();
}

export function resolveWebRTCEndpoint(
  fallbackWorkerIp: string | undefined,
  cameraId: string,
  explicitStreamPath?: string
): WebRTCEndpoint | null {
  const cam = (cameraId || '').trim();
  if (!cam) return null;

  if (explicitStreamPath && explicitStreamPath.trim()) {
    const explicit = explicitStreamPath.trim();
    const redirected = STREAM_REDIRECTS[explicit];
    if (redirected) {
      return {
        ip: redirected.ip || (fallbackWorkerIp || '').trim(),
        streamPath: redirected.streamPath,
      };
    }
    return { ip: (fallbackWorkerIp || '').trim(), streamPath: explicit };
  }

  const normalized = parseLegacyDcam(cam);
  if (CAM_D_TO_ENDPOINT[normalized]) {
    return CAM_D_TO_ENDPOINT[normalized];
  }

  if (cam.startsWith('camera_')) {
    const redirected = STREAM_REDIRECTS[cam];
    if (redirected) {
      return {
        ip: redirected.ip || (fallbackWorkerIp || '').trim(),
        streamPath: redirected.streamPath,
      };
    }
    return { ip: (fallbackWorkerIp || '').trim(), streamPath: cam };
  }

  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cam)) {
    return { ip: (fallbackWorkerIp || '').trim(), streamPath: `camera_${cam}` };
  }

  return { ip: (fallbackWorkerIp || '').trim(), streamPath: `camera_${cam}` };
}
