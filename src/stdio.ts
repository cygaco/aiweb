import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { initProfileStore, HEX_64 } from "./lib/profile-store.js";

// Fixed dev-only token hash for stdio. Stdio runs in a single OS process with
// no shared bearer surface, so the same constant is safe across restarts (the
// developer's profile.db row survives). Do NOT use this constant for HTTP —
// HTTP collapses every caller to one tokenHash and re-introduces the
// cross-user-leak vuln that SP-20260514-001 closed.
//
// Value = sha256("aiweb-stdio-local-dev-token-SP-20260514-001"). The seed is
// stable across the lifetime of this codebase so the developer's profile.db
// row survives across stdio restarts deterministically.
//
// NOTE: with the get_user_profile / update_user_profile MCP tool registrations
// removed in SP-20260514-001, the profile-store is reachable in code but not
// callable via MCP. The wiring is preserved so a future per-user-auth sprint
// can re-register the tools gated on real identity without re-deriving the
// SQLite/HKDF/AES code.
const STDIO_LOCAL_TOKEN_HASH =
  "e6d8a5ac3ba7cf330f70d214a2b5ef48580afe4cd4f60961bb01620c76dce8be";

async function main() {
  if (!HEX_64.test(STDIO_LOCAL_TOKEN_HASH)) {
    console.error(
      "FATAL: STDIO_LOCAL_TOKEN_HASH constant is malformed (must be 64 hex chars).",
    );
    process.exit(1);
  }
  if (!process.env.PROFILE_ENCRYPTION_SECRET) {
    console.error(
      "FATAL: PROFILE_ENCRYPTION_SECRET not set. stdio profile store cannot init. Refusing to start.",
    );
    process.exit(1);
  }
  if (!HEX_64.test(process.env.PROFILE_ENCRYPTION_SECRET)) {
    console.error(
      "FATAL: PROFILE_ENCRYPTION_SECRET must be 64 hex chars (32 bytes). Generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    );
    process.exit(1);
  }
  initProfileStore();
  const server = createServer(STDIO_LOCAL_TOKEN_HASH);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("AI Web Wave 00 MCP server running on stdio");
}

main().catch(console.error);
