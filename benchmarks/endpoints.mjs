// Based on the API validators and packages/db/prisma/schema.prisma.
const paragraph = "Build an accessible freelance marketplace with responsive layouts, tested API integration, and clear documentation. ";
const account = { email: "benchmark@example.test", password: "benchmark-only-password", role: "client" };
const json = (method, path, body, status = 201) => ({ method, path, body: JSON.stringify(body), contentType: "application/json", status });
const get = (path) => ({ method: "GET", path, status: 200 });
const boundary = "benchmark-upload-boundary";
export const endpoints = [
  json("POST", "/api/auth/register", account),
  json("POST", "/api/auth/login", account, 200),
  get("/api/auth/oauth/github/callback"),
  json("POST", "/api/auth/refresh", {}, 200),
  json("POST", "/api/users", { ...account, fullName: "Benchmark User", bio: paragraph, skills: ["javascript"] }),
  get("/api/users"),
  json("POST", "/api/jobs", { title: "Build a responsive marketplace", description: paragraph.repeat(8), budgetMin: 500, budgetMax: 2000, categoryId: "benchmark-category", skills: ["javascript", "react"] }),
  get("/api/jobs"),
  json("POST", "/api/proposals", { jobId: "benchmark-job", freelancerId: "benchmark-freelancer", coverLetter: paragraph.repeat(4), bidAmount: 1200, estDuration: "2 weeks" }),
  get("/api/proposals"),
  json("POST", "/api/payments", { jobId: "benchmark-job", amount: 1200, currency: "usd" }),
  json("POST", "/api/reviews", { reviewerId: "benchmark-client", revieweeId: "benchmark-freelancer", rating: 5, comment: paragraph.repeat(2) }),
  get("/api/reviews"),
  json("POST", "/api/messages", { senderId: "benchmark-client", receiverId: "benchmark-freelancer", body: paragraph.repeat(4) }),
  get("/api/messages"),
  json("POST", "/api/notifications", { userId: "benchmark-client", title: "New proposal", body: paragraph }),
  get("/api/notifications"),
  { method: "POST", path: "/api/uploads", status: 201, contentType: `multipart/form-data; boundary=${boundary}`, body: `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="brief.txt"\r\nContent-Type: text/plain\r\n\r\n${"x".repeat(16 * 1024)}\r\n--${boundary}--\r\n` },
  get("/api/search?q=javascript"),
  { ...get("/api/admin/metrics"), auth: true }
];
export const endpointKey = (endpoint) => `${endpoint.method} ${endpoint.path}`;
