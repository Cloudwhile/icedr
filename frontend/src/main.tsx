import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Provider } from "@/components/common/ui/provider";
import { RootI18nProvider } from "@/components/i18n/root-i18n-provider";
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
        <App />
      </RootI18nProvider>
    </Provider>
  </StrictMode>,
);
