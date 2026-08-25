(function () {
  "use strict";

  const root = document.documentElement;
  const palettes = ["ocean", "emerald", "violet", "sunset"];
  const modes = ["light", "dark"];
  const styles = ["acrylic", "liquid", "matte", "translucent"];
  const keys = {
    palette: "codexscope-theme",
    mode: "codexscope-mode",
    style: "codexscope-style",
    opacity: "codexscope-background-opacity",
    blur: "codexscope-background-blur",
  };
  const databaseName = "codexscope-appearance";
  const databaseStore = "assets";
  const backgroundKey = "background";
  let backgroundUrl = "";

  function readValue(key, allowed, fallback) {
    try {
      const value = window.localStorage.getItem(key);
      return allowed.includes(value) ? value : fallback;
    } catch (_error) {
      return fallback;
    }
  }

  function readNumber(key, fallback, min, max) {
    try {
      const value = Number(window.localStorage.getItem(key));
      return Number.isFinite(value) && value >= min && value <= max ? value : fallback;
    } catch (_error) {
      return fallback;
    }
  }

  function storeValue(key, value) {
    try {
      window.localStorage.setItem(key, String(value));
    } catch (_error) {
      // The current page still reflects the choice when storage is unavailable.
    }
  }

  function updateChecked(selector, attribute, selected) {
    document.querySelectorAll(selector).forEach((option) => {
      option.setAttribute("aria-checked", String(option.dataset[attribute] === selected));
    });
  }

  function applyPalette(palette, persist) {
    const selected = palettes.includes(palette) ? palette : "ocean";
    root.dataset.theme = selected;
    updateChecked("[data-theme-option]", "themeOption", selected);
    if (persist) storeValue(keys.palette, selected);
  }

  function applyMode(mode, persist) {
    const selected = modes.includes(mode) ? mode : "light";
    root.dataset.mode = selected;
    updateChecked("[data-mode-option]", "modeOption", selected);
    if (persist) storeValue(keys.mode, selected);
  }

  function applyStyle(style, persist) {
    const selected = styles.includes(style) ? style : "acrylic";
    root.dataset.style = selected;
    updateChecked("[data-style-option]", "styleOption", selected);
    if (persist) storeValue(keys.style, selected);
  }

  function applyBackgroundControls(opacity, blur, persist) {
    root.style.setProperty("--background-overlay-opacity", String(opacity / 100));
    root.style.setProperty("--background-image-blur", `${blur}px`);
    const opacityInput = document.querySelector("#backgroundOpacity");
    const blurInput = document.querySelector("#backgroundBlur");
    const opacityValue = document.querySelector("#backgroundOpacityValue");
    const blurValue = document.querySelector("#backgroundBlurValue");
    if (opacityInput) opacityInput.value = String(opacity);
    if (blurInput) blurInput.value = String(blur);
    if (opacityValue) opacityValue.textContent = `${opacity}%`;
    if (blurValue) blurValue.textContent = `${blur}px`;
    if (persist) {
      storeValue(keys.opacity, opacity);
      storeValue(keys.blur, blur);
    }
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) {
        reject(new Error("IndexedDB unavailable"));
        return;
      }
      const request = indexedDB.open(databaseName, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(databaseStore)) {
          request.result.createObjectStore(databaseStore);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Failed to open appearance database"));
    });
  }

  async function databaseOperation(mode, operation) {
    const database = await openDatabase();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction(databaseStore, mode);
        const store = transaction.objectStore(databaseStore);
        const request = operation(store);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("Appearance database operation failed"));
      });
    } finally {
      database.close();
    }
  }

  const readBackground = () => databaseOperation("readonly", (store) => store.get(backgroundKey));
  const saveBackground = (record) => databaseOperation("readwrite", (store) => store.put(record, backgroundKey));
  const deleteBackground = () => databaseOperation("readwrite", (store) => store.delete(backgroundKey));

  function setBackgroundStatus(message) {
    const status = document.querySelector("#backgroundStatus");
    if (status) status.textContent = message;
  }

  function applyBackgroundRecord(record) {
    if (backgroundUrl) URL.revokeObjectURL(backgroundUrl);
    if (!record || !(record.blob instanceof Blob)) {
      backgroundUrl = "";
      root.style.removeProperty("--custom-background-image");
      root.dataset.hasBackground = "false";
      const clearButton = document.querySelector("#clearBackground");
      if (clearButton) clearButton.disabled = true;
      setBackgroundStatus("未设置");
      return;
    }
    backgroundUrl = URL.createObjectURL(record.blob);
    root.style.setProperty("--custom-background-image", `url("${backgroundUrl}")`);
    root.dataset.hasBackground = "true";
    const clearButton = document.querySelector("#clearBackground");
    if (clearButton) clearButton.disabled = false;
    setBackgroundStatus(`已应用 · ${record.name || "本地图片"}`);
  }

  async function normalizeBackground(file) {
    if (!file.type.startsWith("image/")) throw new Error("请选择图片文件");
    if (file.size > 15 * 1024 * 1024) throw new Error("图片不能超过 15 MB");
    if (file.type === "image/svg+xml" || file.type === "image/gif" || !("createImageBitmap" in window)) {
      return file;
    }
    const bitmap = await createImageBitmap(file);
    const maxSide = 2560;
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size <= 4 * 1024 * 1024) {
      bitmap.close();
      return file;
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const optimized = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", .86));
    return optimized || file;
  }

  const initialOpacity = readNumber(keys.opacity, 58, 20, 90);
  const initialBlur = readNumber(keys.blur, 0, 0, 20);
  applyPalette(readValue(keys.palette, palettes, "ocean"), false);
  applyMode(readValue(keys.mode, modes, "light"), false);
  applyStyle(readValue(keys.style, styles, "acrylic"), false);
  applyBackgroundControls(initialOpacity, initialBlur, false);
  root.dataset.hasBackground = "false";

  window.addEventListener("DOMContentLoaded", () => {
    const toggle = document.querySelector("#themeToggle");
    const menu = document.querySelector("#themeMenu");
    const paletteOptions = Array.from(document.querySelectorAll("[data-theme-option]"));
    const modeOptions = Array.from(document.querySelectorAll("[data-mode-option]"));
    const styleOptions = Array.from(document.querySelectorAll("[data-style-option]"));
    const backgroundInput = document.querySelector("#backgroundInput");
    const clearBackground = document.querySelector("#clearBackground");
    const opacityInput = document.querySelector("#backgroundOpacity");
    const blurInput = document.querySelector("#backgroundBlur");
    if (!toggle || !menu) return;

    applyPalette(root.dataset.theme, false);
    applyMode(root.dataset.mode, false);
    applyStyle(root.dataset.style, false);
    applyBackgroundControls(initialOpacity, initialBlur, false);

    readBackground().then(applyBackgroundRecord).catch(() => {
      root.dataset.hasBackground = "false";
      setBackgroundStatus("本地存储不可用");
    });

    const isMenuOpen = () => menu.matches(":popover-open");
    const positionMenu = () => {
      const rect = toggle.getBoundingClientRect();
      const menuWidth = Math.min(380, window.innerWidth - 20);
      menu.style.width = `${menuWidth}px`;
      menu.style.maxHeight = `${Math.max(280, window.innerHeight - 24)}px`;
      const left = Math.max(10, Math.min(window.innerWidth - menuWidth - 10, rect.right - menuWidth));
      menu.style.left = `${left}px`;
      const menuHeight = menu.getBoundingClientRect().height;
      const preferredTop = rect.bottom + 9;
      menu.style.top = `${Math.max(12, Math.min(preferredTop, window.innerHeight - menuHeight - 12))}px`;
    };
    const setMenuOpen = (open, restoreFocus) => {
      if (open) {
        menu.style.left = "10px";
        menu.style.top = "12px";
        menu.showPopover();
        positionMenu();
        const selected = menu.querySelector('[aria-checked="true"]');
        if (selected) selected.focus();
      } else {
        if (isMenuOpen()) menu.hidePopover();
        if (restoreFocus) toggle.focus();
      }
    };

    function bindRadioGroup(options, apply, dataKey) {
      options.forEach((option, index) => {
        option.addEventListener("click", () => apply(option.dataset[dataKey], true));
        option.addEventListener("keydown", (event) => {
          if (event.key !== "ArrowRight" && event.key !== "ArrowDown" && event.key !== "ArrowLeft" && event.key !== "ArrowUp") return;
          event.preventDefault();
          const offset = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
          const next = options[(index + offset + options.length) % options.length];
          next.focus();
          next.click();
        });
      });
    }

    bindRadioGroup(modeOptions, applyMode, "modeOption");
    bindRadioGroup(paletteOptions, applyPalette, "themeOption");
    bindRadioGroup(styleOptions, applyStyle, "styleOption");

    toggle.addEventListener("click", () => setMenuOpen(!isMenuOpen(), false));
    menu.addEventListener("toggle", () => toggle.setAttribute("aria-expanded", String(isMenuOpen())));

    if (backgroundInput) {
      backgroundInput.addEventListener("change", async () => {
        const file = backgroundInput.files && backgroundInput.files[0];
        if (!file) return;
        setBackgroundStatus("正在处理…");
        try {
          const blob = await normalizeBackground(file);
          const record = { blob, name: file.name, updatedAt: Date.now() };
          await saveBackground(record);
          applyBackgroundRecord(record);
        } catch (error) {
          setBackgroundStatus(error && error.message ? error.message : "背景设置失败");
        } finally {
          backgroundInput.value = "";
        }
      });
    }

    if (clearBackground) {
      clearBackground.addEventListener("click", async () => {
        clearBackground.disabled = true;
        try {
          await deleteBackground();
          applyBackgroundRecord(null);
        } catch (_error) {
          clearBackground.disabled = false;
          setBackgroundStatus("移除失败");
        }
      });
    }

    const updateBackgroundControls = () => {
      const opacity = Number(opacityInput && opacityInput.value) || 58;
      const blur = Number(blurInput && blurInput.value) || 0;
      applyBackgroundControls(opacity, blur, true);
    };
    if (opacityInput) opacityInput.addEventListener("input", updateBackgroundControls);
    if (blurInput) blurInput.addEventListener("input", updateBackgroundControls);

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && isMenuOpen()) {
        event.preventDefault();
        setMenuOpen(false, true);
      }
    });
    window.addEventListener("resize", () => {
      if (isMenuOpen()) positionMenu();
    });
    window.addEventListener("beforeunload", () => {
      if (backgroundUrl) URL.revokeObjectURL(backgroundUrl);
    });
  });
})();
