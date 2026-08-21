#!/usr/bin/env bash
# Fill SafariWebExtension/Resources from CI-Browser-Extension (sibling checkout
# or a pinned GitHub safari-mobile release). Fail closed so an archive never
# ships an empty .appex.
set -euo pipefail

IOS_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$IOS_ROOT/../../.." && pwd)"
DEST="$IOS_ROOT/ios/App/SafariWebExtension/Resources"
PINNED_VERSION="${CI_BROWSER_EXTENSION_VERSION:-1.5.0}"
GH_REPO="${CI_BROWSER_EXTENSION_REPO:-companionintelligence/CI-Browser-Extension}"

if [[ -n "${CI_BROWSER_EXTENSION_DIR:-}" ]]; then
  EXT_DIR="$CI_BROWSER_EXTENSION_DIR"
else
  EXT_DIR="$(cd "$REPO_ROOT/.." && pwd)/CI-Browser-Extension"
fi

mkdir -p "$DEST"

sync_from_dir() {
  local src="$1"
  if [[ ! -f "$src/manifest.json" ]]; then
    echo "error: no manifest.json in $src" >&2
    return 1
  fi
  rsync -a --delete --exclude '.gitkeep' --exclude 'README.md' "$src"/ "$DEST"/
}

if [[ -d "$EXT_DIR" && -f "$EXT_DIR/package.json" ]]; then
  echo "Building safari-mobile from $EXT_DIR"
  (
    cd "$EXT_DIR"
    if [[ -f yarn.lock ]]; then
      yarn install --immutable
      yarn build:safari-mobile
    else
      npm ci
      npm run build:safari-mobile
    fi
  )
  sync_from_dir "$EXT_DIR/.output/safari-mv3"
else
  echo "No sibling extension at $EXT_DIR — downloading $GH_REPO@$PINNED_VERSION"
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  zip_name="ci-browser-extension-${PINNED_VERSION}-safari-mobile.zip"
  if command -v gh >/dev/null 2>&1; then
    gh release download "v${PINNED_VERSION}" --repo "$GH_REPO" --pattern '*safari-mobile.zip' --dir "$tmp"
  else
    url="https://github.com/${GH_REPO}/releases/download/v${PINNED_VERSION}/${zip_name}"
    curl -fsSL -o "$tmp/$zip_name" "$url"
  fi
  unzip -q "$tmp"/*safari-mobile.zip -d "$tmp/unpacked"
  src="$(find "$tmp/unpacked" -name manifest.json -print -quit | xargs dirname)"
  sync_from_dir "$src"
fi

if [[ ! -f "$DEST/manifest.json" ]]; then
  echo "error: Safari Web Extension Resources are empty ($DEST). Refusing to archive." >&2
  exit 1
fi

echo "Safari Web Extension resources ready at $DEST"

# When Xcode runs this phase, also copy into the built .appex (manifest at bundle root).
if [[ -n "${BUILT_PRODUCTS_DIR:-}" && -n "${WRAPPER_NAME:-}" ]]; then
  appex="${BUILT_PRODUCTS_DIR}/${WRAPPER_NAME}"
  mkdir -p "$appex"
  rsync -a --exclude '.gitkeep' --exclude 'README.md' "$DEST"/ "$appex"/
  echo "Copied extension resources into $appex"
fi
