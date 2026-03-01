import { createContext, useContext, useState, type ReactNode } from 'react';
import type { DeviceType } from '@/lib/api';

interface DeviceFilterContextType {
  selectedTypes: DeviceType[];
  toggleType: (type: DeviceType) => void;
  isTypeSelected: (type: DeviceType) => boolean;
  selectAll: () => void;
  deselectAll: () => void;
}

const DeviceFilterContext = createContext<DeviceFilterContextType | undefined>(undefined);

export function DeviceFilterProvider({ children }: { children: ReactNode }) {
  const [selectedTypes, setSelectedTypes] = useState<DeviceType[]>(['CAMERA', 'DRONE', 'SENSOR']);

  const toggleType = (type: DeviceType) => {
    setSelectedTypes((prev) =>
      prev.includes(type)
        ? prev.filter((t) => t !== type)
        : [...prev, type]
    );
  };

  const isTypeSelected = (type: DeviceType) => {
    return selectedTypes.includes(type);
  };

  const selectAll = () => {
    setSelectedTypes(['CAMERA', 'DRONE', 'SENSOR']);
  };

  const deselectAll = () => {
    setSelectedTypes([]);
  };

  return (
    <DeviceFilterContext.Provider
      value={{
        selectedTypes,
        toggleType,
        isTypeSelected,
        selectAll,
        deselectAll,
      }}
    >
      {children}
    </DeviceFilterContext.Provider>
  );
}

export function useDeviceFilter() {
  const context = useContext(DeviceFilterContext);
  if (context === undefined) {
    throw new Error('useDeviceFilter must be used within a DeviceFilterProvider');
  }
  return context;
}

