# PrismGEO one-line install for Windows (PowerShell):
#   irm https://raw.githubusercontent.com/IliasSami/prism-geo/main/install.ps1 | iex
# Clones (or updates) PrismGEO into .\prism-geo (or $env:PRISMGEO_DIR) and runs `pnpm bootstrap`.
$ErrorActionPreference = "Stop"
$repo = if ($env:PRISMGEO_REPO) { $env:PRISMGEO_REPO } else { "https://github.com/IliasSami/prism-geo.git" }
$dir = if ($env:PRISMGEO_DIR) { $env:PRISMGEO_DIR } else { "prism-geo" }

# Run with `irm … | iex`, `exit` would close the PowerShell window and its message with it: errors throw instead
function Need($cmd, $hint) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { throw "✖ $hint" }
}
Need git "git is required: install it from https://git-scm.com/download/win (or: winget install Git.Git), then run this again."
Need node "Node.js 22.13 or later is required: install the LTS from https://nodejs.org (or: winget install OpenJS.NodeJS.LTS), then run this again."
node -e "const [a,b]=process.versions.node.split('.').map(Number); process.exit(a>22||(a===22&&b>=13)?0:1)"
if ($LASTEXITCODE -ne 0) { throw "✖ Node.js $(node -v) is too old: PrismGEO needs 22.13 or later (https://nodejs.org)." }

if (Test-Path "$dir\.git") {
  Write-Host "▸ Updating $dir"
  git -C $dir pull --ff-only
  if ($LASTEXITCODE -ne 0) { throw "✖ Updating $dir failed (see the git message above)." }
} else {
  Write-Host "▸ Downloading PrismGEO into $dir"
  git clone --depth 1 $repo $dir
  if ($LASTEXITCODE -ne 0) { throw "✖ Downloading PrismGEO failed (see the git message above)." }
}
Set-Location $dir
node scripts/setup.mjs
if ($LASTEXITCODE -ne 0) { throw "✖ Setup did not finish (see the messages above). Run: node scripts/setup.mjs" }
Write-Host "`nNext: cd $dir; pnpm start   (no pnpm? use: npx pnpm@10.34.9 start)"
