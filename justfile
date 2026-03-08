set shell := ["zsh", "-cu"]

default:
  @just --list

help:
  @just --list

install:
  pnpm install

dev:
  pnpm dev

build:
  pnpm build
