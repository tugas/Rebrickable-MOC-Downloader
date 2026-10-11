#!/bin/sh
set -eu

script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
output_dir="$script_dir/web-ext-artifacts"
output_file="$output_dir/rebrickable-moc-downloader.zip"
manifest_file="$script_dir/manifest.json"

files="manifest.json LICENSE README.md snapshot.jpg icons/icon.svg icons/icon-16.png icons/icon-32.png icons/icon-48.png icons/icon-96.png background.js content.js popup.css popup.html popup.js progress.css progress.html progress.js save-xml.html save-xml.js"

version="$(sed -n 's/.*"version":[[:space:]]*"\([^"]*\)".*/\1/p' "$manifest_file")"
if [ -z "$version" ]; then
  printf 'Error: could not read extension version from manifest.json.\n' >&2
  exit 1
fi

zip_command=""
for command_name in zip 7z 7zz; do
  if command -v "$command_name" >/dev/null 2>&1; then
    zip_command="$command_name"
    break
  fi
done
if [ -z "$zip_command" ]; then
  printf 'Error: install zip or 7-Zip to package the extension.\n' >&2
  exit 1
fi

for file in $files; do
  if [ ! -f "$script_dir/$file" ]; then
    printf 'Error: required file not found: %s\n' "$file" >&2
    exit 1
  fi
done

mkdir -p -- "$output_dir"
rm -f -- "$output_file"
notes_file="$output_dir/release-notes-v$version.md"
last_tag="$(git -C "$script_dir" describe --tags --abbrev=0 2>/dev/null || true)"

{
  printf '# Rebrickable MOC Downloader %s\n\n' "$version"
  printf '## Changes\n'
  if command -v git >/dev/null 2>&1 && git -C "$script_dir" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    if [ -n "$last_tag" ]; then
      commits="$(git -C "$script_dir" log "$last_tag..HEAD" --pretty=format:'- %s' 2>/dev/null || true)"
    else
      commits="$(git -C "$script_dir" log HEAD --pretty=format:'- %s' 2>/dev/null || true)"
    fi
  else
    commits=""
  fi

  if [ -n "$commits" ]; then
    printf '\n%s\n' "$commits"
  elif [ -z "$last_tag" ]; then
    printf '\n- Initial release.\n'
  else
    printf '\n- No commits since tag %s; review and edit these notes manually.\n' "$last_tag"
  fi
  printf '\nGenerated from Git commit messages. Uncommitted changes are not included.\n'
} > "$notes_file"

if [ "$zip_command" = "zip" ]; then
  (CDPATH= cd -- "$script_dir" && "$zip_command" -q -X "$output_file" $files)
else
  (CDPATH= cd -- "$script_dir" && "$zip_command" a -tzip -mx=9 "$output_file" $files >/dev/null)
fi

printf 'Created %s\n' "$output_file"
printf 'Created %s\n' "$notes_file"