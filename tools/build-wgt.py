#!/usr/bin/env python3
"""Builds an unsigned .wgt archive for Samsung Tizen TV (matching VexonTV architecture).
A .wgt is an unsigned zip package; whoever installs it signs it (Apps2Samsung, Tizen CLI, or Homebrew installer does).

Usage:
    python3 tools/build-wgt.py
"""
import os
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FILES = ['config.xml', 'index.html', 'styles.css', 'icon.png', 'brand.png', '.tproject']
DIRS = ['src', 'assets']

def main():
    entries = list(FILES)
    for folder in DIRS:
        folder_path = os.path.join(ROOT, folder)
        if not os.path.exists(folder_path):
            continue
        for dirpath, _, names in os.walk(folder_path):
            for name in sorted(names):
                if name.startswith('.') or name.endswith('.DS_Store'):
                    continue
                entries.append(os.path.relpath(os.path.join(dirpath, name), ROOT))

    for entry in entries:
        full_path = os.path.join(ROOT, entry)
        if not os.path.exists(full_path):
            raise SystemExit('Missing required entry: ' + entry)

    # Output to both dist/ and build/
    outputs = [
        os.path.join(ROOT, 'dist', 'MovieBoxTV.wgt'),
        os.path.join(ROOT, 'build', 'MovieBoxTV-unsigned.wgt'),
        os.path.join(ROOT, 'build', 'MovieBoxTV.wgt'),
    ]

    for out in outputs:
        os.makedirs(os.path.dirname(out), exist_ok=True)
        with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as archive:
            for entry in entries:
                archive.write(os.path.join(ROOT, entry), entry.replace(os.sep, '/'))
        size_mb = os.path.getsize(out) / (1024 * 1024)
        print(f"✓ Built {out} ({size_mb:.2f} MB, {len(entries)} files)")

if __name__ == '__main__':
    main()
