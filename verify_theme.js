const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require("playwright");

const pageUrl = `file://${path.resolve(__dirname, "index.html").replace(/\\/g, "/")}`;
const expectedPalettes = ["ocean", "emerald", "violet", "sunset"];
const expectedModes = ["light", "dark"];
const expectedStyles = ["acrylic", "liquid", "matte", "translucent"];

async function appearanceState(page) {
  return page.evaluate(() => {
    const rootStyle = getComputedStyle(document.documentElement);
    return {
      palette: document.documentElement.dataset.theme,
      mode: document.documentElement.dataset.mode,
      style: document.documentElement.dataset.style,
      hasBackground: document.documentElement.dataset.hasBackground,
      accent: rootStyle.getPropertyValue("--blue").trim(),
      surfaceBlur: rootStyle.getPropertyValue("--surface-blur").trim(),
      colorScheme: rootStyle.colorScheme,
      storedPalette: localStorage.getItem("codexscope-theme"),
      storedMode: localStorage.getItem("codexscope-mode"),
      storedStyle: localStorage.getItem("codexscope-style"),
    };
  });
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await page.goto(pageUrl, { waitUntil: "load" });
    await page.evaluate(() => {
      localStorage.removeItem("codexscope-theme");
      localStorage.removeItem("codexscope-mode");
      localStorage.removeItem("codexscope-style");
      localStorage.removeItem("codexscope-background-opacity");
      localStorage.removeItem("codexscope-background-blur");
    });
    await page.reload({ waitUntil: "load" });

    assert.equal(await page.locator("[data-brand-logo]").count(), 1, "应渲染新的品牌 Logo");
    assert.match(await page.locator(".brand-wordmark").innerText(), /CodexScope\s*Live/i, "品牌字标应完整显示");

    const toggle = page.locator("#themeToggle");
    const menu = page.locator("#themeMenu");
    assert.equal(await toggle.count(), 1, "应提供外观切换按钮");
    assert.equal(await toggle.getAttribute("aria-haspopup"), "true");
    assert.equal(await menu.isHidden(), true, "外观面板默认收起");

    await toggle.click();
    assert.equal(await menu.isVisible(), true);
    assert.deepEqual(await page.locator("[data-mode-option]").evaluateAll((nodes) => nodes.map((node) => node.dataset.modeOption)), expectedModes, "应提供浅色和深色模式");
    assert.deepEqual(await page.locator("[data-theme-option]").evaluateAll((nodes) => nodes.map((node) => node.dataset.themeOption)), expectedPalettes, "调色板应与视觉材质分离");
    assert.deepEqual(await page.locator("[data-style-option]").evaluateAll((nodes) => nodes.map((node) => node.dataset.styleOption)), expectedStyles, "应提供亚克力、液态玻璃、哑光和半透明四种内置材质");

    const initial = await appearanceState(page);
    assert.equal(initial.mode, "light", "默认应为浅色模式");
    assert.equal(initial.palette, "ocean", "默认调色板应为海蓝");
    assert.equal(initial.style, "acrylic", "默认材质应为亚克力");
    assert.match(initial.colorScheme, /light/);

    await page.locator('[data-mode-option="dark"]').click();
    const dark = await appearanceState(page);
    assert.equal(dark.mode, "dark");
    assert.equal(dark.storedMode, "dark", "深色模式应持久化");
    assert.match(dark.colorScheme, /dark/, "深色模式必须设置浏览器 color-scheme");

    await page.locator('[data-theme-option="emerald"]').click();
    const emerald = await appearanceState(page);
    assert.equal(emerald.palette, "emerald");
    assert.equal(emerald.storedPalette, "emerald");
    assert.notEqual(emerald.accent, initial.accent, "调色板必须实际改变强调色");

    await page.locator('[data-style-option="liquid"]').click();
    const liquid = await appearanceState(page);
    assert.equal(liquid.style, "liquid");
    assert.equal(liquid.storedStyle, "liquid", "材质风格应持久化");
    assert.notEqual(liquid.surfaceBlur, initial.surfaceBlur, "不同材质必须改变表面渲染参数");

    await page.reload({ waitUntil: "load" });
    const persisted = await appearanceState(page);
    assert.equal(persisted.mode, "dark", "刷新后应恢复深色模式");
    assert.equal(persisted.palette, "emerald", "刷新后应恢复调色板");
    assert.equal(persisted.style, "liquid", "刷新后应恢复材质");
    const darkVisuals = await page.evaluate(() => ({
      metricValue: getComputedStyle(document.querySelector(".metric-value")).color,
      costValue: getComputedStyle(document.querySelector(".cost-value")).color,
      quotaValue: getComputedStyle(document.querySelector(".quota-risk-list .risk-row .value")).color,
      primaryBackground: getComputedStyle(document.querySelector(".metric-primary")).backgroundImage,
    }));
    assert.equal(darkVisuals.metricValue, "rgb(232, 240, 251)", "深色总览指标应使用高对比度文字");
    assert.equal(darkVisuals.costValue, "rgb(232, 240, 251)", "深色费用数值应使用高对比度文字");
    assert.equal(darkVisuals.quotaValue, "rgb(232, 240, 251)", "深色额度数值应使用高对比度文字");
    assert.doesNotMatch(darkVisuals.primaryBackground, /255, 255, 255/, "深色主指标卡不能残留白色背景");

    await toggle.click();
    const backgroundInput = page.locator("#backgroundInput");
    assert.equal(await backgroundInput.getAttribute("accept"), "image/*", "背景选择器只接受图片");
    assert.equal(await page.locator("#backgroundOpacity").count(), 1, "应提供背景遮罩强度配置");
    assert.equal(await page.locator("#backgroundBlur").count(), 1, "应提供背景模糊配置");
    assert.equal(await page.locator("#clearBackground").count(), 1, "应支持移除自定义背景");

    await backgroundInput.setInputFiles({
      name: "theme-test.svg",
      mimeType: "image/svg+xml",
      buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#123456"/></svg>'),
    });
    await page.waitForFunction(() => document.documentElement.dataset.hasBackground === "true");
    assert.match(await page.locator("#backgroundStatus").innerText(), /已应用/);

    await page.locator("#backgroundOpacity").fill("72");
    await page.locator("#backgroundOpacity").dispatchEvent("input");
    await page.locator("#backgroundBlur").fill("6");
    await page.locator("#backgroundBlur").dispatchEvent("input");
    assert.equal(await page.evaluate(() => localStorage.getItem("codexscope-background-opacity")), "72");
    assert.equal(await page.evaluate(() => localStorage.getItem("codexscope-background-blur")), "6");

    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(() => document.documentElement.dataset.hasBackground === "true");
    assert.equal((await appearanceState(page)).hasBackground, "true", "背景图片应从本地数据库恢复");

    await toggle.click();
    await page.locator("#clearBackground").click();
    await page.waitForFunction(() => document.documentElement.dataset.hasBackground === "false");

    await page.keyboard.press("Escape");
    assert.equal(await menu.isHidden(), true, "Escape 应关闭外观面板");

    await page.setViewportSize({ width: 390, height: 844 });
    await toggle.click();
    const mobileLayout = await page.evaluate(() => {
      const button = document.querySelector("#themeToggle").getBoundingClientRect();
      const popup = document.querySelector("#themeMenu").getBoundingClientRect();
      return {
        buttonHeight: button.height,
        noHorizontalScroll: document.documentElement.scrollWidth <= innerWidth + 1,
        popupInViewport: popup.left >= 0 && popup.right <= innerWidth,
        popupFitsHeight: popup.top >= 0 && popup.bottom <= innerHeight,
      };
    });
    assert.ok(mobileLayout.buttonHeight >= 44, "移动端外观按钮触控高度至少为 44px");
    assert.equal(mobileLayout.noHorizontalScroll, true, "外观面板不应造成横向滚动");
    assert.equal(mobileLayout.popupInViewport, true, "移动端外观面板应位于视口内");
    assert.equal(mobileLayout.popupFitsHeight, true, "移动端外观面板应限制在视口高度内");
    assert.deepEqual(pageErrors, [], `页面脚本异常：${pageErrors.join(" | ")}`);

    console.log("Appearance verification passed: mode, palette, material, local background, persistence, and mobile layout.");
  } finally {
    await context.close();
    await browser.close();
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
