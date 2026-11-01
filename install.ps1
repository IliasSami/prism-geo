# PrismGEO one-line install for Windows (PowerShell):
#   irm https://raw.githubusercontent.com/IliasSami/prism-geo/main/install.ps1 | iex
# Clones (or updates) PrismGEO into .\prism-geo (or $env:PRISMGEO_DIR) and runs `pnpm setup`.
$ErrorActionPreference = "Stop"
$repo = if ($env:PRISMGEO_REPO) { $env:PRISMGEO_REPO } else { "https://github.com/IliasSami/prism-geo.git" }
$dir = if ($env:PRISMGEO_DIR) { $env:PRISMGEO_DIR } else { "prism-geo" }

function Need($cmd, $hint) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { Write-Host "`n✖ $hint" -ForegroundColor Red; exit 1 }
}
Need git "git is required: install it from https://git-scm.com/download/win (or: winget install Git.Git), then run this again."
Need node "Node.js 22.13 or later is required: install the LTS from https://nodejs.org (or: winget install OpenJS.NodeJS.LTS), then run this again."
node -e "const [a,b]=process.versions.node.split('.').map(Number); process.exit(a>22||(a===22&&b>=13)?0:1)"
if ($LASTEXITCODE -ne 0) { Write-Host "`n✖ Node.js $(node -v) is too old: PrismGEO needs 22.13 or later (https://nodejs.org)." -ForegroundColor Red; exit 1 }

if (Test-Path "$dir\.git") {
  Write-Host "▸ Updating $dir"
  git -C $dir pull --ff-only
} else {
  Write-Host "▸ Downloading PrismGEO into $dir"
  git clone --depth 1 $repo $dir
}
Set-Location $dir
node scripts/setup.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host "`nNext: cd $dir; pnpm start   (no pnpm? use: npx pnpm@10.34.9 start)"
