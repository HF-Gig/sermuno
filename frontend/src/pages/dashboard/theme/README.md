# Dashboard Theme System

## Overview

The Dashboard Theme System is a **scoped, isolated theming solution** that applies exclusively to dashboard pages. It does NOT affect authentication pages, landing pages, or any other parts of the application.

### Key Principles

✅ **Isolation**: All dashboard styles are scoped under `.dashboard-root` class
✅ **No Global Impact**: Zero influence on auth/landing pages
✅ **Centralized**: Single source of truth for dashboard design tokens
✅ **Context-Driven**: Token access via React Context (useDashboardTheme hook)
✅ **CSS-Scoped**: All `.dashboard-root` prefixed styles in `dashboard.css`

---

## File Structure

```
src/pages/dashboard/
├── theme/
│   ├── tokens.ts                 # Design tokens (colors, typography, spacing, etc.)
│   ├── DashboardThemeProvider.tsx # React Context provider
│   ├── dashboard.css             # All scoped styles (.dashboard-root prefix)
│   └── index.ts                  # Centralized exports
├── DashboardLayout.tsx           # Wrapper component that applies theme + .dashboard-root
└── [other dashboard pages]
```

---

## Usage

### 1. **Accessing Theme Tokens**

Use the `useDashboardTheme` hook in dashboard components:

```tsx
import { useDashboardTheme } from '../theme';

export const MyComponent = () => {
  const { tokens } = useDashboardTheme();
  
  return (
    <div style={{ color: tokens.colors.textPrimary }}>
      My Component
    </div>
  );
};
```

### 2. **Using CSS Classes**

Apply scoped CSS classes for common UI patterns:

```tsx
// Button
<button className="btn btn-primary">Click me</button>

// Card
<div className="card">Content</div>

// Badge
<span className="badge success">Success</span>

// Form elements
<input className="input" type="text" />
<label className="form-label">Label</label>

// Table
<table className="table">...</table>
```

### 3. **Tailwind CSS with CSS Variables**

Tailwind classes can still be used with dashboard-specific variables:

```tsx
<div className="bg-white border border-[var(--color-card-border)] rounded-lg shadow-[var(--shadow-md)]">
  {/* Uses dashboard CSS variables */}
</div>
```

---

## Token Categories

### Colors
- `primary`, `secondary`, `accent`
- `background`, `surface`
- `textPrimary`, `textMuted`
- `border`, `cardBorder`
- Sidebar colors: `sidebarBg`, `sidebarText`, `sidebarTextMuted`
- Header colors: `headerBg`, `headerBorder`
- Form colors: `inputBorder`, `inputFocus`
- Badge colors: `badgeSuccessBg`, `badgeSuccessText`

### Typography
- `fontHeadline`, `fontBody`, `fontMono`
- `fontWeights`: regular, medium, semibold, bold
- `fontSizes`: xs, sm, base, lg, xl, 2xl, 3xl

### Spacing
- `1` through `12` (4px to 96px)

### Border Radius
- `sm` (4px), `md` (6px), `lg` (8px), `xl` (12px), `full` (9999px)

### Shadows
- `sm`, `md`, `lg`

### Layout
- `headerHeight`: 64px
- `sidebarWidth`: 260px
- `sidebarCollapsedWidth`: 64px
- `maxContentWidth`: 1400px

---

## Architecture

### DashboardThemeProvider

Wraps dashboard routes and provides tokens via React Context.

```tsx
<DashboardThemeProvider>
  <YourComponent />
</DashboardThemeProvider>
```

### DashboardLayout

The main wrapper that:

1. Applies `DashboardThemeProvider`
2. Wraps content with `<div className="dashboard-root">`
3. Imports `dashboard.css` (scoped styles)

```tsx
<DashboardLayout>
  <MainLayout /> {/* or any dashboard content */}
</DashboardLayout>
```

### CSS Scoping Strategy

**All dashboard styles in `dashboard.css` are prefixed with `.dashboard-root`:**

```css
/* ✅ CORRECT - Scoped */
.dashboard-root .btn {
  background-color: #163832;
}

/* ❌ WRONG - Would affect entire app */
button {
  background-color: #163832;
}
```

---

## Verification Checklist

After changes, verify:

- [ ] **Dashboard**: Consistent styling across all pages (cards, buttons, forms)
- [ ] **Auth Pages**: Unchanged appearance (login, register, password reset, etc.)
- [ ] **Landing Page**: Unchanged appearance and functionality
- [ ] **Console**: No errors or warnings
- [ ] **Responsive**: No layout breaks on mobile/tablet/desktop
- [ ] **Sidebar**: Text is white, hover states work
- [ ] **Tables**: Proper styling and hover effects
- [ ] **Inputs/Forms**: Border colors and focus states correct

---

## Adding New Styles

### When to Add to `dashboard.css`

✅ Add if you're styling:
- Common dashboard components (cards, buttons, badges)
- Form elements used across multiple pages
- Table styling
- Layout utilities

### When NOT to Add

❌ Don't add for:
- Single-page/component-specific styles (keep in component file)
- Auth/landing page styles (keep in their own CSS files)
- Global styles (avoid entirely)

### How to Add

1. Open `dashboard.css`
2. Add your style **inside `.dashboard-root { ... }`**
3. Prefix all selectors with `.dashboard-root` or nest inside the root rule
4. Test that it doesn't affect other areas

Example:

```css
.dashboard-root {
  .my-new-component {
    display: flex;
    gap: 1rem;
  }

  .my-new-component.variant {
    background-color: #ffffff;
  }
}
```

---

## Important Rules

🔴 **MUST DO:**
- Always scope styles under `.dashboard-root`
- Never modify auth/landing CSS files
- Test in browser that styles only apply to dashboard
- Use token values from `tokens.ts` for consistency

🔴 **NEVER DO:**
- Add global CSS selectors like `body`, `html`, `*`, `:root`, `button`, `a` (unscoped)
- Modify root-level CSS files for dashboard-specific styles
- Import dashboard theme styles in auth/landing pages

---

## Maintenance

### Adding New Tokens

1. Update `tokens.ts` with new token values
2. TypeScript will auto-complete token access via `useDashboardTheme()`
3. Update CSS variables or SCSS maps if using them

### Updating Theme Colors

All color changes go in `tokens.ts`:

```typescript
colors: {
  primary: '#NEW_COLOR',
  // ... other colors
}
```

Then:
- Use via `tokens.colors.primary` in JS
- Use via CSS selector modifications in `dashboard.css`

---

## FAQ

**Q: Can I use inline styles instead of classes?**
A: Yes, but prefer classes for consistency. If using inline styles, pull from `tokens`:

```tsx
const { tokens } = useDashboardTheme();
<div style={{ backgroundColor: tokens.colors.cardBg }} />
```

**Q: Why is theme in Context if I can use CSS variables?**
A: CSS variables have scoping issues across the app. Context ensures dashboard-only access and type safety via TypeScript.

**Q: Can I override styles for specific pages?**
A: Yes, but within the page/component CSS file. Keep scoping with `.dashboard-root` or use CSS Modules to avoid conflicts.

**Q: What if I need to style a third-party component?**
A: Wrap it in your own component with dashboard-themed styles, or create a scoped override in `dashboard.css` using CSS specificity (but avoid if possible).

---

## Support

For questions or issues with the theme system:
1. Check `tokens.ts` for available token values
2. Review `dashboard.css` for existing component styles
3. Ensure `.dashboard-root` is being applied (check DevTools)
4. Verify route/layout wrapping is correct
