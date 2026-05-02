# [Project Name] — Component Library

Shared UI primitives used across the application. Documents current state, variants, usage patterns, and known issues.

---

## Btn (Button)

### Variants

| Variant | Background | Text | Border | Hover |
|---------|-----------|------|--------|-------|
| primary | `--primary` | `--primary-text` | none | `--primary-hover` |
| secondary | `--secondary` | `--secondary-text` | none | `--secondary-hover` |
| ghost | transparent | `--text-muted` | none | bg: `--surface` |
| outline | transparent | `--text` | `1px solid --border` | bg: `--surface` |
| danger | `--error` | `--text-inverse` | none | darker red |

### Sizes

| Size | Padding | Font Size | Min Height |
|------|---------|-----------|------------|
| sm | `px-2 py-1` | `text-xs` | 28px |
| md (default) | `px-4 py-2` | `text-sm` | 36px |
| lg | `px-6 py-3` | `text-base` | 44px |

### Base Styling

- Font weight: `semibold`
- Border radius: `--radius-lg` (8px)
- Transition: `transition-all 150ms`
- Disabled: `opacity-40`, `cursor-not-allowed`
- Loading: shows spinner alongside text, button disabled

### States

| State | Behavior |
|-------|----------|
| Default | Normal appearance |
| Hover | Color shift per variant table |
| Active/Pressed | Slight scale down or darkened |
| Disabled | Reduced opacity, no pointer events |
| Loading | Spinner + text, disabled |
| Focus | Visible focus ring (`--primary` outline, 2px offset) |

### Usage Rules

- One primary button per screen (the main CTA)
- Destructive actions always use `danger` variant
- Ghost buttons for navigation actions (back, cancel)
- Always include text (no icon-only buttons without accessible label)

---

## Card (Container)

### Base Styling

- Background: `--bg-alt`
- Border: `1px solid --border`
- Border radius: `--radius-lg` (8px)
- Box shadow: `--shadow`
- Padding: `p-4` (16px) standard, `p-6` (24px) for featured content

### Variants

| Variant | Additional Styling |
|---------|-------------------|
| Default | Standard border + shadow |
| Selected | `--primary` border, slightly elevated shadow |
| Error | `--error` border |
| Interactive | Cursor pointer, hover shadow increase |

---

## Input Fields

### Text Input

- Height: 40px (md), 32px (sm), 48px (lg)
- Border: `1px solid --border`
- Focus: `--primary` border, subtle shadow
- Error: `--error` border + error message below
- Disabled: `--bg` background, `--text-disabled` text
- Placeholder: `--text-muted`

### Textarea

- Same styling as text input
- Min height: 80px
- Resizable: vertical only
- Character count (if maxLength defined): shown below right

### Select / Dropdown

- Same base styling as text input
- Chevron icon on right
- Dropdown panel: `--bg-alt` background, `--border` border, shadow

### Checkbox / Toggle

- Size: 20x20px (checkbox), 40x20px (toggle)
- Checked: `--primary` fill
- Unchecked: `--border` outline
- Label always on right

---

## Toast / Notification

### Types

| Type | Icon | Background | Border |
|------|------|-----------|--------|
| Success | Checkmark | `--success` bg (subtle) | `--success` left border |
| Error | X / Alert | `--error` bg (subtle) | `--error` left border |
| Warning | Warning triangle | `--warning` bg (subtle) | `--warning` left border |
| Info | Info circle | `--info` bg (subtle) | `--info` left border |

### Behavior

- Position: top-right of viewport
- Duration: 5 seconds (auto-dismiss), configurable
- Dismissible: click X or swipe
- Stacking: new toasts push older ones down
- Max visible: 3 (older ones collapse)

---

## Modal / Dialog

### Base Styling

- Backdrop: dark overlay (`rgba(0,0,0,0.5)`)
- Panel: `--bg` background, `--radius-lg` corners, `--shadow-lg`
- Max width: 480px (sm), 640px (md), 800px (lg)
- Padding: `p-6`

### Behavior

- Focus trapped inside modal
- Escape key closes
- Click outside closes (configurable)
- Body scroll locked while open
- Enter key triggers primary action

### Structure

```
┌─────────────────────────────┐
│ Title                    [X] │
│─────────────────────────────│
│ Content                      │
│                              │
│                              │
│─────────────────────────────│
│           [Cancel]  [Action] │
└─────────────────────────────┘
```

---

## Progress Indicators

### Progress Bar

- Height: 4px (thin) or 8px (standard)
- Track: `--border` background
- Fill: `--primary` (in progress) or `--success` (complete)
- Animation: smooth width transition

### Step Indicator

| State | Appearance |
|-------|-----------|
| Completed | `--success` circle with checkmark |
| Active | `--primary` circle, pulsing |
| Pending | `--border` circle, dot |
| Disabled | `--border` circle, no dot |

### Loading Spinner

- Size: 16px (inline), 24px (button), 48px (page)
- Color: `--primary` (or `--text-inverse` on colored backgrounds)
- Animation: 800ms rotation

---

## Layout Primitives

### Spacing Scale

| Token | Value | Usage |
|-------|-------|-------|
| `--space-1` | 4px | Tight spacing (icon gaps) |
| `--space-2` | 8px | Element spacing |
| `--space-3` | 12px | Group spacing |
| `--space-4` | 16px | Section spacing |
| `--space-6` | 24px | Card padding |
| `--space-8` | 32px | Section gaps |
| `--space-12` | 48px | Page sections |

### Border Radius

| Token | Value | Usage |
|-------|-------|-------|
| `--radius-sm` | 4px | Small elements (chips, tags) |
| `--radius-md` | 6px | Inputs, small cards |
| `--radius-lg` | 8px | Cards, buttons, modals |
| `--radius-xl` | 12px | Large containers |
| `--radius-full` | 9999px | Pills, avatars |

### Shadows

| Token | Usage |
|-------|-------|
| `--shadow-sm` | Subtle lift (hover states) |
| `--shadow` | Cards, dropdowns |
| `--shadow-lg` | Modals, popovers |

---

## Known Issues & Debt

<!-- GUIDANCE: Document any component inconsistencies for cleanup:
- Components that bypass the shared library (raw HTML instead of Btn)
- Inconsistent spacing or padding values
- Missing variants that are needed
- Hover implementations that should use CSS instead of JS
- Components that don't support dark mode properly
-->

---

## Adding New Components

1. Check if an existing component can be extended (new variant, not new component)
2. Follow the token system — reference `--tokens`, never hardcode values
3. Define all states (default, hover, active, disabled, focus, loading, error)
4. Support both light and dark mode
5. Document in this file with the same structure as above
6. Test keyboard accessibility (Tab, Enter, Space, Escape)
