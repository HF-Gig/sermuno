/**
 * Dashboard Layout Wrapper
 * - Applies .dashboard-root class to scope all theme styles
 * - Wraps dashboard pages with DashboardThemeProvider
 * - Provides consistent layout structure for all dashboard pages
 */

import React from 'react';
import { DashboardThemeProvider } from './theme/DashboardThemeProvider';
import './theme/dashboard.css';

interface DashboardLayoutProps {
  children: React.ReactNode;
}

export const DashboardLayout: React.FC<DashboardLayoutProps> = ({ children }) => {
  return (
    <DashboardThemeProvider>
      <div className="dashboard-root h-full w-full">
        {children}
      </div>
    </DashboardThemeProvider>
  );
};

export default DashboardLayout;
