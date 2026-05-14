export default function TermsOfService() {
  return (
    <main style={{ maxWidth: "640px", margin: "2rem auto", padding: "0 1rem" }}>
      <h1>Terms of Service (experimental)</h1>
      <p>
        The AI Web is an experimental pizza-ordering concierge. By using this
        service you acknowledge:
      </p>
      <ul>
        <li>
          The agent places phone calls to real restaurants. Outputs may be
          wrong; orders may fail.
        </li>
        <li>
          This is alpha software. Do not place real orders unattended; expect to
          verify every order.
        </li>
        <li>
          Payment is cash on delivery only. We do not process or store payment
          information.
        </li>
        <li>
          We do not yet offer per-user authentication. Anyone with the API key
          shares the same profile namespace.
        </li>
        <li>
          Bugs, mis-orders, and call failures are likely. Use at your own risk.
        </li>
        <li>
          This page is a placeholder, not legal advice. For questions, contact{" "}
          <a href="mailto:contact@agentsforall.co">contact@agentsforall.co</a>.
        </li>
      </ul>
      <p>Last updated: 2026-05-14</p>
    </main>
  );
}
