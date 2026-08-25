const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require("playwright");

const pageUrl = `file://${path.resolve(__dirname, "index.html").replace(/\\/g, "/")}`;
const expectedTabs = ["overview", "quota", "token", "session", "model", "rate"];

async function selectedTab(page) {
  return page.locator('[role="tab"][aria-selected="true"]').getAttribute("data-tab");
}

async function visiblePanel(page) {
  return page.locator('[role="tabpanel"]:visible').getAttribute("data-tab-panel");
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await page.goto(`${pageUrl}#overview`, { waitUntil: "load" });

    const tabs = page.locator('[role="tab"]');
    const panels = page.locator('[role="tabpanel"]');
    assert.equal(await tabs.count(), expectedTabs.length, "应该渲染 6 个语义化 Tab");
    assert.equal(await panels.count(), expectedTabs.length, "应该渲染 6 个互斥 Tab 页面");
    assert.deepEqual(await tabs.evaluateAll((nodes) => nodes.map((node) => node.dataset.tab)), expectedTabs);
    assert.equal(await page.locator('[role="tabpanel"]:visible').count(), 1, "初始只能显示一个 Tab 页面");
    assert.equal(await selectedTab(page), "overview");
    assert.equal(await visiblePanel(page), "overview");

    await page.locator('[role="tab"][data-tab="session"]').click();
    assert.equal(await selectedTab(page), "session");
    assert.equal(await visiblePanel(page), "session");
    assert.equal(new URL(page.url()).hash, "#session");
    assert.equal(await page.locator('#tab-overview-panel').isHidden(), true);

    await page.goBack();
    assert.equal(await selectedTab(page), "overview", "浏览器返回应恢复上一个 Tab");
    assert.equal(await visiblePanel(page), "overview");

    await page.goForward();
    assert.equal(await selectedTab(page), "session", "浏览器前进应恢复下一个 Tab");
    assert.equal(await visiblePanel(page), "session");

    const sessionTab = page.locator('[role="tab"][data-tab="session"]');
    await sessionTab.focus();
    await sessionTab.press("ArrowRight");
    assert.equal(await selectedTab(page), "model", "ArrowRight 应切到下一个 Tab");
    assert.equal(await visiblePanel(page), "model");
    assert.equal(await page.locator('[role="tab"][data-tab="model"]').evaluate((node) => node === document.activeElement), true);

    await page.locator('[role="tab"][data-tab="model"]').press("Home");
    assert.equal(await selectedTab(page), "overview", "Home 应切到第一个 Tab");
    await page.locator('[role="tab"][data-tab="overview"]').press("End");
    assert.equal(await selectedTab(page), "rate", "End 应切到最后一个 Tab");

    await page.goto(`${pageUrl}#model`, { waitUntil: "load" });
    assert.equal(await selectedTab(page), "model", "URL 哈希应恢复对应 Tab");
    assert.equal(await visiblePanel(page), "model");
    await page.reload({ waitUntil: "load" });
    assert.equal(await selectedTab(page), "model", "刷新后应保留当前 Tab");
    assert.equal(await visiblePanel(page), "model");
    assert.deepEqual(pageErrors, [], `页面脚本异常：${pageErrors.join(" | ")}`);

    console.log("Tab verification passed: 6 pages, URL state, refresh, and keyboard navigation.");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
