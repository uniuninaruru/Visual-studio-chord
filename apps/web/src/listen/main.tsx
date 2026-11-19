import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../theme.css";
import "./listen.css";
import { ListenApp } from "./ListenApp";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ListenApp />
  </StrictMode>,
);
