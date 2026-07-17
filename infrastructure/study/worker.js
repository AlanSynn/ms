const PREFIX = "/ms-study/v1";
const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;
const SAFE_CODE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const DIRECT_KEY = /^(?:name|title|description|instruction|summary|steps|expected|actual|email|phone|address|schoolid|studentid|useragent|ip|ipaddress|latitude|longitude|location|geo|filename|sourceimagename|url|uri|message|error|stack|text|note|comment|jointmap|hierarchy)$/i;
const DIRECT_IDENTITY_VALUE = /(?:[^\s@]+@[^\s@]+\.[^\s@]+)|(?:\+?\d[\d ().-]{7,}\d)/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(`${PREFIX}/`)) return json(env, 404, { error: "not_found" });
    if (request.method === "OPTIONS") return preflight(request, env);
    const admin = url.pathname.startsWith(`${PREFIX}/admin/`);
    if (!admin && request.headers.get("Origin") !== env.ALLOWED_ORIGIN) {
      return json(env, 403, { error: "origin_not_allowed" });
    }
    try {
      if (!admin && request.method === "POST") {
        const limiter = url.pathname === `${PREFIX}/bug` ? env.BUG_RATE_LIMITER : env.INGEST_RATE_LIMITER;
        if (limiter && !await withinRateLimit(request, limiter, url.pathname)) {
          return json(env, 429, { error: "rate_limited" }, { "Retry-After": "60" });
        }
      }
      if (request.method === "POST" && url.pathname === `${PREFIX}/batch`) return await postBatch(request, env);
      if (request.method === "POST" && url.pathname === `${PREFIX}/asset`) return await postAsset(request, env);
      if (request.method === "POST" && url.pathname === `${PREFIX}/bug`) return await postBug(request, env);
      if (request.method === "GET" && url.pathname === `${PREFIX}/admin/sessions`) return await adminSessions(request, env, url);
      if (request.method === "GET" && url.pathname.startsWith(`${PREFIX}/admin/session/`)) {
        return await adminSession(request, env, url, url.pathname.slice(`${PREFIX}/admin/session/`.length));
      }
      if (request.method === "GET" && url.pathname === `${PREFIX}/admin/bugs`) return await adminBugs(request, env, url);
      if (request.method === "GET" && url.pathname === `${PREFIX}/admin/object`) return await adminObject(request, env, url);
      return json(env, 404, { error: "not_found" });
    } catch {
      return json(env, 500, { error: "internal_error" });
    }
  },
};

async function postBatch(request, env) {
  if (mediaType(request) !== "application/json") return json(env, 415, { error: "content_type" });
  const encoding = (request.headers.get("Content-Encoding") || "identity").toLowerCase();
  if (encoding !== "identity" && encoding !== "gzip") return json(env, 415, { error: "content_encoding" });
  const raw = await limitedBytes(request, encoding === "gzip" ? 128 * 1024 : 512 * 1024);
  if (!raw) return json(env, 413, { error: "batch_too_large" });
  let decoded = raw;
  if (encoding === "gzip") {
    try {
      decoded = await limitedStreamBytes(new Blob([raw]).stream().pipeThrough(new DecompressionStream("gzip")), 512 * 1024);
      if (!decoded) return json(env, 413, { error: "batch_too_large" });
    } catch {
      return json(env, 400, { error: "invalid_gzip" });
    }
  }
  if (decoded.byteLength > 512 * 1024) return json(env, 413, { error: "batch_too_large" });
  let envelope;
  try {
    envelope = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decoded));
  } catch {
    return json(env, 400, { error: "invalid_json" });
  }
  if (!validEnvelope(envelope)) return json(env, 400, { error: "invalid_envelope" });
  const key = `telemetry/${envelope.deployment}/sessions/${envelope.sessionId}/${envelope.contextId}/${envelope.batchId}.json.gz`;
  const storedBody = encoding === "gzip" ? raw : await compressGzip(decoded);
  const stored = await putIdempotent(env.STUDY_BUCKET, key, storedBody, await sha256Hex(decoded), {
    httpMetadata: { contentType: "application/json", contentEncoding: "gzip" },
  });
  return stored === "conflict"
    ? json(env, 409, { error: "batch_id_conflict" })
    : json(env, stored === "stored" ? 201 : 200, { ok: true });
}

