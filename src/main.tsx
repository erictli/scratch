import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/inter";
import "katex/dist/katex.min.css";
import App from "./App";
import "./App.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
