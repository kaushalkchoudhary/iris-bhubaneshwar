import { useRef, useMemo, useState, useEffect, useCallback } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Stars } from '@react-three/drei';
import * as THREE from 'three';

// Mouse parallax hook
function useMouseParallax() {
  const { camera } = useThree();
  const mouseRef = useRef({ x: 0, y: 0 });
  const targetRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      targetRef.current.x = (e.clientX / window.innerWidth - 0.5) * 2;
      targetRef.current.y = (e.clientY / window.innerHeight - 0.5) * 2;
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  useFrame(() => {
    // Smooth interpolation
    mouseRef.current.x += (targetRef.current.x - mouseRef.current.x) * 0.05;
    mouseRef.current.y += (targetRef.current.y - mouseRef.current.y) * 0.05;
    
    // Apply to camera
    camera.position.x = mouseRef.current.x * 1.5;
    camera.position.y = -mouseRef.current.y * 1;
    camera.lookAt(0, 0, 0);
  });

  return mouseRef;
}

// Scene controller with mouse interaction
function SceneController() {
  useMouseParallax();
  return null;
}

// CCTV Camera icon - data source
function CCTVCamera({ 
  position, 
  color,
  id,
}: { 
  position: [number, number, number]; 
  color: string;
  id: number;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const [active, setActive] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      if (Math.random() > 0.6) {
        setActive(true);
        setTimeout(() => setActive(false), 400);
      }
    }, 1500 + Math.random() * 2000);
    return () => clearInterval(interval);
  }, []);

  useFrame((state) => {
    if (groupRef.current) {
      groupRef.current.position.y = position[1] + Math.sin(state.clock.getElapsedTime() * 0.5 + id) * 0.08;
    }
  });

  return (
    <group ref={groupRef} position={position} scale={0.7}>
      {/* Camera body */}
      <mesh>
        <boxGeometry args={[0.35, 0.22, 0.25]} />
        <meshBasicMaterial color={active ? color : '#374151'} transparent opacity={0.9} />
      </mesh>
      
      {/* Lens */}
      <mesh position={[0.22, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.08, 0.1, 0.12, 16]} />
        <meshBasicMaterial color={active ? '#ffffff' : '#1f2937'} />
      </mesh>
      
      {/* Recording indicator */}
      {active && (
        <mesh position={[-0.12, 0.08, 0.13]}>
          <circleGeometry args={[0.025, 16]} />
          <meshBasicMaterial color="#ef4444" />
        </mesh>
      )}
      
      {/* Mount */}
      <mesh position={[-0.22, 0.12, 0]}>
        <boxGeometry args={[0.06, 0.12, 0.06]} />
        <meshBasicMaterial color="#1f2937" />
      </mesh>
    </group>
  );
}

// Input streams: Cameras → Center
function InputDataStreams({ cameraPositions, color }: { cameraPositions: [number, number, number][]; color: string }) {
  const streamsRef = useRef<THREE.Group>(null);
  const particleCount = 25;
  
  const particles = useMemo(() => {
    return Array.from({ length: particleCount }).map((_, i) => {
      const cameraIdx = i % cameraPositions.length;
      const start = new THREE.Vector3(...cameraPositions[cameraIdx]);
      return {
        start: start.clone(),
        end: new THREE.Vector3(0, 0, 0),
        progress: Math.random(),
        speed: 0.0004 + Math.random() * 0.0006, // Much slower
        size: 0.03 + Math.random() * 0.03,
        cameraIdx,
      };
    });
  }, [cameraPositions]);

  useFrame(() => {
    if (!streamsRef.current) return;
    
    streamsRef.current.children.forEach((child, i) => {
      const particle = particles[i];
      particle.progress += particle.speed;
      
      if (particle.progress > 1) {
        particle.progress = 0;
        particle.speed = 0.0004 + Math.random() * 0.0006; // Much slower
      }
      
      child.position.lerpVectors(particle.start, particle.end, particle.progress);
      const material = (child as THREE.Mesh).material as THREE.MeshBasicMaterial;
      material.opacity = Math.sin(particle.progress * Math.PI) * 0.7;
    });
  });

  return (
    <group ref={streamsRef}>
      {particles.map((p, i) => (
        <mesh key={i}>
          <sphereGeometry args={[p.size, 8, 8]} />
          <meshBasicMaterial color={color} transparent opacity={0.5} blending={THREE.AdditiveBlending} />
        </mesh>
      ))}
    </group>
  );
}

