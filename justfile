set shell := ["zsh", "-cu"]

default:
  @just --list

help:
  @just --list

install:
  pnpm install

setup-vault vault_path="":
  if [ -n "{{vault_path}}" ]; then pnpm setup:vault -- --vault "{{vault_path}}"; else pnpm setup:vault; fi

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

use-local vault_path="":
  if [ -n "{{vault_path}}" ]; then pnpm plugin:use-local -- --vault "{{vault_path}}"; else pnpm plugin:use-local; fi

use-synced vault_path="":
  if [ -n "{{vault_path}}" ]; then pnpm plugin:use-synced -- --vault "{{vault_path}}"; else pnpm plugin:use-synced; fi
