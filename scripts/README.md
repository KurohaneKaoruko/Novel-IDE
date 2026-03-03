# Build Scripts

This directory contains utility scripts for managing the Novel-IDE build process.

## clean-build

Cleans all build artifacts and caches to fix build issues, especially path reference problems.

### Usage

**Windows (PowerShell):**
```powershell
.\scripts\clean-build.ps1
```

**Linux/Mac (Bash):**
```bash
chmod +x scripts/clean-build.sh
./scripts/clean-build.sh
```

### What it cleans

- `src-tauri/target/` - Rust/Cargo build cache
- `dist/` - Vite build output
- `tsconfig.tsbuildinfo` - TypeScript build info
- (Optional) `node_modules/` - Node dependencies (commented out by default)

### When to use

Run this script when you encounter:
- Build errors referencing old paths (e.g., previous project folder name)
- Cached build artifacts causing issues
- After renaming the project
- After major dependency updates
- When build output seems stale or corrupted

### After cleaning

Run one of these commands to rebuild:
```bash
pnpm run tauri:dev    # Development mode
pnpm run tauri:build  # Production build
```

## Troubleshooting

If the script doesn't fix your build issue:

1. **Clean node_modules**: Uncomment the node_modules section in the script
2. **Check Cargo cache**: Run `cargo clean` manually in `src-tauri/`
3. **Clear global Cargo cache**: `cargo cache -a` (requires cargo-cache tool)
4. **Restart your terminal**: Sometimes environment variables need refreshing
5. **Check disk space**: Ensure you have enough space for the build

## Notes

- The script is safe to run multiple times
- It only removes generated files, not source code
- Your `node_modules` are preserved by default (faster rebuilds)
- If you need a complete clean install, uncomment the node_modules section

## release

One-click release helper scripts:

- `scripts/release.ps1` (Windows PowerShell)
- `scripts/release.sh` (Linux/macOS Bash)

They will:

1. Validate version format (`x.y.z`).
2. Update versions in:
   - `package.json`
   - `src-tauri/Cargo.toml`
   - `src-tauri/tauri.conf.json`
3. Run build checks (unless skipped).
4. Create commit + tag (`v<version>`).
5. Push commit and tag (unless disabled).

### Usage

Windows:

```powershell
.\scripts\release.ps1 -Version 0.2.0
```

Linux/macOS:

```bash
./scripts/release.sh 0.2.0
```

Optional flags:

- Skip checks: `-SkipChecks` / `--skip-checks`
- Allow dirty tree: `-AllowDirty` / `--allow-dirty`
- Do not push: `-NoPush` / `--no-push`

Tag push (`v*`) will trigger GitHub workflow `.github/workflows/tauri-release.yml` to build bundles and create a GitHub Release automatically.
