import { createContext, useContext, useState, type ReactNode } from 'react';

interface LayerVisibilityContextType {
  showCameras: boolean;
  showHotspots: boolean;
  showTraffic: boolean;
  toggleCameras: () => void;
  toggleHotspots: () => void;
  toggleTraffic: () => void;
}

const LayerVisibilityContext = createContext<LayerVisibilityContextType | undefined>(undefined);

export function LayerVisibilityProvider({ children }: { children: ReactNode }) {
  const [showCameras, setShowCameras] = useState(true);
  const [showHotspots, setShowHotspots] = useState(true);
  const [showTraffic, setShowTraffic] = useState(false);

  const toggleCameras = () => {
    setShowCameras((prev) => !prev);
  };

  const toggleHotspots = () => {
    setShowHotspots((prev) => !prev);
  };

  const toggleTraffic = () => {
    setShowTraffic((prev) => !prev);
  };

  return (
    <LayerVisibilityContext.Provider
      value={{
        showCameras,
        showHotspots,
        showTraffic,
        toggleCameras,
        toggleHotspots,
        toggleTraffic,
      }}
    >
      {children}
    </LayerVisibilityContext.Provider>
  );
}

export function useLayerVisibility() {
  const context = useContext(LayerVisibilityContext);
  if (context === undefined) {
    throw new Error('useLayerVisibility must be used within a LayerVisibilityProvider');
  }
  return context;
}

