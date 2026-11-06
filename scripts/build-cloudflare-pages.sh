#!/bin/sh
set -eu

repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
output_dir="$repo_dir/public"

rm -rf "$output_dir"
mkdir -p "$output_dir/assets/fonts"

for file in \
  index.html \
  style.css \
  bom-foundation.css \
  app.js \
  config.js \
  logo.jpeg \
  bom-admin-catalogue.js \
  bom-album.js \
  bom-artist-hero.js \
  bom-artist.js \
  bom-autocomplete.js \
  bom-charts.js \
  bom-discover.js \
  bom-early-access.js \
  bom-foundation.js \
  bom-password-recovery.js \
  bom-ratings.js \
  bom-search.js \
  bom-spotify-playlist.js \
  bom-turnstile.js
do
  cp "$repo_dir/$file" "$output_dir/$file"
done

cp "$repo_dir/assets/bom-header-logo.png" "$output_dir/assets/bom-header-logo.png"
cp "$repo_dir/assets/fonts/Manrope-LICENSE.txt" "$output_dir/assets/fonts/Manrope-LICENSE.txt"
cp "$repo_dir/assets/fonts/manrope-regular.ttf" "$output_dir/assets/fonts/manrope-regular.ttf"
cp "$repo_dir/assets/fonts/manrope-semibold.ttf" "$output_dir/assets/fonts/manrope-semibold.ttf"
cp "$repo_dir/assets/fonts/manrope-extrabold.ttf" "$output_dir/assets/fonts/manrope-extrabold.ttf"
