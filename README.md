# Leader Key

An Obsidian plugin that adds a configurable leader key plus command suffix sequences, with global capture that can still work when focus is in sidebars, modals, and inputs.

## Development

Install dependencies:

```bash
pnpm install
```

Configure your vault path once:

```bash
just setup-vault /abs/path/to/your/vault
```

This writes `.obsidian-dev.json` in the repo so plugin source commands can run without passing a vault path each time.

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
just use-local
just dev
just plugin-status
just use-synced
```
