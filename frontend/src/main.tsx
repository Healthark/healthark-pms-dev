import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AuthProvider } from "./contexts/AuthProvider";
import { SystemSettingsProvider } from "./contexts/SystemSettingsProvider";
import App from "./App";
import "./index.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element #root not found. Check your index.html.");
}

// Mount order is architectural law per the Frontend Standards doc:
// StrictMode → AuthProvider → App
createRoot(root).render(
  <StrictMode>
    <AuthProvider>
      <SystemSettingsProvider>
        <App />
      </SystemSettingsProvider>
    </AuthProvider>
  </StrictMode>,
);
