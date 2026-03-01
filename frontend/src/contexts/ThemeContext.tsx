import { createContext, useContext, useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Read from localStorage on init, default to 'dark'
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem('iris_theme');
    return (saved === 'light' || saved === 'dark') ? saved : 'dark';
  });

  useEffect(() => {
    // Apply theme class to document root
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(theme);

    // Save to localStorage for persistence
    localStorage.setItem('iris_theme', theme);

    // Force theme variables via JS to bypass Tailwind v4 config issues
    if (theme === 'dark') {
      root.style.setProperty('--background', '#07090d');
      root.style.setProperty('--foreground', '#fafafa');
      root.style.setProperty('--card', '#11151c');
      root.style.setProperty('--card-foreground', '#fafafa');
      root.style.setProperty('--popover', '#11151c');
      root.style.setProperty('--popover-foreground', '#fafafa');
      root.style.setProperty('--primary', '#22d3ee');
      root.style.setProperty('--primary-foreground', '#041016');
      root.style.setProperty('--secondary', 'rgba(255, 255, 255, 0.08)');
      root.style.setProperty('--secondary-foreground', '#d4d4d8');
      root.style.setProperty('--muted', 'rgba(255, 255, 255, 0.09)');
      root.style.setProperty('--muted-foreground', '#b5bbc6');
      root.style.setProperty('--accent', 'rgba(34, 211, 238, 0.12)');
      root.style.setProperty('--accent-foreground', '#fafafa');
      root.style.setProperty('--border', 'rgba(255, 255, 255, 0.14)');
      root.style.setProperty('--input', 'rgba(255, 255, 255, 0.16)');
      root.style.setProperty('--ring', '#22d3ee');
      root.style.setProperty('--sidebar', '#0b0f14');
      root.style.setProperty('--sidebar-foreground', '#f3f6fb');
      root.style.setProperty('--sidebar-primary', '#22d3ee');
      root.style.setProperty('--sidebar-primary-foreground', '#041016');
      root.style.setProperty('--sidebar-accent', 'rgba(34, 211, 238, 0.12)');
      root.style.setProperty('--sidebar-accent-foreground', '#e6faff');
      root.style.setProperty('--sidebar-border', 'rgba(255, 255, 255, 0.14)');
      root.style.setProperty('--sidebar-ring', '#22d3ee');
    } else {
      root.style.setProperty('--background', '#f6f8fb');
      root.style.setProperty('--foreground', '#0b1220');
      root.style.setProperty('--card', '#fbfdff');
      root.style.setProperty('--card-foreground', '#0b1220');
      root.style.setProperty('--popover', '#ffffff');
      root.style.setProperty('--popover-foreground', '#0b1220');
      root.style.setProperty('--primary', '#0f766e');
      root.style.setProperty('--primary-foreground', '#ffffff');
      root.style.setProperty('--secondary', '#eef2f6');
      root.style.setProperty('--secondary-foreground', '#111827');
      root.style.setProperty('--muted', '#e9edf4');
      root.style.setProperty('--muted-foreground', '#4b5563');
      root.style.setProperty('--accent', '#e6edf7');
      root.style.setProperty('--accent-foreground', '#0f172a');
      root.style.setProperty('--border', '#cdd6e1');
      root.style.setProperty('--input', '#cdd6e1');
      root.style.setProperty('--ring', '#0f766e');
      root.style.setProperty('--sidebar', '#f7f9fc');
      root.style.setProperty('--sidebar-foreground', '#0b1220');
      root.style.setProperty('--sidebar-primary', '#0f766e');
      root.style.setProperty('--sidebar-primary-foreground', '#ffffff');
      root.style.setProperty('--sidebar-accent', '#e9edf4');
      root.style.setProperty('--sidebar-accent-foreground', '#0f172a');
      root.style.setProperty('--sidebar-border', '#cdd6e1');
      root.style.setProperty('--sidebar-ring', '#0f766e');
    }
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
