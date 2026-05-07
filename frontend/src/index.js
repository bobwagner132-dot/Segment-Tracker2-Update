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
}
