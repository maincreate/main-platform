import { createServer } from "node:http";

const port = Number(process.env.PORT ?? "3000");
const host = process.env.HOST ?? "127.0.0.1";
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PORT");

// Adapt the existing Fetch API portal without Cloudflare, npm packages or network dependencies.
let onFetch;
globalThis.addEventListener = (type, fn) => {
  if (type !== "fetch" || onFetch) throw new Error("Unexpected worker event");
  onFetch = fn;
};
await import("./worker.js");
delete globalThis.addEventListener;
if (typeof onFetch !== "function") throw new Error("Portal fetch handler missing");

function reject(res, status, message) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  res.end(JSON.stringify({error: message}));
}
const server = createServer(async (req, res) => {
  try {
    const method = req.method || "GET";
    if (!["GET", "HEAD", "POST"].includes(method)) {
      res.setHeader("allow", "GET, HEAD, POST");
      return reject(res, 405, "Method not allowed");
    }
    if (!req.url?.startsWith("/")) return reject(res, 400, "Invalid request path");
    const chunks = [];
    let total = 0;
    for await (const chunk of req) {
      total += chunk.length;
      if (total > 8192) return reject(res, 413, "Request body too large");
      chunks.push(chunk);
    }
    const options = {method, headers:req.headers};
    if (method === "POST") options.body = Buffer.concat(chunks);
    const request = new Request(new URL(req.url, "http://127.0.0.1:" + port), options);
    let responsePromise;
    onFetch({request, respondWith(value){responsePromise = Promise.resolve(value);}});
    if (!responsePromise) throw new Error("Portal did not return a response");
    const response = await responsePromise;
    res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    if (method === "HEAD") res.end();
    else res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.error("Portal request error:", error instanceof Error ? error.message : "unknown");
    if (!res.headersSent) reject(res, 500, "Internal server error");
    else res.end();
  }
});
server.listen(port, host, () => console.log("TinkerTunnel portal listening on " + host + ":" + port));
process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
