#!/usr/bin/env bash
# Code/assets only: keeps existing dependencies, uses host files persistently.
set -euo pipefail
cd "$(dirname "$0")"
test -s frontend/dist/index.html
test -s backend/app/site_build.json
# Check the dependencies actually installed in the current image before any change.
deployed_requirements=$(docker compose exec -T backend cat /app/requirements.txt)
if [[ "$deployed_requirements" != "$(cat backend/requirements.txt)" ]]; then
  echo 'Backend dependencies changed. Build/load a new image before deploying.' >&2
  exit 1
fi
compose=(docker compose -f docker-compose.yml -f compose.cached.yml)
"${compose[@]}" up -d --no-build --pull never
# Bind mounts persist across recreation; workers need a restart for later updates.
"${compose[@]}" restart backend
"${compose[@]}" exec -T frontend nginx -t
"${compose[@]}" exec -T frontend nginx -s reload
for attempt in 1 2 3 4 5; do
  if "${compose[@]}" exec -T backend python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=5).read().decode())"; then
    "${compose[@]}" ps
    exit 0
  fi
  sleep 2
done
echo 'Backend health check failed; inspect docker compose logs backend.' >&2
exit 1
