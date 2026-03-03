#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  ./scripts/release.sh <version> [--allow-dirty] [--skip-checks] [--no-push]

Examples:
  ./scripts/release.sh 0.2.0
  ./scripts/release.sh 0.2.0-beta.1 --skip-checks --no-push
EOF
}

if [[ $# -lt 1 ]]; then
  usage
  exit 1
fi

VERSION="$1"
shift

ALLOW_DIRTY=0
SKIP_CHECKS=0
NO_PUSH=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --allow-dirty) ALLOW_DIRTY=1 ;;
    --skip-checks) SKIP_CHECKS=1 ;;
    --no-push) NO_PUSH=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1"; usage; exit 1 ;;
  esac
  shift
done

if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([\-+][0-9A-Za-z\.-]+)?$ ]]; then
  echo "Invalid version '$VERSION'. Example: 0.2.0 or 0.2.0-beta.1" >&2
  exit 1
fi

TAG="v$VERSION"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

PACKAGE_MANAGER="npm"
if [[ -f pnpm-lock.yaml ]]; then
  if ! command -v pnpm >/dev/null 2>&1; then
    echo "pnpm-lock.yaml detected, but 'pnpm' is not installed. Install pnpm (or enable corepack) and retry." >&2
    exit 1
  fi
  PACKAGE_MANAGER="pnpm"
fi

run_step() {
  echo ">> $*"
  "$@"
}

if [[ "$ALLOW_DIRTY" -ne 1 ]]; then
  if [[ -n "$(git status --porcelain)" ]]; then
    echo "Working tree is not clean. Commit/stash changes first, or use --allow-dirty." >&2
    exit 1
  fi
fi

if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  echo "Tag '$TAG' already exists." >&2
  exit 1
fi

echo "Updating versions to $VERSION ..."

RELEASE_VERSION="$VERSION" node <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const version = process.env.RELEASE_VERSION;
if (!version) throw new Error("RELEASE_VERSION is empty");

const packagePath = path.resolve("package.json");
const tauriConfPath = path.resolve("src-tauri/tauri.conf.json");
const cargoPath = path.resolve("src-tauri/Cargo.toml");

const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
pkg.version = version;
fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + "\n");

const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, "utf8"));
tauriConf.version = version;
fs.writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + "\n");

const cargoRaw = fs.readFileSync(cargoPath, "utf8");
const cargoUpdated = cargoRaw.replace(/^version\s*=\s*"[^"]+"/m, `version = "${version}"`);
if (cargoUpdated === cargoRaw) {
  throw new Error("Failed to update version in src-tauri/Cargo.toml");
}
fs.writeFileSync(cargoPath, cargoUpdated);
NODE

if [[ "$SKIP_CHECKS" -ne 1 ]]; then
  run_step "$PACKAGE_MANAGER" run build
  run_step cargo check --manifest-path src-tauri/Cargo.toml --target-dir .cargo-target
fi

run_step git add package.json src-tauri/Cargo.toml src-tauri/tauri.conf.json

if [[ -z "$(git diff --cached --name-only)" ]]; then
  echo "No staged version changes detected." >&2
  exit 1
fi

run_step git commit -m "chore(release): $TAG"
run_step git tag "$TAG"

if [[ "$NO_PUSH" -ne 1 ]]; then
  run_step git push origin HEAD
  run_step git push origin "$TAG"
  echo
  echo "Release tag pushed: $TAG"
  echo "GitHub Actions workflow will build bundles and publish the release."
else
  echo
  echo "Tag created locally: $TAG (not pushed due to --no-push)."
fi
