import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import DashboardApp from "./DashboardApp.tsx";
// dashboard.css @imports ../styles.css so the shared base rules always
// precede the dashboard overrides in a single stylesheet.
import "./dashboard.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DashboardApp />
  </StrictMode>
);