async function postAsset(request, env) {
  const type = mediaType(request);
  if (type !== "image/png" && type !== "image/webp") return json(env, 415, { error: "content_type" });
  const body = await limitedBytes(request, 192 * 1024);
  if (!body) return json(env, 413, { error: "asset_too_large" });
  if (!validImage(body, type)) return json(env, 400, { error: "invalid_asset" });
  let meta;
  try {
    meta = JSON.parse(decodeBase64Url(request.headers.get("X-MotionSmith-Meta") || ""));
  } catch {
    return json(env, 400, { error: "invalid_metadata" });
  }
  if (!validAssetMeta(meta) || meta.bytes !== body.byteLength) return json(env, 400, { error: "invalid_metadata" });
  const ext = type === "image/webp" ? "webp" : "png";
  const key = `assets/${meta.deployment}/sessions/${meta.sessionId}/${meta.projectId}/${meta.assetId}.${ext}`;
  const stored = await putIdempotent(env.STUDY_BUCKET, key, body, await sha256Hex(body), {
    httpMetadata: { contentType: type },
    customMetadata: Object.fromEntries(Object.entries(meta).map(([key, value]) => [key, String(value)])),
  });
  return stored === "conflict"
    ? json(env, 409, { error: "asset_id_conflict" })
    : json(env, stored === "stored" ? 201 : 200, { ok: true });
}

async function postBug(request, env) {
  if (mediaType(request) !== "multipart/form-data") return json(env, 415, { error: "content_type" });
  const checked = await limitedBytes(request.clone(), Math.floor(1.2 * 1024 * 1024));
  if (!checked) return json(env, 413, { error: "report_too_large" });
  let form;
  try {
    form = await request.formData();
  } catch {
    return json(env, 400, { error: "invalid_multipart" });
  }
  if ([...form.keys()].some((key) => key !== "report" && key !== "screenshot") || form.getAll("report").length !== 1 || form.getAll("screenshot").length > 1) {
    return json(env, 400, { error: "invalid_report" });
  }
  const rawReport = form.get("report");
  let report;
  try {
    report = JSON.parse(typeof rawReport === "string" ? rawReport : "");
  } catch {
    return json(env, 400, { error: "invalid_report" });
  }
  if (!validBugReport(report)) return json(env, 400, { error: "invalid_report" });
  const screenshot = form.get("screenshot");
  if (screenshot !== null && (!(screenshot instanceof File) || !["image/png", "image/webp"].includes(screenshot.type) || screenshot.size > 1024 * 1024)) {
    return json(env, 400, { error: "invalid_screenshot" });
  }
  const screenshotBytes = screenshot instanceof File ? new Uint8Array(await screenshot.arrayBuffer()) : undefined;
  if (screenshotBytes && !validImage(screenshotBytes, screenshot.type)) return json(env, 400, { error: "invalid_screenshot" });

  const base = `bugs/${report.submissionId}`;
  const existing = await env.STUDY_BUCKET.get(`${base}.issue.json`);
  if (existing) {
    const issue = await existing.json();
    return json(env, 200, { ok: true, issueNumber: issue.number, issueUrl: issue.url });
  }
  await putOnce(env.STUDY_BUCKET, `${base}.report.json`, JSON.stringify(report), { httpMetadata: { contentType: "application/json" } });
  if (screenshot instanceof File) {
    const ext = screenshot.type === "image/webp" ? "webp" : "png";
    await putOnce(env.STUDY_BUCKET, `${base}.screenshot.${ext}`, screenshotBytes, { httpMetadata: { contentType: screenshot.type } });
  }
  const recovered = await findExistingIssue(env, report.submissionId);
  if (recovered) {
    await putOnce(env.STUDY_BUCKET, `${base}.issue.json`, JSON.stringify(recovered), { httpMetadata: { contentType: "application/json" } });
    return json(env, 200, { ok: true, issueNumber: recovered.number, issueUrl: recovered.url });
  }
  const attemptKey = `${base}.attempt.json`;
  let claimed = await putOnce(env.STUDY_BUCKET, attemptKey, JSON.stringify({ attemptedAt: new Date().toISOString() }), { httpMetadata: { contentType: "application/json" } });
  if (!claimed) {
    const priorAttempt = await env.STUDY_BUCKET.get(attemptKey);
    let attemptedAt = 0;
    try {
      attemptedAt = Date.parse((await priorAttempt?.json())?.attemptedAt || "");
    } catch {
      // Old or incomplete attempts are recoverable after the stale window.
    }
    if (Number.isFinite(attemptedAt) && Date.now() - attemptedAt < 5 * 60_000) {
      return json(env, 202, { ok: true, pending: true });
    }
    await env.STUDY_BUCKET.delete(attemptKey);
    claimed = await putOnce(env.STUDY_BUCKET, attemptKey, JSON.stringify({ attemptedAt: new Date().toISOString() }), { httpMetadata: { contentType: "application/json" } });
    if (!claimed) return json(env, 202, { ok: true, pending: true });
  }
  let issue;
  try {
    issue = await createIssue(env, report, Boolean(screenshot));
  } catch {
    await env.STUDY_BUCKET.delete(attemptKey);
    return json(env, 503, { error: "github_unavailable" }, { "Retry-After": "5" });
  }
  await putOnce(env.STUDY_BUCKET, `${base}.issue.json`, JSON.stringify(issue), { httpMetadata: { contentType: "application/json" } });
  return json(env, 201, { ok: true, issueNumber: issue.number, issueUrl: issue.url });
}

