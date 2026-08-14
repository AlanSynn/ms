import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 43197);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("summary sink port must be a valid TCP port");
}

let requests = [];

const headers = {
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "no-store",
};

const respondJson = (response, status, value) => {
  response.writeHead(status, {
    ...headers,
    "Content-Type": "application/json;charset=UTF-8",
  });
  response.end(`${JSON.stringify(value)}\n`);
};

createServer((request, response) => {
  if (request.method === "OPTIONS") {
    response.writeHead(204, headers);
    response.end();
    return;
  }

  if (request.method === "GET" && request.url === "/health") {
    respondJson(response, 200, { ok: true, port });
    return;
  }

  if (request.method === "POST" && request.url === "/reset") {
    requests = [];
    respondJson(response, 200, { ok: true, requestCount: 0 });
    return;
  }

  if (request.method === "GET" && request.url === "/stats") {
    respondJson(response, 200, { requestCount: requests.length, requests });
    return;
  }

  if (request.method !== "POST" || request.url !== "/summary") {
    respondJson(response, 404, { ok: false });
    return;
  }

  const chunks = [];
  let bytes = 0;
  request.on("data", (chunk) => {
    bytes += chunk.byteLength;
    if (bytes <= 16_384) chunks.push(chunk);
  });
  request.on("end", () => {
    const body = Buffer.concat(chunks).toString("utf8");
    requests.push({
      body,
      bytes,
      contentType: request.headers["content-type"] ?? null,
      origin: request.headers.origin ?? null,
      secFetchMode: request.headers["sec-fetch-mode"] ?? null,
    });
    respondJson(response, 204, { ok: true });
  });
}).listen(port, "127.0.0.1", () => {
  process.stdout.write(`summary sink ready http://127.0.0.1:${port}\n`);
});
