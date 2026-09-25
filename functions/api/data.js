export async function onRequest(context) {
  const { request, env } = context;

  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store, no-cache, must-revalidate",
  };

  if (request.method === "OPTIONS") return new Response(null, { headers });

  if (!env.INTERCEDE_KV) {
    return new Response(JSON.stringify({ error: "KV namespace not bound" }), { status: 500, headers });
  }

  const url = new URL(request.url);
  const key = url.searchParams.get("key") || "people";

// Admin authentication endpoint
if (key === "auth" && request.method === "POST") {
  const body = await request.json();
  const raw = await env.INTERCEDE_KV.get("settings");
  const settings = raw ? JSON.parse(raw) : {};
  const ok = body.password === settings.password;

  if (!ok) {
    return new Response(JSON.stringify({ ok: false }), {
      status: 401,
      headers
    });
  }

  const token = crypto.randomUUID();
  const expiresAt = Date.now() + (12 * 60 * 60 * 1000);

  await env.INTERCEDE_KV.put(
    `admin_session:${token}`,
    JSON.stringify({ expiresAt }),
    { expirationTtl: 43200 }
  );
return new Response(JSON.stringify({ ok: true, token }), {
  status: 200,
  headers
});
}
// Verify admin session token
async function isValidAdminSession() {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");

  if (!token) return false;

  const raw = await env.INTERCEDE_KV.get(`admin_session:${token}`);
  if (!raw) return false;

  try {
    const session = JSON.parse(raw);

    if (!session.expiresAt || Date.now() > session.expiresAt) {
      await env.INTERCEDE_KV.delete(`admin_session:${token}`);
      return false;
    }

    return true;
  } catch (_e) {
    return false;
  }
}
  
// Settings endpoint
if (key === "settings") {
  if (request.method === "GET") {
    const data = await env.INTERCEDE_KV.get("settings");

    if (!data) {
      return new Response("null", { headers });
    }

    const settings = JSON.parse(data);
    const { password, ...publicSettings } = settings;

    return new Response(JSON.stringify(publicSettings), { headers });
  }

  if (request.method === "POST") {
    const body = await request.text();

    try {
      const parsed = JSON.parse(body);

      const existingRaw = await env.INTERCEDE_KV.get("settings");
      const existing = existingRaw ? JSON.parse(existingRaw) : {};

      const merged = {
        ...existing,
        ...parsed,
      };

      await env.INTERCEDE_KV.put("settings", JSON.stringify(merged));

      return new Response(JSON.stringify({ ok: true }), { headers });
    } catch (_e) {
      return new Response(
        JSON.stringify({ error: "Invalid JSON" }),
        { status: 400, headers }
      );
    }
  }
}

  // People endpoint (default)
  if (request.method === "GET") {
    const data = await env.INTERCEDE_KV.get("people");
    return new Response(data || "[]", { headers });
  }

  if (request.method === "POST") {
    const body = await request.text();
    let incoming, force;
    try {
      const parsed = JSON.parse(body);
      if (Array.isArray(parsed)) {
        incoming = parsed;
        force = false;
      } else {
        incoming = parsed.data;
        force = parsed.force === true;
      }
      if (!Array.isArray(incoming)) throw new Error("not array");
    } catch (_e) {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers });
    }

    if (incoming.length === 0) {
      return new Response(JSON.stringify({ error: "Refusing to store empty data" }), { status: 400, headers });
    }

    if (force) {
      await env.INTERCEDE_KV.put("people", JSON.stringify(incoming));
      return new Response(JSON.stringify({ ok: true, count: incoming.length, forced: true }), { headers });
    }

    let stored = [];
    try {
      const raw = await env.INTERCEDE_KV.get("people");
      if (raw) stored = JSON.parse(raw);
      if (!Array.isArray(stored)) stored = [];
    } catch (_e) { stored = []; }

    const storedMap = Object.fromEntries(stored.map(p => [p.id, p]));
    const incomingIds = new Set(incoming.map(p => p.id));

    const merged = incoming.map(p => {
      const s = storedMap[p.id];
      if (!s) return p;
      return (p.updatedAt || 0) >= (s.updatedAt || 0) ? p : s;
    });

    for (const s of stored) {
      if (!incomingIds.has(s.id)) merged.push(s);
    }

    await env.INTERCEDE_KV.put("people", JSON.stringify(merged));
    return new Response(JSON.stringify({ ok: true, count: merged.length }), { headers });
  }

  return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers });
}
