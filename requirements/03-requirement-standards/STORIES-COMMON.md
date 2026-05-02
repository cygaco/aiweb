# Shared Granular Stories

## Purpose

Cross-cutting behaviors that repeat across multiple features. Feature stories reference these by ID (`Inherits: CS-XXX`) instead of re-specifying the behavior. This ensures consistent implementation and prevents drift between features.

Shared stories are **not standalone** — they are inherited by feature-specific stories that supply the concrete context (which data, which step, which operation).

---

## CS-001: Session Persistence

> As a System, I want modified data to be persisted to session storage immediately on confirmation, so that no user input is lost between steps.

**Acceptance Criteria:**

- Data is saved to session storage via the standard save function
- Persistence completes before the next step renders
- If persistence fails, the user is shown an error and does not advance
- Stale or partial data from a previous session does not silently overwrite newer data

**Verifiable by:** Session storage contains the expected field with correct value after save.

---

## CS-002: Loading State During AI Operation

> As a User, I want to see a progress indicator while the system is processing an AI request, so that I know the system is working and not frozen.

**Acceptance Criteria:**

- Progress indicator appears within 200ms of operation start
- Indicator includes a text description of what's happening
- If the operation takes longer than expected, a "taking longer than usual" message appears
- User can cancel or navigate back during loading (if applicable)

**Verifiable by:** Loading indicator visible during API call; disappears on completion or error.

---

## CS-003: Error Recovery on AI Failure

> As a User, I want to see a clear error message with retry option when an AI operation fails, so that I can try again without losing my progress.

**Acceptance Criteria:**

- Error message explains what happened (not a raw error code)
- Retry action is available and re-triggers the operation
- Previous user input is preserved across retries
- After 3 failed retries, an alternative path is suggested (if applicable)

**Verifiable by:** On simulated API failure, error UI appears with retry; input preserved after retry.

---

## CS-004: Input Validation Before Advancement

> As a System, I want to validate all required fields before allowing the user to advance, so that downstream features receive complete data.

**Acceptance Criteria:**

- Validation runs when the user attempts to advance (not on every keystroke)
- Each invalid field shows an inline error message
- The advance action is blocked until all validations pass
- Optional fields with invalid content show warnings but do not block

**Verifiable by:** Attempting to advance with empty required fields shows errors and blocks navigation.

---

<!-- Add more shared stories as patterns emerge across features. Each should have:
- A unique CS-XXX ID
- "As a [role], I want [behavior], so that [benefit]" format
- Acceptance Criteria with behavioral guarantees
- Verifiable by (how to test it)
-->