// Output streams: Center → Top Right (Alert feed) - triggers alerts on arrival
function OutputDataStreams({ onParticleArrive }: { onParticleArrive: (type: string) => void }) {
  const streamsRef = useRef<THREE.Group>(null);
  const particleCount = 8; // 1/3 of input (25)
  
  // Alert types with their colors
  const alertTypes = useMemo(() => [
    { type: 'crowd', color: '#f97316' },
    { type: 'vehicle', color: '#a855f7' },
    { type: 'violation', color: '#ef4444' },
    { type: 'system', color: '#22c55e' },
    { type: 'alert', color: '#ef4444' },
  ], []);

  // Single target position - top right near alert feed
  const targetPosition: [number, number, number] = [8.5, 4, 0];

  const particles = useMemo(() => {
    return Array.from({ length: particleCount }).map((_, i) => {
      const alertType = alertTypes[i % alertTypes.length];
      return {
        start: new THREE.Vector3(0, 0, 0),
        end: new THREE.Vector3(...targetPosition),
        progress: i * (1 / particleCount), // Stagger start times
        speed: 0.0008 + Math.random() * 0.0006, // Much slower
        size: 0.04 + Math.random() * 0.02,
        color: alertType.color,
        type: alertType.type,
        hasTriggered: false,
      };
    });
  }, [alertTypes]);

  useFrame(() => {
    if (!streamsRef.current) return;
    
    streamsRef.current.children.forEach((child, i) => {
      const particle = particles[i];
      particle.progress += particle.speed;
      
      // Trigger alert when particle reaches destination
      if (particle.progress >= 0.95 && !particle.hasTriggered) {
        particle.hasTriggered = true;
        onParticleArrive(particle.type);
      }
      
      if (particle.progress > 1) {
        particle.progress = 0;
        particle.hasTriggered = false;
        particle.speed = 0.0008 + Math.random() * 0.0006; // Much slower
        // Randomize type for next cycle
        const newType = alertTypes[Math.floor(Math.random() * alertTypes.length)];
        particle.color = newType.color;
        particle.type = newType.type;
        // Update material color
        const material = (child as THREE.Mesh).material as THREE.MeshBasicMaterial;
        material.color.set(newType.color);
      }
      
      // Curved arc path
      const t = particle.progress;
      const curveHeight = Math.sin(t * Math.PI) * 1.5;
      
      child.position.lerpVectors(particle.start, particle.end, t);
      child.position.y += curveHeight;
      child.position.z += Math.sin(t * Math.PI) * 0.5;
      
      const material = (child as THREE.Mesh).material as THREE.MeshBasicMaterial;
      // Fade in at start, bright in middle, fade out at end
      material.opacity = Math.sin(t * Math.PI) * 0.9;
    });
  });

  return (
    <group ref={streamsRef}>
      {particles.map((p, i) => (
        <mesh key={i}>
          <sphereGeometry args={[p.size, 8, 8]} />
          <meshBasicMaterial 
            color={p.color} 
            transparent 
            opacity={0.5} 
            blending={THREE.AdditiveBlending} 
          />
        </mesh>
      ))}
    </group>
  );
}

// World globe background - MORE VISIBLE
function MonitoringGlobe({ color }: { color: string }) {
  const globeRef = useRef<THREE.Group>(null);
  const pointsRef = useRef<THREE.Points>(null);

  // Generate monitoring points on globe
  const pointPositions = useMemo(() => {
    const count = 100;
    const positions = new Float32Array(count * 3);
    
    for (let i = 0; i < count; i++) {
      const phi = Math.acos(1 - 2 * (i + 0.5) / count);
      const theta = Math.PI * (1 + Math.sqrt(5)) * (i + 0.5);
      
      const radius = 6;
      positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = radius * Math.cos(phi);
    }
    
    return positions;
  }, []);

  useFrame((state) => {
    if (globeRef.current) {
      globeRef.current.rotation.y = state.clock.getElapsedTime() * 0.03;
      globeRef.current.rotation.x = Math.sin(state.clock.getElapsedTime() * 0.05) * 0.1;
    }
  });

  return (
    <group ref={globeRef} position={[0, 0, -10]}>
      {/* Main globe wireframe - more visible */}
      <mesh>
        <sphereGeometry args={[6, 32, 32]} />
        <meshBasicMaterial color={color} wireframe transparent opacity={0.12} />
      </mesh>
      
      {/* Solid inner glow */}
      <mesh>
        <sphereGeometry args={[5.8, 32, 32]} />
        <meshBasicMaterial color={color} transparent opacity={0.03} />
      </mesh>
      
      {/* Equator ring */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[6, 0.03, 16, 100]} />
        <meshBasicMaterial color={color} transparent opacity={0.25} />
      </mesh>
      
      {/* Latitude rings */}
      {[-0.4, 0.4].map((tilt, i) => (
        <mesh key={i} rotation={[Math.PI / 2 + tilt, 0, 0]}>
          <torusGeometry args={[6 * Math.cos(tilt), 0.02, 16, 100]} />
          <meshBasicMaterial color={color} transparent opacity={0.15} />
        </mesh>
      ))}
      
      {/* Meridian rings */}
      {[0, Math.PI / 2].map((rot, i) => (
        <mesh key={i} rotation={[0, rot, 0]}>
          <torusGeometry args={[6, 0.02, 16, 100]} />
          <meshBasicMaterial color={color} transparent opacity={0.15} />
        </mesh>
      ))}
      
      {/* Monitoring points */}
      <points ref={pointsRef}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[pointPositions, 3]}
          />
        </bufferGeometry>
        <pointsMaterial
          size={0.12}
          color={color}
          transparent
          opacity={0.7}
          sizeAttenuation
        />
      </points>
    </group>
  );
}

