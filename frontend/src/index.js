import React from "react";
import ReactDOM from "react-dom/client";
import "@/index.css";
import App from "@/App";

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Register the service worker for offline map tiles + app shell caching.
// Only runs in production builds served over http/https (so the CRA dev
// server on 3000 is unaffected).
if (
  "serviceWorker" in navigator &&
  process.env.NODE_ENV === "production" &&
  (window.location.protocol === "http:" || window.location.protocol === "https:")
) {
  window.addEventListener("load", () => {
    const swUrl = `${process.env.PUBLIC_URL || ""}/sw.js`;
    navigator.serviceWorker
      .register(swUrl)
      .catch((err) => console.warn("Service worker registration failed:", err));
  });
} else if (
  "serviceWorker" in navigator &&
  process.env.NODE_ENV !== "production"
) {
  // Dev / preview: actively clear any stale SW registered by an older build.
  // Stale workers intercept /api/* fetches and break credentialed JSON
  // responses (browsers refuse cross-read of consumed streams).
  window.addEventListener("load", async () => {
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const r of regs) await r.unregister();
      if (window.caches) {
        const keys = await caches.keys();
        for (const k of keys) await caches.delete(k);
      }
    } catch {
      /* ignore */
    }
  });
}
