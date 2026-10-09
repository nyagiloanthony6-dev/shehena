"use client";
import { useEffect } from "react";

/** Readable crash screen: shows the real reason so it can be reported, plus a way back. */
export default function ErrorScreen({ error, reset }: { error: Error & { digest?: string }; reset?: () => void }) {
  useEffect(() => {
    console.error(error);
    // After a new version is deployed, an open tab can ask for files that no longer exist.
    // Reload once to pick up the new version instead of showing an error.
    const stale = /ChunkLoadError|Loading chunk|dynamically imported module|Failed to find Server Action|server action/i.test(`${error?.name} ${error?.message}`);
    try {
      if (stale && !sessionStorage.getItem("shehena.reloaded")) {
        sessionStorage.setItem("shehena.reloaded", "1");
        window.location.reload();
      }
    } catch { /* storage blocked */ }
  }, [error]);
  const detail = [error?.name, error?.message].filter(Boolean).join(": ") || "Unknown error";
  return (
    <section className="login">
      <div className="login-card" style={{ gridTemplateColumns: "1fr", maxWidth: 620 }}>
        <div className="login-form">
          <h2>Something went wrong</h2>
          <p className="sub">This screen couldn&apos;t load. Reloading usually fixes it. If it keeps happening, send this message to Serengeti Labs:</p>
          <pre className="msg" style={{ whiteSpace: "pre-wrap", fontFamily: "var(--f-mono)", fontSize: 12.5, marginTop: 10 }}>
            {detail}{error?.digest ? `\nRef: ${error.digest}` : ""}{typeof window !== "undefined" ? `\nPage: ${window.location.pathname}\nBrowser: ${navigator.userAgent}` : ""}
          </pre>
          <div className="actions">
            <button className="btn primary" onClick={() => (reset ? reset() : window.location.reload())}>Try again</button>
            <button className="btn" onClick={() => window.location.reload()}>Reload page</button>
            <a className="btn" href="/login">Back to sign in</a>
          </div>
        </div>
      </div>
    </section>
  );
}
