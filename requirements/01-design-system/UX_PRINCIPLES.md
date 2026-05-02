# [Project Name] — UX Principles & Emotional Design

---

## Core UX Principles

### 1. Visibility of System Status

The user must always know:

- What step they're on (progress indicators, phase markers)
- What's happening right now (loading states, processing feedback)
- What they've accomplished (score, completed phases, outputs generated)
- What comes next (step labels, CTA buttons, upcoming actions)

**Implementation:**
<!-- GUIDANCE: List the components that provide system status:
- Progress bar / phase indicator
- Loading states with descriptive text
- Score/progress meter
- Step completion indicators
-->

### 2. User Control & Freedom

The user must be able to:

- Go back to any previous step
- Edit any data they've entered
- Cancel any in-progress operation
- Export or delete all their data
- Skip optional features

**Implementation:**
<!-- GUIDANCE: List the mechanisms for user control:
- Navigation (back buttons, sidebar, keyboard shortcuts)
- Data editing (inline edit, re-run)
- Cancel/abort (AbortController on API calls)
- Privacy controls (export, import, delete)
-->

### 3. Consistency & Standards

The UI should be predictable:

- Same action = same appearance everywhere
- Color meanings are stable (green = done, orange = action, red = error)
- Button patterns are consistent (one component with variants)
- Feedback patterns are consistent (toasts for confirmations, inline for errors)

**Known gaps:**
<!-- GUIDANCE: Document inconsistencies for cleanup:
- Button inconsistency (raw HTML vs component in places)
- Spacing inconsistency (different padding values)
- Icon alignment inconsistency
-->

### 4. Error Prevention

The system should prevent errors before they happen:

- Validation before submission (input fields, file types)
- Confirmation dialogs for destructive actions
- Disabled states on invalid actions (can't proceed until data is valid)
- Smart defaults that reduce user input
- Guardrails on navigation (data gates prevent skipping required steps)

### 5. Recognition Over Recall

- Labels on every action (no icon-only buttons without tooltips)
- Prefilled fields from previously entered data
- Context-sensitive help (inline hints, not separate help pages)
- Persistent navigation showing where the user is

### 6. Flexibility & Efficiency

- Keyboard navigation for power users
- Skip-ahead paths for returning users with saved data
- Bulk operations where applicable
- Progressive disclosure (simple first, details on demand)

### 7. Aesthetic & Minimalist Design

- Every element earns its place — remove anything that doesn't serve the current step
- Content hierarchy: one primary action per screen
- Whitespace is a feature, not waste
- Animations serve purpose (progress, attention, delight) — never decoration

---

## Emotional Design

### Feedback Moments

<!-- GUIDANCE: Map key moments where the product should produce an emotional response:

| Moment | Emotion | Mechanism |
|--------|---------|-----------|
| First output generated | Accomplishment | Celebration animation + score jump |
| Phase completed | Progress | Phase transition with visual flourish |
| Error recovered | Relief | "Back on track" confirmation |
| Final output ready | Empowerment | Summary of everything created |
-->

### Loading State Psychology

<!-- GUIDANCE: Loading states are emotional design opportunities:

| Duration | User Experience | Design Response |
|----------|----------------|-----------------|
| < 1 second | Instant | No indicator needed |
| 1-3 seconds | Brief wait | Skeleton screen or spinner |
| 3-10 seconds | Noticeable wait | Progress text: "Analyzing..." |
| 10-30 seconds | Long wait | Phased progress: "Step 1 of 3..." |
| 30+ seconds | Anxiety | Time estimate + what's happening + cancel option |
-->

### Celebration Design

<!-- GUIDANCE: When and how to celebrate user achievements:

Rules:
1. Celebrate meaningful milestones, not trivial actions
2. Celebrations should be brief (< 2 seconds)
3. User can dismiss immediately
4. Never celebrate if the outcome was an error
5. Scale intensity to significance (small success = subtle, major milestone = confetti)
-->

---

## Responsive Design

### Breakpoints

<!-- GUIDANCE: Define your breakpoints and what changes:

| Breakpoint | Width | Navigation | Layout Changes |
|------------|-------|-----------|----------------|
| Mobile | < 768px | Bottom nav or hamburger | Single column, stacked cards |
| Tablet | 768-1023px | Sidebar collapses | Two columns where appropriate |
| Desktop | ≥ 1024px | Full sidebar | Multi-column, side panels |
-->

### Mobile-First Rules

1. Every screen must be usable on mobile
2. Touch targets: minimum 44x44px
3. No hover-dependent interactions (always have a tap equivalent)
4. Text readable without zooming (minimum 16px body text)

---

## Accessibility

### Minimum Requirements

- **Keyboard navigation:** Every interactive element reachable via Tab, activatable via Enter/Space
- **Screen readers:** All images have alt text, all form fields have labels, all buttons have accessible names
- **Color contrast:** Minimum 4.5:1 for body text, 3:1 for large text (WCAG AA)
- **Focus management:** Visible focus indicators, logical tab order, focus trapped in modals
- **Reduced motion:** Respect `prefers-reduced-motion` — disable all animations

### Focus Order

<!-- GUIDANCE: Define the expected tab order for each major screen:
1. Skip to main content link
2. Navigation elements
3. Main content area (top to bottom, left to right)
4. Primary action (CTA button)
5. Secondary actions
-->

---

## Review Checklist

A screen passes UX review if:

1. [ ] System status is visible (user knows where they are and what's happening)
2. [ ] User can go back and undo
3. [ ] Colors and patterns are consistent with the rest of the app
4. [ ] Errors are prevented where possible, handled gracefully where not
5. [ ] No icon-only buttons without labels or tooltips
6. [ ] Works on mobile (touch targets, no hover-dependent interactions)
7. [ ] Keyboard navigable (Tab through all elements, Enter activates)
8. [ ] Loading states defined for all async operations
9. [ ] Empty states defined for all data-dependent views
10. [ ] Celebrations/feedback match the emotional arc
