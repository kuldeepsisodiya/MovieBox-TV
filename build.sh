#!/usr/bin/env bash
# ==============================================================================
# MovieBox TV - Reproducible Samsung Tizen WGT Build Script
# Creates both an unsigned WGT (for external Homebrew/CI signing workflows)
# and a Tizen CLI packaged WGT artifact.
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "========================================================"
echo "MovieBox TV - Building Samsung Tizen WGT Application"
echo "========================================================"

# 1. Verification of Required Files
REQUIRED_FILES=("config.xml" "index.html" "styles.css" "icon.png" "src/app.js")
for file in "${REQUIRED_FILES[@]}"; do
  if [[ ! -f "$file" ]]; then
    echo "ERROR: Required runtime file missing: $file" >&2
    exit 1
  fi
done

# 2. Prepare Clean Staging and Build Output Directories
BUILD_DIR="$SCRIPT_DIR/build"
STAGING_DIR="$BUILD_DIR/staging"

rm -rf "$BUILD_DIR"
mkdir -p "$STAGING_DIR"

echo "→ Staging web application runtime assets..."
cp "$SCRIPT_DIR/config.xml" "$STAGING_DIR/"
cp "$SCRIPT_DIR/.tproject" "$STAGING_DIR/"
cp "$SCRIPT_DIR/icon.png" "$STAGING_DIR/"
cp "$SCRIPT_DIR/index.html" "$STAGING_DIR/"
cp "$SCRIPT_DIR/styles.css" "$STAGING_DIR/"
cp -r "$SCRIPT_DIR/src" "$STAGING_DIR/"
if [[ -d "$SCRIPT_DIR/assets" ]]; then
  cp -r "$SCRIPT_DIR/assets" "$STAGING_DIR/"
fi

# Clean any macOS metadata
find "$STAGING_DIR" -name ".DS_Store" -delete 2>/dev/null || true

# 3. Create Unsigned Standard WGT Archive
# (WGT packages are standard zip archives with config.xml at the root)
UNSIGNED_WGT="$BUILD_DIR/MovieBoxTV-unsigned.wgt"
echo "→ Creating unsigned WGT package: $UNSIGNED_WGT"

(
  cd "$STAGING_DIR"
  zip -q -r -9 "$UNSIGNED_WGT" . -x ".DS_Store" "*/.DS_Store"
)

# 4. Check for installed Tizen CLI
TIZEN_CLI="/Users/kuldeep/tizen-studio/tools/ide/bin/tizen"
CLI_WGT="$BUILD_DIR/MovieBoxTV.wgt"

if [[ -x "$TIZEN_CLI" ]]; then
  echo "→ Packaging with Samsung Tizen Studio CLI ($TIZEN_CLI)..."
  "$TIZEN_CLI" package -t wgt -o "$BUILD_DIR" -- "$STAGING_DIR" || {
    echo "Notice: Tizen CLI packaging returned non-zero; falling back to standard WGT"
    cp "$UNSIGNED_WGT" "$CLI_WGT"
  }
  if [[ -f "$BUILD_DIR/MovieBox TV.wgt" ]]; then
    cp "$BUILD_DIR/MovieBox TV.wgt" "$CLI_WGT"
  fi
else
  echo "Notice: Tizen CLI not found at default location; using standard zip WGT"
  cp "$UNSIGNED_WGT" "$CLI_WGT"
fi

# 5. Archive Verification
echo "→ Verifying generated WGT archive structure..."
if ! unzip -tq "$UNSIGNED_WGT" >/dev/null 2>&1; then
  echo "ERROR: Generated WGT failed ZIP archive integrity verification!" >&2
  exit 1
fi

echo "✓ Archive integrity verified."
echo ""
echo "Archive Contents:"
unzip -l "$UNSIGNED_WGT" | head -n 35

echo ""
echo "========================================================"
echo "BUILD SUCCESSFUL"
echo "========================================================"
echo "Artifact paths:"
echo "1. Unsigned WGT (for external Homebrew workflow):"
echo "   $UNSIGNED_WGT"
if [[ -f "$CLI_WGT" ]]; then
  echo "2. Tizen Packaged WGT:"
  echo "   $CLI_WGT"
fi
echo ""
ls -lh "$BUILD_DIR"/*.wgt
echo "========================================================"
