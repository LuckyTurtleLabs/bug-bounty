import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fork } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath, pathToFileURL } from "node:url";
import { endpoints } from "./endpoints.mjs";
import { benchmarkEndpoint, markdown, violations } from "./runner.mjs";

export function configFrom(env, smoke) {
  const number = (name, fallback, min = 1) => {
    const value = Number(env[name] ?? fallback);
    if (!Number.isSafeInteger(value) || value < min) throw new Error(`${name} must be an integer >= ${min}`);
    return value;
  };
  return {
    concurrency: smoke ? 1 : number("BENCHMARK_CONCURRENCY", 10),
    requests: smoke ? 20 : number("BENCHMARK_REQUESTS", 100),
    warmup: smoke ? 2 : number("BENCHMARK_WARMUP", 5, 0),
    timeoutMs: number("BENCHMARK_TIMEOUT_MS", 5000)
  };
}

async function loadEnv() {
  try {
    const source = await readFile(new URL("../.env.benchmark", import.meta.url), "utf8");
    for (const line of source.split(/\r?\n/)) {
      if (!line.trim() || line.trimStart().startsWith("#")) continue;
      const match = line.match(/^([A-Z_]+)=(.*)$/);
      if (!match) throw new Error("Invalid .env.benchmark line; use KEY=value");
      process.env[match[1]] ??= match[2].trim().replace(/^(['"])(.*)\1$/, "$2");
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

async function localServer() {
  const child = fork(fileURLToPath(new URL("./local-server.mjs", import.meta.url)), { stdio: ["ignore", "ignore", "inherit", "ipc"] });
  try {
    const address = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Local API startup timed out")), 10000);
      const done = (fn, value) => { clearTimeout(timer); fn(value); };
      child.once("message", (message) => done(resolve, message));
      child.once("error", (error) => done(reject, error));
      child.once("exit", () => done(reject, new Error("Local API exited before startup")));
    });
    return { child, ...address };
  } catch (error) {
    child.kill();
    throw error;
  }
}

export async function main(args = process.argv.slice(2)) {
  for (const arg of args) if (!["--local", "--smoke"].includes(arg)) throw new Error(`Unknown option: ${arg}`);
  await loadEnv();
  const local = args.includes("--local");
  const smoke = args.includes("--smoke");
  const config = configFrom(process.env, smoke);
  const thresholds = JSON.parse(await readFile(new URL("./thresholds.json", import.meta.url), "utf8"));
  let server;
  try {
    let baseUrl = process.env.BENCHMARK_BASE_URL;
    let token = process.env.BENCHMARK_TOKEN;
    if (local) {
      server = await localServer();
      baseUrl = server.url;
      token = server.token;
    }
    if (!baseUrl || !token) throw new Error("Set BENCHMARK_BASE_URL and BENCHMARK_TOKEN, or use --local");
    const url = new URL(baseUrl);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("BENCHMARK_BASE_URL must be an HTTP(S) origin without credentials, path, query or fragment");
    const results = [];
    for (const endpoint of endpoints) {
      const result = await benchmarkEndpoint(url, endpoint, { ...config, token });
      results.push(result);
      console.log(`${result.endpoint}: p99=${result.latencyMs.p99.toFixed(2)}ms errors=${result.errorRatePercent.toFixed(2)}%`);
    }
    const report = {
      generatedAt: new Date().toISOString(), node: process.version,
      mode: `${local ? "isolated-local (rate limiter bypassed)" : "external"}${smoke ? " smoke" : ""}`,
      config, results, failures: violations(results, thresholds)
    };
    const directory = new URL("./results/", import.meta.url);
    await mkdir(directory, { recursive: true });
    const name = report.generatedAt.replace(/[:.]/g, "-");
    await writeFile(new URL(`${name}.json`, directory), `${JSON.stringify(report, null, 2)}\n`);
    await writeFile(new URL(`${name}.md`, directory), markdown(report));
    console.log(`Reports: benchmarks/results/${name}.{json,md}`);
    if (report.failures.length) {
      console.error(report.failures.join("\n"));
      process.exitCode = 1;
    }
  } finally {
    if (server?.child.connected) {
      const stopped = once(server.child, "exit");
      server.child.disconnect();
      await stopped;
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
