const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require("playwright");

const pageUrl = "file://" + path.resolve(__dirname, "index.html").replace(/\\/g, "/");
const fixtureClock = new Date();
fixtureClock.setHours(10, 30, 0, 0);
const fixtureDay = [fixtureClock.getFullYear(), String(fixtureClock.getMonth() + 1).padStart(2, "0"), String(fixtureClock.getDate()).padStart(2, "0")].join("-");
const fixtureNow = fixtureClock.getTime();
const fixtureTimestamp = (minute, second = 0) => `${fixtureDay} 10:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`;

function mixedSessionFixture() {
  const now = fixtureNow;
  const view = {
    label: "今天",
    summary: {
      totalTokensLabel: "40",
      inputLabel: "30",
      cachedLabel: "10",
      outputLabel: "8",
      reasoningLabel: "2",
      requestsLabel: "2",
      failures: 0,
      successRateLabel: "100.0%",
      cacheHitLabel: "33.3%",
      peakLabel: "30",
      peakTime: "10:20",
      peakTpmLabel: "30 TPM",
    },
    cost: { total: 0.01, average: 0.005, rangeTokensLabel: "40", parts: [] },
    trend: [
       ["10:00", 10, 2, 3, 10, 1, 1, 0.004],
       ["10:20", 1549, 8, 5, 20, 1, 1, 0.004],
    ],
    distribution: [
       ["10:00", 10, 1, 0.004],
       ["10:20", 1549, 1, 0.004],
    ],
    sessions: [{
      rank: 1,
      name: "mixed-session",
      model: "gpt-5.6-terra",
      latestModel: "gpt-5.6-terra",
      latestEffort: "low",
      tokens: 40,
      tokensLabel: "40",
      requests: 2,
      tokenPercent: 100,
      requestPercent: 100,
      status: "ok",
      modelBreakdown: [
        { model: "gpt-5.6-terra", tokens: 30, requests: 1 },
        { model: "gpt-5.6-sol", tokens: 10, requests: 1 },
      ],
      effortBreakdown: [
        { effort: "low", tokens: 30, requests: 1 },
        { effort: "high", tokens: 10, requests: 1 },
      ],
      ttfbMedianMs: 400,
      ttfbP90Ms: 500,
      durationMedianMs: 1700,
      durationP90Ms: 2200,
    }],
    models: [],
    costModels: [],
    risk: [],
  };
  return {
    schemaVersion: 2,
    generatedAt: fixtureTimestamp(30),
    availableRange: { start: now - 3600000, end: now },
    views: { "24h": view, today: view, "7": view, "30": view, history: view },
    limits: { planType: "pro", primaryRemaining: 75, primaryUsed: 25 },
    pricingRules: [],
  };
}

function legacyDuplicateSessionFixture() {
  const fixture = mixedSessionFixture();
  const duplicate = structuredClone(fixture);
  duplicate.records = [];
  const view = duplicate.views.today;
  view.sessions = [
    { name: "same-name", model: "gpt-5.6-sol", latestModel: "gpt-5.6-sol", latestEffort: "high", tokens: 20, tokensLabel: "20", requests: 1, tokenPercent: 100, requestPercent: 100, status: "ok", modelBreakdown: [], effortBreakdown: [] },
    { name: "same-name", model: "gpt-5.6-terra", latestModel: "gpt-5.6-terra", latestEffort: "low", tokens: 10, tokensLabel: "10", requests: 1, tokenPercent: 50, requestPercent: 100, status: "ok", modelBreakdown: [], effortBreakdown: [] },
  ];
  for (const key of ["24h", "7", "30", "history"]) duplicate.views[key] = view;
  return duplicate;
}

function mixedRawFixture() {
  const recordBase = fixtureNow - 30 * 60 * 1000;
  return {
    schemaVersion: 2,
    rawSchemaVersion: 1,
    recordBase,
    catalog: {
      sessions: [["sid-mixed", "mixed-session", "gpt-5.6-sol"]],
      models: ["gpt-5.6-sol", "gpt-5.6-terra"],
      turns: ["turn-sol", "turn-terra"],
      efforts: ["high", "low"],
    },
    recordsV2: [
      [0, 0, 0, 10, 2, 1, 0, 10, 0, 0],
      [1200000, 0, 1, 20, 8, 5, 1, 30, 1, 1],
    ],
    completionRecordsV2: [
      [1000, 0, 0, 1200, 300, 0, 0],
      [1201000, 0, 1, 2200, 500, 1, 1],
    ],
    ttfbRecordsV2: [[1000, 0, 0, 300], [1201000, 0, 1, 500]],
    failureRecordsV2: [],
  };
}

