# Deployment

How `delivery-service` gets from a commit to a running, TLS-terminated host, how to roll back, and how
a release with a database migration stays zero-downtime.

## Target

One Linux host running Docker, deployed over SSH. It's provider-agnostic: the same scripts run on a
Hetzner VM or an EC2 instance. The staging environment for this assignment is on AWS (`eu-central-1`):

```
Internet ──80/443──► EC2 (Ubuntu 24.04, security group flexpress-web-sg)
                       nginx ──► app-blue | app-green ──► RDS PostgreSQL 18 (private, flexpress-db-sg)
                         └────► keycloak ───────────────┘
                       app ──(EC2 IAM role, no keys)──► S3 bucket (private)
```

- Only nginx publishes ports. The API and Keycloak have none; RDS has public access disabled and its
  security group only accepts 5432 from the web security group.
- Photos go to S3 through the instance's IAM role (least privilege: `orders/*/pod/*`), so no S3 keys
  exist anywhere. Locally MinIO plays S3; switching is configuration only.
- Infrastructure setup (security groups, IAM role, RDS, S3, EC2 user data, Elastic IP) is a step-by-step
  checklist in [`deploy/aws/README.md`](deploy/aws/README.md).

## Pipeline (`.gitlab-ci.yml`)

```
lint ─► test ─► build ─► migrate ─► deploy-staging       automatic on main
                                └─► deploy-production    tags vX.Y.Z, manual (migrate + deploy)
```

| Stage | What happens |
|---|---|
| lint | `npm ci` (npm cache keyed on `package-lock.json`), ESLint without `--fix`, `npm audit --omit=dev` |
| test | unit tests, `nest build`, e2e tests against a PostgreSQL service container |
| build | `docker build` → push `registry.gitlab.com/<project>/delivery-service:$CI_COMMIT_SHA` (also `:latest` on main, `:vX.Y.Z` on tags). Authenticates with the job's own registry token |
| migrate | SSH to the host → `deploy.sh migrate <sha>`: pending migrations run with the new image, before any traffic moves |
| deploy | SSH to the host → `deploy.sh <sha>`: blue/green switch (below) |

Rules use `rules:` only. Deploy jobs appear only when the target host variable is set
(`STAGING_HOST`, `PRODUCTION_HOST`), production only for `vX.Y.Z` tags and only on a manual click.
`resource_group` serialises deploys per environment.

## Secrets

Nothing secret is in git or in the image. CI variables (Settings → CI/CD → Variables):

| Variable | Masked + protected | Ends up in |
|---|---|---|
| `SSH_PRIVATE_KEY_B64` | yes | CI's ssh-agent only (base64 so it's one maskable line) |
| `DEPLOY_DB_PASSWORD` | yes | `/opt/flexpress/app.env` → API containers |
| `KC_DB_PASSWORD`, `KC_ADMIN_PASSWORD` | yes | `/opt/flexpress/keycloak.env` → Keycloak only |
| `SSH_KNOWN_HOSTS`, `STAGING_HOST`, `STAGING_API_HOST`, `STAGING_AUTH_HOST`, `DEPLOY_DB_HOST`, `DEPLOY_S3_BUCKET`, `ACME_EMAIL` | no (not secret) | `/opt/flexpress/deploy.env` (interpolation only) |

Flow: password manager → masked, protected CI variable (only visible to jobs on protected branches
and tags, hidden in logs) → the deploy job writes the env files on the host with `umask 077` (mode 600,
owned by the unprivileged `deploy` user) → Compose passes each file only to the container that needs it,
so the API never sees Keycloak's database password. The registry login on the host uses the job's
short-lived `CI_REGISTRY_PASSWORD` and is logged out after the job. The service validates tokens through
JWKS and needs no Keycloak client secret; if it ever does (e.g. for the admin API), it would follow
the same path.

Deploy settings carry a `DEPLOY_` prefix on purpose: project variables override variables defined in
`.gitlab-ci.yml`, and a project-level `DB_HOST` once replaced the test job's local database.

CI verifies the host key from `SSH_KNOWN_HOSTS` instead of disabling host key checking. SSH logs in as
`deploy`, a user without sudo that only accepts the CI key.

## Deploy (blue/green)

`deploy/deploy.sh <tag>` on the host, called by CI:

1. Take a lock (`flock`) so two deploys can't overlap.
2. Pull `<image>:<tag>`; run pending migrations with it (`docker compose run --rm migrate`).
3. Start the idle color (`app-green` if `app-blue` is live) with the new tag. The live color keeps
   serving.
4. Wait up to 90 s for `GET /health/ready` (database reachable). If it never gets ready: stop the new
   color, exit non-zero, and the old version is still live. No traffic was moved.
5. Point nginx at the new color (`nginx/active-upstream.conf`), `nginx -t`, `nginx -s reload`. Reload is
   graceful: in-flight requests finish on the old color, new requests go to the new one.
