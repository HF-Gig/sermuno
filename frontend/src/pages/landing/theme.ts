/**
 * Landing Page Theme & Design Tokens
 * All colors, fonts, and animations are defined here
 * This ensures the landing page is completely self-contained
 */

export const COLORS = {
  mint: '#ffffff',
  sage: '#8EB69B',
  forest: '#235347',
  deep: '#163832',
  darker: '#0B2B26',
  void: '#051F20',
} as const;

export const FONTS = {
  sans: "'Inter', sans-serif",
  mono: "'JetBrains Mono', monospace",
} as const;

export const MOTION = {
  easeOut: 'cubic-bezier(0.16, 1, 0.3, 1)',
  easeIn: 'cubic-bezier(0.7, 0, 1, 1)',
  easeStd: 'cubic-bezier(0.4, 0, 0.2, 1)',
  durMicro: '120ms',
  durElem: '280ms',
  durSection: '500ms',
} as const;

export const BREAKPOINTS = {
  mobile: '480px',
  tablet: '768px',
  desktop: '1024px',
  wide: '1440px',
} as const;
