import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const CONFIG_FILE = ".obsidian-dev.json";
const MANIFEST_FILE = "manifest.json";
const STATEFUL_PLUGIN_FILES = new Set(["data.json"]);

function fail(message) {
	console.error(message);
	process.exit(1);
}

function readManifest(repoRoot) {
	const manifestPath = path.join(repoRoot, MANIFEST_FILE);
	return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
}

function resolveVaultPath(inputPath) {
	if (!inputPath) {
		fail('Usage: pnpm setup:vault "/path/to/your/vault"');
	}

	const vaultPath = path.resolve(inputPath);
	if (!fs.existsSync(vaultPath)) {
		fail(`Vault path does not exist: ${vaultPath}`);
	}

	const stats = fs.statSync(vaultPath);
	if (!stats.isDirectory()) {
		fail(`Vault path is not a directory: ${vaultPath}`);
	}

	return vaultPath;
}

function ensureObsidianVault(vaultPath) {
	const obsidianDir = path.join(vaultPath, ".obsidian");
	if (!fs.existsSync(obsidianDir) || !fs.statSync(obsidianDir).isDirectory()) {
		fail(`Vault does not look like an Obsidian vault; missing directory: ${obsidianDir}`);
	}
}

function createBackupPath(pluginDir) {
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	return `${pluginDir}.backup-${stamp}`;
}

function migrateExistingPluginDir(repoRoot, pluginDir) {
	const backupDir = createBackupPath(pluginDir);
	fs.renameSync(pluginDir, backupDir);

	for (const entry of fs.readdirSync(backupDir)) {
		if (!STATEFUL_PLUGIN_FILES.has(entry)) {
			continue;
		}

		const backupFile = path.join(backupDir, entry);
		const repoFile = path.join(repoRoot, entry);
		if (!fs.existsSync(repoFile)) {
			fs.copyFileSync(backupFile, repoFile);
		}
	}

	return backupDir;
}

function ensurePluginSymlink(repoRoot, pluginDir) {
	const parentDir = path.dirname(pluginDir);
	fs.mkdirSync(parentDir, { recursive: true });

	const existing = fs.lstatSync(pluginDir, { throwIfNoEntry: false });
	let backupDir = null;
	if (existing) {
		if (existing.isDirectory()) {
			backupDir = migrateExistingPluginDir(repoRoot, pluginDir);
		} else if (!existing.isSymbolicLink()) {
			fail(`Refusing to replace unsupported path: ${pluginDir}`);
		}

		if (existing.isSymbolicLink()) {
			const currentTarget = fs.realpathSync(pluginDir);
			const desiredTarget = fs.realpathSync(repoRoot);
			if (currentTarget === desiredTarget) {
				return { linked: false, backupDir: null };
			}

			fs.unlinkSync(pluginDir);
		}
	}

	fs.symlinkSync(repoRoot, pluginDir, "dir");
	return { linked: true, backupDir };
}

function writeConfig(configPath, payload) {
	fs.writeFileSync(configPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

const repoRoot = process.cwd();
const manifest = readManifest(repoRoot);
const vaultPath = resolveVaultPath(process.argv[2]);
ensureObsidianVault(vaultPath);

const pluginDir = path.join(vaultPath, ".obsidian", "plugins", manifest.id);
const result = ensurePluginSymlink(repoRoot, pluginDir);

writeConfig(path.join(repoRoot, CONFIG_FILE), {
	vaultPath,
	pluginId: manifest.id,
	pluginDir,
	repoRoot,
});

console.log(`Saved local vault config to ${path.join(repoRoot, CONFIG_FILE)}`);
if (result.backupDir) {
	console.log(`Backed up previous plugin directory to ${result.backupDir}`);
}
console.log(`${result.linked ? "Linked" : "Verified"} plugin at ${pluginDir}`);