// Floating HUD frame
function HUDFrame({ color }: { color: string }) {
  return (
    <group position={[0, 0, 1]}>
      {/* Corner brackets */}
      {[
        { pos: [-9, 5, 0], rot: 0 },
        { pos: [9, 5, 0], rot: Math.PI / 2 },
        { pos: [9, -5, 0], rot: Math.PI },
        { pos: [-9, -5, 0], rot: -Math.PI / 2 },
      ].map((bracket, i) => (
        <group key={i} position={bracket.pos as [number, number, number]} rotation={[0, 0, bracket.rot]}>
          <mesh position={[0.5, 0, 0]}>
            <planeGeometry args={[1, 0.02]} />
            <meshBasicMaterial color={color} transparent opacity={0.3} />
          </mesh>
          <mesh position={[0, -0.5, 0]}>
            <planeGeometry args={[0.02, 1]} />
            <meshBasicMaterial color={color} transparent opacity={0.3} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

// Center glow effect
function CenterGlow({ color }: { color: string }) {
  const glowRef = useRef<THREE.Mesh>(null);
  
  useFrame((state) => {
    if (glowRef.current) {
      const t = state.clock.getElapsedTime();
      const scale = 1 + Math.sin(t * 0.8) * 0.1;
      glowRef.current.scale.setScalar(scale);
    }
  });

  return (
    <mesh ref={glowRef} position={[0, 0, -1]}>
      <circleGeometry args={[2, 64]} />
      <meshBasicMaterial color={color} transparent opacity={0.08} />
    </mesh>
  );
}

// Floating particles that respond to mouse
function FloatingParticles({ color }: { color: string }) {
  const pointsRef = useRef<THREE.Points>(null);
  const mouseRef = useRef({ x: 0, y: 0 });
  
  const { positions, velocities } = useMemo(() => {
    const count = 50;
    const positions = new Float32Array(count * 3);
    const velocities: { x: number; y: number; z: number }[] = [];
    
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 20;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 12;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 5;
      velocities.push({
        x: (Math.random() - 0.5) * 0.002, // Much slower
        y: (Math.random() - 0.5) * 0.002, // Much slower
        z: (Math.random() - 0.5) * 0.001, // Much slower
      });
    }
    
    return { positions, velocities };
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      mouseRef.current.x = (e.clientX / window.innerWidth - 0.5) * 2;
      mouseRef.current.y = (e.clientY / window.innerHeight - 0.5) * 2;
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  useFrame(() => {
    if (!pointsRef.current) return;
    
    const pos = pointsRef.current.geometry.attributes.position;
    const array = pos.array as Float32Array;
    
    for (let i = 0; i < velocities.length; i++) {
      // Add mouse influence
      const mouseInfluence = 0.001;
      array[i * 3] += velocities[i].x + mouseRef.current.x * mouseInfluence;
      array[i * 3 + 1] += velocities[i].y - mouseRef.current.y * mouseInfluence;
      array[i * 3 + 2] += velocities[i].z;
      
      // Wrap around
      if (array[i * 3] > 10) array[i * 3] = -10;
      if (array[i * 3] < -10) array[i * 3] = 10;
      if (array[i * 3 + 1] > 6) array[i * 3 + 1] = -6;
      if (array[i * 3 + 1] < -6) array[i * 3 + 1] = 6;
    }
    
    pos.needsUpdate = true;
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positions, 3]}
        />
      </bufferGeometry>
      <pointsMaterial
        size={0.06}
        color={color}
        transparent
        opacity={0.4}
        sizeAttenuation
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

// Alert arrival indicator - glowing dot at the arrival point
function AlertArrivalIndicator({ color }: { color: string }) {
  const meshRef = useRef<THREE.Mesh>(null);
  
  useFrame((state) => {
    if (meshRef.current) {
      const t = state.clock.getElapsedTime();
      const scale = 0.8 + Math.sin(t * 3) * 0.2;
      meshRef.current.scale.setScalar(scale);
    }
  });

  return (
    <mesh ref={meshRef} position={[8.5, 4, 0]}>
      <circleGeometry args={[0.15, 16]} />
      <meshBasicMaterial color={color} transparent opacity={0.6} blending={THREE.AdditiveBlending} />
    </mesh>
  );
}

interface Background3DProps {
  color?: string;
  onAlertTrigger?: (type: string) => void;
}

// Inner component that can use Three.js hooks
function Background3DInner({ 
  color, 
  cameraPositions,
  onParticleArrive,
}: { 
  color: string;
  cameraPositions: [number, number, number][];
  onParticleArrive: (type: string) => void;
}) {
  return (
    <>
      {/* Mouse interaction controller */}
      <SceneController />
      
      <ambientLight intensity={0.1} />
      <pointLight position={[0, 0, 8]} intensity={0.2} color={color} />
      
      {/* Stars */}
      <Stars radius={60} depth={50} count={1500} factor={3} saturation={0} fade speed={0.2} />
      
      {/* Background globe - more visible */}
      <MonitoringGlobe color={color} />
      
      {/* Floating particles */}
      <FloatingParticles color={color} />
      
      {/* CCTV Cameras (Input sources) */}
      {cameraPositions.map((pos, i) => (
        <CCTVCamera key={i} position={pos} color={color} id={i} />
      ))}
      
      {/* Input data streams: Cameras → Center */}
      <InputDataStreams cameraPositions={cameraPositions} color={color} />
      
      {/* Output data streams: Center → Alert feed (top right) */}
      <OutputDataStreams onParticleArrive={onParticleArrive} />
      
      {/* Alert arrival indicator */}
      <AlertArrivalIndicator color={color} />
      
      {/* Center glow */}
      <CenterGlow color={color} />
      
      {/* HUD frame */}
      <HUDFrame color={color} />
    </>
  );
}

export function Background3D({ color = '#f97316', onAlertTrigger }: Background3DProps) {
  const [alerts, setAlerts] = useState<{ id: number; text: string; type: string; opacity: number; flash: boolean }[]>([]);
  const idRef = useRef(0);
  
  // Camera positions (input sources) - left side
  const cameraPositions: [number, number, number][] = useMemo(() => [
    [-9, 3, 0],
    [-9, 0, 0],
    [-9, -3, 0],
    [-7, 4.5, 0],
    [-7, -4.5, 0],
  ], []);

  const alertTemplates = useMemo(() => ({
    crowd: [
      'Crowd surge detected at Brigade Road',
      'High density alert: MG Road Junction',
      'Crowd dispersing at Church Street',
      'Gathering detected: Commercial Street',
      'Peak crowd: 2,847 at Central Mall',
    ],
    vehicle: [
      'Vehicle KA-01-AB-1234 on watchlist',
      'ANPR match: Stolen vehicle alert',
      'Vehicle count: 12,456 today',
      'License plate recognized: KA-05-MX-9876',
      'Fleet vehicle detected: Zone A',
    ],
    violation: [
      'Speed violation: 78km/h in 40 zone',
      'Wrong way detected: Residency Road',
      'Signal jump: Camera 12, MG Road',
      'Parking violation: No parking zone',
      'Lane violation: Unauthorized entry',
    ],
    system: [
      'Camera 15 online: Brigade Junction',
      'Processing 1,247 frames/sec',
      'Analytics sync completed',
      'Alert threshold updated',
      'System health: All nominal',
    ],
    alert: [
      'Face match: Person of interest',
      'Incident reported: Zone B',
      'Emergency response dispatched',
      'Security breach: Perimeter 3',
      'Unauthorized access attempt',
    ],
  }), []);

  // Called when a particle reaches the alert feed
  const handleParticleArrive = useCallback((type: string) => {
    const templates = alertTemplates[type as keyof typeof alertTemplates] || alertTemplates.system;
    const text = templates[Math.floor(Math.random() * templates.length)];
    
    const newAlert = {
      id: idRef.current++,
      text,
      type,
      opacity: 1,
      flash: true, // New alerts flash briefly
    };
    
    setAlerts(prev => [newAlert, ...prev].slice(0, 10));
    
    // Remove flash after animation
    setTimeout(() => {
      setAlerts(prev => prev.map(a => a.id === newAlert.id ? { ...a, flash: false } : a));
    }, 300);
    
    if (onAlertTrigger) {
      onAlertTrigger(type);
    }
  }, [alertTemplates, onAlertTrigger]);

  // Fade out alerts over time
  useEffect(() => {
    const fadeInterval = setInterval(() => {
      setAlerts(prev => 
        prev
          .map(a => ({ ...a, opacity: a.opacity - 0.015 }))
          .filter(a => a.opacity > 0)
      );
    }, 100);
    return () => clearInterval(fadeInterval);
  }, []);

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'crowd': return '#f97316';
      case 'vehicle': return '#a855f7';
      case 'violation': return '#ef4444';
      case 'alert': return '#ef4444';
      case 'system': return '#22c55e';
      default: return color;
    }
  };

  const getTypePrefix = (type: string) => {
    switch (type) {
      case 'crowd': return '[CROWD]';
      case 'vehicle': return '[ANPR]';
      case 'violation': return '[ITMS]';
      case 'alert': return '[ALERT]';
      case 'system': return '[SYS]';
      default: return '[INFO]';
    }
  };

  return (
    <div 
      style={{ 
        position: 'absolute', 
        inset: 0, 
        zIndex: 0,
      }}
    >
      <Canvas
        camera={{ position: [0, 0, 12], fov: 50 }}
        style={{ background: 'linear-gradient(180deg, #030712 0%, #0a0a15 50%, #030712 100%)' }}
        gl={{ alpha: false, antialias: true }}
      >
        <Background3DInner 
          color={color} 
          cameraPositions={cameraPositions}
          onParticleArrive={handleParticleArrive}
        />
      </Canvas>
      
      {/* HTML Labels */}
      <div style={{
        position: 'absolute',
        left: '8%',
        bottom: '12%',
        color: '#6b7280',
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '0.15em',
        pointerEvents: 'none',
      }}>
        Input Sources
      </div>
      
      {/* Matrix-style alert feed - top right */}
      <div
        style={{
          position: 'absolute',
          right: '3%',
          top: '10%',
          width: 300,
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          overflow: 'hidden',
          fontFamily: 'monospace',
          pointerEvents: 'none',
        }}
      >
        {/* Header */}
        <div 
          style={{
            fontSize: 10,
            fontWeight: 600,
            color: '#6b7280',
            letterSpacing: '0.2em',
            marginBottom: 6,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <div 
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              backgroundColor: '#22c55e',
              boxShadow: '0 0 8px #22c55e',
              animation: 'pulse 2s infinite',
            }}
          />
          Live Event Feed
        </div>
        
        {/* Alerts */}
        {alerts.map((alert) => (
          <div
            key={alert.id}
            style={{
              fontSize: 10,
              color: getTypeColor(alert.type),
              opacity: alert.opacity,
              transition: 'all 0.2s',
              textShadow: `0 0 ${alert.flash ? '20px' : '8px'} ${getTypeColor(alert.type)}${alert.flash ? '' : '50'}`,
              display: 'flex',
              gap: 6,
              lineHeight: 1.4,
              transform: alert.flash ? 'scale(1.02)' : 'scale(1)',
              backgroundColor: alert.flash ? `${getTypeColor(alert.type)}15` : 'transparent',
              padding: '2px 4px',
              borderRadius: 2,
            }}
          >
            <span style={{ color: getTypeColor(alert.type), fontWeight: 700, flexShrink: 0 }}>
              {getTypePrefix(alert.type)}
            </span>
            <span style={{ color: alert.flash ? '#ffffff' : '#9ca3af' }}>
              {alert.text}
            </span>
          </div>
        ))}
        
        {/* Scanline effect */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(transparent 50%, rgba(0,0,0,0.1) 50%)',
            backgroundSize: '100% 4px',
            pointerEvents: 'none',
            opacity: 0.2,
          }}
        />
        
        <style>{`
          @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
          }
        `}</style>
      </div>
    </div>
  );
}
