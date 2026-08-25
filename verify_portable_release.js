const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const repositoryRoot = __dirname;
const packageName = "CodexScope-Live-Windows-x64";
const packageRoot = path.join(repositoryRoot, "dist", packageName);
const archivePath = path.join(repositoryRoot, "dist", `${packageName}.zip`);

function isFile(filePath) {
  return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
}

const requiredFiles = [
  "CodexScope-Live.exe",
  "codexscope-generator.exe",
  "index.html",
  "styles.css",
  "app.js",
  "live.js",
  "theme.js",
  "data.sample.js",
  "LICENSE",
  "README.md",
  "README.zh-CN.md",
  "START-HERE.txt",
];

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

async function waitForResponse(url, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) return response;
      lastError = new Error(`${url} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}

async function main() {
  assert.ok(
    fs.existsSync(packageRoot) && fs.statSync(packageRoot).isDirectory(),
    `missing release directory: ${packageRoot}`,
  );
  assert.ok(isFile(archivePath), `missing release archive: ${archivePath}`);
  for (const relativePath of requiredFiles) {
    assert.ok(
      isFile(path.join(packageRoot, relativePath)),
      `missing release file: ${relativePath}`,
    );
  }

  for (const forbiddenPath of ["node_modules", "live-server", "generate_codex_data.go"]) {
    assert.ok(
      !fs.existsSync(path.join(packageRoot, forbiddenPath)),
      `developer-only path leaked into release: ${forbiddenPath}`,
    );
  }

  const sessions = fs.mkdtempSync(path.join(os.tmpdir(), "codexscope-portable-sessions-"));
  const port = await reservePort();
  const executable = path.join(packageRoot, "CodexScope-Live.exe");
  const output = [];
  const server = spawn(
    executable,
    ["--sessions", sessions, "--port", String(port), "--no-open"],
    {
      cwd: repositoryRoot,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  server.stdout.on("data", (chunk) => output.push(chunk.toString()));
  server.stderr.on("data", (chunk) => output.push(chunk.toString()));

  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    const health = await waitForResponse(`${baseUrl}/health`);
    assert.deepEqual(await health.json(), { ok: true, mode: "local" });

    const index = await waitForResponse(`${baseUrl}/`);
    assert.match(await index.text(), /CodexScope-Live/);

    const liveScript = await waitForResponse(`${baseUrl}/live.js`);
    assert.match(await liveScript.text(), /EventSource/);

    const themeScript = await waitForResponse(`${baseUrl}/theme.js`);
    assert.match(await themeScript.text(), /localStorage/);
  } catch (error) {
    error.message += `\nserver output:\n${output.join("")}`;
    throw error;
  } finally {
    server.kill();
    fs.rmSync(sessions, { recursive: true, force: true });
  }

  console.log(`Portable release verified: ${archivePath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
