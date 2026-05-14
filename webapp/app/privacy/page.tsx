export default function PrivacyPolicy() {
  return (
    <main style={{ maxWidth: "640px", margin: "2rem auto", padding: "0 1rem" }}>
      <h1>Privacy Policy (experimental)</h1>
      <p>
        The AI Web is an experimental service. While we work toward a
        production-grade privacy story, here is what is currently true:
      </p>
      <ul>
        <li>
          We collect: your phone number, delivery address, and name (to pass to
          the restaurant), plus the contents of your chat with the agent.
        </li>
        <li>
          We log: restaurant call transcripts and outcomes for debugging. These
          logs live on a single Fly volume and are not shipped to a managed log
          provider yet.
        </li>
        <li>
          We do not currently support per-user authentication. The same shared
          API key is used by every caller, meaning profile data may be visible
          across sessions until per-user auth ships.
        </li>
        <li>We do not sell user data and have no advertising partners.</li>
        <li>
          Third-party services we use: Bland.ai (voice calls), Anthropic
          (Claude), Google Maps (geocoding), Domino&apos;s (one delivery
          connector).
        </li>
        <li>
          To request your data, request deletion, or report concerns, contact{" "}
          <a href="mailto:contact@agentsforall.co">contact@agentsforall.co</a>.
        </li>
      </ul>
      <p>
        This page is a placeholder, not legal advice. Last updated: 2026-05-14.
      </p>
    </main>
  );
}
