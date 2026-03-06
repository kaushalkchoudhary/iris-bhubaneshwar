import React, { useEffect, useRef } from 'react';

interface WebRTCPlayerProps {
    streamUrl: string;
    className?: string;
}

export const WebRTCPlayer: React.FC<WebRTCPlayerProps> = ({ streamUrl, className }) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const pcRef = useRef<RTCPeerConnection | null>(null);
    const whepUrl = (() => {
        const base = streamUrl.replace(/\/+$/, '');
        return base.endsWith('/whep') ? base : `${base}/whep`;
    })();

    useEffect(() => {
        let isActive = true;
        let retryTimeout: ReturnType<typeof setTimeout>;

        const connectStream = () => {
            if (!isActive) return;
            console.log(`[WebRTC] Connecting to ${whepUrl}`);

            let pc = new RTCPeerConnection({
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'turn:10.10.0.250:3478', username: 'admin@wiredleap.com', credential: 'admin123' }
                ]
            });
            pcRef.current = pc;

            pc.addTransceiver('video', { direction: 'recvonly' });

            pc.ontrack = (event) => {
                if (videoRef.current) {
                    if (event.streams && event.streams[0]) {
                        videoRef.current.srcObject = event.streams[0];
                    } else {
                        let inboundStream = new MediaStream([event.track]);
                        videoRef.current.srcObject = inboundStream;
                    }
                }
            };

            // Restart on connection failure or disconnect
            pc.onconnectionstatechange = () => {
                if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
                    console.warn(`[WebRTC] Disconnected (${pc.connectionState}), retrying in 3s...`);
                    pc.close();
                    if (isActive) {
                        retryTimeout = setTimeout(connectStream, 3000);
                    }
                } else {
                    console.log(`[WebRTC] Connection state: ${pc.connectionState}`);
                }
            };

            // WHEP requires the full SDP with all ICE candidates — wait for gathering.
            const waitForIce = (): Promise<void> => new Promise((resolve) => {
                if (pc.iceGatheringState === 'complete') { resolve(); return; }
                const t = setTimeout(resolve, 5000); // 5s max wait
                pc.onicegatheringstatechange = () => {
                    if (pc.iceGatheringState === 'complete') { clearTimeout(t); resolve(); }
                };
            });

            pc.createOffer()
                .then(offer => pc.setLocalDescription(offer))
                .then(() => waitForIce())
                .then(() => {
                    console.log(`[WebRTC] ICE gathered (${pc.iceGatheringState}), sending offer`);
                    return fetch(whepUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/sdp' },
                        body: pc.localDescription?.sdp
                    });
                })
                .then(res => {
                    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
                    return res.text();
                })
                .then(answer => {
                    if (isActive) {
                        pc.setRemoteDescription({ type: 'answer', sdp: answer });
                    }
                })
                .catch(err => {
                    console.error("[WebRTC] WHEP Error:", err);
                    pc.close();
                    if (isActive) {
                        retryTimeout = setTimeout(connectStream, 3000); // Retry every 3s
                    }
                });
        };

        connectStream();

        return () => {
            isActive = false;
            clearTimeout(retryTimeout);
            if (pcRef.current) {
                pcRef.current.close();
                pcRef.current = null;
            }
        };
    }, [whepUrl]);

    return (
        <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={className || "w-full h-full object-cover"}
        />
    );
};
