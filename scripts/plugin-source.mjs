import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const manifestPath = path.join(repoRoot, "manifest.json");
const configPath = path.join(repoRoot, ".obsidian-dev.json");

const nowTimestamp = () => {
  const iso = new Date().toISOString().replace(/[-:.]/g, "");
  return iso.replace("T", "-").slice(0, 15);
};

const toAbsolutePath = (value) => path.resolve(value);

const pathExists = async (targetPath) => {
  try {
    await fs.lstat(targetPath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
};

const readJson = async (targetPath) => {
  const content = await fs.readFile(targetPath, "utf8");
  return JSON.parse(content);
};

const getPluginId = async () => {
  const manifest = await readJson(manifestPath);
  if (!manifest?.id || typeof manifest.id !== "string") {
    throw new Error(`Missing plugin id in ${manifestPath}`);
  }
  return manifest.id;
};

const readConfig = async () => {
  if (!(await pathExists(configPath))) {
    return {};
  }
  return readJson(configPath);
};

const writeConfig = async (nextConfig) => {
  const content = `${JSON.stringify(nextConfig, null, 2)}\n`;
  await fs.writeFile(configPath, content, "utf8");
};

const resolveVaultPath = async (vaultArg) => {
  if (vaultArg) {
    return toAbsolutePath(vaultArg);
  }

  const config = await readConfig();
  if (typeof config.vaultPath === "string" && config.vaultPath.trim()) {
    return toAbsolutePath(config.vaultPath);
  }

  throw new Error(
    `Vault path is not configured. Pass --vault /abs/path or run "just setup-vault /abs/path".`
  );
};

const getPaths = (vaultPath, pluginId) => {
  const vaultRoot = toAbsolutePath(vaultPath);
  const vaultObsidianDir = path.join(vaultRoot, ".obsidian");
  const vaultPluginsDir = path.join(vaultObsidianDir, "plugins");
  const vaultPluginPath = path.join(vaultPluginsDir, pluginId);
  const vaultBackupsRoot = path.join(
    vaultObsidianDir,
    "plugin-backups",
    pluginId
  );
  const repoPluginPath = path.join(repoRoot, ".obsidian", "plugins", pluginId);
  return {
    vaultRoot,
    vaultObsidianDir,
    vaultPluginsDir,
    vaultPluginPath,
    vaultBackupsRoot,
    repoPluginPath,
  };
};

const parseArgs = (argv) => {
  const args = [...argv];
  const command = args.shift();
  let vaultPath;

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (token === "--") {
      continue;
    }
    if (token === "--vault") {
      const value = args[i + 1];
      if (!value) {
        throw new Error("Expected value after --vault");
      }
      vaultPath = value;
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  return { command, vaultPath };
};

const symlinkInfo = async (linkPath) => {
  const rawTarget = await fs.readlink(linkPath);
  const resolvedTarget = path.resolve(path.dirname(linkPath), rawTarget);
  return { rawTarget, resolvedTarget };
};

const describeMode = async (vaultPluginPath, repoPluginPath) => {
  if (!(await pathExists(vaultPluginPath))) {
    return { mode: "missing" };
  }

  const stats = await fs.lstat(vaultPluginPath);
  if (stats.isSymbolicLink()) {
    const target = await symlinkInfo(vaultPluginPath);
    if (path.resolve(target.resolvedTarget) === path.resolve(repoPluginPath)) {
      return { mode: "local-build", symlinkTarget: target.resolvedTarget };
    }
    return { mode: "symlink-other", symlinkTarget: target.resolvedTarget };
  }

  if (stats.isDirectory()) {
    return { mode: "synced-static" };
  }

  return { mode: "other-file" };
};

const listBackupCandidates = async (backupRoot) => {
  if (!(await pathExists(backupRoot))) {
    return [];
  }

  const entries = await fs.readdir(backupRoot, { withFileTypes: true });
  const candidates = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const candidatePath = path.join(backupRoot, entry.name);
    const stats = await fs.stat(candidatePath);
    candidates.push({
      name: entry.name,
      path: candidatePath,
      mtimeMs: stats.mtimeMs,
    });
  }

  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates;
};

export const setConfiguredVaultPath = async (vaultPath) => {
  const config = await readConfig();
  const nextConfig = {
    ...config,
    vaultPath: toAbsolutePath(vaultPath),
  };
  await writeConfig(nextConfig);
};

export const status = async ({ vaultArg }) => {
  const pluginId = await getPluginId();
  console.log(`Plugin ID: ${pluginId}`);
  console.log(`Repo output path: ${path.join(repoRoot, ".obsidian", "plugins", pluginId)}`);
  console.log(`Config file: ${configPath}`);

  const vaultPath = await resolveVaultPath(vaultArg);

  const paths = getPaths(vaultPath, pluginId);
  const modeInfo = await describeMode(paths.vaultPluginPath, paths.repoPluginPath);

  console.log(`Vault: ${paths.vaultRoot}`);
  console.log(`Vault plugin path: ${paths.vaultPluginPath}`);
  console.log(`Backup root: ${paths.vaultBackupsRoot}`);
  console.log(`Mode: ${modeInfo.mode}`);
  if (modeInfo.symlinkTarget) {
    console.log(`Symlink target: ${modeInfo.symlinkTarget}`);
  }
};

export const useLocal = async ({ vaultArg }) => {
  const pluginId = await getPluginId();
  const vaultPath = await resolveVaultPath(vaultArg);
  const paths = getPaths(vaultPath, pluginId);

  await fs.mkdir(paths.vaultPluginsDir, { recursive: true });
  await fs.mkdir(paths.repoPluginPath, { recursive: true });

  if (await pathExists(paths.vaultPluginPath)) {
    const stats = await fs.lstat(paths.vaultPluginPath);
    if (stats.isSymbolicLink()) {
      const target = await symlinkInfo(paths.vaultPluginPath);
      if (path.resolve(target.resolvedTarget) === path.resolve(paths.repoPluginPath)) {
        console.log("Plugin path already points to local build output.");
      } else {
        await fs.unlink(paths.vaultPluginPath);
        console.log(
          `Removed symlink pointing to different target: ${target.resolvedTarget}`
        );
      }
    } else if (stats.isDirectory()) {
      await fs.mkdir(paths.vaultBackupsRoot, { recursive: true });
      const backupPath = path.join(
        paths.vaultBackupsRoot,
        `synced-${nowTimestamp()}`
      );
      await fs.rename(paths.vaultPluginPath, backupPath);
      console.log(`Moved synced plugin directory to backup: ${backupPath}`);
    } else {
      await fs.rm(paths.vaultPluginPath, { force: true });
      console.warn(
        `Removed non-directory file at plugin path: ${paths.vaultPluginPath}`
      );
    }
  }

  if (!(await pathExists(paths.vaultPluginPath))) {
    await fs.symlink(paths.repoPluginPath, paths.vaultPluginPath, "dir");
    console.log(`Created symlink: ${paths.vaultPluginPath} -> ${paths.repoPluginPath}`);
  }

  await setConfiguredVaultPath(vaultPath);
  console.log(`Saved vault path in ${configPath}`);
};

export const useSynced = async ({ vaultArg }) => {
  const pluginId = await getPluginId();
  const vaultPath = await resolveVaultPath(vaultArg);
  const paths = getPaths(vaultPath, pluginId);

  await fs.mkdir(paths.vaultPluginsDir, { recursive: true });

  if (await pathExists(paths.vaultPluginPath)) {
    const stats = await fs.lstat(paths.vaultPluginPath);
    if (stats.isSymbolicLink()) {
      await fs.unlink(paths.vaultPluginPath);
      console.log(`Removed local-build symlink: ${paths.vaultPluginPath}`);
    } else if (stats.isDirectory()) {
      console.log("Plugin path is already a normal directory (synced static mode).");
      await setConfiguredVaultPath(vaultPath);
      console.log(`Saved vault path in ${configPath}`);
      return;
    }
  }

  const backups = await listBackupCandidates(paths.vaultBackupsRoot);
  if (backups.length === 0) {
    console.warn("No backup found to restore.");
    console.warn(`Expected backups under: ${paths.vaultBackupsRoot}`);
    console.warn(
      "Next steps: sync or copy the plugin folder into the vault plugin path, then rerun plugin:status."
    );
    await setConfiguredVaultPath(vaultPath);
    console.log(`Saved vault path in ${configPath}`);
    return;
  }

  const latest = backups[0];
  await fs.rename(latest.path, paths.vaultPluginPath);
  console.log(`Restored backup to synced mode: ${latest.path} -> ${paths.vaultPluginPath}`);

  await setConfiguredVaultPath(vaultPath);
  console.log(`Saved vault path in ${configPath}`);
};

const usage = () => {
  console.log("Usage:");
  console.log("  node scripts/plugin-source.mjs status [--vault /abs/path]");
  console.log("  node scripts/plugin-source.mjs use-local [--vault /abs/path]");
  console.log("  node scripts/plugin-source.mjs use-synced [--vault /abs/path]");
};

const runCli = async () => {
  const { command, vaultPath } = parseArgs(process.argv.slice(2));
  if (!command) {
    usage();
    process.exitCode = 1;
    return;
  }

  if (command === "status") {
    await status({ vaultArg: vaultPath });
    return;
  }

  if (command === "use-local") {
    await useLocal({ vaultArg: vaultPath });
    return;
  }

  if (command === "use-synced") {
    await useSynced({ vaultArg: vaultPath });
    return;
  }

  throw new Error(`Unknown command: ${command}`);
};

if (path.resolve(process.argv[1] ?? "") === __filename) {
  runCli().catch((error) => {
    console.error(`plugin-source error: ${error.message}`);
    process.exitCode = 1;
  });
}
