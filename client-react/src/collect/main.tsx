import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../index.css";
import { CollectPage } from "./CollectPage";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <CollectPage />
  </StrictMode>,
);
