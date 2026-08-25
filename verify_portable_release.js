const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("playwright");

const repositoryRoot = __dirname;
const packageMetadata = require(path.join(repositoryRoot, "package.json"));
const releaseManifest = require(path.join(repositoryRoot, "release-manifest.json"));
const packageName = `CodexScope-Live-v${packageMetadata.version}-Windows-x64`;
const archivePath = path.join(repositoryRoot, "dist", `${packageName}.zip`);
const checksumPath = `${archivePath}.sha256`;

function isFile(filePath) {
  return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function peMachine(filePath) {
  const body = fs.readFileSync(filePath);
  assert.equal(body.subarray(0, 2).toString("ascii"), "MZ", `${filePath} is not a PE executable`);
  const peOffset = body.readUInt32LE(0x3c);
  assert.equal(body.subarray(peOffset, peOffset + 4).toString("binary"), "PE\u0000\u0000");
  return body.readUInt16LE(peOffset + 4);
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });
}

async function waitForResponse(url, predicate = (response) => response.ok, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { cache: "no-store", redirect: "follow" });
      if (await predicate(response)) return response;
      lastError = new Error(`${url} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}

function writeSessionFixture(sessionsRoot) {
  const timestamp = new Date().toISOString();
  const lines = [
    { type: "session_meta", payload: { id: "portable-fixture-session", cwd: "D:/portable-fixture-marker" } },
    { type: "turn_context", payload: { model: "gpt-portable-fixture", cwd: "D:/portable-fixture-marker" } },
    {
      timestamp,
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          last_token_usage: {
            input_tokens: 1234,
            cached_input_tokens: 234,
            output_tokens: 56,
            reasoning_output_tokens: 7,
          },
          total_token_usage: {
            input_tokens: 1234,
            cached_input_tokens: 234,
            output_tokens: 56,
            reasoning_output_tokens: 7,
          },
        },
      },
    },
    { timestamp, type: "event_msg", payload: { type: "task_complete", duration_ms: 2500 } },
  ];
  fs.writeFileSync(
    path.join(sessionsRoot, "portable-fixture.jsonl"),
    `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`,
    "utf8",
  );
}

async function startAttackerPage(scriptUrl) {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(`<!doctype html><script src="${scriptUrl}"></script><p>attacker</p>`);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function main() {
  assert.equal(packageMetadata.version, "0.2.0", "portable hardening release must be v0.2.0");
  assert.ok(isFile(archivePath), `missing release archive: ${archivePath}`);
  assert.ok(isFile(checksumPath), `missing release checksum: ${checksumPath}`);

  const checksumParts = fs.readFileSync(checksumPath, "utf8").trim().split(/\s+/);
  const expectedHash = checksumParts[0];
  assert.match(expectedHash, /^[a-f0-9]{64}$/i, "invalid SHA256 file");
  assert.equal(checksumParts.at(-1), `${packageName}.zip`, "checksum filename mismatch");
  assert.equal(sha256(archivePath), expectedHash.toLowerCase(), "archive SHA256 mismatch");

  const extractionRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codexscope-release-"));
  const sessionsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codexscope-sessions-"));
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codexscope-data-"));
  let server;
  let browser;
  let attacker;
  const output = [];

  try {
    const expand = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        "& { param($archive, $destination) Expand-Archive -LiteralPath $archive -DestinationPath $destination -Force }",
        archivePath,
        extractionRoot,
      ],
      { encoding: "utf8", windowsHide: true },
    );
    assert.equal(expand.status, 0, `failed to extract archive:\n${expand.stderr || expand.stdout}`);

    const packageRoot = path.join(extractionRoot, packageName);
    assert.ok(fs.statSync(packageRoot).isDirectory(), `archive root must be ${packageName}`);
    const requiredFiles = [...releaseManifest.runtimeFiles, ...releaseManifest.generatedPackageFiles];
    for (const relativePath of requiredFiles) {
      assert.ok(isFile(path.join(packageRoot, relativePath)), `missing release file: ${relativePath}`);
    }
    for (const relativePath of releaseManifest.runtimeDirectories) {
      const directoryPath = path.join(packageRoot, relativePath);
      assert.ok(
        fs.existsSync(directoryPath) && fs.statSync(directoryPath).isDirectory(),
        `missing release directory: ${relativePath}`,
      );
    }
    for (const forbiddenPath of releaseManifest.forbiddenPaths) {
      assert.ok(
        !fs.existsSync(path.join(packageRoot, forbiddenPath)),
        `developer/private path leaked into release: ${forbiddenPath}`,
      );
    }

    assert.equal(peMachine(path.join(packageRoot, "CodexScope-Live.exe")), 0x8664, "server is not x64");
    assert.equal(peMachine(path.join(packageRoot, "codexscope-generator.exe")), 0x8664, "generator is not x64");

    const placeholderHash = sha256(path.join(packageRoot, "data.js"));
    writeSessionFixture(sessionsRoot);
    const port = await reservePort();
    const executable = path.join(packageRoot, "CodexScope-Live.exe");
    server = spawn(
      executable,
      [
        "--sessions",
        sessionsRoot,
        "--data-dir",
        dataRoot,
        "--port",
        String(port),
        "--no-open",
      ],
      { cwd: packageRoot, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    server.stdout.on("data", (chunk) => output.push(chunk.toString()));
    server.stderr.on("data", (chunk) => output.push(chunk.toString()));

    const baseUrl = `http://127.0.0.1:${port}`;
    const health = await waitForResponse(`${baseUrl}/health`);
    const healthPayload = await health.json();
    assert.equal(healthPayload.protocol, 2);
    assert.match(healthPayload.config, /^[a-f0-9]{16}$/);

    const index = await waitForResponse(`${baseUrl}/`);
    assert.match(index.url, new RegExp(`^${baseUrl}/[a-f0-9]{48}/$`));
    assert.match(await index.text(), /CodexScope-Live/);
    assert.equal(index.headers.get("cross-origin-resource-policy"), "same-origin");
    assert.equal(index.headers.get("x-content-type-options"), "nosniff");
    assert.match(index.headers.get("content-security-policy") || "", /default-src 'self'/);

    const tokenBaseUrl = index.url;
    const status = await waitForResponse(
      new URL("status", tokenBaseUrl),
      async (response) => response.ok && (await response.clone().json()).state === "ok",
    );
    assert.deepEqual(await status.json(), { state: "ok" });

    const generatedData = await waitForResponse(new URL("data.js", tokenBaseUrl));
    const generatedSource = await generatedData.text();
    assert.match(generatedSource, /portable-fixture-marker/);
    assert.match(generatedSource, /gpt-portable-fixture/);
    assert.match(generatedSource, /"inputTokens":1234/);
    assert.ok(isFile(path.join(dataRoot, "data.js")), "generated data must use the private data directory");
    assert.ok(isFile(path.join(dataRoot, "data.raw.js")), "raw data must use the private data directory");
    assert.equal(sha256(path.join(packageRoot, "data.js")), placeholderHash, "install directory was mutated");
    assert.ok(!fs.existsSync(path.join(packageRoot, ".codexscope-cache.json")));

    const unprotectedData = await fetch(`${baseUrl}/data.js`, { redirect: "manual" });
    assert.equal(unprotectedData.status, 404, "data.js must not be available without the private token");

    browser = await chromium.launch({ headless: true });
    const appPage = await browser.newPage();
    const pageErrors = [];
    appPage.on("pageerror", (error) => pageErrors.push(error.message));
    await appPage.goto(tokenBaseUrl, { waitUntil: "domcontentloaded" });
    await appPage.waitForFunction(
      () => document.querySelector("#sourcePrimary")?.textContent === "Codex 桌面端",
    );
    assert.deepEqual(pageErrors, [], `packaged dashboard page errors: ${pageErrors.join("; ")}`);

    attacker = await startAttackerPage(new URL("data.js", tokenBaseUrl).href);
    const page = await browser.newPage();
    await page.goto(attacker.url, { waitUntil: "networkidle" });
    assert.equal(
      await page.evaluate(() => typeof window.CODEXSCOPE_DATA),
      "undefined",
      "cross-origin page loaded private Codex data",
    );
  } catch (error) {
    error.message += `\nserver output:\n${output.join("")}`;
    throw error;
  } finally {
    if (browser) await browser.close();
    if (attacker) await attacker.close();
    if (server && !server.killed) server.kill();
    fs.rmSync(extractionRoot, { recursive: true, force: true });
    fs.rmSync(sessionsRoot, { recursive: true, force: true });
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }

  console.log(`Portable release verified from final ZIP: ${archivePath}`);
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
