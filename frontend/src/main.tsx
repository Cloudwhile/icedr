import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Provider } from "@/components/common/ui/provider";
import { App } from "@/App";
import "@/app/globals.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element #root was not found");
}

createRoot(root).render(
  <StrictMode>
    <Provider>
      <App />
    </Provider>
  </StrictMode>,
);
