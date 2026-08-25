const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require("playwright");

const root = __dirname;
const sampleSource = fs.readFileSync(path.join(root, "data.sample.js"), "utf8");
const realFixture = sampleSource
  .replace("window.CODEXSCOPE_SAMPLE_DATA =", "window.CODEXSCOPE_DATA =")
  .replace("sample: true", "sample: false")
  .replace('generatedAt: "2026-05-09 00:16:00"', 'generatedAt: "2099-01-01 00:00:00"');

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

async function startRaceServer() {
  let dataReady = false;
  let dataRequests = 0;
  let pageLoads = 0;
  const eventStreams = new Set();

  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    if (pathname === "/events") {
      response.writeHead(200, {
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Content-Type": "text/event-stream; charset=utf-8",
      });
      response.write(": connected\n\n");
      eventStreams.add(response);
      request.on("close", () => eventStreams.delete(response));
      return;
    }

    if (pathname === "/data.js") {
      dataRequests += 1;
      if (dataRequests === 1) {
        setTimeout(() => { dataReady = true; }, 700);
      }
      if (!dataReady) {
        response.writeHead(404, { "Cache-Control": "no-store" });
        response.end("not ready");
        return;
      }
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": contentTypes[".js"],
      });
      response.end(realFixture);
      return;
    }

    const relative = pathname === "/" ? "index.html" : pathname.slice(1);
    const filePath = path.join(root, relative);
    if (!filePath.startsWith(root) || !fs.existsSync(filePath)) {
      response.writeHead(404);
      response.end("not found");
      return;
    }
    if (relative === "index.html") pageLoads += 1;
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type": contentTypes[path.extname(filePath)] || "application/octet-stream",
    });
    response.end(fs.readFileSync(filePath));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}/`,
    stats: () => ({ dataRequests, pageLoads }),
    close: async () => {
      eventStreams.forEach((stream) => stream.destroy());
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

(async () => {
  const raceServer = await startRaceServer();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.addInitScript(() => localStorage.setItem("codexscope-live-enabled", "false"));

  try {
    await page.goto(raceServer.url, { waitUntil: "domcontentloaded" });
    assert.equal(await page.locator("#sourcePrimary").textContent(), "示例数据", "应先稳定复现启动阶段的示例数据回退");
    await page.waitForFunction(() => document.querySelector("#liveStatusText")?.textContent === "实时监控已暂停");

    await page.waitForFunction(() => document.querySelector("#sourcePrimary")?.textContent === "Codex 桌面端", null, {
      timeout: 6000,
    });

    assert.equal(await page.locator("#syncText").textContent(), "00:00 已同步");
    assert.ok(raceServer.stats().dataRequests >= 2, "页面应重新探测已经就绪的 data.js");
    assert.ok(raceServer.stats().pageLoads >= 2, "真实数据就绪后应自动刷新页面");
    console.log("Live data verification passed: startup fallback recovers from sample to real data.");
  } finally {
    await browser.close();
    await raceServer.close();
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
