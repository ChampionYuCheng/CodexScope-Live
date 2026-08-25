(() => {
  const status = document.getElementById("liveStatus");
  const statusText = document.getElementById("liveStatusText");
  const toggle = document.getElementById("liveToggle");
  const refresh = document.getElementById("manualRefresh");
  if (!status || !statusText || !toggle || !refresh) return;

  const isServerMode = location.protocol === "http:" || location.protocol === "https:";
  const initialGeneratedAt = window.CODEXSCOPE_DATA?.generatedAt || null;
  let enabled = localStorage.getItem("codexscope-live-enabled") !== "false";
  let reloading = false;

  const setStatus = (state, text) => {
    status.className = `live-status ${state}`;
    statusText.textContent = text;
  };

  const updateToggle = () => {
    toggle.textContent = enabled ? "暂停实时" : "启用实时";
    toggle.setAttribute("aria-pressed", String(enabled));
  };

  const reloadPage = () => {
    if (reloading) return;
    reloading = true;
    sessionStorage.setItem("codexscope-scroll-y", String(window.scrollY));
    location.reload();
  };

  refresh.addEventListener("click", reloadPage);
  toggle.addEventListener("click", () => {
    enabled = !enabled;
    localStorage.setItem("codexscope-live-enabled", String(enabled));
    updateToggle();
    if (!isServerMode) setStatus("static", "静态预览");
  });
  updateToggle();

  const savedScroll = Number(sessionStorage.getItem("codexscope-scroll-y"));
  if (Number.isFinite(savedScroll) && savedScroll > 0) {
    sessionStorage.removeItem("codexscope-scroll-y");
    requestAnimationFrame(() => window.scrollTo(0, savedScroll));
  }

  if (!isServerMode || !window.EventSource) {
    toggle.disabled = true;
    setStatus("static", "静态预览");
    return;
  }

  const payloadGeneratedAt = (source) => {
    const match = source.match(/(?:"generatedAt"|generatedAt)\s*:\s*"([^"]+)"/);
    return match?.[1] || null;
  };
  const startupProbeStartedAt = Date.now();
  const probeForGeneratedData = async () => {
    if (reloading) return;
    try {
      const response = await fetch(`/data.js?codexscope-ready=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) return;
      const source = await response.text();
      if (!source.includes("window.CODEXSCOPE_DATA")) return;
      const generatedAt = payloadGeneratedAt(source);
      if (!window.CODEXSCOPE_DATA || (generatedAt && generatedAt !== initialGeneratedAt)) {
        reloadPage();
      }
    } catch {
      // The live server may still be starting; the next probe will retry.
    }
  };
  const startupProbe = window.setInterval(() => {
    const hasRealData = Boolean(window.CODEXSCOPE_DATA);
    if (hasRealData && Date.now() - startupProbeStartedAt > 30_000) {
      window.clearInterval(startupProbe);
      return;
    }
    void probeForGeneratedData();
  }, 750);

  setStatus("connecting", "连接实时服务…");
  const events = new EventSource("/events");
  events.onopen = () => setStatus("connected", enabled ? "实时监控中" : "实时监控已暂停");
  events.onerror = () => setStatus("offline", "实时服务断开，正在重试…");
  events.addEventListener("data", () => {
    if (enabled) reloadPage();
  });
})();
