# Clean Build Script for Novel IDE
# This script cleans all build artifacts and caches to fix path reference issues

Write-Host "Cleaning Novel IDE build artifacts..." -ForegroundColor Cyan
Write-Host ""

# Clean Rust/Cargo build cache
Write-Host "Cleaning Rust build cache (src-tauri/target)..." -ForegroundColor Yellow
if (Test-Path "src-tauri/target") {
    Remove-Item -Recurse -Force "src-tauri/target"
    Write-Host "Removed src-tauri/target" -ForegroundColor Green
} else {
    Write-Host "src-tauri/target already clean" -ForegroundColor Green
}

# Clean Vite build output
Write-Host "Cleaning Vite build output (src-react/dist)..." -ForegroundColor Yellow
if (Test-Path "src-react/dist") {
    Remove-Item -Recurse -Force "src-react/dist"
    Write-Host "Removed src-react/dist" -ForegroundColor Green
} else {
    Write-Host "src-react/dist already clean" -ForegroundColor Green
}

# Clean TypeScript build output cache
Write-Host "Cleaning TypeScript build cache (src-react/node_modules/.tmp)..." -ForegroundColor Yellow
if (Test-Path "src-react/node_modules/.tmp") {
    Remove-Item -Recurse -Force "src-react/node_modules/.tmp"
    Write-Host "Removed src-react/node_modules/.tmp" -ForegroundColor Green
} else {
    Write-Host "src-react/node_modules/.tmp already clean" -ForegroundColor Green
}

Write-Host ""
Write-Host "Build cleanup complete!" -ForegroundColor Green
Write-Host ""
Write-Host "You can now run:" -ForegroundColor Cyan
Write-Host "  npm run tauri:dev   - for development" -ForegroundColor White
Write-Host "  npm run tauri:build - for production build" -ForegroundColor White
Write-Host ""
