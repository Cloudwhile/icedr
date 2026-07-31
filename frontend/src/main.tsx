import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Provider } from "@/components/common/ui/provider";
import { AuthSessionCoordinator } from "@/components/auth/auth-session-coordinator";
import { RootI18nProvider } from "@/components/i18n/root-i18n-provider";
import { AppErrorBoundary } from "@/components/ui/app-error-boundary";
import { App } from "@/App";
import "@/styles/index.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element #root was not found");
}

createRoot(root).render(
  <StrictMode>
    <Provider>
      <RootI18nProvider>
        <AuthSessionCoordinator />
        <AppErrorBoundary>
          <App />
        </AppErrorBoundary>
      </RootI18nProvider>
    </Provider>
  </StrictMode>,
);
