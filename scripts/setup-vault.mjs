import path from "node:path";
import { fileURLToPath } from "node:url";
import { setConfiguredVaultPath, status } from "./plugin-source.mjs";

const __filename = fileURLToPath(import.meta.url);

const parseVaultArg = (argv) => {
  if (argv.length === 1 && !argv[0].startsWith("--")) {
    return argv[0];
  }

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--") {
      continue;
    }
    if (token === "--vault") {
      const value = argv[i + 1];
      if (!value) {
        throw new Error("Expected value after --vault");
      }
      return value;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  return undefined;
};

const run = async () => {
  const vaultPath = parseVaultArg(process.argv.slice(2));
  if (!vaultPath) {
    throw new Error(
      'Missing vault path. Usage: node scripts/setup-vault.mjs --vault /abs/path'
    );
  }

  const absoluteVaultPath = path.resolve(vaultPath);
  await setConfiguredVaultPath(absoluteVaultPath);
  console.log(`Saved vault path: ${absoluteVaultPath}`);
  await status({ vaultArg: absoluteVaultPath });
};

if (path.resolve(process.argv[1] ?? "") === __filename) {
  run().catch((error) => {
    console.error(`setup-vault error: ${error.message}`);
    process.exitCode = 1;
  });
}