async function findExistingIssue(env, submissionId) {
  if (!env.GITHUB_TOKEN || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(env.GITHUB_REPOSITORY || "")) return undefined;
  try {
    const response = await fetch(`https://api.github.com/repos/${env.GITHUB_REPOSITORY}/issues?state=all&sort=created&direction=desc&per_page=100`, {
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "MotionSmith-Study-Worker",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!response.ok) return undefined;
    const marker = `MotionSmith-Bug-ID: ${submissionId}`;
    const match = (await response.json()).find((issue) => typeof issue.body === "string" && issue.body.endsWith(marker));
    return match && Number.isSafeInteger(match.number) && typeof match.html_url === "string"
      ? { number: match.number, url: match.html_url }
      : undefined;
  } catch {
    return undefined;
  }
}

async function createIssue(env, report, hasScreenshot) {
  if (!env.GITHUB_TOKEN || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(env.GITHUB_REPOSITORY || "")) throw new Error("github_config");
  const sections = [
    ["What happened", report.summary],
    ["Steps", report.steps],
    ["Expected", report.expected],
    ["Context", `Stage: ${report.stage}\nApp: MotionSmith v${report.appVersion}\nDeployment: ${report.deployment}\nBuild: ${report.buildSha}\nBrowser: ${report.browserFamily} ${report.browserMajor}\nViewport: ${report.viewportBucket}\nScreenshot: ${hasScreenshot ? "stored privately" : "none"}`],
  ].map(([heading, value]) => `## ${heading}\n${safeIssueText(value)}`);
  const body = `${sections.join("\n\n")}\n\n<!-- motionsmith-bug-marker-v1 -->\nMotionSmith-Bug-ID: ${report.submissionId}`;
  const response = await fetch(`https://api.github.com/repos/${env.GITHUB_REPOSITORY}/issues`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "MotionSmith-Study-Worker",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({
      title: `MotionSmith bug · ${safeIssueText(report.stage).replace(/\n/g, " ")} · ${report.submissionId.slice(0, 8)}`,
      body,
      labels: ["bug"],
    }),
  });
  if (!response.ok) throw new Error("github_issue");
  const data = await response.json();
  if (!Number.isSafeInteger(data.number) || typeof data.html_url !== "string") throw new Error("github_response");
  return { number: data.number, url: data.html_url };
}

async function adminSessions(request, env, url) {
  if (!isAdmin(request, env)) return json(env, 401, { error: "unauthorized" });
  const deployment = url.searchParams.get("deployment") || "";
  if (!SAFE_ID.test(deployment)) return json(env, 400, { error: "invalid_deployment" });
  const page = await env.STUDY_BUCKET.list({
    prefix: `telemetry/${deployment}/sessions/`,
    delimiter: "/",
    limit: 1000,
    cursor: url.searchParams.get("cursor") || undefined,
  });
  return json(env, 200, {
    sessions: page.delimitedPrefixes.map((prefix) => prefix.split("/").at(-2)).filter(Boolean),
    cursor: page.truncated ? page.cursor : null,
  });
}