6. Stop the old color with SIGTERM: Nest stops accepting connections, drains, closes the DB pool, exits 0.
7. Record `current_tag`, `previous_tag` and the live color in `/opt/flexpress/state/`.

Manual use, as `deploy` on the host:

```bash
/opt/flexpress/deploy.sh status
/opt/flexpress/deploy.sh <sha>
```

## Rollback (one command)

```bash
/opt/flexpress/deploy.sh --rollback        # same as: /opt/flexpress/deploy.sh <previous_tag>
```

It runs the same blue/green flow with the previous image (already on the host, so it works even
without registry access). It never runs down-migrations: with expand/contract, the previous image is
compatible with the current schema. A broken migration is fixed by a new forward migration.

## Zero-downtime releases with migrations (expand/contract)

During a deploy, the old and new versions run against the same database at the same time, and a
rollback puts the old version back on the new schema. So every migration must be backward compatible
with the previous release. Breaking changes are split across releases:

| Release | Example: rename `pickup_address` → `pickup_location` |
|---|---|
| 1. Expand | Add `pickup_location` (nullable). Code writes both columns and reads the old one. Old code is unaffected |
| 2. Migrate | Backfill `pickup_location` from `pickup_address` (a data migration, in batches for large tables). Code reads the new column, still writes both |
| 3. Contract | Once no running or rollback-target version uses `pickup_address`: stop writing it, then drop it in a later migration |

Rules that follow from this: add columns as nullable or with a default; never rename or drop in the same
release that stops using something; create indexes with `CREATE INDEX CONCURRENTLY` in a migration with
`transaction = false`; widen constraints before narrowing them (the status `CHECK` constraint is easy to
extend for exactly this reason).

## Network and firewall

- **Security groups (AWS) / Hetzner Cloud Firewall:** inbound 80 and 443 from anywhere; 22 for SSH;
  everything else denied. The database group allows 5432 only from the web group.
- **ufw on the host** (second layer, enabled by user data): allow 22, 80, 443. Docker publishes only
  nginx's ports, so no container is reachable directly.
- **SSH:** key-only, `deploy` user for CI, personal key for the admin user. GitLab.com shared runners
  have no fixed IPs, so 22 is open to the internet here. In production I'd restrict it to a VPN or
  bastion, run a self-managed runner inside the VPC, or use AWS Systems Manager instead of SSH.
- `/metrics` returns 404 through nginx; Prometheus would scrape it from the private network.

## TLS

Let's Encrypt via certbot, HTTP-01 challenge, run once per host:

```bash
/opt/flexpress/deploy.sh certs
```

nginx first serves port 80 with the ACME challenge location, certbot obtains one certificate for both
hostnames, and `deploy.sh` switches nginx to the HTTPS config (port 80 redirects to 443, HSTS on).
Without a domain, hostnames are `api-<ip>.sslip.io` and `auth-<ip>.sslip.io`, which resolve to the
Elastic IP. **Renewal:** certificates last 90 days; a daily cron entry renews them when they have less
than 30 days left and reloads nginx:

```
17 3 * * * /opt/flexpress/deploy.sh certs >> /opt/flexpress/state/certs.log 2>&1
```

## Status of this deployment

Verified on the real staging host (AWS, `eu-central-1`) through the GitLab pipeline:

- lint → test → build → migrate → deploy ran green; the image came from the GitLab registry, the
  migrations ran against RDS, and nginx switched traffic to the new color.
- `https://api-18-193-180-145.sslip.io/health/ready` → 200 with the database up: the API reaches RDS
  over TLS with certificate verification (`verify-full` against the RDS CA).
- Let's Encrypt certificate for both hostnames; HTTP redirects to HTTPS; HSTS on; `/metrics` → 404
  from the internet; `/orders` without a token → 401.
- Keycloak runs on the host with its data on RDS and issues tokens with the public issuer
  `https://auth-18-193-180-145.sslip.io/realms/flexpress`, which the API validates.

Also verified locally: the Dockerfile and the local stack from a fresh clone, the production Compose
file (`docker compose config`), both nginx configs (`nginx -t`), `deploy.sh` (shellcheck), and
`.gitlab-ci.yml` (GitLab's CI JSON schema and pipeline validation).

Rollback rehearsed on the host after the second release (after submission): `deploy.sh --rollback`
switched green → blue in about 8 seconds while the readiness endpoint was polled five times a second:
about 90 consecutive 200s, no failed requests. The image pull failed by design (CI logs the host out of
the registry after each job), so the script used the image already on the host. Not yet done: the
certificate renewal cron entry. The first pipeline runs surfaced two configuration issues, both fixed: a
project variable named `DB_HOST` overriding the test job's database, and a host-key variable saved with
the wrong type.
