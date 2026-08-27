(() => {
  const status = document.getElementById("liveStatus");
  const statusText = document.getElementById("liveStatusText");
  const toggle = document.getElementById("liveToggle");
  const refresh = document.getElementById("manualRefresh");
  const exitApp = document.getElementById("exitApp");
  if (!status || !statusText || !toggle || !refresh || !exitApp) return;

  const isServerMode = location.protocol === "http:" || location.protocol === "https:";
  let enabled = localStorage.getItem("codexscope-live-enabled") !== "false";
  let refreshPromise = null;
  let streamConnected = false;
  let generationState = "pending";
  let startupProbe = null;
  let events = null;
  let stopping = false;

  exitApp.hidden = !isServerMode;

  const setStatus = (state, text) => {
    status.className = `live-status ${state}`;
    statusText.textContent = text;
  };

  const updateToggle = () => {
    toggle.textContent = enabled ? "暂停实时" : "启用实时";
    toggle.setAttribute("aria-pressed", String(enabled));
  };

  const renderLiveStatus = () => {
    if (stopping) return;
    if (!streamConnected) {
      setStatus("connecting", "连接实时服务…");
      return;
    }
    if (generationState === "error") {
      setStatus("offline", "数据生成失败，请查看本地日志");
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
  exitApp.addEventListener("click", async () => {
    if (!isServerMode || stopping) return;
    if (!window.confirm("退出 CodexScope-Live？后台实时服务将停止。")) return;
    stopping = true;
    exitApp.disabled = true;
    exitApp.textContent = "正在退出…";
    setStatus("connecting", "正在安全退出…");
    try {
      const response = await fetch("shutdown", { method: "POST", cache: "no-store" });
      if (response.status !== 202) throw new Error(`shutdown ${response.status}`);
      if (startupProbe !== null) window.clearInterval(startupProbe);
      if (events) events.close();
      toggle.disabled = true;
      refresh.disabled = true;
      exitApp.textContent = "已退出";
      setStatus("offline", "程序已退出，可以关闭页面");
    } catch {
      stopping = false;
      exitApp.disabled = false;
      exitApp.textContent = "退出程序";
      setStatus("offline", "退出失败，请重试");
    }
  });
  updateToggle();

  if (!isServerMode || !window.EventSource) {
    toggle.disabled = true;
    exitApp.hidden = true;
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
  startupProbe = window.setInterval(() => {
    const hasRealData = Boolean(window.CODEXSCOPE_DATA);
    if (hasRealData && Date.now() - startupProbeStartedAt > 30_000) {
      window.clearInterval(startupProbe);
      startupProbe = null;
      return;
    }
    void probeForGeneratedData();
  }, 750);

  renderLiveStatus();
  events = new EventSource("events");
  events.onopen = () => {
    streamConnected = true;
    void refreshGenerationStatus();
  };
  events.onerror = () => {
    if (stopping) return;
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
