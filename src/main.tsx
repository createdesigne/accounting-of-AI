import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AiSettingsProvider } from "./AiSettings";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AiSettingsProvider><App /></AiSettingsProvider>
  </React.StrictMode>,
);
