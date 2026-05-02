# [Project Name] — Security Architecture

Every security decision, boundary, and control. If it protects user data or prevents attacks, it belongs here.

---

## Authentication

<!-- GUIDANCE: How users prove who they are.

### Strategy
- [e.g., JWT tokens in httpOnly cookies]
- [e.g., OAuth providers: Google, LinkedIn]
- [e.g., Email/password with bcrypt hashing]

### Session Management
- Token type: [JWT / session cookie / etc.]
- Token lifetime: [duration]
- Refresh strategy: [silent refresh / re-auth / sliding window]
- Storage: [httpOnly cookie / header / localStorage — NEVER localStorage for auth]
- Invalidation: [on logout / on password change / on suspicious activity]

### OAuth Flow
- Providers: [list]
- State parameter: [how it's generated, stored, validated, deleted after use]
- PKCE: [yes/no and why]
-->

---

## Authorization

<!-- GUIDANCE: Who can do what.

### Model
- [Role-based / Resource-based / Attribute-based]
- Roles: [list with permissions]

### Enforcement Points
- API routes: [middleware that checks auth]
- Client-side: [route guards, component visibility]
- Note: Client-side checks are UX, not security. Server MUST enforce independently.
-->

---

## Data Protection

### Encryption at Rest

<!-- GUIDANCE:
- What's encrypted: [session data, user content, PII]
- Algorithm: [AES-GCM, AES-256, etc.]
- Key management: [where keys live, how they're rotated]
- Implementation: [Web Crypto API, server-side library]
-->

### Encryption in Transit

<!-- GUIDANCE:
- HTTPS enforced: [yes, via hosting provider / HSTS header]
- Certificate management: [auto via platform / manual]
- API calls: [TLS 1.2+ required]
-->

### PII Handling

<!-- GUIDANCE:
- What PII is collected: [name, email, resume data, etc.]
- Where it's stored: [encrypted localStorage, server DB]
- Retention: [how long, auto-delete policy]
- Export: [user can download all their data]
- Deletion: [user can delete all their data, process for handling deletion]
-->

---

## API Security

### CSRF Protection

<!-- GUIDANCE:
- Method: [Origin header validation, CSRF tokens, SameSite cookies]
- Which routes: [all state-changing routes / specific routes]
- Implementation: [middleware, per-route check]
-->

### Rate Limiting

<!-- GUIDANCE:
- Strategy: [sliding window, token bucket, fixed window]
- Limits: [per-IP, per-user, per-endpoint, global]
- Implementation: [Upstash, Redis, in-memory]
- Response on limit: [429 status, retry-after header]

| Endpoint | Limit | Window | Scope |
|----------|-------|--------|-------|
| /api/auth/* | 5 | 1 min | per-IP |
| /api/process | 10 | 1 min | per-user |
| Global | 100 | 1 min | per-IP |
-->

### Input Validation

<!-- GUIDANCE:
- Server-side validation: [on every endpoint, schema validation]
- Content-type checking: [reject unexpected content types]
- Size limits: [max request body, max file upload]
- Sanitization: [how external data is cleaned before use]
-->

### CORS

<!-- GUIDANCE:
- Allowed origins: [specific domains, not wildcard]
- Allowed methods: [GET, POST, etc.]
- Credentials: [include / omit]
- Configuration: [Next.js config, middleware, response headers]
-->

---

## Secrets Management

### Environment Variables

<!-- GUIDANCE:
- Where secrets live: [.env.local, hosting dashboard, vault]
- How they're loaded: [Next.js runtime, process.env]
- Never in: [client bundle, git, logs, error messages]
- Rotation: [how and when secrets are rotated]
-->

### API Key Security

<!-- GUIDANCE:
- All API keys are server-side only
- Client NEVER sees: [list of keys that are server-only]
- Validation: [keys checked on startup, fail-fast if missing]
-->

---

## OWASP Top 10 Checklist

| # | Category | Status | Implementation |
|---|----------|--------|---------------|
| 1 | Injection | <!-- ✅/⚠️/❌ --> | <!-- Parameterized queries, input sanitization --> |
| 2 | Broken Authentication | <!-- --> | <!-- Secure session management, password hashing --> |
| 3 | Sensitive Data Exposure | <!-- --> | <!-- Encryption, minimal data collection --> |
| 4 | XML External Entities | <!-- --> | <!-- N/A or disabled --> |
| 5 | Broken Access Control | <!-- --> | <!-- Auth checks on every endpoint --> |
| 6 | Security Misconfiguration | <!-- --> | <!-- Security headers, no debug in prod --> |
| 7 | Cross-Site Scripting | <!-- --> | <!-- Output encoding, CSP headers --> |
| 8 | Insecure Deserialization | <!-- --> | <!-- Input validation on all API bodies --> |
| 9 | Known Vulnerabilities | <!-- --> | <!-- Dependency scanning, update policy --> |
| 10 | Insufficient Logging | <!-- --> | <!-- Security events logged, alerts configured --> |

---

## Security Headers

<!-- GUIDANCE: Document all security-related HTTP headers:

| Header | Value | Purpose |
|--------|-------|---------|
| Strict-Transport-Security | max-age=31536000; includeSubDomains | Force HTTPS |
| X-Content-Type-Options | nosniff | Prevent MIME sniffing |
| X-Frame-Options | DENY | Prevent clickjacking |
| Content-Security-Policy | [policy] | XSS prevention |
| Referrer-Policy | strict-origin-when-cross-origin | Control referrer info |
-->

---

## Third-Party Data Handling

<!-- GUIDANCE: How external data is treated:

- All external data is **untrusted by default**
- External content wrapped in injection-defense mechanisms
- API responses validated against expected schema before use
- Third-party scripts loaded with integrity checks (SRI)
- No third-party tracking without user consent
-->

---

## Incident Response

<!-- GUIDANCE: What happens when a security issue is found:

1. **Detect**: How are security issues discovered? (monitoring, user reports, audits)
2. **Assess**: How is severity determined? (data exposed, users affected, exploitability)
3. **Contain**: How is the issue isolated? (disable feature, revoke tokens, block IP)
4. **Fix**: How is the fix deployed? (hotfix process, rollback plan)
5. **Notify**: Who is informed? (users, team, authorities if required)
6. **Review**: What prevents recurrence? (new rule, new test, new hook)
-->

---

## Security Review Cadence

- **Every PR**: Automated checks (linter, dependency scan)
- **Monthly**: Manual review of auth flows and access controls
- **Quarterly**: Full OWASP audit
- **On incident**: Immediate review + post-mortem
