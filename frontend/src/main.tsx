import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { queryClient } from "./queries/queryClient";
import { AuthProvider } from "./contexts/AuthProvider";
import { SystemSettingsProvider } from "./contexts/SystemSettingsProvider";
import { ToastProvider } from "./contexts/ToastProvider";
import { SnackbarProvider } from "./contexts/SnackbarProvider";
import { ConfirmProvider } from "./contexts/ConfirmProvider";
import App from "./App";
import "./index.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element #root not found. Check your index.html.");
}

// Mount order: StrictMode → AuthProvider → SystemSettings → feedback providers
// → App. Feedback providers (Toast/Snackbar/Confirm) sit innermost so any
// component anywhere in the tree can trigger them without prop drilling.
//
// <ReactQueryDevtools> sits inside QueryClientProvider so it can read the
// cache, and is rendered as a sibling of the app tree. The package guards
// on `process.env.NODE_ENV` internally, so Vite tree-shakes the panel out
// of production builds — `npm run build` output size is unchanged.
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <SystemSettingsProvider>
          <ToastProvider>
            <SnackbarProvider>
              <ConfirmProvider>
                <App />
              </ConfirmProvider>
            </SnackbarProvider>
          </ToastProvider>
        </SystemSettingsProvider>
      </AuthProvider>
      <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-right" />
    </QueryClientProvider>
  </StrictMode>,
);
