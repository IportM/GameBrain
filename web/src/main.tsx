import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import EnvironmentGate from "./EnvironmentGate";
import { LanguageProvider } from "./i18n";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LanguageProvider><EnvironmentGate><App /></EnvironmentGate></LanguageProvider>
  </StrictMode>,
);
