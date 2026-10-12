# API benchmarks

Install with `npm ci --workspace apps/api`. From the repository root:

```sh
npm run benchmark -- --local  # full suite against a fresh disposable API process
npm run benchmark:smoke     # CI: concurrency 1, 20 requests + 2 warmups per route
```

For an existing disposable local/staging API, copy `.env.benchmark.example` to
`.env.benchmark`, set its origin and a dedicated benchmark user's bearer token,
then run `npm run benchmark`. Environment variables override the file. The token
must permit `/api/admin/metrics`. Tokens, response bodies and credentials are not
written to reports. The runner does not follow redirects. Never target production:
POST scenarios create records, upload files, register accounts and invoke payments.

The dependency-free Node HTTP runner uses keep-alive connections, bounded request
counts and an absolute request timeout. `BENCHMARK_CONCURRENCY`,
`BENCHMARK_REQUESTS`, `BENCHMARK_WARMUP`, and `BENCHMARK_TIMEOUT_MS` control full
runs; smoke fixes the first three for comparable CI runs. Requests are counted
per endpoint, with endpoints run sequentially. Warmups are excluded from metrics.
Every registered `/api/` method is covered in `endpoints.mjs`; a test checks the
manifest against the Express router. Add a fixture when adding a route.

Fixtures use the current validators and Prisma model fields: a ~1 KB job brief,
~500-byte proposal/message, ~250-byte review, and a 16 KiB multipart upload.
POSTs precede corresponding GETs so list routes have data. These are synthetic,
schema-based examples, not captured customer data. The current implementation has
placeholder auth/payment/search services and in-memory collections; fixture IDs
are illustrative. When persistence/integrations are implemented, seed actual
related IDs and unique accounts in a disposable database and use payment test
mode. Current measurements are a baseline for this scaffold, not database or
production capacity measurements.

`--local` starts the real application in a separate process on loopback, signs a
short-lived token for `benchmark-user`, and injects a no-op rate limiter only into
that app instance. Normal server startup keeps its existing limiter unchanged.
External runs keep the target's rate limiting (currently 200 requests/15 minutes);
429 responses count as failures. Provision a suitable test-only staging limit
before load testing. Each local invocation starts with empty in-memory data.

Results are timestamped JSON and Markdown in `benchmarks/results/` (gitignored).
Attach the generated Markdown to the operator's PR description. JSON also records
sample counts, elapsed time, HTTP statuses and transport failures.

- Latency p50/p95/p99: nearest-rank percentiles, request start to complete body
  receipt (or failure/timeout), milliseconds. Errors remain in this distribution.
- TTFB p50/p95/p99: request start to first received HTTP bytes on the socket,
  including connection/TLS setup when needed. Requests with no bytes are excluded;
  zero samples yields `null` / `n/a`, never a fabricated zero.
- Sustained RPS: all completed attempts divided by measured wall-clock seconds.
- Peak RPS: maximum rate in a one-second completion bucket; the final partial
  bucket is normalized by its actual duration. Short runs may be noisy.
- Error rate: transport errors, timeouts, and unexpected HTTP statuses divided by
  all measured attempts. An expected success status is specified for each route.

`thresholds.json` defines the p99 ceiling in ms and maximum error percentage,
with optional overrides keyed by the exact `METHOD /api/path` from the report.
Both full and smoke runs exit nonzero on violations, including fast error-only
responses. The initial 500 ms / 0% limits are a conservative smoke guard, not an
SLA; calibrate on stable hardware before tightening. `benchmarks/ci-smoke.yml` is
a ready Actions workflow — copy it to `.github/workflows/benchmark.yml` to enable
the CI gate (kept out of that directory so this change adds no executable
workflows). It runs tests and the local smoke suite, uploading reports either way.

Record runtime, hardware, concurrency and workload when comparing runs. A smoke
run is deliberately small and cannot establish statistically robust tail latency
or sustained production throughput. Full default runs have 100 samples/endpoint;
increase the request budget for more stable p99 estimates, keeping in mind that
write routes grow the current in-memory collections.
