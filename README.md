# delivery-service

Delivery orders for Flexpress 365: dispatchers create orders and assign drivers, drivers move them
through `CREATED → ASSIGNED → PICKED_UP → IN_TRANSIT → DELIVERED` (or `FAILED`) from a mobile app and
upload a proof-of-delivery photo. NestJS + TypeScript, PostgreSQL, Keycloak (JWT via JWKS),
S3-compatible storage (MinIO locally, S3 in AWS).

- [DEPLOYMENT.md](DEPLOYMENT.md): CI/CD pipeline, blue/green deploy, rollback, expand/contract migrations,
  network, TLS and secrets.
- [DECISIONS.md](DECISIONS.md): assumptions, trade-offs, and what I'd do with more time.

## Run it locally (under 5 minutes)

Requirements: Docker Desktop (Compose v2). Nothing else; no `.env` file needed.

```bash
docker compose up -d --wait
```

The first run builds the API image (2–3 minutes). Compose then starts PostgreSQL, Keycloak (realm
imported), MinIO, a one-shot job that creates the bucket, a one-shot job that runs the database
migrations, and the API. `--wait` returns once everything is healthy.

| URL | What |
|---|---|
| http://localhost:3000/docs | Swagger UI (click **Authorize** and paste an access token) |
| http://localhost:3000/health, `/health/ready` | Liveness, readiness (checks the database) |
| http://localhost:3000/metrics | Prometheus metrics |
| http://localhost:8080/admin | Keycloak admin (`admin` / `dev-only-admin-password`) |
| http://localhost:9001 | MinIO console (`dev-only-minio-user` / `dev-only-minio-password`) |

