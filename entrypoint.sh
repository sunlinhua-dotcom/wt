#!/bin/sh
# Render runtime config.js from Zeabur env vars so the deployed static site
# can pick up the Mimo API key without a hash-bootstrap URL.
#
# Vars (set in Zeabur 环境变量 panel):
#   MIMO_API_KEY  — required; the tp-... token-plan key
#   MIMO_BASE     — optional; defaults to the xiaomimimo CN endpoint
#   MIMO_MODEL    — optional; defaults to mimo-v2-omni
set -eu

cat > /usr/share/nginx/html/config.js <<EOF
// auto-generated at container start by entrypoint.sh — do not edit by hand
window.WT_CONFIG = {
  base:  "${MIMO_BASE:-https://token-plan-cn.xiaomimimo.com/v1}",
  model: "${MIMO_MODEL:-mimo-v2-omni}",
  key:   "${MIMO_API_KEY:-}"
};
EOF

exec "$@"
