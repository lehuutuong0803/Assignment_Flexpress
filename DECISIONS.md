# Decisions

## Assumptions

- Each dispatcher and driver belongs to exactly one company. The company comes from a `company_id`
  attribute on the Keycloak user, mapped into the token; only admins can edit it.
- Each user has exactly one role, dispatcher or driver.
- A dispatcher assigns the driver through a separate endpoint (`CREATED → ASSIGNED`); from then on only
  the assigned driver moves the order, and only the driver can set `FAILED` (from `IN_TRANSIT`, with
  a reason).
- An order can't be marked `DELIVERED` without a proof-of-delivery photo that actually exists in
  storage.
- There's no customer role, and login/logout stay in Keycloak. The service only validates tokens.

## Trade-offs

**Company isolation in the application, not in the database.** Every query for orders starts from one
small function that adds the company filter, plus the driver filter for drivers, and the company
always comes from the token. If you ask for another company's order you get a 404, so you can't even
tell it exists. It's easy to read, test and review because it's in one place. The catch is that it
relies on every new query going through that function. Postgres row-level security would be a real
second line of defence, and it's the first thing I'd add.

**A small custom auth guard instead of Passport.** I verify tokens with `jose` against Keycloak's
public keys (issuer, audience, expiry, RS256 only), in about fifty lines I can explain line by line,
rather than wiring up three Passport packages. The guard applies to every route by default, so a new
endpoint is protected unless someone explicitly marks it public. The price was some friction:
`jose` only ships as an ES module, so I had to teach Jest to compile it.

**Idempotency done properly, which costs a table and some care.** Drivers on bad connections will
retry, so status changes need an `Idempotency-Key`. I store the response together with the status
change in one transaction, so a retry gets the original answer and never creates a second event.
Reusing a key for a different request is a 422. A plain "ignore duplicates" check would have been
simpler, but the client would get confusing errors on a retry that had actually succeeded. Keys
expire after 24 hours; there's no cleanup job yet.

**Migrations as their own step, and rollbacks that never undo them.** Migrations run once, before the
new version gets traffic: a one-shot container locally, a pipeline stage in production. They never
run when the app starts. Rolling back only swaps the image back. That only works if every migration
is backward compatible (expand, migrate, contract), which is a discipline the team has to follow.
In return, a bad release can be undone in one command without touching data.

**One host, Docker Compose and a shell script, instead of Kubernetes or ECS.** The deploy is a short
blue/green script over SSH: start the new version next to the old one, wait until it's ready, switch
nginx, stop the old one. It works on Hetzner or EC2 alike, and anyone can read it in five minutes.
What I give up is high availability and autoscaling: it's a single machine. And because GitLab's
shared runners have no fixed IPs, SSH has to be reachable from the internet (key-only, for a user
without sudo). With more time I'd move to a runner inside the network or AWS Systems Manager and close
port 22.

## What I would do with more time

- A scheduled cleanup of expired idempotency keys; keyset pagination for the drivers' mobile list.
- S3 lifecycle rules for orphaned uploads, a size limit via POST policies, and image validation.
- Swagger examples and documented error responses; contract tests from the OpenAPI spec.
- Infrastructure as code (Terraform) for the AWS resources, and Grafana dashboards and alerts on the
  metrics already exposed.
