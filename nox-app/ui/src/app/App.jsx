import React from "react";
import MainApp from "../components/main/MainApp.jsx";
import OverlayApp from "../components/overlay/OverlayApp.jsx";

function getMode() {
  const params = new URLSearchParams(window.location.search);
  const mode = params.get("mode");
  if (mode === "overlay") return "overlay";
  if (mode === "main") return "main";
  return "main";
}

function App() {
  const mode = getMode();
  return mode === "overlay" ? <OverlayApp /> : <MainApp />;
}

export default App;
