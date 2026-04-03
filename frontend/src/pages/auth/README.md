# Auth Module - Self-Contained Design System

## Overview

The auth module is now a completely **self-contained design system**. All authentication pages, components, styling, and design tokens are isolated within this folder. **No global styles or components affect auth pages**, and auth doesn't depend on anything outside the essential external libraries.

## Folder Structure

```
auth/
├── index.ts                     # Main export file & theme
├── theme.ts                     # Colors, fonts, motion, sizes, shadows
├── styles.css                   # All auth-specific CSS (400+ lines)
├── AuthLayout.tsx               # Main auth layout wrapper
├── AuthLanguageToggle.tsx       # Language switcher
├── authCodeSession.ts           # MFA session management
├── Login.tsx                    # Login page
├── Register.tsx                 # Signup page
├── ForgotPassword.tsx           # Password reset request
├── ResetPassword.tsx            # Password reset form
├── VerifyEmail.tsx              # Email verification
├── AuthCodePage.tsx             # MFA code entry
├── AcceptInvite.tsx             # Team invite acceptance
└── components/
    ├── index.ts                 # Local component exports
    ├── utils.tsx                # FloatingPaths, AuthSeparator, icons
    └── InviteMfaSetupStep.tsx   # MFA setup component
```

## Design Tokens (theme.ts)

All design system values are defined in `theme.ts`, exported as constants:

### `AUTH_COLORS`
- Brand colors: darker, deep, forest, sage, mint
- Light mode: white, lightGray
- Neutrals: gray50, gray100, ... gray900
- Text: textDark, textMain
- Status: errorLight, errorBorder, errorText, successBg

### `AUTH_FONTS`
- sans: 'Inter', sans-serif
- mono: 'JetBrains Mono', monospace

### `AUTH_MOTION`
- Easing: easeOut, easeIn, easeStd
- Durations: durMicro, durElem, durSection

### `AUTH_SIZES`
- inputHeight, inputRadius, buttonHeight, buttonRadius, cardRadius

### `AUTH_SHADOWS`
- sm, md, lg - predefined box shadows

## Styling (styles.css)

All auth styling is contained in a single `styles.css` file with clear sections:

```
:root 
├── Colors (--auth-*)
├── Fonts (--auth-font-*)
├── Sizes (--auth-*-*)
├── Shadows (--auth-shadow-*)
└── Motion (--auth-ease-*, --auth-dur-*)

Components
├── AUTH FORM ELEMENTS (.auth-input, .auth-input-icon, etc)
├── AUTH BUTTONS (.auth-button-primary, .auth-button-oauth)
├── AUTH ALERTS (.auth-alert-error, .auth-alert-success)
├── AUTH SEPARATORS (.auth-separator)
├── AUTH FORM LAYOUT (.auth-form-*, .auth-form-heading, etc)
├── AUTH HELPER TEXT (.auth-helper-text)
└── RESPONSIVE
```

## Key Features

✅ **Self-Contained**: All auth design & logic in one folder
✅ **No Global Dependencies**: Doesn't import from global UI components
✅ **Centralized Theme**: Single source of truth for colors & design
✅ **CSS Classes**: Reusable `.auth-button-primary`, `.auth-input`, etc.
✅ **TypeScript**: Type-safe color and token usage
✅ **Flexible**: External dependencies are only auth-specific (auth context, mock store, etc.)

## Usage in Components

### Import Theme

```tsx
import { AUTH_COLORS, AUTH_FONTS, AUTH_MOTION, AUTH_SIZES } from '../theme';
import '../styles.css';

// Use in JSX:
<button 
  style={{ 
    backgroundColor: AUTH_COLORS.darker,
    fontFamily: AUTH_FONTS.sans
  }}
/>
```

### Utility Components

```tsx
import { FloatingPaths, AuthSeparator, GoogleIcon, MicrosoftIcon } from '../components/utils';

// FloatingPaths - animated background
<FloatingPaths position={1} />

// AuthSeparator - OR divider
<AuthSeparator label="OR" />

// Icons
<GoogleIcon className="size-5" />
<MicrosoftIcon className="size-5" />
```

### CSS Classes

```tsx
// Buttons
<button className="auth-button-primary">Sign In</button>
<button className="auth-button-oauth">Continue with Google</button>

// Inputs
<input className="auth-input auth-input-with-left-icon" />

// Alerts
<div className="auth-alert-error">
  <p className="auth-alert-error-text">Error message</p>
</div>

// Form
<h1 className="auth-form-title">Login</h1>
<p className="auth-form-subtitle">Create or sign in to your account</p>
</div>
```

## Module Independence

Each auth page:

- ✅ Imports only from local auth folder
- ✅ Imports from external auth libraries (react-hook-form, framer-motion, lucide-react)
- ✅ Imports from necessary external dependencies (AuthContext, mockAuthStore, API lib)
- ✅ Uses local theme & styles
- ❌ Does NOT import from global UI components
- ❌ Does NOT use global tailwind colors
- ❌ Does NOT depend on app-wide styles

## External Dependencies (Required)

These are necessary and appropriate to keep external:

- **react-hook-form**: Form state management
- **framer-motion**: Animations (FloatingPaths)
- **lucide-react**: Icons
- **react-router-dom**: Navigation
- **react-i18next**: Translations
- **AuthContext** (`src/context`): Auth state management
- **mockAuthStore** (`src/lib`): Mock credentials for testing
- **API functions** (`src/lib/api`): Real API integration

## CSS Custom Properties

All colors and sizing are exposed as CSS variables for consistency:

```css
:root {
  --auth-darker: #0B2B26;
  --auth-deep: #163832;
  --auth-gray-300: #D1D5DB;
  /* ... etc */
}
```

This allows dynamic theming without touching component code.

## Adding New Auth Pages

1. Create new file in `auth/` folder (e.g., `TwoFactorSetup.tsx`)
2. Import theme and styles:
   ```tsx
   import { AUTH_COLORS, AUTH_FONTS } from './theme';
   import './styles.css';
   ```
3. Use `AuthLayout` wrapper:
   ```tsx
   <AuthLayout>
     {/* Your form here */}
   </AuthLayout>
   ```
4. Add new export to `auth/index.ts`

## Modifying Theme

Update `theme.ts` to change:
- Colors (AUTH_COLORS)
- Fonts (AUTH_FONTS)
- Motion & durations (AUTH_MOTION)
- Sizes (AUTH_SIZES)
- Shadows (AUTH_SHADOWS)

Changes automatically propagate to all pages.

## CSS Customization

Modify `styles.css` to:
- Update component styles (buttons, inputs, etc.)
- Add new utility classes
- Adjust responsive breakpoints
- Change animations

All color values use CSS variables (`var(--auth-*)`) for easy updates.

## Performance Benefits

- 🚀 Can be **lazy-loaded** as a separate bundle
- 🚀 Tree-shakeable: unused components removed in production
- 🚀 Isolated: changes to auth don't affect other pages
- 🚀 Maintainable: all auth code in one logical place

## Route Configuration

When importing auth pages in your router:

```tsx
import { Login, Register, ForgotPassword } from '@/pages/auth';

// or
import { Login } from '@/pages/auth/Login';
```

All imports are available from the `auth/index.ts` barrel export.
