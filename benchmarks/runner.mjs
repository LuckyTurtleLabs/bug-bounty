import http from "node:http";
import https from "node:https";
import { performance } from "node:perf_hooks";
import { endpointKey } from "./endpoints.mjs";

export function percentiles(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return Object.fromEntries([50, 95, 99].map((p) => [`p${p}`, sorted.length ? sorted[Math.ceil(sorted.length * p / 100) - 1] : null]));
}

export function request(url, endpoint, { agent, token, timeoutMs }) {
  return new Promise((resolve) => {
    const start = performance.now();
    let ttfbMs = null;
    let socket;
    let settled = false;
    let timer;
    const firstByte = () => { ttfbMs = performance.now() - start; };
    const finish = (status, error = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket?.removeListener("data", firstByte);
      resolve({ latencyMs: performance.now() - start, ttfbMs, status, error });
    };
    const headers = {};
    if (endpoint.auth) headers.authorization = `Bearer ${token}`;
    if (endpoint.body !== undefined) {
      headers["content-type"] = endpoint.contentType;
      headers["content-length"] = Buffer.byteLength(endpoint.body);
    }
    const transport = url.protocol === "https:" ? https : http;
    const req = transport.request(url, { method: endpoint.method, headers, agent }, (res) => {
      res.on("error", () => finish(res.statusCode, "response-error"));
      res.on("aborted", () => finish(res.statusCode, "aborted"));
      res.on("end", () => finish(res.statusCode));
      res.resume();
    });
    req.on("socket", (assigned) => {
      socket = assigned;
      socket.once("data", firstByte);
    });
    req.on("error", (error) => finish(null, error.code || "request-error"));
    // Absolute deadline also bounds responses that trickle data indefinitely.
    timer = setTimeout(() => {
      finish(null, "timeout");
      req.destroy();
    }, timeoutMs);
    req.end(endpoint.body);
  });
}

export async function benchmarkEndpoint(baseUrl, endpoint, options) {
  const { requests, concurrency, warmup, token, timeoutMs } = options;
  const url = new URL(endpoint.path, baseUrl);
  const Agent = url.protocol === "https:" ? https.Agent : http.Agent;
  const agent = new Agent({ keepAlive: true, maxSockets: concurrency });
  try {
    for (let i = 0; i < warmup; i++) await request(url, endpoint, { agent, token, timeoutMs });
    let next = 0;
    const samples = [];
    const start = performance.now();
    await Promise.all(Array.from({ length: Math.min(concurrency, requests) }, async () => {
      while (next++ < requests) {
        const sample = await request(url, endpoint, { agent, token, timeoutMs });
        samples.push({ ...sample, completedMs: performance.now() - start });
      }
    }));
    const elapsedMs = performance.now() - start;
    const buckets = new Map();
    const statuses = {};
    let errors = 0;
    for (const sample of samples) {
      const bucket = Math.floor(sample.completedMs / 1000);
      buckets.set(bucket, (buckets.get(bucket) || 0) + 1);
      const status = sample.error || String(sample.status);
      statuses[status] = (statuses[status] || 0) + 1;
      if (sample.error || sample.status !== endpoint.status) errors++;
    }
    return {
      endpoint: endpointKey(endpoint), requests: samples.length, errors,
      errorRatePercent: errors / samples.length * 100, elapsedMs,
      latencyMs: percentiles(samples.map((s) => s.latencyMs)),
      ttfbMs: percentiles(samples.filter((s) => s.ttfbMs !== null).map((s) => s.ttfbMs)),
      ttfbSamples: samples.filter((s) => s.ttfbMs !== null).length,
      rps: { sustained: samples.length / (elapsedMs / 1000), peak: Math.max(...[...buckets].map(([bucket, count]) => count / Math.min(1, (elapsedMs - bucket * 1000) / 1000))) },
      statuses
    };
  } finally {
    agent.destroy();
  }
}

export function violations(results, thresholds) {
  return results.flatMap((result) => {
    const limit = thresholds.endpoints?.[result.endpoint] ?? thresholds.default;
    if (!limit || !Number.isFinite(limit.p99Ms) || limit.p99Ms <= 0 || !Number.isFinite(limit.errorRatePercent) || limit.errorRatePercent < 0 || limit.errorRatePercent > 100) {
      throw new Error(`Invalid thresholds for ${result.endpoint}`);
    }
    const failures = [];
    if (!result.requests || result.latencyMs.p99 === null || !Number.isFinite(result.latencyMs.p99) || result.latencyMs.p99 > limit.p99Ms) failures.push(`${result.endpoint}: p99 exceeds ${limit.p99Ms} ms or has no samples`);
    if (!Number.isFinite(result.errorRatePercent) || result.errorRatePercent > limit.errorRatePercent) failures.push(`${result.endpoint}: error rate exceeds ${limit.errorRatePercent}%`);
    return failures;
  });
}

export function markdown(report) {
  const format = (value) => value === null ? "n/a" : value.toFixed(2);
  return [
    "# API benchmark", "", `Generated: ${report.generatedAt}`, "",
    `Mode: ${report.mode}; Node: ${report.node}; concurrency: ${report.config.concurrency}; measured requests per endpoint: ${report.config.requests}; warmup: ${report.config.warmup}.`, "",
    "All times are milliseconds. Latency includes errors; RPS counts all completed attempts. TTFB measures the first received HTTP bytes, excluding requests with no response bytes.", "",
    "| Endpoint | p50 | p95 | p99 | Sustained RPS | Peak RPS | Error % | TTFB p50 | TTFB p95 | TTFB p99 |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...report.results.map((r) => `| ${r.endpoint} | ${[r.latencyMs.p50, r.latencyMs.p95, r.latencyMs.p99, r.rps.sustained, r.rps.peak, r.errorRatePercent, r.ttfbMs.p50, r.ttfbMs.p95, r.ttfbMs.p99].map(format).join(" | ")} |`),
    "", report.failures.length ? `Gate failed:\n${report.failures.map((f) => `- ${f}`).join("\n")}` : "Gate passed.", ""
  ].join("\n");
}
