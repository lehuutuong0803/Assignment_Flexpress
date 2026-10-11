#!/usr/bin/env bash
# Blue/green deploy of delivery-service on a single host. Run from CI over SSH, or by hand.
#
#   ./deploy.sh <tag>          migrate, start the idle color, wait for /health/ready, switch nginx,
#                              stop the old color. The old color keeps serving until the switch.
#   ./deploy.sh --rollback     redeploy the previous tag (same as ./deploy.sh <previous_tag>)
#   ./deploy.sh migrate <tag>  only run pending migrations with that image
#   ./deploy.sh certs          issue or renew the Let's Encrypt certificate, then enable HTTPS
#   ./deploy.sh status         show what is running
#
# Rollback never runs down-migrations: releases follow expand/contract, so the previous image works
# on the current schema (see DEPLOYMENT.md).
set -euo pipefail

cd "$(dirname "$0")"
STATE_DIR=state
mkdir -p "$STATE_DIR" nginx/sites

# Only one deploy at a time (CI also serialises with resource_group).
exec 9>"$STATE_DIR/deploy.lock"
flock -n 9 || { echo "Another deploy is running" >&2; exit 1; }

# Non-secret settings (image, hostnames) for compose interpolation and the nginx templates.
set -a
# shellcheck disable=SC1091
source ./deploy.env
set +a

compose() {
  BLUE_TAG="$(read_state blue_tag)" GREEN_TAG="$(read_state green_tag)" \
    docker compose -f docker-compose.prod.yml --env-file deploy.env "$@"
}
read_state() { cat "$STATE_DIR/$1" 2>/dev/null || true; }
write_state() { printf '%s\n' "$2" > "$STATE_DIR/$1"; }
log() { printf '[deploy %s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }

# Pull the image; if the registry is unreachable (e.g. a manual rollback without CI's login),
# fall back to the copy already on the host.
pull_image() {
  local image="$APP_IMAGE:$1"
  docker pull "$image" >/dev/null || docker image inspect "$image" >/dev/null || {
    echo "Image $image is neither pullable nor present locally" >&2
    exit 1
  }
}

migrate() {
  local tag="$1"
  pull_image "$tag"
  log "running migrations with $tag"
  MIGRATE_TAG="$tag" compose run --rm migrate
}

# Render the nginx sites: HTTP-only until a certificate exists, HTTPS with redirect afterwards.
render_nginx() {
  local template=http.conf
  if compose run --rm --entrypoint test certbot \
    -f "/etc/letsencrypt/live/$PUBLIC_API_HOST/fullchain.pem" 2>/dev/null; then
    template=https.conf
  fi
  sed -e "s/__API_HOST__/$PUBLIC_API_HOST/g" -e "s/__AUTH_HOST__/$PUBLIC_AUTH_HOST/g" \
    "nginx/templates/$template" > nginx/sites/flexpress.conf.tmp
  mv nginx/sites/flexpress.conf.tmp nginx/sites/flexpress.conf
}

reload_nginx() {
  if [ -n "$(compose ps -q nginx)" ]; then
    compose exec -T nginx nginx -t
    compose exec -T nginx nginx -s reload
  else
    compose up -d nginx
  fi
}

wait_ready() {
  local color="$1"
  for _ in $(seq 1 45); do
    if compose exec -T "app-$color" node -e \
      "fetch('http://127.0.0.1:3000/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" \
      2>/dev/null; then
      return 0
    fi
    sleep 2
  done
  return 1
}

deploy() {
  local tag="$1" current target
  current="$(read_state current_color)"
  if [ "$current" = blue ]; then target=green; else target=blue; fi
  log "deploying $tag to $target (live: ${current:-none})"

  compose up -d keycloak
  migrate "$tag"

  write_state "${target}_tag" "$tag"
  compose up -d --no-deps "app-$target"
  if ! wait_ready "$target"; then
    log "app-$target never became ready; leaving ${current:-nothing} live"
    compose logs --tail 50 "app-$target" || true
    compose stop "app-$target"
    exit 1
  fi

  # Atomic switch: nginx re-reads the upstream on reload; in-flight requests finish on the old color.
  # shellcheck disable=SC2016 # $backend is an nginx variable, written literally
  printf 'set $backend http://app-%s:3000;\n' "$target" > nginx/active-upstream.conf.tmp
  mv nginx/active-upstream.conf.tmp nginx/active-upstream.conf
  render_nginx
  reload_nginx
  log "traffic now on app-$target"

  if [ -n "$current" ]; then
    compose stop "app-$current" # SIGTERM: drains in-flight requests, closes the DB pool
  fi

  write_state previous_tag "$(read_state current_tag)"
  write_state current_tag "$tag"
  write_state current_color "$target"
  log "done: current=$tag previous=$(read_state previous_tag)"
}

certs() {
  render_nginx
  reload_nginx
  log "requesting certificate for $PUBLIC_API_HOST and $PUBLIC_AUTH_HOST"
  compose run --rm certbot certonly --webroot -w /var/www/certbot \
    -d "$PUBLIC_API_HOST" -d "$PUBLIC_AUTH_HOST" \
    --email "$ACME_EMAIL" --agree-tos --non-interactive --keep-until-expiring
  render_nginx
  reload_nginx
  log "HTTPS enabled"
}

case "${1:-}" in
  "" | -h | --help)
    sed -n '2,13p' "$0"
    ;;
  status)
    echo "current: $(read_state current_tag) on $(read_state current_color)"
    echo "previous: $(read_state previous_tag)"
    compose ps
    ;;
  migrate)
    migrate "${2:?usage: deploy.sh migrate <tag>}"
    ;;
  certs)
    certs
    ;;
  --rollback)
    previous="$(read_state previous_tag)"
    [ -n "$previous" ] || { echo "No previous tag recorded" >&2; exit 1; }
    deploy "$previous"
    ;;
  *)
    deploy "$1"
    ;;
esac
