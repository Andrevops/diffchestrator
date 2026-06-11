import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import SearchApp from "./SearchApp.tsx";
import "./search.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SearchApp />
  </StrictMode>
);
