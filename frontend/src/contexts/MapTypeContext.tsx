import { createContext, useContext, useState, type ReactNode } from 'react';

interface MapTypeContextType {
  mapType: 'satellite' | 'roadmap';
  setMapType: (type: 'satellite' | 'roadmap') => void;
  toggleMapType: () => void;
}

const MapTypeContext = createContext<MapTypeContextType | undefined>(undefined);

export function MapTypeProvider({ children }: { children: ReactNode }) {
  const [mapType, setMapType] = useState<'satellite' | 'roadmap'>('satellite'); // Default to satellite

  const toggleMapType = () => {
    setMapType((prev) => (prev === 'satellite' ? 'roadmap' : 'satellite'));
  };

  return (
    <MapTypeContext.Provider
      value={{
        mapType,
        setMapType,
        toggleMapType,
      }}
    >
      {children}
    </MapTypeContext.Provider>
  );
}

export function useMapType() {
  const context = useContext(MapTypeContext);
  if (context === undefined) {
    throw new Error('useMapType must be used within a MapTypeProvider');
  }
  return context;
}

