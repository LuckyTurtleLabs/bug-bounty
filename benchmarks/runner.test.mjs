import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { createApp } from "../apps/api/src/app.js";
import { endpoints, endpointKey } from "./endpoints.mjs";
import { benchmarkEndpoint, percentiles, violations, markdown } from "./runner.mjs";
import { configFrom } from "./run.mjs";

const options = { requests: 4, concurrency: 2, warmup: 1, timeoutMs: 1000, token: "test-token" };
async function serve(t, handler) {
  const server = http.createServer(handler).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  return `http://127.0.0.1:${server.address().port}`;
}

test("nearest-rank percentiles handle unsorted and empty samples", () => {
  assert.deepEqual(percentiles([5, 1, 4, 2, 3]), { p50: 3, p95: 5, p99: 5 });
  assert.deepEqual(percentiles(Array.from({ length: 100 }, (_, i) => i + 1)), { p50: 50, p95: 95, p99: 99 });
  assert.deepEqual(percentiles([]), { p50: null, p95: null, p99: null });
});

test("manifest covers every API route exactly once", () => {
  const app = createApp();
  const actual = [];
  for (const mount of app._router.stack.filter((layer) => layer.name === "router")) {
    const candidates = endpoints.map((e) => e.path.split("?")[0]).filter((path) => mount.regexp.test(path));
    assert.ok(candidates.length, `Missing router: ${mount.regexp}`);
    const prefix = mount.regexp.exec(candidates[0])[0].replace(/\/$/, "");
    for (const layer of mount.handle.stack.filter((entry) => entry.route)) {
      for (const method of Object.keys(layer.route.methods)) actual.push(`${method.toUpperCase()} ${prefix}${layer.route.path === "/" ? "" : layer.route.path}`);
    }
  }
  const declared = endpoints.map((e) => endpointKey(e).split("?")[0].replace("/oauth/github/", "/oauth/:provider/"));
  assert.deepEqual(declared.sort(), actual.sort());
});

test("TTFB precedes body completion; warmups excluded; concurrency is bounded", async (t) => {
  let calls = 0;
  let active = 0;
  let peak = 0;
  const url = await serve(t, (req, res) => {
    calls++;
    active++;
    peak = Math.max(peak, active);
    assert.equal(req.headers.authorization, "Bearer test-token");
    res.writeHead(200);
    res.flushHeaders();
    setTimeout(() => { active--; res.end("body"); }, 70);
  });
  const result = await benchmarkEndpoint(url, { method: "GET", path: "/", status: 200, auth: true }, options);
  assert.equal(calls, 5);
  assert.equal(result.requests, 4);
  assert.equal(result.errors, 0);
  assert.equal(result.ttfbSamples, 4);
  assert.ok(peak <= 2);
  assert.ok(result.latencyMs.p50 - result.ttfbMs.p50 > 40);
  assert.ok(result.rps.peak >= result.rps.sustained);
});

test("HTTP errors are counted and fail the gate even with low latency", async (t) => {
  let count = 0;
  const url = await serve(t, (_req, res) => { res.writeHead(++count % 2 ? 200 : 429); res.end(); });
  const result = await benchmarkEndpoint(url, { method: "GET", path: "/", status: 200 }, { ...options, warmup: 0 });
  assert.equal(result.errors, 2);
  assert.equal(result.errorRatePercent, 50);
  assert.equal(result.statuses[429], 2);
  const thresholds = { default: { p99Ms: 10000, errorRatePercent: 0 } };
  assert.equal(violations([result], thresholds).length, 1);
  assert.equal(violations([{ ...result, latencyMs: { p99: 10001 } }], thresholds).length, 2);
  assert.equal(violations([result], { ...thresholds, endpoints: { [result.endpoint]: { p99Ms: 10000, errorRatePercent: 50 } } }).length, 0);
  assert.throws(() => violations([result], { default: { p99Ms: "invalid" } }));
});

test("absolute timeouts and refused connections yield errors, no fake TTFB", async (t) => {
  const url = await serve(t, () => {});
  const endpoint = { method: "GET", path: "/", status: 200 };
  const result = await benchmarkEndpoint(url, endpoint, { ...options, warmup: 0, timeoutMs: 30 });
  assert.equal(result.errors, 4);
  assert.equal(result.statuses.timeout, 4);
  assert.equal(result.ttfbMs.p99, null);
  assert.equal(result.ttfbSamples, 0);
  const server = http.createServer().listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  const refused = await benchmarkEndpoint(`http://127.0.0.1:${port}`, endpoint, options);
  assert.equal(refused.errors, 4);
  assert.equal(refused.statuses.ECONNREFUSED, 4);
  const report = { generatedAt: "test", mode: "test", node: process.version, config: options, results: [result], failures: ["test failure"] };
  assert.match(markdown(report), /n\/a/);
  assert.match(markdown(report), /Gate failed/);
  assert.doesNotMatch(markdown(report), /NaN|Infinity/);
});

test("invalid load configuration fails early; smoke has fixed low load", () => {
  for (const value of ["0", "-1", "NaN", "Infinity", "1.5", ""]) assert.throws(() => configFrom({ BENCHMARK_REQUESTS: value }, false));
  assert.equal(configFrom({ BENCHMARK_CONCURRENCY: "100" }, true).concurrency, 1);
  assert.equal(configFrom({ BENCHMARK_WARMUP: "0" }, false).warmup, 0);
});
