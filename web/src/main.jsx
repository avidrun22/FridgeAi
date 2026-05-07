import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import { initAnalytics } from "./lib/analytics.js";
import "./index.css";

// v1.15 — initialize PostHog before the React tree renders so the first
// $pageview fires with the correct URL and any auth-restored sessions can
// identify() during App's mount effect. Same project key as iOS so events
// from both platforms unify in PostHog project 382774.
initAnalytics();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
