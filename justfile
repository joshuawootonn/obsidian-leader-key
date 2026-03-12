set shell := ["zsh", "-cu"]

default:
  @just --list

help:
  @just --list

install:
  pnpm install

setup-vault vault_path:
  pnpm setup:vault -- --vault "{{vault_path}}"

dev:
  pnpm dev

build:
  pnpm build

test:
  pnpm test

check:
  pnpm check

plugin-status:
  pnpm plugin:status

use-local:
  pnpm plugin:use-local

use-synced:
  pnpm plugin:use-synced
