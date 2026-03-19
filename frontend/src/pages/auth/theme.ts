/**
 * Auth Theme & Design Tokens
 * All colors, fonts, and styling for auth pages
 * Self-contained and independent from global styles
 */

export const AUTH_COLORS = {
  // Dark brand colors
  darker: '#0B2B26',
  deep: '#163832',
  forest: '#235347',
  sage: '#8EB69B',
  mint: '#ffffff',

  // Light mode colors
  white: '#FFFFFF',
  lightGray: '#F3F4F6',
  lightGrayBg: '#FAFAFA',

  // Neutral grays
  gray50: '#F9FAFB',
  gray100: '#F3F4F6',
  gray200: '#E5E7EB',
  gray300: '#D1D5DB',
  gray400: '#9CA3AF',
  gray500: '#6B7280',
  gray600: '#4B5563',
  gray700: '#374151',
  gray800: '#1F2937',
  gray900: '#111827',
  
  // Text
  textDark: '#051F20',
  textDarker: '#0B2B26',
  textMain: '#0F172A',
  
  // Status
  errorLight: '#FEF2F2',
  errorBorder: '#FECACA',
  errorText: '#991B1B',
  successBg: '#235347',
  
  // Semantic
  hoverDark: 'rgba(11, 43, 38, 0.05)',
} as const;

export const AUTH_FONTS = {
  sans: "'Inter', sans-serif",
  mono: "'JetBrains Mono', monospace",
} as const;

export const AUTH_MOTION = {
  easeOut: 'cubic-bezier(0.16, 1, 0.3, 1)',
  easeIn: 'cubic-bezier(0.7, 0, 1, 1)',
  easeStd: 'cubic-bezier(0.4, 0, 0.2, 1)',
  durMicro: '120ms',
  durElem: '280ms',
  durSection: '500ms',
} as const;

export const AUTH_SIZES = {
  inputHeight: '48px',
  inputRadius: '12px',
  buttonHeight: '48px',
  buttonRadius: '12px',
  cardRadius: '16px',
} as const;

export const AUTH_SHADOWS = {
  sm: '0 2px 4px rgba(0, 0, 0, 0.08)',
  md: '0 6px 20px rgba(11, 43, 38, 0.18)',
  lg: '0 12px 40px rgba(0, 0, 0, 0.15)',
} as const;
