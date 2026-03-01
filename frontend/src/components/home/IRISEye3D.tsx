import { useRef, useMemo, useState, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface EyeProps {
  color: string;
  isActive: boolean;
}

function RealisticEye({ color, isActive }: EyeProps) {
  const eyeGroupRef = useRef<THREE.Group>(null);
  const irisRef = useRef<THREE.Mesh>(null);
  const pupilRef = useRef<THREE.Mesh>(null);
  const upperLidRef = useRef<THREE.Mesh>(null);
  const lowerLidRef = useRef<THREE.Mesh>(null);
  const highlightRef = useRef<THREE.Mesh>(null);
  
  const [lookTarget, setLookTarget] = useState({ x: 0, y: 0 });
  const [isBlinking, setIsBlinking] = useState(false);

  // Random micro-movements for eye direction
  useEffect(() => {
    const moveEye = () => {
      setLookTarget({
        x: (Math.random() - 0.5) * 0.3,
        y: (Math.random() - 0.5) * 0.2,
      });
    };
    
    const interval = setInterval(moveEye, 1500 + Math.random() * 2500);
    return () => clearInterval(interval);
  }, []);

  // Random blinking
  useEffect(() => {
    const blink = () => {
      setIsBlinking(true);
      setTimeout(() => setIsBlinking(false), 120 + Math.random() * 80);
    };
    
    // Initial blink
    const initialBlink = setTimeout(blink, 500);
    
    // Random blinks
    const interval = setInterval(() => {
      // Sometimes double blink
      if (Math.random() > 0.7) {
        blink();
        setTimeout(blink, 250);
      } else {
        blink();
      }
    }, 2500 + Math.random() * 3000);
    
    return () => {
      clearTimeout(initialBlink);
      clearInterval(interval);
    };
  }, []);

  useFrame((state) => {
    const t = state.clock.getElapsedTime();
    
    // Smooth eye movement
    if (irisRef.current && pupilRef.current) {
      irisRef.current.position.x += (lookTarget.x - irisRef.current.position.x) * 0.04;
      irisRef.current.position.y += (lookTarget.y - irisRef.current.position.y) * 0.04;
      
      pupilRef.current.position.x = irisRef.current.position.x;
      pupilRef.current.position.y = irisRef.current.position.y;
      
      if (highlightRef.current) {
        highlightRef.current.position.x = irisRef.current.position.x + 0.12;
        highlightRef.current.position.y = irisRef.current.position.y + 0.12;
      }
    }
    
    // Pupil dilation
    if (pupilRef.current) {
      const baseSize = isActive ? 0.34 : 0.26;
      const pulse = Math.sin(t * 1.5) * 0.015;
      pupilRef.current.scale.setScalar(baseSize + pulse);
    }
    
    // Eyelid animation - smooth blink
    if (upperLidRef.current && lowerLidRef.current) {
      const targetUpper = isBlinking ? 0.05 : 0.92;
      const targetLower = isBlinking ? -0.05 : -0.92;
      
      const blinkSpeed = isBlinking ? 0.35 : 0.15;
      upperLidRef.current.position.y += (targetUpper - upperLidRef.current.position.y) * blinkSpeed;
      lowerLidRef.current.position.y += (targetLower - lowerLidRef.current.position.y) * blinkSpeed;
    }
    
    // Subtle eye rotation
    if (eyeGroupRef.current) {
      eyeGroupRef.current.rotation.z = Math.sin(t * 0.15) * 0.01;
    }
  });

  const threeColor = useMemo(() => new THREE.Color(color), [color]);
  const darkerColor = useMemo(() => new THREE.Color(color).multiplyScalar(0.5), [color]);

  return (
    <group ref={eyeGroupRef}>
      {/* Outer glow */}
      <mesh position={[0, 0, -0.3]}>
        <circleGeometry args={[1.5, 64]} />
        <meshBasicMaterial color={threeColor} transparent opacity={0.1} />
      </mesh>

      {/* Sclera (white of eye) */}
      <mesh position={[0, 0, 0]}>
        <circleGeometry args={[1, 64]} />
        <meshBasicMaterial color="#f0f0f0" />
      </mesh>

      {/* Eye shadow/socket ring */}
      <mesh position={[0, 0, 0.01]}>
        <ringGeometry args={[0.85, 1.1, 64]} />
        <meshBasicMaterial color="#1a1a2e" transparent opacity={0.5} />
      </mesh>

      {/* Blood vessels hint */}
      <mesh position={[0, 0, 0.005]}>
        <ringGeometry args={[0.75, 0.95, 64]} />
        <meshBasicMaterial color="#ffcccc" transparent opacity={0.15} />
      </mesh>

      {/* Iris base */}
      <mesh ref={irisRef} position={[0, 0, 0.02]}>
        <circleGeometry args={[0.52, 64]} />
        <meshBasicMaterial color={threeColor} />
      </mesh>

      {/* Iris detail rings */}
      {[0.15, 0.28, 0.38, 0.48].map((radius, i) => (
        <mesh key={`iris-ring-${i}`} position={[0, 0, 0.025 + i * 0.002]}>
          <ringGeometry args={[radius - 0.012, radius, 64]} />
          <meshBasicMaterial color={i % 2 === 0 ? darkerColor : threeColor} transparent opacity={0.45} />
        </mesh>
      ))}

      {/* Iris radial lines */}
      {Array.from({ length: 16 }).map((_, i) => {
        const angle = (i / 16) * Math.PI * 2;
        return (
          <mesh 
            key={`radial-${i}`}
            position={[Math.cos(angle) * 0.32, Math.sin(angle) * 0.32, 0.03]}
            rotation={[0, 0, angle]}
          >
            <planeGeometry args={[0.015, 0.2]} />
            <meshBasicMaterial color={darkerColor} transparent opacity={0.25} />
          </mesh>
        );
      })}

      {/* Pupil */}
      <mesh ref={pupilRef} position={[0, 0, 0.04]}>
        <circleGeometry args={[1, 64]} />
        <meshBasicMaterial color="#000000" />
      </mesh>

      {/* Pupil depth */}
      <mesh position={[0, 0, 0.035]}>
        <circleGeometry args={[0.18, 64]} />
        <meshBasicMaterial color="#050505" />
      </mesh>

      {/* Main highlight */}
      <mesh ref={highlightRef} position={[0.12, 0.12, 0.05]}>
        <circleGeometry args={[0.09, 32]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.9} />
      </mesh>

      {/* Secondary highlight */}
      <mesh position={[-0.06, -0.1, 0.05]}>
        <circleGeometry args={[0.035, 32]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.45} />
      </mesh>

      {/* Upper eyelid */}
      <mesh ref={upperLidRef} position={[0, 0.92, 0.06]}>
        <planeGeometry args={[2.5, 1.2]} />
        <meshBasicMaterial color="#050505" />
      </mesh>
      
      {/* Upper eyelid crease shadow */}
      <mesh position={[0, 1.1, 0.055]}>
        <planeGeometry args={[2.2, 0.15]} />
        <meshBasicMaterial color="#151520" transparent opacity={0.6} />
      </mesh>

      {/* Lower eyelid */}
      <mesh ref={lowerLidRef} position={[0, -0.92, 0.06]}>
        <planeGeometry args={[2.5, 1.2]} />
        <meshBasicMaterial color="#050505" />
      </mesh>

      {/* Eye rim / lash line */}
      <mesh position={[0, 0, 0.058]}>
        <ringGeometry args={[0.92, 1.02, 64]} />
        <meshBasicMaterial color="#101018" />
      </mesh>

      {/* Inner iris glow */}
      <mesh position={[0, 0, 0.038]}>
        <ringGeometry args={[0.2, 0.24, 64]} />
        <meshBasicMaterial color={threeColor} transparent opacity={0.6} />
      </mesh>
    </group>
  );
}

// Data particles flowing into eye
function DataParticles({ color }: { color: string }) {
  const particlesRef = useRef<THREE.Points>(null);
  const particleCount = 25;
  
  const [positions, velocities, speeds] = useMemo(() => {
    const pos = new Float32Array(particleCount * 3);
    const vel = new Float32Array(particleCount * 3);
    const spd = new Float32Array(particleCount);
    
    for (let i = 0; i < particleCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 1.6 + Math.random() * 0.5;
      pos[i * 3] = Math.cos(angle) * radius;
      pos[i * 3 + 1] = Math.sin(angle) * radius;
      pos[i * 3 + 2] = 0;
      
      // Very slow particle speeds
      spd[i] = 0.0008 + Math.random() * 0.0012;
      vel[i * 3] = -pos[i * 3] * spd[i];
      vel[i * 3 + 1] = -pos[i * 3 + 1] * spd[i];
      vel[i * 3 + 2] = 0;
    }
    return [pos, vel, spd];
  }, []);

  useFrame(() => {
    if (!particlesRef.current) return;
    
    const posArray = particlesRef.current.geometry.attributes.position.array as Float32Array;
    
    for (let i = 0; i < particleCount; i++) {
      posArray[i * 3] += velocities[i * 3];
      posArray[i * 3 + 1] += velocities[i * 3 + 1];
      
      const dist = Math.sqrt(posArray[i * 3] ** 2 + posArray[i * 3 + 1] ** 2);
      if (dist < 0.15) {
        const angle = Math.random() * Math.PI * 2;
        const radius = 1.6 + Math.random() * 0.5;
        posArray[i * 3] = Math.cos(angle) * radius;
        posArray[i * 3 + 1] = Math.sin(angle) * radius;
        // New very slow random speed
        speeds[i] = 0.0008 + Math.random() * 0.0012;
        velocities[i * 3] = -posArray[i * 3] * speeds[i];
        velocities[i * 3 + 1] = -posArray[i * 3 + 1] * speeds[i];
      }
    }
    
    particlesRef.current.geometry.attributes.position.needsUpdate = true;
  });

  return (
    <points ref={particlesRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positions, 3]}
        />
      </bufferGeometry>
      <pointsMaterial
        size={0.04}
        color={color}
        transparent
        opacity={0.65}
        sizeAttenuation
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

// Scanning ring
function ScanningRing({ color }: { color: string }) {
  const ringRef = useRef<THREE.Mesh>(null);
  
  useFrame((state) => {
    if (ringRef.current) {
      const t = state.clock.getElapsedTime();
      const cycle = (t * 0.4) % 1;
      const scale = 1 + cycle * 0.5;
      ringRef.current.scale.setScalar(scale);
      (ringRef.current.material as THREE.MeshBasicMaterial).opacity = (1 - cycle) * 0.25;
    }
  });

  return (
    <mesh ref={ringRef} position={[0, 0, -0.15]}>
      <ringGeometry args={[1.2, 1.25, 64]} />
      <meshBasicMaterial color={color} transparent opacity={0.25} />
    </mesh>
  );
}

interface IRISEye3DProps {
  color?: string;
  isActive?: boolean;
  size?: number;
}

export function IRISEye3D({ color = '#f97316', isActive = false, size = 160 }: IRISEye3DProps) {
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', overflow: 'hidden' }}>
      <Canvas
        camera={{ position: [0, 0, 2.8], fov: 45 }}
        style={{ background: 'transparent' }}
        gl={{ alpha: true, antialias: true }}
      >
        <ambientLight intensity={0.5} />
        <pointLight position={[2, 2, 4]} intensity={0.9} color="#ffffff" />
        <pointLight position={[-1, -1, 2]} intensity={0.3} color={color} />
        
        <RealisticEye color={color} isActive={isActive} />
        <DataParticles color={color} />
        <ScanningRing color={color} />
      </Canvas>
    </div>
  );
}
