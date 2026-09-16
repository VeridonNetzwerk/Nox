import { useState, useEffect, useCallback, useRef } from "react";
import { API_BASE, loadLocaleData } from "../../../shared/constants.jsx";

export function useSystemStatus(addToast) {
  const [systemStatus, setSystemStatus] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState("connecting");
  const [backendReady, setBackendReady] = useState(false);
  const [micState, setMicState] = useState("idle");
  const [showSetup, setShowSetup] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const hasConnectedOnceRef = useRef(false);

  // Fetch system status periodically
  useEffect(() => {
    let lastErrorTime = 0;
    const fetchStatus = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/status`);
        const data = await res.json();
        if (data.status === "ok") setSystemStatus(data);
      } catch {
        if (!hasConnectedOnceRef.current) return;
        const now = Date.now();
        if (now - lastErrorTime > 30000) {
          lastErrorTime = now;
          addToast({ type: "warning", title: "Status", message: "System-Status konnte nicht abgerufen werden", duration: 5000 });
        }
      }
    };
    fetchStatus();
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  // Check onboarding state
  useEffect(() => {
    let cancelled = false;
    let retries = 0;
    const MAX_RETRIES = 60;

    const checkOnboarding = async () => {
      try {
        try {
          const bsRes = await fetch("http://127.0.0.1:8421/api/bootstrap/status");
          const bsData = await bsRes.json();
          if (bsData.status === "ok" && !bsData.deps_installed) {
            setShowSetup(true);
            return;
          }
        } catch {}

        const res = await fetch(`${API_BASE}/api/settings`);
        const data = await res.json();
        if (cancelled) return;
        if (data.status === "ok" && !data.settings.onboarding_completed) {
          setShowOnboarding(true);
          window.nox?.onboardingActive?.();
        } else if (data.status === "ok" && data.settings.onboarding_completed) {
          window.nox?.onboardingNotNeeded?.();
        }
      } catch {
        if (cancelled) return;
        if (retries === 10 && !hasConnectedOnceRef.current) {
          addToast({ type: "warning", title: "Backend", message: "Backend reagiert nicht. Nox versucht weiterhin eine Verbindung herzustellen…", duration: 6000 });
        }
        if (retries < MAX_RETRIES) {
          retries++;
          setTimeout(checkOnboarding, 3000);
        }
      }
    };
    checkOnboarding();
    return () => { cancelled = true; };
  }, []);

  const checkOllamaStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/health/ollama`);
      const data = await res.json();
      setSystemStatus((prev) => ({ ...prev, ollama: { status: data.status === "ok" ? "ok" : "error", host: data.ollama_host, error: data.error } }));
    } catch (err) {
      addToast({ type: "warning", title: "Ollama", message: "Ollama-Status konnte nicht geprüft werden", detail: String(err), duration: 4000 });
    }
  }, [addToast]);

  return {
    systemStatus,
    setSystemStatus,
    connectionStatus,
    setConnectionStatus,
    backendReady,
    setBackendReady,
    micState,
    setMicState,
    showSetup,
    setShowSetup,
    showOnboarding,
    setShowOnboarding,
    hasConnectedOnceRef,
    checkOllamaStatus,
  };
}
