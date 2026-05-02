# Inputs: Onboarding

## Step 1 — Data Import

### File Upload

| Field | Type | Validation | Required |
|-------|------|-----------|----------|
| file | File (PDF, DOCX, TXT, MD) | Max 10MB, accepted extensions only | Yes (or text paste) |

### Text Paste

| Field | Type | Validation | Required |
|-------|------|-----------|----------|
| text | string | Min 50 chars, trimmed, no whitespace-only | Yes (or file upload) |

**Output:** `SessionData.rawInput` — raw text extracted from file or pasted directly

## Step 2 — Preferences

| Field | Type | Options/Validation | Required |
|-------|------|-------------------|----------|
| direction | enum | User-defined options per product | Yes |
| type | enum | User-defined options per product | Yes |
| constraints | string[] | Free-text list of hard requirements | No |
| quickCheck | boolean[] | Yes/No validation questions | Yes |

**Output:** `SessionData.preferences` — structured preference object

## Step 3 — Profile Generation

No user input — this step is AI-generated from Steps 1 + 2.

**Output:** `SessionData.profile` — AI-generated structured profile

## Data Flow

```
Step 1 (rawInput)
  ↓ AI parsing
  → SessionData.parsed
  
Step 2 (preferences)
  → SessionData.preferences

Step 3 (profile generation)
  ← SessionData.parsed + SessionData.preferences
  → SessionData.profile
```
