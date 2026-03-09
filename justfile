set shell := ["zsh", "-cu"]

default:
  @just --list

help:
  @just --list

install:
  pnpm install

setup-vault vault_path:
  pnpm setup:vault "{{vault_path}}"

dev:
  pnpm dev

build:
  pnpm build