async function svgEndpointAlignment(page, pathSelector, markerId) {
  return page.evaluate(({ selector, id }) => {
    const path = document.querySelector(selector);
    const svg = path?.ownerSVGElement;
    const marker = document.querySelector(`[data-chart-marker="${id}"]`);
    if (!(path instanceof SVGPathElement) || !(svg instanceof SVGSVGElement) || !(marker instanceof HTMLElement)) return null;
    const endpoint = path.getPointAtLength(path.getTotalLength());
    const svgPoint = svg.createSVGPoint();
    svgPoint.x = endpoint.x;
    svgPoint.y = endpoint.y;
    const matrix = path.getScreenCTM();
    if (!matrix) return null;
    const expected = svgPoint.matrixTransform(matrix);
    const markerRect = marker.getBoundingClientRect();
    return {
      dx: Math.abs(markerRect.left + markerRect.width / 2 - expected.x),
      dy: Math.abs(markerRect.top + markerRect.height / 2 - expected.y),
    };
  }, { selector: pathSelector, id: markerId });
}

async function elementTopAlignment(page, elementSelector, markerId) {
  return page.evaluate(({ selector, id }) => {
    const element = document.querySelector(selector);
    const marker = document.querySelector(`[data-chart-marker="${id}"]`);
    if (!(element instanceof Element) || !(marker instanceof HTMLElement)) return null;
    const elementRect = element.getBoundingClientRect();
    const markerRect = marker.getBoundingClientRect();
    return {
      dx: Math.abs(markerRect.left + markerRect.width / 2 - (elementRect.left + elementRect.width / 2)),
      dy: Math.abs(markerRect.top + markerRect.height / 2 - elementRect.top),
    };
  }, { selector: elementSelector, id: markerId });
}