async function adminSession(request, env, url, sessionId) {
  if (!isAdmin(request, env)) return json(env, 401, { error: "unauthorized" });
  const deployment = url.searchParams.get("deployment") || "";
  if (!SAFE_ID.test(deployment) || !SAFE_ID.test(sessionId)) return json(env, 400, { error: "invalid_session" });
  const prefix = `telemetry/${deployment}/sessions/${sessionId}/`;
  const page = await env.STUDY_BUCKET.list({ prefix, limit: 16, cursor: url.searchParams.get("cursor") || undefined });
  const batches = [];
  for (const item of page.objects) {
    const object = await env.STUDY_BUCKET.get(item.key);
    if (!object) continue;
    let bytes = new Uint8Array(await object.arrayBuffer());
    if (item.key.endsWith(".gz")) {
      bytes = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
    }
    batches.push({
      ...JSON.parse(new TextDecoder().decode(bytes)),
      receivedAt: object.uploaded instanceof Date ? object.uploaded.toISOString() : undefined,
    });
  }
  const assets = await env.STUDY_BUCKET.list({ prefix: `assets/${deployment}/sessions/${sessionId}/`, limit: 1000, include: ["customMetadata"] });
  return json(env, 200, {
    sessionId,
    batches,
    assets: assets.objects.map((item) => ({ key: item.key, size: item.size, metadata: item.customMetadata || {} })),
    cursor: page.truncated ? page.cursor : null,
  });
}

async function adminBugs(request, env, url) {
  if (!isAdmin(request, env)) return json(env, 401, { error: "unauthorized" });
  const page = await env.STUDY_BUCKET.list({ prefix: "bugs/", limit: 1000, cursor: url.searchParams.get("cursor") || undefined });
  return json(env, 200, { objects: page.objects.map((item) => ({ key: item.key, size: item.size })), cursor: page.truncated ? page.cursor : null });
}

async function adminObject(request, env, url) {
  if (!isAdmin(request, env)) return json(env, 401, { error: "unauthorized" });
  const key = url.searchParams.get("key") || "";
  if (key.length > 512 || (!key.startsWith("assets/") && !key.startsWith("bugs/")) || key.includes("..")) {
    return json(env, 400, { error: "invalid_key" });
  }
  const object = await env.STUDY_BUCKET.get(key);
  if (!object) return json(env, 404, { error: "not_found" });
  const headers = responseHeaders(env, {
    "Content-Type": object.httpMetadata?.contentType || "application/octet-stream",
    "Content-Length": String(object.size),
  });
  return new Response(object.body, { status: 200, headers });
}

function validEnvelope(value) {
  const keys = ["v", "eventSchema", "snapshotSchema", "batchId", "deployment", "appVersion", "buildSha", "profile", "classId", "classSessionId", "teamId", "participantId", "sessionId", "contextId", "sessionCount", "reconnectCount", "records"];
  return exactKeys(value, keys)
    && value.v === 1
    && value.eventSchema === "motionsmith-study-event-v1"
    && value.snapshotSchema === "motionsmith-study-snapshot-v1"
    && [value.batchId, value.deployment, value.appVersion, value.buildSha, value.classId, value.classSessionId, value.teamId, value.participantId, value.sessionId, value.contextId].every((item) => typeof item === "string" && SAFE_ID.test(item))
    && ["metrics", "replay", "study"].includes(value.profile)
    && Number.isSafeInteger(value.sessionCount) && value.sessionCount >= 1
    && Number.isSafeInteger(value.reconnectCount) && value.reconnectCount >= 1
    && Array.isArray(value.records) && value.records.length > 0 && value.records.length <= 200
    && value.records.every(validRecord);
}

function validRecord(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return false;
  if (Object.keys(record).some((key) => !["seq", "t", "type", "stage", "project", "data"].includes(key))) return false;
  return Number.isSafeInteger(record.seq) && record.seq >= 1
    && Number.isSafeInteger(record.t) && record.t >= 0
    && typeof record.type === "string" && SAFE_CODE.test(record.type)
    && (record.stage === undefined || ["character", "path", "foundry", "design", "blueprint", "assembly", "options"].includes(record.stage))
    && (record.project === undefined || (typeof record.project === "string" && SAFE_ID.test(record.project)))
    && (record.data === undefined || validStudyData(record.data));
}

function validStudyData(value, key = "", depth = 0) {
  if (depth > 24 || DIRECT_KEY.test(key) || /(?:Url|Filename|FileName|Name|Label)$/.test(key)) return false;
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value) && Math.abs(value) <= 1e15;
  if (typeof value === "string") return value.length <= 256 && !/[\r\n]/.test(value) && !/^(?:data|blob|file|https?):/i.test(value) && !DIRECT_IDENTITY_VALUE.test(value);
  if (Array.isArray(value)) return value.length <= 4096 && value.every((item) => validStudyData(item, key, depth + 1));
  if (!value || typeof value !== "object" || Object.keys(value).length > 4096) return false;
  return Object.entries(value).every(([childKey, child]) => childKey.length <= 128 && !DIRECT_IDENTITY_VALUE.test(childKey) && validStudyData(child, childKey, depth + 1));
}

