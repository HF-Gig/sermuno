/**
 * Dashboard Theme Tokens
 * SCOPED to dashboard area only - does NOT affect auth or landing pages
 * All values are provided via Context, not globals
 */

export const DashboardTokens = {
  /* ---- Primary Colors (Sermuno Design System) ---- */
  colors: {
    primary: '#163832',
    secondary: '#235347',
    accent: '#8EB69B',
    background: '#ffffff',
    surface: '#8EB69B',
    textPrimary: '#051F20',
    textMuted: '#0B2B26',
    border: '#235347',
    ctaPrimary: '#163832',
    ctaSecondary: '#235347',

    /* Sidebar specific */
    sidebarBg: '#163832',
    sidebarHover: '#235347',
    sidebarText: '#FFFFFF',
    sidebarTextMuted: '#8EB69B',
    sidebarActiveBg: '#235347',

    /* Header specific */
    headerBg: '#ffffff',
    headerBorder: '#235347',

    /* Cards & Surfaces */
    cardBg: '#ffffff',
    cardBorder: '#23534733',
    contentBg: '#ffffff',
    tableHover: '#ffffff',

    /* Input & Form */
    inputBorder: '#8EB69B',
    inputFocus: '#235347',

    /* Badges */
    badgeSuccessBg: '#ffffff',
    badgeSuccessText: '#163832',
  },

  /* ---- Typography ---- */
  typography: {
    fontHeadline: "'Inter', system-ui, -apple-system, sans-serif",
    fontBody: "'Inter', system-ui, sans-serif",
    fontMono: "'JetBrains Mono', monospace",
    
    fontWeights: {
      regular: 400,
      medium: 500,
      semibold: 600,
      bold: 700,
    },

    fontSizes: {
      xs: '0.75rem',    // 12px
      sm: '0.875rem',   // 14px
      base: '1rem',     // 16px
      lg: '1.125rem',   // 18px
      xl: '1.25rem',    // 20px
      '2xl': '1.5rem',  // 24px
      '3xl': '1.875rem', // 30px
    },

    lineHeights: {
      tight: 1.2,
      normal: 1.5,
      relaxed: 1.75,
    },
  },

  /* ---- Spacing Scale ---- */
  spacing: {
    1: '0.25rem',   // 4px
    2: '0.5rem',    // 8px
    3: '0.75rem',   // 12px
    4: '1rem',      // 16px
    5: '1.5rem',    // 24px
    6: '2rem',      // 32px
    8: '3rem',      // 48px
    10: '4rem',     // 64px
    12: '6rem',     // 96px
  },

  /* ---- Border Radius ---- */
  radius: {
    sm: '4px',
    md: '6px',
    lg: '8px',
    xl: '12px',
    full: '9999px',
  },

  /* ---- Shadows ---- */
  shadows: {
    sm: '0 1px 2px rgba(5, 31, 32, 0.04)',
    md: '0 1px 3px rgba(5, 31, 32, 0.06), 0 1px 2px rgba(5, 31, 32, 0.04)',
    lg: '0 4px 6px -1px rgba(5, 31, 32, 0.06), 0 2px 4px -1px rgba(5, 31, 32, 0.04)',
  },

  /* ---- Layout ---- */
  layout: {
    headerHeight: '64px',
    sidebarWidth: '260px',
    sidebarCollapsedWidth: '64px',
    maxContentWidth: '1400px',
  },
};

export type DashboardThemeTokens = typeof DashboardTokens;
