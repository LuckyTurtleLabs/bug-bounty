import { createApp } from "../apps/api/src/app.js";
import { signAccessToken } from "../apps/api/src/utils/jwt.js";

// This isolated process holds disposable in-memory data. Production startup never
// imports this module and continues to use the normal 200-request limiter.
const server = createApp({ rateLimiter: (_req, _res, next) => next() }).listen(0, "127.0.0.1", () => {
  process.send({ url: `http://127.0.0.1:${server.address().port}`, token: signAccessToken({ sub: "benchmark-user", role: "admin" }) });
});
process.on("disconnect", () => {
  server.close();
  server.closeAllConnections();
});
