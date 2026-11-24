#!/usr/bin/env bash
# Kept for compatibility with older installs: use lzrcnc.sh instead.
exec "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/lzrcnc.sh" "$@"
