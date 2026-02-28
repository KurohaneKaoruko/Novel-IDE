import fs from "node:fs/promises";
import path from "node:path";

const repoRoot = process.cwd();

async function readText(filePath) {
  return await fs.readFile(filePath, "utf8");
}

async function writeTextIfChanged(filePath, content) {
  let previous = null;
  try {
    previous = await fs.readFile(filePath, "utf8");
  } catch {
    previous = null;
  }

  if (previous === content) {
    return false;
  }

  await fs.writeFile(filePath, content, "utf8");
  return true;
}

function stringifyJson(obj) {
  return `${JSON.stringify(obj, null, 2)}\n`;
}

function updateHtmlTitle(html, title) {
  if (!/<title>[\s\S]*?<\/title>/i.test(html)) {
    throw new Error("index.html missing <title> tag");
  }
  return html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${title}</title>`);
}

function updateTomlKeysInSections(toml, updatesBySection) {
  const lines = toml.split(/\r?\n/);
  let currentSection = "";

  const sectionHeaderRegex = /^\s*\[([^\]]+)\]\s*$/;
  const keyValueRegex = /^\s*([A-Za-z0-9_.-]+)\s*=\s*"(.*)"\s*$/;

  for (let i = 0; i < lines.length; i++) {
    const headerMatch = lines[i].match(sectionHeaderRegex);
    if (headerMatch) {
      currentSection = headerMatch[1];
      continue;
    }

    const kvMatch = lines[i].match(keyValueRegex);
    if (!kvMatch) continue;

    const key = kvMatch[1];
    const updates = updatesBySection[currentSection];
    if (!updates) continue;
    if (!(key in updates)) continue;

    lines[i] = `${key} = "${updates[key]}"`;
  }

  // Normalize trailing newlines to a single newline for idempotent writes.
  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return `${lines.join("\n")}\n`;
}

function escapeRustString(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
}

function generateRustBrandingSource(branding) {
  const displayName = branding.displayName ?? "";
  const dataDirName = branding.dataDirName ?? displayName;
  const legacyDataDirName = branding.legacyDataDirName ?? "";
  const gitName = branding?.gitSignature?.name ?? displayName;
  const gitEmail = branding?.gitSignature?.email ?? "";

  return (
    `#[allow(dead_code)]\n` +
    `pub const DISPLAY_NAME: &str = "${escapeRustString(displayName)}";\n` +
    `#[allow(dead_code)]\n` +
    `pub const DATA_DIR_NAME: &str = "${escapeRustString(dataDirName)}";\n` +
    `#[allow(dead_code)]\n` +
    `pub const LEGACY_DATA_DIR_NAME: &str = "${escapeRustString(legacyDataDirName)}";\n` +
    `pub const GIT_SIGNATURE_NAME: &str = "${escapeRustString(gitName)}";\n` +
    `pub const GIT_SIGNATURE_EMAIL: &str = "${escapeRustString(gitEmail)}";\n`
  );
}

function tsStringLiteral(value) {
  return JSON.stringify(String(value ?? ""));
}

function generateFrontendBrandingSource(branding) {
  const displayName = branding.displayName ?? "";
  const editorNamespace = branding?.editor?.namespace ?? "";
  const editorConfigStorageKey = branding?.editor?.configStorageKey ?? "";
  const legacyEditorConfigStorageKey = branding?.editor?.legacyConfigStorageKey ?? "";

  return (
    `export const DISPLAY_NAME = ${tsStringLiteral(displayName)} as const\n` +
    `export const EDITOR_NAMESPACE = ${tsStringLiteral(editorNamespace)} as const\n` +
    `export const EDITOR_CONFIG_STORAGE_KEY = ${tsStringLiteral(editorConfigStorageKey)} as const\n` +
    `export const LEGACY_EDITOR_CONFIG_STORAGE_KEY = ${tsStringLiteral(legacyEditorConfigStorageKey)} as const\n`
  );
}

async function main() {
  const brandingPath = path.join(repoRoot, "branding.json");
  const branding = JSON.parse(await readText(brandingPath));
  const changedFiles = [];

  const displayName = branding.displayName;
  const npmName = branding.npmName;
  const crateName = branding.crateName;
  const tauriIdentifier = branding.tauriIdentifier;

  {
    const packageJsonPath = path.join(repoRoot, "package.json");
    const pkg = JSON.parse(await readText(packageJsonPath));
    pkg.name = npmName;
    if (await writeTextIfChanged(packageJsonPath, stringifyJson(pkg))) {
      changedFiles.push(packageJsonPath);
    }
  }

  {
    const indexHtmlPath = path.join(repoRoot, "src-react", "index.html");
    const html = await readText(indexHtmlPath);
    if (await writeTextIfChanged(indexHtmlPath, updateHtmlTitle(html, displayName))) {
      changedFiles.push(indexHtmlPath);
    }
  }

  {
    const tauriConfPath = path.join(repoRoot, "src-tauri", "tauri.conf.json");
    const tauriConf = JSON.parse(await readText(tauriConfPath));

    tauriConf.productName = displayName;
    tauriConf.identifier = tauriIdentifier;

    if (tauriConf?.app?.windows?.length) {
      for (const win of tauriConf.app.windows) {
        if (win && typeof win === "object" && "title" in win) {
          win.title = displayName;
        }
      }
    }

    if (await writeTextIfChanged(tauriConfPath, stringifyJson(tauriConf))) {
      changedFiles.push(tauriConfPath);
    }
  }

  {
    const cargoTomlPath = path.join(repoRoot, "src-tauri", "Cargo.toml");
    const cargoToml = await readText(cargoTomlPath);
    const updated = updateTomlKeysInSections(cargoToml, {
      package: { name: crateName, description: displayName },
      "package.metadata.tauri": { productName: displayName }
    });
    if (await writeTextIfChanged(cargoTomlPath, updated)) {
      changedFiles.push(cargoTomlPath);
    }
  }

  {
    const rustBrandingPath = path.join(repoRoot, "src-tauri", "src", "branding.rs");
    if (await writeTextIfChanged(rustBrandingPath, generateRustBrandingSource(branding))) {
      changedFiles.push(rustBrandingPath);
    }
  }

  {
    const frontendBrandingPath = path.join(repoRoot, "src-react", "src", "branding.ts");
    if (await writeTextIfChanged(frontendBrandingPath, generateFrontendBrandingSource(branding))) {
      changedFiles.push(frontendBrandingPath);
    }
  }

  if (changedFiles.length > 0) {
    const rel = changedFiles.map((p) => path.relative(repoRoot, p)).join(", ");
    console.log(`[sync-branding] updated ${changedFiles.length} file(s): ${rel}`);
  } else {
    console.log("[sync-branding] no file changes");
  }
}

await main();
