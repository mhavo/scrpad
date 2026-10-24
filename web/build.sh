#!/usr/bin/env bash
# Builds the web app into web/dist: the static files from web/src, the crypto module from
# src/crypto.rs (web/crypto), and the fonts and icons the desktop app embeds. Serve web/dist
# from any static host over HTTPS (or http://localhost); there is nothing to run server side.
set -euo pipefail
cd "$(dirname "$0")"

(cd crypto && cargo build --locked --release --quiet)

dist=dist
rm -rf "$dist"
mkdir -p "$dist/fonts" "$dist/icons/app"
cp src/*.html src/*.js src/*.css src/*.webmanifest "$dist/"
cp crypto/target/wasm32-unknown-unknown/release/scrpad_crypto.wasm "$dist/"
cp ../assets/fonts/*.ttf ../assets/fonts/OFL-*.txt "$dist/fonts/"
cp ../assets/icons/*.svg ../assets/icons/LICENSE-lucide.txt "$dist/icons/"
cp ../assets/app-icon/web/*.png "$dist/icons/app/"

# The service worker caches every file of this build, under a name that changes with them.
cd "$dist"
files=$(find . -type f ! -name sw.js | sed 's|^\./||' | sort)
build=$(echo "$files" | xargs sha256sum | sha256sum | cut -c1-16)
list=$(echo "$files" | sed 's|^index.html$|./|; s|.*|"&"|' | paste -sd, -)
sed -i "s|__BUILD__|$build|; s|__FILES__|[$list]|" sw.js
echo "web/dist built ($build)"
