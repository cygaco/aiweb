# [Project Name] — Data Flow

How data moves through the system. Every input, transformation, storage, and output. This is the map a new developer reads to understand "where does X come from and where does it go?"

---

## High-Level Flow

<!-- GUIDANCE: Show the complete data lifecycle as an ASCII diagram:

```
User Input → Client State → API Route → Processing → Storage
                                                        ↓
Storage → API Route → Client State → Render
```

Then expand each arrow into what actually happens.
-->

---

## Data Stores

### Primary Session State

<!-- GUIDANCE: The main data object that flows through the product. Document:
- Where it lives (localStorage, server session, database)
- What's in it (key fields and types)
- How it's accessed (direct read, API, context provider)
- Encryption (if applicable)

Example:
| Field | Type | Set by | Read by |
|-------|------|--------|---------|
| personal | PersonalInfo | Onboarding Step 1 | Profile, Resumes, LinkedIn |
| preferences | Preferences | Onboarding Step 2 | Search, Analysis |
| profile | Profile | Onboarding Step 3 | Everything downstream |
-->

### Server-Side Storage

<!-- GUIDANCE: Document all server-side storage:

| Store | Technology | What's Stored | TTL | Access Pattern |
|-------|-----------|--------------|-----|----------------|
| Session cache | [Redis/DB] | Session data mirror | [duration] | Read on page load, write on save |
| Rate limiting | [Redis] | Request counts | [window] | Check on every API call |
| Auth tokens | [Cookies/DB] | JWT tokens | [duration] | Set on login, check on protected routes |
-->

### Client-Side Storage

<!-- GUIDANCE:

| Store | Technology | What's Stored | Encrypted | Persistence |
|-------|-----------|--------------|-----------|-------------|
| Session | localStorage | All session data | Yes (AES-GCM) | Until cleared |
| Preferences | localStorage | UI preferences | No | Until cleared |
| Auth | Cookies | JWT token | httpOnly | Session/30d |
-->

---

## API Routes

<!-- GUIDANCE: Document every API endpoint:

| Method | Path | Input | Output | Auth Required | Rate Limited |
|--------|------|-------|--------|---------------|-------------|
| POST | /api/process | { data, action } | { result } | Yes | 10/min |
| GET | /api/session | — | { session } | Yes | 30/min |
| POST | /api/auth/login | { email, password } | { token } | No | 5/min |
-->

---

## Data Transformation Pipeline

<!-- GUIDANCE: For each major data transformation, document the chain:

### [Pipeline Name] (e.g., "Resume Parsing")

```
Input: Raw file (PDF/DOCX/TXT)
  → Step 1: File validation (type, size)
  → Step 2: Text extraction (pdf-parse / mammoth)
  → Step 3: AI parsing (Claude API with PARSE prompt)
  → Step 4: Structured output validation
Output: Structured data (PersonalInfo, Education, Experience)

Error handling:
- Step 1 fails → "Unsupported file type" error, offer alternatives
- Step 3 fails → Retry once, then "Parsing failed" with manual fallback
- Step 4 fails → Partial data saved, missing fields flagged
```
-->

---

## State Management

### Client-Side State Flow

<!-- GUIDANCE: How does state move through the client?

```
Component → setState/dispatch → State Update → Re-render
                                     ↓
                              saveSession() → localStorage (encrypted)
                                     ↓
                              syncToServer() → API → Server Storage
```

Key rules:
1. Always update React state BEFORE calling saveSession()
2. Always re-read from storage before spreading (load-spread-save pattern)
3. Never save stale closure-captured state
-->

### The Load-Spread-Save Pattern

<!-- GUIDANCE: If your product uses a pattern for safe concurrent saves, document it:

```typescript
// CORRECT: Re-read before saving
const latest = await loadSession();
const updated = { ...latest, fieldToUpdate: newValue };
await saveSession(updated);

// WRONG: Save from stale closure
await saveSession({ ...session, fieldToUpdate: newValue });
// ↑ session may be stale if another component saved between render and now
```
-->

---

## Data Contracts

<!-- GUIDANCE: Rules for how data flows between features:

### Contract Rules

1. Every screen's INPUTS.md defines downstream consumers
2. Data shape must match TypeScript interfaces (types.ts)
3. If a field is consumed downstream, it cannot be removed without updating all consumers
4. Optional fields must be handled (null checks) by all consumers
5. Field renames require updating: types.ts → storage → API → components → specs

### Cross-Feature Dependencies

| Producer | Field | Consumer(s) | Contract |
|----------|-------|-------------|----------|
| Step 1 | resumeStructured | Steps 3, 8, 9 | Must contain at least name + summary |
| Step 2 | preferences | Steps 4, 5 | Must have location + at least one preference |
-->

---

## Data Lifecycle

<!-- GUIDANCE: What happens to data over time?

| Event | What Happens | Data Affected |
|-------|-------------|---------------|
| User starts | Empty session created | All fields null |
| Step completed | Data saved to session | Step-specific fields |
| User returns | Session loaded from storage | All saved fields restored |
| User goes back | Downstream data invalidated | Fields per invalidation map |
| Session expires | Server cache cleared | Server-side session |
| User deletes | All data removed | Everything |
-->

---

## Security Boundaries

<!-- GUIDANCE: Where are the trust boundaries?

```
[Browser — UNTRUSTED]
    ↓ HTTPS
[API Routes — TRUSTED]
    ↓ Server-side only
[External APIs — SEMI-TRUSTED]
    ↓ Response validation
[Database — TRUSTED]
```

Rules:
1. Client sends requests, server validates everything
2. External API responses are sanitized before use
3. API keys live on server only, never in client bundle
4. User input is validated server-side (client validation is UX, not security)
-->
