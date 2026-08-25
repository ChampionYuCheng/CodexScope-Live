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
const updatedFixture = realFixture.replace(
  'generatedAt: "2099-01-01 00:00:00"',
  'generatedAt: "2099-01-01 00:05:00"',
);

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

async function startRaceServer({ generationError = false, statusMissing = false, initialDataReady = false } = {}) {
  const privatePrefix = "/test-access-token";
  let dataReady = initialDataReady;
  let dataFixture = realFixture;
  let dataRequests = 0;
  let pageLoads = 0;
  const eventStreams = new Set();

  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    if (pathname === `${privatePrefix}/events`) {
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

    if (pathname === `${privatePrefix}/status`) {
      if (statusMissing) {
        response.writeHead(404, { "Cache-Control": "no-store" });
        response.end("not found");
        return;
      }
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": "application/json; charset=utf-8",
      });
      response.end(JSON.stringify({ state: generationError ? "error" : (dataReady ? "ok" : "pending") }));
      return;
    }

    if (pathname === `${privatePrefix}/data.js`) {
      dataRequests += 1;
      if (!initialDataReady && dataRequests === 1) {
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
      response.end(dataFixture);
      return;
    }

    const relative = pathname === `${privatePrefix}/`
      ? "index.html"
      : pathname.slice(`${privatePrefix}/`.length);
    const filePath = path.join(root, relative);
    if (
      !filePath.startsWith(root)
      || !fs.existsSync(filePath)
      || !fs.statSync(filePath).isFile()
    ) {
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
    url: `http://127.0.0.1:${address.port}${privatePrefix}/`,
    stats: () => ({ dataRequests, pageLoads }),
    publishData: (fixture = updatedFixture) => {
      dataFixture = fixture;
      dataReady = true;
      eventStreams.forEach((stream) => stream.write("event: data\ndata: changed\n\n"));
    },
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
  let errorServer;
  let oldServer;
  let liveUpdateServer;
  await page.addInitScript(() => localStorage.setItem("codexscope-live-enabled", "false"));

  try {
    await page.goto(raceServer.url, { waitUntil: "domcontentloaded" });
    assert.equal(await page.locator("#sourcePrimary").textContent(), "示例数据", "应先稳定复现启动阶段的示例数据回退");
    await page.waitForFunction(() => document.querySelector("#liveStatusText")?.textContent === "正在生成本地数据…");

    await page.waitForFunction(() => document.querySelector("#sourcePrimary")?.textContent === "Codex 桌面端", null, {
      timeout: 6000,
    });

    assert.equal(await page.locator("#syncText").textContent(), "00:00 已同步");
    assert.ok(raceServer.stats().dataRequests >= 2, "页面应重新探测已经就绪的 data.js");
    assert.equal(raceServer.stats().pageLoads, 1, "真实数据就绪后应只更新数据，不重新加载 HTML 页面");

    liveUpdateServer = await startRaceServer({ initialDataReady: true });
    const livePage = await browser.newPage();
    await livePage.goto(liveUpdateServer.url, { waitUntil: "domcontentloaded" });
    await livePage.waitForFunction(
      () => document.querySelector("#liveStatusText")?.textContent === "实时监控中",
    );
    liveUpdateServer.publishData();
    await livePage.waitForFunction(() => document.querySelector("#syncText")?.textContent === "00:05 已同步");
    assert.equal(liveUpdateServer.stats().pageLoads, 1, "SSE 数据事件不应触发整页重载");
    await livePage.close();

    errorServer = await startRaceServer({ generationError: true });
    const errorPage = await browser.newPage();
    await errorPage.goto(errorServer.url, { waitUntil: "domcontentloaded" });
    await errorPage.waitForFunction(
      () => document.querySelector("#liveStatusText")?.textContent === "数据生成失败，请查看程序窗口",
    );
    await errorPage.close();

    oldServer = await startRaceServer({ statusMissing: true });
    const oldServerPage = await browser.newPage();
    await oldServerPage.goto(oldServer.url, { waitUntil: "domcontentloaded" });
    await oldServerPage.waitForFunction(
      () => document.querySelector("#liveStatusText")?.textContent === "服务版本过旧，请重新启动",
      null,
      { timeout: 3000 },
    );
    await oldServerPage.close();
    console.log("Live data verification passed: startup and SSE updates replace data without page reload.");
  } finally {
    await browser.close();
    await raceServer.close();
    if (errorServer) await errorServer.close();
    if (oldServer) await oldServer.close();
    if (liveUpdateServer) await liveUpdateServer.close();
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
