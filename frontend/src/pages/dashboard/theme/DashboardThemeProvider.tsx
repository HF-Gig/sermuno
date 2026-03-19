/**
 * Dashboard Theme Provider
 * Provides theme tokens ONLY to dashboard pages
 * Does NOT affect auth or landing pages
 */

import React, { createContext, useContext } from 'react';
import { DashboardTokens, DashboardThemeTokens } from './tokens';

interface DashboardThemeContextType {
  tokens: DashboardThemeTokens;
}

const DashboardThemeContext = createContext<DashboardThemeContextType | undefined>(undefined);

interface DashboardThemeProviderProps {
  children: React.ReactNode;
}

export const DashboardThemeProvider: React.FC<DashboardThemeProviderProps> = ({ children }) => {
  return (
    <DashboardThemeContext.Provider value={{ tokens: DashboardTokens }}>
      {children}
    </DashboardThemeContext.Provider>
  );
};

/**
 * Hook to access dashboard theme tokens
 * Use sparingly - prefer CSS class approach or Tailwind for styling
 */
export const useDashboardTheme = (): DashboardThemeContextType => {
  const context = useContext(DashboardThemeContext);
  if (!context) {
    throw new Error('useDashboardTheme must be used within DashboardThemeProvider');
  }
  return context;
};