function assertAligned(alignment, label) {
  assert.ok(alignment, `${label}必须能计算真实数据点坐标`);
  assert.ok(alignment.dx <= 2.5 && alignment.dy <= 2.5, `${label}悬浮点偏移 dx=${alignment.dx.toFixed(2)}px dy=${alignment.dy.toFixed(2)}px`);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.addInitScript(({ fixture, rawFixture }) => {
    let current = fixture;
    let currentRaw = rawFixture;
    Object.defineProperty(window, "CODEXSCOPE_DATA", {
      configurable: true,
      get: () => current,
      set: (next) => {
        if (typeof window.CODEXSCOPE_APPLY_DATA === "function") current = next;
      },
    });
    Object.defineProperty(window, "CODEXSCOPE_RAW_DATA", {
      configurable: true,
      get: () => currentRaw,
      set: () => {},
    });
    window.__setRawFixture = (next) => { currentRaw = next; };
  }, { fixture: mixedSessionFixture(), rawFixture: mixedRawFixture() });

  try {
    await page.goto(pageUrl + "#session", { waitUntil: "load" });
    const row = page.locator(".session-row[data-session-index='0']");
    await row.waitFor({ state: "visible" });
    assert.equal(await row.getAttribute("role"), "button", "会话行必须使用按钮语义");
    assert.equal(await row.getAttribute("tabindex"), "0", "会话行必须可通过键盘聚焦");
    assert.equal(await row.getAttribute("aria-expanded"), "false", "会话详情默认收起");

    await row.focus();
    await row.press("Enter");
    assert.equal(await row.getAttribute("aria-expanded"), "true", "Enter 应展开会话详情");
    const detail = page.locator(".session-detail[data-session-index='0']");
    await detail.waitFor({ state: "visible" });
    const text = await detail.innerText();
    for (const expected of ["gpt-5.6-sol", "gpt-5.6-terra", "high", "low", "TTFB", "400ms", "500ms", "整轮耗时", "1.70s", "2.20s"]) {
      assert.equal(text.includes(expected), true, "会话详情缺少 " + expected);
    }

    await page.locator(".period-btn[data-range='custom']").click();
    await page.locator("#startDate").fill(fixtureDay);
    await page.locator("#endDate").fill(fixtureDay);
    await page.locator("#endDate").dispatchEvent("change");
    await page.waitForFunction((day) => (document.querySelector("#rangeSummary")?.textContent || "").includes(day), fixtureDay);
    const customRow = page.locator(".session-row[data-session-index='0']");
    const customRowText = await customRow.innerText();
    assert.equal(customRowText.includes("gpt-5.6-terra"), true, "自定义区间应显示同一会话的最新 Terra 模型");
    assert.equal(customRowText.includes("low"), true, "自定义区间应显示最新推理档位");
    await customRow.press("Enter");
    const customDetailText = await page.locator(".session-detail[data-session-index='0']").innerText();
    for (const expected of ["gpt-5.6-sol", "gpt-5.6-terra", "high", "low", "400ms", "500ms", "1.70s", "2.20s"]) {
      assert.equal(customDetailText.includes(expected), true, "自定义区间会话详情缺少 " + expected);
    }

    await page.evaluate(async (generatedAt) => {
      window.__setRawFixture({ ...window.CODEXSCOPE_RAW_DATA, recordsV2: [], completionRecordsV2: [], ttfbRecordsV2: [], failureRecordsV2: [] });
      await window.CODEXSCOPE_APPLY_DATA({
        schemaVersion: 2,
        generatedAt,
        rawDataPath: "missing-data.raw.js",
        availableRange: { start: Date.now() - 3600000, end: Date.now() },
        views: {},
        limits: {},
      });
    }, fixtureTimestamp(32));
    const clearedState = await page.evaluate(() => {
      const trend = document.querySelector("#trendChart");
      const distribution = document.querySelector("#distributionChart");
      return {
        trendMax: trend?.getAttribute("aria-valuemax") ?? null,
        distributionMax: distribution?.getAttribute("aria-valuemax") ?? null,
        trendTips: document.querySelectorAll("[data-chart-tooltip='trend']").length,
        requestTips: document.querySelectorAll("[data-chart-tooltip='requests']").length,
      };
    });
    assert.deepEqual(clearedState, { trendMax: null, distributionMax: null, trendTips: 0, requestTips: 0 }, "空数据必须清理所有稳定图表交互状态");
    assert.equal(await page.locator("#trendChart").getAttribute("aria-valuemax"), null, "空数据后 Token 图不得保留 slider ARIA");
    assert.equal(await page.locator("[data-chart-tooltip='trend']").count(), 0, "空数据后不得保留 Token 旧 tooltip");
    assert.equal(await page.locator("[data-chart-crosshair='trend']").count(), 0, "空数据后不得保留 Token 旧 crosshair");
    assert.equal(await page.locator("[data-chart-marker='trend']").count(), 0, "空数据后不得保留 Token 旧 marker");
    assert.equal(await page.locator("#distributionChart").getAttribute("aria-valuemax"), null, "空数据后速率图不得保留 slider ARIA");
    assert.equal(await page.locator("[data-chart-tooltip='requests']").count(), 0, "空数据后不得保留 spark 旧 tooltip");

    await page.evaluate(async ({ legacy }) => {
      window.__setRawFixture(undefined);
      await window.CODEXSCOPE_APPLY_DATA(legacy);
    }, { legacy: legacyDuplicateSessionFixture() });
    await page.locator(".period-btn[data-range='today']").click();
    const duplicateRows = page.locator(".session-row");
    assert.equal(await duplicateRows.count(), 2, "旧导出同名会话应分别渲染");
    assert.notEqual(await duplicateRows.nth(0).getAttribute("data-session-key"), await duplicateRows.nth(1).getAttribute("data-session-key"), "旧导出同名会话必须使用不同的渲染期键");
    await duplicateRows.nth(0).press("Enter");
    assert.equal(await duplicateRows.nth(0).getAttribute("aria-expanded"), "true", "第一个同名会话应独立展开");
    assert.equal(await duplicateRows.nth(1).getAttribute("aria-expanded"), "false", "第二个同名会话不得被同名键连带展开");
    await page.evaluate(async (generatedAt) => {
      const next = structuredClone(window.CODEXSCOPE_DATA);
      next.generatedAt = generatedAt;
      await window.CODEXSCOPE_APPLY_DATA(next);
    }, fixtureTimestamp(33));
    assert.equal(await page.locator(".session-row[aria-expanded='true']").count(), 0, "旧导出刷新后不得按名称恢复展开态");
    await page.locator(".period-btn[data-range='today']").click();
    await page.waitForFunction(() => (document.querySelector("#rangeSummary")?.textContent || "").includes("今天"));

    await page.locator("#tab-token").click();
    const trendChart = page.locator("#trendChart");
    assert.equal(await trendChart.getAttribute("role"), "slider", "Token 图必须提供可拖动的 slider 语义");
    assert.equal(await trendChart.getAttribute("tabindex"), "0", "Token 图必须可通过键盘聚焦");
    const trendBox = await trendChart.boundingBox();
    assert.ok(trendBox, "Token 图必须有可交互尺寸");
    await page.mouse.move(trendBox.x + trendBox.width * 0.08, trendBox.y + trendBox.height * 0.55);
    await page.mouse.down();
    await page.mouse.move(trendBox.x + trendBox.width * 0.92, trendBox.y + trendBox.height * 0.4, { steps: 5 });
    await page.mouse.up();
    assert.equal(await trendChart.getAttribute("aria-valuenow"), "1", "拖动到末端应选择最后一个时间点");
    assert.equal(await trendChart.getAttribute("data-chart-pinned"), "true", "拖动结束后提示应固定");
    const trendTip = page.locator("[data-chart-tooltip='trend']");
    await trendTip.waitFor({ state: "visible" });
    const trendText = await trendTip.innerText();
    for (const expected of ["10:20", "总量", "1,559 Token"]) {
      assert.equal(trendText.includes(expected), true, "Token 提示缺少 " + expected);
    }
    await page.evaluate(() => {
      const chartWrap = document.querySelector("#trendChart")?.parentElement;
      if (chartWrap) chartWrap.style.height = "500px";
    });
    await trendChart.focus();
    await trendChart.press("End");
    const trendAlignment = await page.evaluate(() => {
      const svg = document.querySelector("#trendChart");
      const path = svg?.querySelector("path[data-series='total']");
      const marker = document.querySelector("[data-chart-marker='trend']");
      if (!(svg instanceof SVGSVGElement) || !(path instanceof SVGPathElement) || !(marker instanceof HTMLElement)) return null;
      const svgPoint = svg.createSVGPoint();
      const endpoint = path.getPointAtLength(path.getTotalLength());
      svgPoint.x = endpoint.x;
      svgPoint.y = endpoint.y;
      const matrix = path.getScreenCTM();
      if (!matrix) return null;
      const expected = svgPoint.matrixTransform(matrix);
      const markerRect = marker.getBoundingClientRect();
      const actual = { x: markerRect.left + markerRect.width / 2, y: markerRect.top + markerRect.height / 2 };
      return { dx: Math.abs(actual.x - expected.x), dy: Math.abs(actual.y - expected.y) };
    });
    assert.ok(trendAlignment, "Token 图必须能计算 SVG 数据点与悬浮标记坐标");
    assert.ok(
      trendAlignment.dx <= 2.5 && trendAlignment.dy <= 2.5,
      `Token 悬浮点必须落在线上，当前偏移 dx=${trendAlignment.dx.toFixed(2)}px dy=${trendAlignment.dy.toFixed(2)}px`,
    );
    const trendKindButtons = page.locator(".chart-kind[data-chart-target='trend']");
    assert.equal(await trendKindButtons.count(), 2, "Token 图必须提供折线图和柱状图两种显示方式");
    const trendBarButton = page.locator(".chart-kind[data-chart-target='trend'][data-chart-kind='bar']");
    await trendBarButton.click();
    assert.equal(await trendChart.getAttribute("data-chart-kind"), "bar", "Token 图切换后应标记为柱状图");
    assert.ok(await trendChart.locator("rect[data-series='total'][data-chart-index]").count() > 0, "Token 柱状图应渲染可定位的数据柱");
    await trendChart.focus();
    await trendChart.press("End");
    const trendBarAlignment = await page.evaluate(() => {
      const bar = document.querySelector("#trendChart rect[data-series='total'][data-chart-index='1']");
      const marker = document.querySelector("[data-chart-marker='trend']");
      if (!(bar instanceof SVGRectElement) || !(marker instanceof HTMLElement)) return null;
      const barRect = bar.getBoundingClientRect();
      const markerRect = marker.getBoundingClientRect();
      return {
        dx: Math.abs(markerRect.left + markerRect.width / 2 - (barRect.left + barRect.width / 2)),
        dy: Math.abs(markerRect.top + markerRect.height / 2 - barRect.top),
      };
    });
    assert.ok(trendBarAlignment, "Token 柱状图必须能计算柱顶与悬浮标记坐标");
    assert.ok(trendBarAlignment.dx <= 2.5 && trendBarAlignment.dy <= 2.5, "Token 柱状图悬浮点必须落在对应柱顶");
    await page.locator(".chart-kind[data-chart-target='trend'][data-chart-kind='line']").click();
    assert.equal(await trendChart.getAttribute("data-chart-kind"), "line", "Token 图应能切回折线图");
    await trendChart.focus();
    await trendChart.press("ArrowLeft");
    assert.equal(await trendChart.getAttribute("aria-valuenow"), "0", "方向键应移动 Token 图节点");
    await trendChart.press("Enter");

    await page.evaluate(async (generatedAt) => {
      const next = structuredClone(window.CODEXSCOPE_DATA);
      next.generatedAt = generatedAt;
      next.views.today.summary.requestsLabel = "3";
      await window.CODEXSCOPE_APPLY_DATA(next);
    }, fixtureTimestamp(31));
    assert.equal(await trendChart.getAttribute("aria-valuenow"), "0", "局部数据刷新后应保留选中节点");
    assert.equal(await trendChart.getAttribute("data-chart-pinned"), "true", "局部数据刷新后应保留固定提示");

    await page.locator("#tab-overview").click();
    const requestSpark = page.locator("[data-chart-id='requests']");
    await requestSpark.waitFor({ state: "visible" });
    assert.equal(await requestSpark.getAttribute("role"), "slider", "总览火花图必须支持键盘和指针交互");
    const sparkBox = await requestSpark.boundingBox();
    assert.ok(sparkBox, "调用量火花图必须有可交互尺寸");
    await page.mouse.move(sparkBox.x + sparkBox.width * 0.9, sparkBox.y + sparkBox.height * 0.5);
    const requestTip = page.locator("[data-chart-tooltip='requests']");
    await requestTip.waitFor({ state: "visible" });
    const requestText = await requestTip.innerText();
    assert.equal(requestText.includes("10:20"), true, "调用量提示应显示时间节点");
    assert.equal(requestText.includes("1 次调用"), true, "调用量提示应显示调用次数");
    assertAligned(await svgEndpointAlignment(page, "#requestSparkChart path[data-series='requests']", "requests"), "调用量折线图");
    const sparkCharts = [
      ["requests", "#requestSparkChart"],
      ["peak-rate", "#peakSparkChart"],
      ["cache-hit", "#cacheSparkChart"],
    ];
    for (const [target, selector] of sparkCharts) {
      assert.equal(await page.locator(`.chart-kind[data-chart-target='${target}']`).count(), 2, `${target} 总览图必须提供两种显示方式`);
      await page.locator(`.chart-kind[data-chart-target='${target}'][data-chart-kind='bar']`).click();
      assert.equal(await page.locator(selector).getAttribute("data-chart-kind"), "bar", `${target} 应切换为柱状图`);
      assert.ok(await page.locator(`${selector} rect[data-chart-index]`).count() > 0, `${target} 柱状图应渲染数据柱`);
      await page.locator(selector).focus();
      await page.locator(selector).press("End");
      assertAligned(await elementTopAlignment(page, `${selector} rect[data-chart-index='1']`, target), `${target} 柱状图`);
      await page.locator(`.chart-kind[data-chart-target='${target}'][data-chart-kind='line']`).click();
      assert.equal(await page.locator(selector).getAttribute("data-chart-kind"), "line", `${target} 应切回折线图`);
      assert.equal(await page.locator(`${selector} path[data-series='${target}']`).count(), 1, `${target} 折线图应渲染趋势线`);
    }
    await page.locator(".chart-kind[data-chart-target='requests'][data-chart-kind='bar']").click();
    await page.evaluate(async (generatedAt) => {
      const next = structuredClone(window.CODEXSCOPE_DATA);
      next.generatedAt = generatedAt;
      await window.CODEXSCOPE_APPLY_DATA(next);
    }, fixtureTimestamp(31, 30));
    assert.equal(await page.locator("#requestSparkChart").getAttribute("data-chart-kind"), "bar", "局部数据刷新后应保留总览图表类型");
    assert.equal(await page.locator("#peakSparkChart").getAttribute("data-chart-kind"), "line", "各总览图表类型必须相互独立");

    await page.locator("#tab-rate").click();
    const distributionChart = page.locator("#distributionChart");
    assert.equal(await distributionChart.getAttribute("role"), "slider", "速率柱状图必须支持连续时间节点交互");
    assert.equal(await page.locator(".chart-kind[data-chart-target='distribution']").count(), 2, "速率图必须提供折线图和柱状图两种显示方式");
    await page.locator(".chart-kind[data-chart-target='distribution'][data-chart-kind='line']").click();
    assert.equal(await distributionChart.getAttribute("data-chart-kind"), "line", "速率图应切换为折线图");
    assert.equal(await distributionChart.locator("svg.distribution-line-chart path[data-series='distribution']").count(), 1, "速率折线图应渲染趋势线");
    await distributionChart.focus();
    await distributionChart.press("End");
    assertAligned(await svgEndpointAlignment(page, "#distributionChart path[data-series='distribution']", "distribution"), "速率折线图");
    await page.locator(".chart-kind[data-chart-target='distribution'][data-chart-kind='bar']").click();
    assert.equal(await distributionChart.getAttribute("data-chart-kind"), "bar", "速率图应能切回柱状图");
    const lastDistributionBar = distributionChart.locator("[data-chart-index='1']");
    await lastDistributionBar.hover();
    const distributionTip = page.locator("[data-chart-tooltip='distribution']");
    await distributionTip.waitFor({ state: "visible" });
    const distributionText = await distributionTip.innerText();
    for (const expected of ["10:20", "1 次调用", "1,549 Token"]) {
      assert.equal(distributionText.includes(expected), true, "速率提示缺少 " + expected);
    }
    assertAligned(await elementTopAlignment(page, "#distributionChart .dist-bar[data-chart-index='1'] .dist-bar-fill", "distribution"), "速率柱状图");
    await distributionChart.focus();
    await distributionChart.press("End");
    await distributionChart.press("Enter");
    assert.equal(await distributionChart.getAttribute("data-chart-pinned"), "true", "速率图应支持键盘固定提示");

    await page.locator("#tab-model").click();
    const costChart = page.locator(".cost-chart");
    assert.equal(await costChart.getAttribute("role"), "slider", "费用走势必须支持连续时间节点交互");
    assert.equal(await page.locator(".chart-kind[data-chart-target='cost']").count(), 2, "费用走势图必须提供折线图和柱状图两种显示方式");
    await page.locator(".chart-kind[data-chart-target='cost'][data-chart-kind='line']").click();
    assert.equal(await page.locator(".cost-chart").getAttribute("data-chart-kind"), "line", "费用走势应切换为折线图");
    assert.equal(await page.locator(".cost-chart svg.cost-line-chart path[data-series='cost']").count(), 1, "费用折线图应渲染趋势线");
    await page.locator(".cost-chart").focus();
    await page.locator(".cost-chart").press("End");
    assertAligned(await svgEndpointAlignment(page, ".cost-chart path[data-series='cost']", "cost"), "费用折线图");
    await page.locator(".chart-kind[data-chart-target='cost'][data-chart-kind='bar']").click();
    assert.equal(await page.locator(".cost-chart").getAttribute("data-chart-kind"), "bar", "费用走势应能切回柱状图");
    const lastCostBar = costChart.locator("[data-chart-index='1']");
    await lastCostBar.hover();
    const costTip = page.locator("[data-chart-tooltip='cost']");
    await costTip.waitFor({ state: "visible" });
    const costText = await costTip.innerText();
    for (const expected of ["10:20", "费用", "$0.004", "1,549 Token", "1 次调用"]) {
      assert.equal(costText.includes(expected), true, "费用提示缺少 " + expected);
    }
    assertAligned(await elementTopAlignment(page, ".cost-chart [data-chart-index='1']", "cost"), "费用柱状图");
    assert.equal(await page.locator(".cost-chart").getAttribute("aria-valuetext"), "10:20，费用 $0.004，1,549 Token，1 次调用", "费用 aria 详细值应保留精度");

    await page.evaluate(async (day) => {
      window.__setRawFixture(undefined);
      for (let index = 0; index < 3; index += 1) {
        await window.CODEXSCOPE_APPLY_DATA({
          schemaVersion: 2,
          generatedAt: `${day} 10:34:0${index}`,
          rawDataPath: "missing-sidecar.raw.js",
          availableRange: { start: Date.now() - 3600000, end: Date.now() },
          views: {},
          limits: {},
        });
      }
    }, fixtureDay);
    await page.waitForTimeout(100);
    assert.equal(await page.locator("script[src*='missing-sidecar.raw.js']").count(), 0, "sidecar load 失败后 script 节点必须移除");
    assert.deepEqual(pageErrors, [], "页面脚本异常：" + pageErrors.join(" | "));
    console.log("Interaction verification passed.");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
