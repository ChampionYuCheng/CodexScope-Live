const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require("playwright");

const pageUrl = "file://" + path.resolve(__dirname, "index.html").replace(/\\/g, "/");
const viewports = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 768, height: 900 },
  { width: 390, height: 844 },
  { width: 375, height: 812 },
];

function quotaFixture() {
  const view = {
    label: "今天",
    summary: {
      totalTokensLabel: "1.20M", inputLabel: "1.00M", cachedLabel: "800K",
      outputLabel: "180K", reasoningLabel: "20K", requestsLabel: "120",
      failures: 2, successRateLabel: "98.3%", cacheHitLabel: "80.0%",
      peakLabel: "120K", peakTime: "14:20", peakTpmLabel: "120K TPM",
    },
    cost: { total: 1.2, average: 0.01, rangeTokensLabel: "1.20M", parts: [] },
    trend: [["14:00", 600000, 400000, 90000, 500000, 10000, 60, 0.6], ["14:20", 600000, 400000, 90000, 500000, 10000, 60, 0.6]],
    distribution: [["14:00", 600000, 60, 0.6], ["14:20", 600000, 60, 0.6]],
    sessions: [], models: [], costModels: [],
    risk: [
      { name: "5h 窗口", value: 72, label: "72% 剩余", note: "已用 28% · 15:30", tone: "blue", percentLabel: "72%" },
      { name: "周限额", value: 54, label: "54% 剩余", note: "已用 46% · 周一", tone: "teal", percentLabel: "54%" },
      { name: "缓存", value: 80, label: "命中 80%", note: "输入 token", tone: "teal", percentLabel: "80%" },
      { name: "失败", value: 1.7, label: "1.7%", note: "2 次失败", tone: "amber", percentLabel: "1.7%" },
    ],
  };
  return {
    schemaVersion: 2,
    generatedAt: "2026-08-31 14:30:00",
    availableRange: { start: Date.now() - 86400000, end: Date.now() },
    limits: { planType: "pro", primaryRemaining: 72, primaryUsed: 28, secondaryRemaining: 54, secondaryUsed: 46 },
    pricingRules: [],
    views: { "24h": view, today: view, "7": view, "30": view, history: view },
  };
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const mode of ["light", "dark"]) {
      for (const viewport of viewports) {
        const context = await browser.newContext({ viewport });
        const page = await context.newPage();
        const pageErrors = [];
        page.on("pageerror", (error) => pageErrors.push(error.message));
        await page.addInitScript(({ fixture, selectedMode }) => {
          localStorage.setItem("codexscope-mode", selectedMode);
          Object.defineProperty(window, "CODEXSCOPE_DATA", {
            configurable: true,
            get: () => fixture,
            set: () => {},
          });
        }, { fixture: quotaFixture(), selectedMode: mode });
        await page.goto(pageUrl + "#quota", { waitUntil: "load" });
        await page.locator("#tab-quota-panel").waitFor({ state: "visible" });
        const report = await page.evaluate(() => {
          const quota = document.querySelector(".quota");
          const ring = document.querySelector(".ringbox");
          const risk = document.querySelector(".quota-risk");
          const panel = document.querySelector("#quotaPanel");
          const tracks = Array.from(document.querySelectorAll(".quota-risk-list .risk-row .track"));
          const rows = Array.from(document.querySelectorAll(".quota-risk-list .risk-row"));
          const value = document.querySelector(".quota-risk-list .risk-row .value");
          const name = document.querySelector(".quota-risk-list .risk-row strong");
          const rect = (element) => element.getBoundingClientRect();
          const rgb = (value) => (value.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
          const luminance = (color) => {
            const channels = rgb(color).map((channel) => {
              const normalized = channel / 255;
              return normalized <= .03928 ? normalized / 12.92 : ((normalized + .055) / 1.055) ** 2.4;
            });
            return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2];
          };
          const contrast = (foreground, background) => {
            const first = luminance(foreground);
            const second = luminance(background);
            return (Math.max(first, second) + .05) / (Math.min(first, second) + .05);
          };
          const probe = document.createElement("span");
          probe.style.color = "var(--panel-solid)";
          document.body.appendChild(probe);
          const panelSolid = getComputedStyle(probe).color;
          probe.remove();
          const ringRect = rect(ring);
          const riskRect = rect(risk);
          const panelRect = rect(panel);
          return {
            noHorizontalScroll: document.documentElement.scrollWidth <= innerWidth + 1,
            trackMinHeight: Math.min(...tracks.map((track) => rect(track).height)),
            rowMinHeight: Math.min(...rows.map((row) => rect(row).height)),
            valueContrast: contrast(getComputedStyle(value).color, panelSolid),
            nameContrast: contrast(getComputedStyle(name).color, panelSolid),
            valueWeight: Number(getComputedStyle(value).fontWeight),
            withinPanel: ringRect.left >= panelRect.left - 1 && ringRect.right <= panelRect.right + 1
              && riskRect.left >= panelRect.left - 1 && riskRect.right <= panelRect.right + 1,
            nonOverlapping: innerWidth > 700 ? ringRect.right <= riskRect.left + 1 : ringRect.bottom <= riskRect.top + 1,
          };
        });
        const label = `${mode} ${viewport.width}x${viewport.height}`;
        assert.equal(report.noHorizontalScroll, true, `${label} 不应横向滚动`);
        assert.ok(report.trackMinHeight >= 9.9, `${label} 额度进度条应约为 10px 或更粗，实际 ${report.trackMinHeight}`);
        assert.ok(report.rowMinHeight >= 44, `${label} 额度行至少 44px，实际 ${report.rowMinHeight}`);
        assert.ok(report.valueContrast >= 4.5, `${label} 数值对比度不足：${report.valueContrast}`);
        assert.ok(report.nameContrast >= 4.5, `${label} 名称对比度不足：${report.nameContrast}`);
        assert.ok(report.valueWeight >= 700, `${label} 数值字重不足：${report.valueWeight}`);
        assert.equal(report.withinPanel, true, `${label} 额度内容越出面板`);
        assert.equal(report.nonOverlapping, true, `${label} 环形图与进度区域重叠`);
        assert.deepEqual(pageErrors, [], `${label} 页面脚本异常：${pageErrors.join(" | ")}`);
        await context.close();
      }
    }
    console.log("Quota layout verification passed: responsive tracks, touch rows, and light/dark contrast.");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
