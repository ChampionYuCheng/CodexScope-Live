param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$distRoot = [IO.Path]::GetFullPath((Join-Path $repositoryRoot "dist"))
$packageName = "CodexScope-Live-Windows-x64"
$packageRoot = [IO.Path]::GetFullPath((Join-Path $distRoot $packageName))
$archivePath = [IO.Path]::GetFullPath((Join-Path $distRoot "$packageName.zip"))
$portableCargoTarget = [IO.Path]::GetFullPath((Join-Path $distRoot ".cargo-target"))

function Assert-ChildPath {
    param(
        [Parameter(Mandatory = $true)][string]$Child,
        [Parameter(Mandatory = $true)][string]$Parent
    )

    $normalizedParent = [IO.Path]::GetFullPath($Parent).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
    $normalizedChild = [IO.Path]::GetFullPath($Child)
    if (-not $normalizedChild.StartsWith($normalizedParent, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to modify path outside $normalizedParent : $normalizedChild"
    }
}

function Invoke-CheckedCommand {
    param(
        [Parameter(Mandatory = $true)][string]$Command,
        [Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments
    )

    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Command exited with code $LASTEXITCODE"
    }
}

Assert-ChildPath -Child $distRoot -Parent $repositoryRoot
Assert-ChildPath -Child $packageRoot -Parent $distRoot
Assert-ChildPath -Child $archivePath -Parent $distRoot
Assert-ChildPath -Child $portableCargoTarget -Parent $distRoot

Push-Location $repositoryRoot
try {
    Invoke-CheckedCommand npm.cmd run build:frontend

    $previousRustFlags = $env:RUSTFLAGS
    $previousCargoTarget = $env:CARGO_TARGET_DIR
    try {
        New-Item -ItemType Directory -Path $distRoot -Force | Out-Null
        $staticCrtFlag = "-C target-feature=+crt-static"
        $env:RUSTFLAGS = if ([string]::IsNullOrWhiteSpace($previousRustFlags)) {
            $staticCrtFlag
        }
        else {
            "$previousRustFlags $staticCrtFlag"
        }
        $env:CARGO_TARGET_DIR = $portableCargoTarget
        Invoke-CheckedCommand cargo build --release --locked --manifest-path live-server/Cargo.toml
    }
    finally {
        if ($null -eq $previousRustFlags) {
            Remove-Item Env:RUSTFLAGS -ErrorAction SilentlyContinue
        }
        else {
            $env:RUSTFLAGS = $previousRustFlags
        }
        if ($null -eq $previousCargoTarget) {
            Remove-Item Env:CARGO_TARGET_DIR -ErrorAction SilentlyContinue
        }
        else {
            $env:CARGO_TARGET_DIR = $previousCargoTarget
        }
    }

    if (Test-Path -LiteralPath $packageRoot) {
        Remove-Item -LiteralPath $packageRoot -Recurse -Force
    }
    if (Test-Path -LiteralPath $archivePath) {
        Remove-Item -LiteralPath $archivePath -Force
    }
    New-Item -ItemType Directory -Path $packageRoot | Out-Null

    $generatorPath = Join-Path $packageRoot "codexscope-generator.exe"
    Invoke-CheckedCommand go build '-trimpath' '-ldflags=-s -w -buildid=' '-o' $generatorPath 'generate_codex_data.go'

    Copy-Item -LiteralPath (Join-Path $portableCargoTarget "release/codexscope-live.exe") -Destination (Join-Path $packageRoot "CodexScope-Live.exe")

    $runtimeFiles = @(
        "index.html",
        "styles.css",
        "app.js",
        "live.js",
        "theme.js",
        "data.sample.js",
        "LICENSE",
        "README.md",
        "README.zh-CN.md"
    )
    foreach ($file in $runtimeFiles) {
        Copy-Item -LiteralPath $file -Destination (Join-Path $packageRoot $file)
    }
    Copy-Item -LiteralPath "assets" -Destination (Join-Path $packageRoot "assets") -Recurse

    $utf8WithoutBom = [Text.UTF8Encoding]::new($false)
    [IO.File]::WriteAllText(
        (Join-Path $packageRoot "data.js"),
        "window.CODEXSCOPE_DATA = window.CODEXSCOPE_DATA || null;`n",
        $utf8WithoutBom
    )
    [IO.File]::WriteAllText(
        (Join-Path $packageRoot "data.raw.js"),
        "window.CODEXSCOPE_RAW_DATA = window.CODEXSCOPE_RAW_DATA || null;`n",
        $utf8WithoutBom
    )

    $startHere = @"
CodexScope-Live Windows 免安装版

1. 解压整个 ZIP，不能只单独取出 EXE。
2. 双击 CodexScope-Live.exe。
3. 程序会自动打开 http://127.0.0.1:48173/。
4. 默认读取当前 Windows 用户的 .codex\sessions，无需配置环境变量。
5. 关闭本程序的控制台窗口即可停止实时服务。

如果 Windows SmartScreen 提示未知发布者，请核对下载来源和 GitHub Release 的校验信息后选择“更多信息 > 仍要运行”。
本程序仅监听 127.0.0.1，不会向局域网公开页面。

Original project: CodexScope by JUk1-GH
https://github.com/JUk1-GH/CodexScope
License: MIT
"@
    [IO.File]::WriteAllText(
        (Join-Path $packageRoot "START-HERE.txt"),
        $startHere.TrimStart() + "`n",
        $utf8WithoutBom
    )

    Compress-Archive -LiteralPath $packageRoot -DestinationPath $archivePath -CompressionLevel Optimal
    $archiveStream = [IO.File]::OpenRead($archivePath)
    try {
        $sha256 = [Security.Cryptography.SHA256]::Create()
        try {
            $archiveHash = -join ($sha256.ComputeHash($archiveStream) | ForEach-Object { $_.ToString("x2") })
        }
        finally {
            $sha256.Dispose()
        }
    }
    finally {
        $archiveStream.Dispose()
    }
    [IO.File]::WriteAllText("$archivePath.sha256", "$archiveHash  $packageName.zip`n", $utf8WithoutBom)

    Write-Output "Built Windows portable release:"
    Write-Output "  $archivePath"
    Write-Output "  $archivePath.sha256"
}
finally {
    Pop-Location
}
