import { memo } from 'react';

interface MapBackgroundProps {
  color?: string;
  lite?: boolean;
}

export const MapBackground = memo(function MapBackground({ color = '#00F0FF', lite = false }: MapBackgroundProps) {
  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 0, overflow: 'hidden' }}>
      {/* Static map-style background (local asset, no Google Maps) */}
      <img
        alt="Static tactical map background"
        src="/simple-map-bg.svg?v=4"
        style={{
          position: 'absolute',
          inset: '-1%',
          width: '102%',
          height: '102%',
          objectFit: 'cover',
          pointerEvents: 'none',
          opacity: 0.95,
          filter: 'grayscale(0.22) contrast(1.06) brightness(0.8) saturate(0.85)',
          transform: lite ? 'none' : 'scale(1.01)',
        }}
      />

      {/* Balanced blue tone wash */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          background:
            `radial-gradient(120% 90% at 50% 45%, rgba(6, 18, 32, 0.22) 0%, rgba(4, 14, 26, 0.44) 50%, rgba(2, 7, 13, 0.7) 100%),
             linear-gradient(180deg, rgba(0, 10, 20, 0.24) 0%, rgba(0, 10, 20, 0.06) 45%, rgba(0, 10, 20, 0.34) 100%)`,
        }}
      />

      {/* Subtle scanlines only */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          background:
            'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0, 240, 255, 0.01) 2px, rgba(0, 240, 255, 0.01) 4px)',
          opacity: 0.6,
        }}
      />

      {/* Soft vignette for panel focus */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          background:
            'radial-gradient(ellipse 76% 64% at 50% 52%, transparent 34%, rgba(2, 6, 11, 0.76) 100%)',
          boxShadow: `inset 0 0 140px ${color}14`,
        }}
      />
    </div>
  );
});
