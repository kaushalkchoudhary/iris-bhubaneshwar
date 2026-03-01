import { createContext, useContext, useState, type ReactNode } from 'react';

interface CrowdDashboardContextType {
  autoRefresh: boolean;
  setAutoRefresh: (value: boolean) => void;
}

const CrowdDashboardContext = createContext<CrowdDashboardContextType | undefined>(undefined);

export function CrowdDashboardProvider({ children }: { children: ReactNode }) {
  const [autoRefresh, setAutoRefresh] = useState(true);

  return (
    <CrowdDashboardContext.Provider value={{ autoRefresh, setAutoRefresh }}>
      {children}
    </CrowdDashboardContext.Provider>
  );
}

export function useCrowdDashboard() {
  const context = useContext(CrowdDashboardContext);
  if (context === undefined) {
    throw new Error('useCrowdDashboard must be used within a CrowdDashboardProvider');
  }
  return context;
}

