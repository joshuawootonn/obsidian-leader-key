# Leader Key

An Obsidian plugin that adds a configurable leader key plus command suffix sequences, with global capture that can still work when focus is in sidebars, modals, and inputs.

## Development

Install dependencies:

```bash
pnpm install
```

Link the plugin into a local vault:

```bash
pnpm setup:vault "/path/to/your/vault"
```

This writes a local `.obsidian-dev.json` file in the repo and creates or updates the vault plugin symlink at `.obsidian/plugins/leader-key`.
If that plugin directory already exists as a normal folder, the script backs it up, preserves `data.json`, and then replaces it with the symlink.

Start watch mode:

```bash
pnpm dev
```

Build the plugin:

```bash
pnpm build
```

## Local vs Synced Mode

- **Local build mode**: your vault plugin path is a symlink to this repo's local output at `.obsidian/plugins/leader-key`.
- **Synced static mode**: your vault plugin path is a normal folder managed by Obsidian Sync.
- Backups are stored at `<vault>/.obsidian/plugin-backups/leader-key/` (never inside `.obsidian/plugins/`).

Use these commands:

```bash
just use-local /abs/vault/path
# or: just use-local
just dev
just plugin-status
just use-synced
```
