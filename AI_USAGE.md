# How I used AI

I used Claude Code (an AI coding assistant) throughout this assignment, for code, configuration and
documentation. Here's how I worked with it, how I checked what it produced, and where it was wrong.

## How I worked

- **I set the direction first.** Before reading an answer, I wrote down what I wanted to build and how
  I thought it should work, then gave the AI that context and the brief. I used its answers to fill in
  details and explore options, not to decide for me. One step at a time: it proposed a plan, I
  discussed and approved it, and only then did it write code.
- **I pushed back when I disagreed.** For example, it suggested testing the deployment on a local VM. I
  wanted a real cloud setup, so we deployed to AWS instead (EC2, RDS, S3 with an IAM role). It also
  defaulted to Keycloak on H2; I asked why not RDS, and production now uses a separate database on
  RDS. I chose the project layout (the service in its own folder) and asked for a Postman collection
  because it's easier to test with than curl.
- **I asked "why" until I could explain it.** I'll be walking through this code in the review, so for
  each part I asked follow-up questions: how the auth flow works end to end, what `iss` and `aud`
  are, why a separate prod-deps stage, why `USER node`, why liveness and readiness are separate, how the
  logger picks up the request id. Some of those questions surfaced real bugs (below).

## How I verified

- **Official documentation** for anything provider-specific: AWS (IAM policies for S3, EC2 instance
  metadata, RDS TLS), Keycloak (user profile, hostname and proxy settings), GitLab CI (variables,
  rules), PostgreSQL.
- **Tests:** 68 unit tests and 10 e2e tests against a real PostgreSQL, plus lint.
- **Running it for real:** curl and a Postman collection (40 requests, 61 assertions) against the
  local stack, a fresh-clone `docker compose up`, checks inside the containers (user, health, logs,
  metrics, shutdown), and finally the GitLab pipeline deploying to AWS with HTTPS.

## Where the AI was wrong (and how it was caught)

- **Logged a status change before the transaction committed.** I asked why the log line was inside
  the transaction function; the answer was that a rolled-back race would log a change that never
  happened. It's now logged after commit.
- **Presigned upload URLs didn't sign the Content-Type**, so any file type could be uploaded. Found
  by testing an upload with the wrong type (it returned 200); fixed and covered by a test.
- **First IAM policy for S3** used a prefix condition on `ListBucket`. That would make `HeadObject`
  on a missing photo return 403 instead of 404, and the API would return a 500. Corrected before deploying.
- **Database setup SQL failed on RDS.** On RDS the master user isn't a real superuser, and since
  PostgreSQL 16 creating a database owned by another role needs a `GRANT` first. Caught when I ran it.
- **CI variable names collided.** A project-level `DB_HOST` meant for deployment overrode the test
  job's database (project variables beat the ones in `.gitlab-ci.yml`), so the e2e tests tried to reach
  RDS. Caught by the first pipeline run; deploy settings now have a `DEPLOY_` prefix.
- **Smaller ones:** a boolean environment variable parsed `"false"` as `true` (caught by a unit test);
  `npm ci --omit=dev` still shipped TypeScript in the image (caught by inspecting the image); the
  metrics middleware mislabelled 404s and counted its own endpoint (caught against real traffic); an
  ES-module library broke Jest; a pinned dependency version required the next NestJS major.

The pattern I took away: the AI gets the shape right quickly, but the edge cases (permissions,
transactions, cloud-specific behaviour) only surfaced when I asked why or ran the thing for real.
