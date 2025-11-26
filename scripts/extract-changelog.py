#!/usr/bin/env python3
"""
Extract a specific version section from CHANGELOG.md

Usage:
    python3 extract-changelog.py <version> <changelog-file>

Example:
    python3 extract-changelog.py 0.3.0 programs/cascade-splits/CHANGELOG.md
"""

import sys
import re


def extract_version_section(version: str, changelog_path: str) -> str:
    """
    Extract the section for a specific version from CHANGELOG.md

    Args:
        version: Version to extract (e.g., "0.3.0")
        changelog_path: Path to CHANGELOG.md file

    Returns:
        The extracted section as a string

    Raises:
        ValueError: If version not found in changelog
    """
    with open(changelog_path, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    # Pattern to match version headers like "## [0.3.0] - 2025-11-26"
    version_pattern = re.compile(rf'^## \[{re.escape(version)}\]')
    # Pattern to match any version header
    any_version_pattern = re.compile(r'^## \[')

    result_lines = []
    in_section = False

    for line in lines:
        if version_pattern.match(line):
            # Found the target version
            in_section = True
            result_lines.append(line)
        elif in_section and any_version_pattern.match(line):
            # Hit the next version section, stop
            break
        elif in_section:
            # We're in the target section, collect the line
            result_lines.append(line)

    if not result_lines:
        raise ValueError(f"Version [{version}] not found in {changelog_path}")

    return ''.join(result_lines).rstrip() + '\n'


def main():
    if len(sys.argv) != 3:
        print(__doc__, file=sys.stderr)
        sys.exit(1)

    version = sys.argv[1]
    changelog_path = sys.argv[2]

    try:
        section = extract_version_section(version, changelog_path)
        print(section, end='')
    except FileNotFoundError:
        print(f"Error: File not found: {changelog_path}", file=sys.stderr)
        sys.exit(1)
    except ValueError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
