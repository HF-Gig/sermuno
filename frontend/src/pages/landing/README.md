# Landing Page - Self-Contained Module

## Overview

The landing page is now a completely self-contained module. All components, styling, theming, and design tokens are isolated within this folder. **No global styles or components affect the landing page**, and the landing page doesn't depend on anything outside its folder.

## Folder Structure

```
landing/
├── index.ts                 # Main export file
├── theme.ts                 # Colors, fonts, motion, breakpoints
├── styles.css               # All landing-specific styles (1850+ lines)
├── LandingPage.tsx          # Main landing page component
└── components/
    ├── index.ts             # Local component exports
    ├── Navigation.tsx
    ├── HeroSection.tsx
    ├── ProblemSection.tsx
    ├── FeaturesSection.tsx
    ├── IntegrationsSection.tsx
    ├── PricingSection.tsx
    ├── FAQSection.tsx
    ├── CTASection.tsx
    ├── Footer.tsx
    ├── Modals.tsx
    ├── SocialProofSection.tsx
    └── SpiralBackground.tsx  # LOCAL copy (not dependent on global UI components)
```

## Design Tokens (theme.ts)

All design system values are defined in `theme.ts`:

- **Colors**: mint, sage, forest, deep, darker, void
- **Fonts**: sans, mono
- **Motion**: easeOut, easeIn, easeStd, durations
- **Breakpoints**: mobile, tablet, desktop, wide

```tsx
// Usage in components:
import { COLORS, FONTS, MOTION } from '../theme';

const myStyle = {
  background: COLORS.void,
  fontFamily: FONTS.sans,
  transition: `all ${MOTION.durElem} ${MOTION.easeOut}`
};
```

## Styling (styles.css)

The entire landing page styling is contained in `styles.css`:

- **Global Reset & Variables**: CSS custom properties (--c-*, --font-*, --ease-*, --dur-*)
- **Navigation**: Fixed nav with scroll detection
- **Hero Section**: Full-height hero with parallax and animations
- **Feature Sections**: Problem, Features, Integrations, Pricing, FAQ, CTA
- **Footer**: Multi-column footer layout
- **Modals**: Modal styling for legal docs and other modals
- **Animations**: Scroll reveal, parallax effects, transitions

### CSS Organization

The CSS file is organized with clear section comments:

```css
/* NAVIGATION */
/* HERO SECTION */
/* INTEGRATIONS SECTION */
/* PRICING SECTION */
/* SOCIAL PROOF SECTION */
/* PROBLEM SECTION */
/* FEATURES SECTION */
/* FAQ SECTION */
/* FINAL CTA SECTION */
/* FOOTER */
/* MODALS */
```

## Component Independence

Each component:

- ✅ Only imports from React, react-router-dom, lucide-react (external libs)
- ✅ Only imports from local landing components (`./Navigation`, `./SpiralBackground`)
- ✅ Only imports from local theme file (`../theme`)
- ❌ Does NOT import from global UI components
- ❌ Does NOT import from global styles
- ❌ Does NOT depend on tailwind or other global CSS frameworks

### SpiralBackground

The `SpiralBackground.tsx` component is a **local copy** of the global UI component. This ensures:

- Landing page doesn't break if the global component changes
- Landing page doesn't need to import from outside its module
- Complete visual control over the spiral visual

## How to Use

### Import the Landing Page

```tsx
// In App.tsx or router config
import { LandingPage } from '@/pages/landing';

// Or with destructuring
import { LandingPage, COLORS } from '@/pages/landing';
```

### Modify Landing Page Styling

1. **Theme colors**: Edit `theme.ts`
2. **Global styles**: Edit `styles.css`
3. **Component-specific styles**: Add inline styles or scoped CSS classes in component files

### Add New Components

1. Create new file in `components/` folder
2. Add to `components/index.ts` exports
3. Import in `LandingPage.tsx`
4. Add CSS to `styles.css`

## What This Isolation Provides

- ✅ **No Global Effects**: Changing app-wide styles won't affect landing page
- ✅ **Portable**: Landing page can be moved, duplicated, or exported independently
- ✅ **Easy Maintenance**: All landing-specific code is in one place
- ✅ **Version Control**: Can track landing changes separately
- ✅ **Performance**: Can lazy-load entire landing module
- ✅ **Reusability**: Same visual system can be used for other pages

## CSS Specificity Notes

- Uses CSS custom properties (variables) for dynamic values
- All colors reference `--c-*` variables defined in `:root`
- All fonts reference `--font-*` variables
- All animation durations/easing reference `--dur-*` and `--ease-*` variables
- No reliance on external CSS frameworks (no tailwind, bootstrap, etc.)

## Mobile Responsiveness

Breakpoints defined in `theme.ts` and used throughout `styles.css`:

- `480px`: Mobile (phones)
- `768px`: Tablet
- `1024px`: Desktop
- `1440px`: Wide/Ultra-wide

Media queries are clearly labeled in CSS for easy navigation.
