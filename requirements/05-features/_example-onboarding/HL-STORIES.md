# High-Level Stories: Onboarding

> **Agent Instructions**
>
> These stories define INTENT and OUTCOMES, not implementation details.
> Granular stories (STORIES.md) break each HL story into atomic behaviors.

---

### HL-ONB-01: Data Import (MVP)

> As a User, I want to import my existing data (file or text), so the system can understand who I am without me typing everything from scratch.

**Success:** User provides input and sees a structured preview of their parsed data within 30 seconds.

**Granular stories:** GS-ONB-01 (file upload), GS-ONB-02 (size validation), GS-ONB-03 (text paste), GS-ONB-04 (AI parsing)

---

### HL-ONB-02: Preferences (MVP)

> As a User, I want to tell the system what I'm looking for, so it can personalize everything downstream.

**Success:** User completes all preference sections and data persists across refresh.

**Granular stories:** GS-ONB-05 (preference collection)

---

### HL-ONB-03: Profile Generation (MVP)

> As a User, I want to see an AI-generated profile that summarizes my strengths and goals, so I can verify the system understands me before proceeding.

**Success:** Profile is generated, displayed, and the user confirms it's accurate.

**Granular stories:** GS-ONB-06 (profile generation)

---

### HL-ONB-04: Session Persistence (MVP)

> As a User, I want my progress saved automatically, so I can close the browser and come back later without losing anything.

**Success:** Refresh at any step → resume exactly where left off with all data intact.

**Granular stories:** GS-ONB-07 (session persistence)