All ports are bound to `127.0.0.1`. Every credential above is a **dev-only default** baked into
`docker-compose.yml` so the stack starts with zero setup; production secrets come from CI variables
(see [DEPLOYMENT.md](DEPLOYMENT.md#secrets)). To start from scratch: `docker compose down -v`.

## Test users

All passwords are `dev-only-password`. Two companies, so company isolation can be tested.

| Username | Role | Company (`company_id`) | User id (`sub`) |
|---|---|---|---|
| `dispatcher.a` | dispatcher | `aaaaaaaa-0000-4000-8000-000000000001` | `1a000000-0000-4000-8000-000000000001` |
| `driver.a` | driver | `aaaaaaaa-0000-4000-8000-000000000001` | `1a000000-0000-4000-8000-000000000002` |
| `dispatcher.b` | dispatcher | `bbbbbbbb-0000-4000-8000-000000000002` | `1b000000-0000-4000-8000-000000000001` |
| `driver.b` | driver | `bbbbbbbb-0000-4000-8000-000000000002` | `1b000000-0000-4000-8000-000000000002` |

## Try it with Postman (easiest)

[`postman/flexpress.postman_collection.json`](postman/flexpress.postman_collection.json) covers the
whole API with assertions, and needs no environment (`baseUrl` and `keycloakUrl` are collection
variables pointing at localhost).

1. Postman → **Import** → select the file.
2. Right-click the collection → **Run collection** → **Run**. It runs 40 requests in order and shows
   each assertion (61 in total):
   - **Auth (run first)**: gets a token for each test user and stores it in a collection variable.
   - **Orders** (A1–C5): create, list with filters and paging, get by id, and the error cases:
     driver can't create (403), `companyId` in the body (400), no or tampered token (401),
     another company's order (404).
   - **Workflow** (W1–W20): one order's full life: assign, `PICKED_UP` with an idempotency retry
     (replayed response, then 422 for a different body), invalid transitions (409), proof-of-delivery
     upload through the presigned URL (403 for the wrong Content-Type), `DELIVERED`, and the
     status history.
3. To send a single request, run the **Auth** folder first; tokens expire after 15 minutes.
   W16 uploads a placeholder body; switch its Body to **binary** to upload a real photo.

## Example requests (curl)

The same flow from a terminal.

Get tokens (the `delivery-app` client has the password grant enabled for local testing only):

```bash
tok() { curl -s http://localhost:8080/realms/flexpress/protocol/openid-connect/token -d grant_type=password -d client_id=delivery-app -d username="$1" -d password=dev-only-password | python3 -c 'import sys,json; print(json.load(sys.stdin)["access_token"])'; }
DA=$(tok dispatcher.a); DB=$(tok dispatcher.b); DRA=$(tok driver.a); API=http://localhost:3000
```

Create, list and read orders (dispatcher). `companyId` always comes from the token:

```bash
ID=$(curl -s -X POST $API/orders -H "Authorization: Bearer $DA" -H 'Content-Type: application/json' \
  -d '{"pickupAddress":"1 Warehouse St, Berlin","deliveryAddress":"9 Customer Rd, Berlin"}' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')
curl -s "$API/orders?status=CREATED&page=1&limit=20" -H "Authorization: Bearer $DA"
curl -s -w ' [%{http_code}]\n' $API/orders/$ID -H "Authorization: Bearer $DB"   # other company → 404
```

Assign a driver, then the driver moves the order on. Every status change needs an `Idempotency-Key`;
retrying with the same key returns the stored response (`Idempotent-Replayed: true`) instead of
changing the order twice:

```bash
curl -s -X POST $API/orders/$ID/assign -H "Authorization: Bearer $DA" -H 'Content-Type: application/json' \
  -d '{"driverId":"1a000000-0000-4000-8000-000000000002"}'
for s in PICKED_UP IN_TRANSIT; do
  curl -s -X POST $API/orders/$ID/status -H "Authorization: Bearer $DRA" -H 'Content-Type: application/json' \
    -H "Idempotency-Key: $(uuidgen)" -d "{\"status\":\"$s\",\"lat\":52.52,\"lng\":13.405}"; echo
done
```

Proof of delivery: get a presigned URL, upload the photo straight to storage, then mark it delivered
(`DELIVERED` without a photo returns `409 PROOF_OF_DELIVERY_REQUIRED`):

```bash
URL=$(curl -s -X POST $API/orders/$ID/proof-of-delivery -H "Authorization: Bearer $DRA" \
  -H 'Content-Type: application/json' -d '{"contentType":"image/jpeg"}' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["uploadUrl"])')
curl -s -o /dev/null -w 'upload [%{http_code}]\n' -X PUT "$URL" -H 'Content-Type: image/jpeg' --data-binary @photo.jpg
curl -s -X POST $API/orders/$ID/status -H "Authorization: Bearer $DRA" -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $(uuidgen)" -d '{"status":"DELIVERED"}'
curl -s $API/orders/$ID/events -H "Authorization: Bearer $DA"   # full status history
```

## API

All endpoints require a Keycloak bearer token except health, metrics and docs.

| Method | Path | Role | Notes |
|---|---|---|---|
| `POST` | `/orders` | dispatcher | `{ pickupAddress, deliveryAddress }` |
| `GET` | `/orders` | both | `page`, `limit` (≤ 100), `status`, `from` (inclusive), `to` (exclusive), ISO 8601 |
| `GET` | `/orders/:id` | both | another company's order, or a driver's unassigned order → 404 |
| `POST` | `/orders/:id/assign` | dispatcher | `{ driverId }`: `CREATED → ASSIGNED` |
| `POST` | `/orders/:id/status` | assigned driver | `{ status, reason?, lat?, lng? }` + `Idempotency-Key` header |
| `POST` | `/orders/:id/proof-of-delivery` | assigned driver | `{ contentType }` → presigned PUT URL (5 min), only while `IN_TRANSIT` |
| `GET` | `/orders/:id/events` | both | append-only status history |

Errors: 400 invalid input (unknown fields such as `companyId` are rejected), 401 missing or invalid
token, 403 wrong role, 404 outside your scope, 409 invalid transition
(`{"error":"INVALID_TRANSITION","message":"Cannot change status from X to Y. Allowed: ..."}`),
422 idempotency key reused with a different body.

## Tests

Requires Node 24 (`nvm use`) and, for e2e, the compose stack running (it uses the local PostgreSQL).

```bash
cd delivery-service && npm ci
npm run lint:check
npm test            # 68 unit tests: state machine, auth, scoping, config, storage, metrics, logging
npm run test:e2e    # 10 e2e tests: whole app on real PostgreSQL, tokens signed by test keys
```

## Developing on the host

```bash
docker compose stop delivery-service        # free port 3000
cd delivery-service && cp .env.example .env && npm ci
npm run migration:run && npm run start:dev
```

Migrations: `npm run migration:generate -- src/database/migrations/<Name>` (from entity changes),
`migration:run`, `migration:revert`, `migration:show`.

## Layout

```
delivery-service/   NestJS app: src/ (auth, orders, storage, health, metrics, logging), test/, Dockerfile
docker/keycloak/    local realm export (roles, clients, mappers, test users)
deploy/             production compose, nginx, deploy.sh (blue/green, rollback)
docker-compose.yml  local stack        .gitlab-ci.yml  CI/CD pipeline
postman/            Postman collection
```
