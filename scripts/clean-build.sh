#!/usr/bin/env bash
set -euo pipefail

# Clean Build Script for Novel IDE
# This script cleans all build artifacts and caches to fix path reference issues.

echo "Cleaning Novel IDE build artifacts..."
echo

echo "Cleaning Rust build cache (src-tauri/target)..."
if [[ -d "src-tauri/target" ]]; then
  rm -rf "src-tauri/target"
  echo "Removed src-tauri/target"
else
  echo "src-tauri/target already clean"
fi

echo "Cleaning Vite build output (src-react/dist)..."
if [[ -d "src-react/dist" ]]; then
  rm -rf "src-react/dist"
  echo "Removed src-react/dist"
else
  echo "src-react/dist already clean"
fi

echo "Cleaning TypeScript build cache (src-react/node_modules/.tmp)..."
if [[ -d "src-react/node_modules/.tmp" ]]; then
  rm -rf "src-react/node_modules/.tmp"
  echo "Removed src-react/node_modules/.tmp"
else
  echo "src-react/node_modules/.tmp already clean"
fi

# Clean node_modules (optional - uncomment if needed)
# echo "Cleaning node_modules..."
# if [[ -d "node_modules" ]]; then
#   rm -rf "node_modules"
#   echo "Removed node_modules"
#   echo "Running pnpm install..."
#   pnpm install --frozen-lockfile
#   echo "pnpm install complete"
# fi

echo
echo "Build cleanup complete."
echo
echo "You can now run:"
echo "  pnpm run tauri:dev   - for development"
echo "  pnpm run tauri:build - for production build"
echo
