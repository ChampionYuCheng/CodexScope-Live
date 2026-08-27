const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const friendlyLauncherPath = path.join(__dirname, "Start-CodexScope-Live.vbs");
assert.ok(fs.existsSync(friendlyLauncherPath), "source checkout must include a double-click launcher");
const friendlyLauncher = fs.readFileSync(friendlyLauncherPath, "utf8");
assert.match(friendlyLauncher, /CodexScope-Live\.exe/i, "friendly launcher must prefer the packaged executable");
assert.match(friendlyLauncher, /windows\\open-dashboard\.cmd/i, "friendly launcher must retain the source fallback");
assert.match(friendlyLauncher, /\.Run\s+.+,\s*0\s*,\s*False/i, "friendly launcher must hide the command window");

const launcherPath = path.join(__dirname, "windows", "open-dashboard.cmd");
const launcher = fs.readFileSync(launcherPath, "utf8").toLowerCase();
const cargoProbe = launcher.indexOf("where cargo");
const cachedReleaseBinary = launcher.indexOf("live-server\\target\\release\\codexscope-live.exe");

assert.ok(cargoProbe >= 0, "source launcher must detect Cargo");
assert.ok(cachedReleaseBinary >= 0, "source launcher must retain an offline binary fallback");
assert.ok(
  cargoProbe < cachedReleaseBinary,
  "source launcher must let Cargo validate current sources before using a cached release binary",
);
assert.match(
  launcher,
  /cargo run --release --manifest-path/,
  "source launcher must build and run the current release-mode Rust source",
);

console.log("Source launcher verification passed: current Cargo sources take precedence over cached binaries.");
