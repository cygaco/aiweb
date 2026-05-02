# [Project Name] — Color Semantics

Colors communicate meaning, not just aesthetics. This document defines what every color means in the product and how it behaves across themes.

---

## Design Tokens

All colors are defined as CSS custom properties (design tokens). Components reference tokens, never raw hex values.

```css
:root {
  /* Override these for theming */
  --primary: /* main brand action color */;
  --primary-hover: /* hover state */;
  --primary-text: /* text on primary background */;
  --bg: /* page background */;
  --bg-alt: /* card/container background */;
  --surface: /* elevated surface */;
  --text: /* primary text */;
  --text-muted: /* secondary text */;
  --border: /* standard border */;
  --success: /* positive states */;
  --warning: /* caution states */;
  --error: /* error/destructive states */;
  --info: /* informational states */;
}
```

---

## Semantic Color Roles

### Action Colors

| Role | Token | Light Mode | Dark Mode | Usage |
|------|-------|-----------|-----------|-------|
| Primary action | `--primary` | <!-- hex --> | <!-- hex --> | Main CTA buttons, active states, links |
| Primary hover | `--primary-hover` | <!-- hex --> | <!-- hex --> | Hover state for primary elements |
| Primary text | `--primary-text` | <!-- hex --> | <!-- hex --> | Text on primary-colored backgrounds |
| Secondary action | `--secondary` | <!-- hex --> | <!-- hex --> | Secondary buttons, less prominent actions |

### State Colors

| Role | Token | Light Mode | Dark Mode | Usage |
|------|-------|-----------|-----------|-------|
| Success | `--success` | <!-- green --> | <!-- green --> | Completed steps, positive confirmations, "done" states |
| Warning | `--warning` | <!-- amber --> | <!-- amber --> | Caution, needs attention, in-progress states |
| Error | `--error` | <!-- red --> | <!-- red --> | Failures, destructive actions, validation errors |
| Info | `--info` | <!-- blue --> | <!-- blue --> | Neutral information, tips, system messages |

### Surface Colors

| Role | Token | Light Mode | Dark Mode | Usage |
|------|-------|-----------|-----------|-------|
| Page background | `--bg` | <!-- light --> | <!-- dark --> | Root page background |
| Card background | `--bg-alt` | <!-- slightly different --> | <!-- slightly different --> | Cards, containers, grouped content |
| Elevated surface | `--surface` | <!-- hover bg --> | <!-- hover bg --> | Hover states, selected items, elevated panels |
| Border | `--border` | <!-- light gray --> | <!-- dark gray --> | Card borders, dividers, input outlines |

### Text Colors

| Role | Token | Light Mode | Dark Mode | Usage |
|------|-------|-----------|-----------|-------|
| Primary text | `--text` | <!-- near black --> | <!-- near white --> | Body text, headings |
| Secondary text | `--text-muted` | <!-- gray --> | <!-- light gray --> | Descriptions, labels, help text |
| Inverse text | `--text-inverse` | <!-- white --> | <!-- dark --> | Text on colored backgrounds (buttons, badges) |
| Disabled text | `--text-disabled` | <!-- light gray --> | <!-- darker gray --> | Disabled controls, inactive labels |

---

## Color Meaning Rules

1. **Green always means "done" or "success."** Never use green for warnings or neutral states.
2. **Red always means "error" or "destructive."** Never use red for positive actions.
3. **Orange/amber means "active" or "needs attention."** Current step, in-progress operations, warnings.
4. **Gray means "inactive" or "disabled."** Future steps, unavailable features, disabled controls.
5. **Primary color means "take this action."** The thing you want the user to do next.

---

## Theme Support

### Light/Dark Mode

- All colors defined as CSS custom properties with light and dark variants
- Theme toggle switches the property values, not individual component styles
- Default: system preference (`prefers-color-scheme`), user can override
- Transition: smooth 200ms transition on theme switch

### Contrast Requirements

- Body text on background: minimum 4.5:1 (WCAG AA)
- Large text (18px+) on background: minimum 3:1
- Interactive elements: minimum 3:1 against adjacent colors
- Focus indicators: minimum 3:1 against background

### Color Blindness Considerations

- Never use color alone to convey meaning — always pair with icons, labels, or patterns
- Success/error states use icons (checkmark/X) in addition to green/red
- Charts and data visualizations use patterns or shapes alongside colors
- Test with color blindness simulators (protanopia, deuteranopia, tritanopia)

---

## Component-Specific Color Usage

<!-- GUIDANCE: Document how colors map to specific components:

### Buttons
- Primary: `--primary` bg, `--primary-text` text
- Ghost: transparent bg, `--text-muted` text → `--surface` bg on hover
- Danger: `--error` bg, `--text-inverse` text

### Status Indicators
- Done: `--success` with checkmark icon
- Active: `--primary` or `--warning` with pulse animation
- Pending: `--text-muted` with dot
- Error: `--error` with X icon

### Progress Indicators
- Completed phase: `--success` fill
- Active phase: `--primary` fill + pulse
- Future phase: `--border` fill (gray)

### Form Fields
- Default: `--border` outline
- Focus: `--primary` outline (2px)
- Error: `--error` outline + error text
- Disabled: `--bg` fill, `--text-disabled` text
-->

---

## Anti-Patterns

- Using raw hex values instead of tokens
- Using the same color for different meanings on different screens
- Relying on color alone without text/icon backup
- Hardcoding light-mode colors that break in dark mode
- Using brand colors for state indicators (success/error)