function validAssetMeta(value) {
  const keys = ["v", "deployment", "participantId", "sessionId", "contextId", "projectId", "assetId", "kind", "width", "height", "bytes"];
  return exactKeys(value, keys) && value.v === 1
    && [value.deployment, value.participantId, value.sessionId, value.contextId, value.projectId, value.assetId, value.kind].every((item) => typeof item === "string" && SAFE_ID.test(item))
    && [value.width, value.height].every((item) => Number.isSafeInteger(item) && item >= 1 && item <= 16384)
    && Number.isSafeInteger(value.bytes) && value.bytes >= 1 && value.bytes <= 192 * 1024;
}

function validBugReport(value) {
  const limits = { submissionId: 64, summary: 160, steps: 4000, expected: 2000, email: 254, stage: 100, appVersion: 40, deployment: 96, buildSha: 96, browserFamily: 24, browserMajor: 16, viewportBucket: 16 };
  return exactKeys(value, Object.keys(limits))
    && Object.entries(limits).every(([key, limit]) => typeof value[key] === "string" && value[key].length <= limit)
    && /^[0-9a-f-]{36}$/.test(value.submissionId)
    && value.summary.length > 0 && value.steps.length > 0 && value.expected.length > 0
    && /^[A-Za-z0-9 ._-]{1,100}$/.test(value.stage)
    && [value.appVersion, value.deployment, value.buildSha, value.browserFamily, value.browserMajor, value.viewportBucket].every((item) => SAFE_ID.test(item));
}

function safeIssueText(value) {
  return String(value)
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, "[redacted email]")
    .replace(/\+?\d[\d ().-]{7,}\d/g, "[redacted phone]")
    .replace(/\r\n?/g, "\n").split("\n").map((line) => {
      const folded = line.replace(/^[\t ]+/, "").toLowerCase();
      return folded.startsWith("motionsmith-bug-id:") || folded.startsWith("<!-- motionsmith-bug-marker-v1 -->") ? `User text: ${line}` : line;
    }).join("\n");
}

function exactKeys(value, keys) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

async function limitedBytes(request, limit) {
  const declared = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > limit) return null;
  return limitedStreamBytes(request.body, limit);
}

async function limitedStreamBytes(stream, limit) {
  if (!stream) return new Uint8Array();
  const reader = stream.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel("limit");
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function compressGzip(bytes) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer());
}

async function putOnce(bucket, key, body, options) {
  return bucket.put(key, body, { ...options, onlyIf: { etagDoesNotMatch: "*" } });
}

async function putIdempotent(bucket, key, body, checksum, options) {
  const stored = await putOnce(bucket, key, body, {
    ...options,
    customMetadata: { ...(options.customMetadata || {}), sha256: checksum },
  });
  if (stored) return "stored";
  const existing = await bucket.get(key);
  return existing?.customMetadata?.sha256 === checksum ? "duplicate" : "conflict";
}

async function sha256Hex(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function withinRateLimit(request, limiter, path) {
  const actor = request.headers.get("CF-Connecting-IP") || "unknown";
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(actor)));
  const key = `${path}:${Array.from(digest.slice(0, 8), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  return (await limiter.limit({ key })).success;
}

function validImage(bytes, type) {
  if (type === "image/png") return bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
  return bytes.length >= 12 && new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP";
}

function decodeBase64Url(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length > 4096) throw new Error("metadata");
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const bytes = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function mediaType(request) {
  return (request.headers.get("Content-Type") || "").split(";", 1)[0].trim().toLowerCase();
}

function isAdmin(request, env) {
  return Boolean(env.ADMIN_TOKEN) && request.headers.get("Authorization") === `Bearer ${env.ADMIN_TOKEN}`;
}

function preflight(request, env) {
  if (request.headers.get("Origin") !== env.ALLOWED_ORIGIN) return json(env, 403, { error: "origin_not_allowed" });
  return new Response(null, {
    status: 204,
    headers: responseHeaders(env, {
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type, Content-Encoding, X-MotionSmith-Meta",
      "Access-Control-Max-Age": "86400",
    }),
  });
}

function json(env, status, body, extra = {}) {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders(env, { ...JSON_HEADERS, ...extra }) });
}

function responseHeaders(env, extra = {}) {
  return {
    ...extra,
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN,
    Vary: "Origin",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  };
}
