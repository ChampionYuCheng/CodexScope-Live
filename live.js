(() => {
  const status = document.getElementById("liveStatus");
  const statusText = document.getElementById("liveStatusText");
  const toggle = document.getElementById("liveToggle");
  const refresh = document.getElementById("manualRefresh");
  if (!status || !statusText || !toggle || !refresh) return;

  const isServerMode = location.protocol === "http:" || location.protocol === "https:";
  let enabled = localStorage.getItem("codexscope-live-enabled") !== "false";
  let refreshPromise = null;
  let streamConnected = false;
  let generationState = "pending";

  const setStatus = (state, text) => {
    status.className = `live-status ${state}`;
    statusText.textContent = text;
  };

  const updateToggle = () => {
    toggle.textContent = enabled ? "暂停实时" : "启用实时";
    toggle.setAttribute("aria-pressed", String(enabled));
  };

  const renderLiveStatus = () => {
    if (!streamConnected) {
      setStatus("connecting", "连接实时服务…");
      return;
    }
    if (generationState === "error") {
      setStatus("offline", "数据生成失败，请查看程序窗口");
      return;
    }
    if (generationState === "incompatible") {
      setStatus("offline", "服务版本过旧，请重新启动");
      return;
    }
    if (generationState === "pending") {
      setStatus("connecting", "正在生成本地数据…");
      return;
    }
    setStatus("connected", enabled ? "实时监控中" : "实时监控已暂停");
  };

  const refreshGenerationStatus = async () => {
    try {
      const response = await fetch(`status?codexscope-status=${Date.now()}`, { cache: "no-store" });
      if (response.status === 404) {
        generationState = "incompatible";
        renderLiveStatus();
        return;
      }
      if (!response.ok) throw new Error(`status ${response.status}`);
      const payload = await response.json();
      generationState = ["pending", "ok", "error"].includes(payload.state)
        ? payload.state
        : "error";
      renderLiveStatus();
    } catch {
      generationState = "error";
      renderLiveStatus();
    }
  };

  const loadLatestData = () => {
    if (refreshPromise) return refreshPromise;
    refresh.disabled = true;
    refreshPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = `data.js?codexscope-update=${Date.now()}`;
      script.async = true;
      script.onload = async () => {
        script.remove();
        try {
          if (!window.CODEXSCOPE_DATA || !window.CODEXSCOPE_APPLY_DATA) {
            throw new Error("dashboard data updater unavailable");
          }
          const applied = await window.CODEXSCOPE_APPLY_DATA(window.CODEXSCOPE_DATA);
          if (!applied) throw new Error("dashboard rejected updated data");
          generationState = "ok";
          renderLiveStatus();
          resolve(true);
        } catch (error) {
          reject(error);
        }
      };
      script.onerror = () => {
        script.remove();
        reject(new Error("failed to load data.js"));
      };
      document.head.appendChild(script);
    }).catch(() => {
      setStatus("offline", "数据刷新失败，等待重试…");
      return false;
    }).finally(() => {
      refreshPromise = null;
      refresh.disabled = false;
    });
    return refreshPromise;
  };

  refresh.addEventListener("click", () => {
    if (!isServerMode) {
      location.reload();
      return;
    }
    void loadLatestData();
  });
  toggle.addEventListener("click", () => {
    enabled = !enabled;
    localStorage.setItem("codexscope-live-enabled", String(enabled));
    updateToggle();
    if (!isServerMode) setStatus("static", "静态预览");
    else renderLiveStatus();
  });
  updateToggle();

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
    try {
      const response = await fetch(`data.js?codexscope-ready=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) return;
      const source = await response.text();
      if (!source.includes("window.CODEXSCOPE_DATA")) return;
      const generatedAt = payloadGeneratedAt(source);
      const currentGeneratedAt = window.CODEXSCOPE_DATA?.generatedAt || null;
      if (!window.CODEXSCOPE_DATA || (generatedAt && generatedAt !== currentGeneratedAt)) {
        await loadLatestData();
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

  renderLiveStatus();
  const events = new EventSource("events");
  events.onopen = () => {
    streamConnected = true;
    void refreshGenerationStatus();
  };
  events.onerror = () => {
    streamConnected = false;
    setStatus("offline", "实时服务断开，正在重试…");
  };
  events.addEventListener("data", () => {
    generationState = "ok";
    if (enabled) void loadLatestData();
    else renderLiveStatus();
  });
  events.addEventListener("generation-error", () => {
    generationState = "error";
    renderLiveStatus();
  });
})();
