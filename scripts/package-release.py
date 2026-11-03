#!/usr/bin/env python3
"""Build or verify the extension ZIP using only Python's standard library."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
import zipfile


EXTENSION_FILES = (
    "LICENSE",
    "_locales/en/messages.json",
    "_locales/es/messages.json",
    "_locales/fr/messages.json",
    "_locales/it/messages.json",
    "_locales/pt_PT/messages.json",
    "background/service-worker.js",
    "content/bridge.js",
    "content/interceptor.js",
    "icons/icon128.png",
    "icons/icon16.png",
    "icons/icon48.png",
    "manifest.json",
    "popup/popup.css",
    "popup/popup.html",
    "popup/popup.js",
    "utils/i18n-runtime.js",
    "utils/wallapop-api.js",
)
ZIP_TIMESTAMP = (1980, 1, 1, 0, 0, 0)


def source_files(root):
    root = root.resolve()
    contents = {}
    for name in EXTENSION_FILES:
        source = root / name
        if source.is_symlink() or not source.is_file():
            raise ValueError(f"Release source must be a regular file: {name}")
        for parent in source.parents:
            if parent == root:
                break
            if parent.is_symlink():
                raise ValueError(f"Release source must not use symlink directories: {name}")
        source.resolve().relative_to(root)
        contents[name] = source.read_bytes()
    manifest = json.loads(contents["manifest.json"])
    version = manifest.get("version", "")
    if manifest.get("manifest_version") != 3 or not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise ValueError("The extension must declare Manifest V3 and a three-part numeric version.")
    return contents, version


def verify_archive(root, archive_path):
    contents, version = source_files(root)
    with zipfile.ZipFile(archive_path) as archive:
        names = archive.namelist()
        if names != sorted(EXTENSION_FILES):
            raise ValueError("ZIP entries must exactly match the sorted release allowlist.")
        for name, expected in contents.items():
            entry = archive.getinfo(name)
            if entry.date_time != ZIP_TIMESTAMP or entry.is_dir():
                raise ValueError(f"Unexpected ZIP metadata: {name}")
            if archive.read(name) != expected:
                raise ValueError(f"ZIP bytes differ from the current source: {name}")
        if archive.testzip() is not None:
            raise ValueError("ZIP CRC verification failed.")
    return {
        "archive": str(archive_path.resolve()),
        "version": version,
        "files": sorted(contents),
        "sha256": hashlib.sha256(archive_path.read_bytes()).hexdigest(),
        "source_matches": True,
    }


def build_archive(root, output):
    contents, _version = source_files(root)
    if output.suffix.lower() != ".zip":
        raise ValueError("Release output must use a .zip filename.")
    output.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=".wallapop-release-", suffix=".zip", dir=output.parent)
    temporary = Path(temporary_name)
    os.close(descriptor)
    try:
        with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
            for name in sorted(contents):
                entry = zipfile.ZipInfo(name, date_time=ZIP_TIMESTAMP)
                entry.create_system = 3
                entry.external_attr = 0o100644 << 16
                entry.compress_type = zipfile.ZIP_DEFLATED
                archive.writestr(entry, contents[name], compresslevel=9)
        verify_archive(root, temporary)
        os.replace(temporary, output)
    finally:
        temporary.unlink(missing_ok=True)
    return verify_archive(root, output)


def main():
    root = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, help="Output ZIP; defaults to dist/wallapop-tools-vVERSION.zip.")
    parser.add_argument("--verify", type=Path, help="Verify an existing ZIP against this checkout without writing.")
    arguments = parser.parse_args()
    if arguments.output and arguments.verify:
        parser.error("Choose either --output or --verify.")
    try:
        if arguments.verify:
            result = verify_archive(root, arguments.verify)
        else:
            _contents, version = source_files(root)
            output = arguments.output or root / "dist" / f"wallapop-tools-v{version}.zip"
            result = build_archive(root, output)
    except (OSError, ValueError, zipfile.BadZipFile, json.JSONDecodeError) as error:
        parser.exit(1, f"Release packaging failed: {error}\n")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
