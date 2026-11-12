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
  artist-easter-eggs.js \
  config.js \
  historical-uk-number-ones-cover-art.json \
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
  bom-turnstile.js \
  bom-bond.js \
  bom-bond.css \
  bond-007.json \
  bom-higher-lower.js \
  bom-higher-lower.css \
  bom-quickfire.js \
  bom-daily-challenge.js \
  bom-games.css \
  bom-game-preview.js \
  bom-game-preview.css \
  bom-christmas.js \
  bom-christmas.css \
  christmas-100.json
do
  cp "$repo_dir/$file" "$output_dir/$file"
done

cp "$repo_dir/assets/bom-header-logo.png" "$output_dir/assets/bom-header-logo.png"
cp "$repo_dir/assets/david-bowie-lightning.png" "$output_dir/assets/david-bowie-lightning.png"
cp "$repo_dir/assets/rolling-stones-easter-egg.png" "$output_dir/assets/rolling-stones-easter-egg.png"
mkdir -p "$output_dir/assets/game-share"
cp "$repo_dir/assets/game-share/daily-bom-square.png" "$output_dir/assets/game-share/daily-bom-square.png"
cp "$repo_dir/assets/game-share/daily-bom-story.png" "$output_dir/assets/game-share/daily-bom-story.png"
cp "$repo_dir/assets/fonts/Manrope-LICENSE.txt" "$output_dir/assets/fonts/Manrope-LICENSE.txt"
cp "$repo_dir/assets/fonts/manrope-regular.ttf" "$output_dir/assets/fonts/manrope-regular.ttf"
cp "$repo_dir/assets/fonts/manrope-semibold.ttf" "$output_dir/assets/fonts/manrope-semibold.ttf"
cp "$repo_dir/assets/fonts/manrope-extrabold.ttf" "$output_dir/assets/fonts/manrope-extrabold.ttf"
