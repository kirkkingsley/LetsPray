export async function onRequest(context) {
  const { request, env } = context;

  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
   "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Cache-Control": "no-store, no-cache, must-revalidate",
  };

  if (request.method === "OPTIONS") return new Response(null, { headers });

  if (!env.INTERCEDE_KV) {
    return new Response(JSON.stringify({ error: "KV namespace not bound" }), { status: 500, headers });
  }

  const url = new URL(request.url);
  const key = url.searchParams.get("key") || "people";

// Private leader notes endpoint
if (key === "private-note") {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");

  if (!token) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers
    });
  }

  const rawSession = await env.INTERCEDE_KV.get(`leader_session:${token}`);

  if (!rawSession) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers
    });
  }

  let session;

  try {
    session = JSON.parse(rawSession);

    if (
      !session.leaderId ||
      !session.expiresAt ||
      Date.now() > session.expiresAt
    ) {
      await env.INTERCEDE_KV.delete(`leader_session:${token}`);

      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers
      });
    }
  } catch (_e) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers
    });
  }

  const studentId = url.searchParams.get("studentId");

  if (!studentId) {
    return new Response(JSON.stringify({ error: "Student required" }), {
      status: 400,
      headers
    });
  }

  const rawPeople = await env.INTERCEDE_KV.get("people");
const people = rawPeople ? JSON.parse(rawPeople) : [];

const student = people.find(
  p => p.id === studentId &&
       p.type === "student" &&
       p.active !== false &&
       p.smallGroupLeader === session.leaderId
);

if (!student) {
  return new Response(JSON.stringify({ error: "Student not found or not assigned to this leader" }), {
    status: 404,
    headers
  });
}
  const noteKey = `private_note:${session.leaderId}:${studentId}`;

  if (request.method === "GET") {
    const note = await env.INTERCEDE_KV.get(noteKey);

    return new Response(
      JSON.stringify({ note: note || "" }),
      { headers }
    );
  }

  if (request.method === "POST") {
    const body = await request.json();
    const note = String(body.note || "").trim();
if (note.length > 2000) {
  return new Response(JSON.stringify({ error: "Note is too long" }), {
    status: 400,
    headers
  });
}
    if (note) {
      await env.INTERCEDE_KV.put(noteKey, note);
    } else {
      await env.INTERCEDE_KV.delete(noteKey);
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers
    });
  }

  return new Response(JSON.stringify({ error: "Method not allowed" }), {
    status: 405,
    headers
  });
}
// Validate an existing leader session
if (key === "leader-session" && request.method === "GET") {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");

  if (!token) {
    return new Response(JSON.stringify({ valid: false }), {
      status: 401,
      headers
    });
  }

  const raw = await env.INTERCEDE_KV.get(`leader_session:${token}`);

  if (!raw) {
    return new Response(JSON.stringify({ valid: false }), {
      status: 401,
      headers
    });
  }

  try {
    const session = JSON.parse(raw);

    if (
      !session.leaderId ||
      !session.expiresAt ||
      Date.now() > session.expiresAt
    ) {
      await env.INTERCEDE_KV.delete(`leader_session:${token}`);

      return new Response(JSON.stringify({ valid: false }), {
        status: 401,
        headers
      });
    }

    return new Response(
      JSON.stringify({
        valid: true,
        leaderId: session.leaderId
      }),
      { headers }
    );
  } catch (_e) {
    return new Response(JSON.stringify({ valid: false }), {
      status: 401,
      headers
    });
  }
}
  
  // Leader authentication endpoint
if (key === "leader-auth" && request.method === "POST") {
  const body = await request.json();
  const leaderId = body.leaderId;
  const pin = String(body.pin || "");

  const raw = await env.INTERCEDE_KV.get("people");
  const people = raw ? JSON.parse(raw) : [];

  const leader = people.find(
    p => p.id === leaderId &&
         p.type === "leader" &&
         p.active !== false
  );

  if (!leader || !leader.pin || String(leader.pin) !== pin) {
    return new Response(JSON.stringify({ ok: false }), {
      status: 401,
      headers
    });
  }

  const token = crypto.randomUUID();
  const expiresAt = Date.now() + (30 * 24 * 60 * 60 * 1000);

  await env.INTERCEDE_KV.put(
    `leader_session:${token}`,
    JSON.stringify({
      leaderId: leader.id,
      expiresAt
    }),
    { expirationTtl: 2592000 }
  );

  return new Response(JSON.stringify({
    ok: true,
    token,
    leaderId: leader.id
  }), {
    status: 200,
    headers
  });
}
// Admin-only leader PIN endpoint
if (key === "leader-pin" && request.method === "POST") {
  const authorized = await isValidAdminSession();

  if (!authorized) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers
    });
  }

  const body = await request.json();
  const leaderId = body.leaderId;
  const pin = String(body.pin || "").trim();

  if (!leaderId || !/^\d{4}$/.test(pin)) {
    return new Response(JSON.stringify({ error: "Invalid leader or PIN" }), {
      status: 400,
      headers
    });
  }

  const raw = await env.INTERCEDE_KV.get("people");
  const people = raw ? JSON.parse(raw) : [];

  const leaderIndex = people.findIndex(
    p => p.id === leaderId &&
         p.type === "leader" &&
         p.active !== false
  );

  if (leaderIndex === -1) {
    return new Response(JSON.stringify({ error: "Leader not found" }), {
      status: 404,
      headers
    });
  }

  people[leaderIndex] = {
    ...people[leaderIndex],
    pin,
    updatedAt: Date.now()
  };

  await env.INTERCEDE_KV.put("people", JSON.stringify(people));

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers
  });
}  
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
async function getValidLeaderSession() {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");

  if (!token) return null;

  const raw = await env.INTERCEDE_KV.get(`leader_session:${token}`);
  if (!raw) return null;

  try {
    const session = JSON.parse(raw);

    if (
      !session.leaderId ||
      !session.expiresAt ||
      Date.now() > session.expiresAt
    ) {
      await env.INTERCEDE_KV.delete(`leader_session:${token}`);
      return null;
    }

    return session;
  } catch (_e) {
    return null;
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
   const existingRaw = await env.INTERCEDE_KV.get("settings");
const authorized = await isValidAdminSession();

// Allow the very first setup when no settings exist yet.
// After setup, all settings changes require Admin authentication.
if (existingRaw && !authorized) {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers
  });
}
    const body = await request.text();

    try {
      const parsed = JSON.parse(body);

     
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
  const people = data ? JSON.parse(data) : [];

  const leaderSession = await getValidLeaderSession();
  const leaderId = leaderSession?.leaderId;

  const publicPeople = people.map(person => {
    const { pin, leaderFollowUps, ...safePerson } = person;

    // Only return this leader's own Follow Up data.
    if (
      leaderId &&
      person.type === "student" &&
      person.active !== false &&
      person.smallGroupLeader === leaderId &&
      leaderFollowUps?.[leaderId] !== undefined
    ) {
      safePerson.leaderFollowUps = {
        [leaderId]: leaderFollowUps[leaderId],
      };
    }

    return safePerson;
  });

  return new Response(JSON.stringify(publicPeople), { headers });
}
  if (request.method === "POST") {
    const adminAuthorized = await isValidAdminSession();
const leaderSession = adminAuthorized
  ? null
  : await getValidLeaderSession();

if (!adminAuthorized && !leaderSession) {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers
  });
}
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
  if (!adminAuthorized) {
    return new Response(JSON.stringify({ error: "Admin authorization required" }), {
      status: 403,
      headers
    });
  }

  await env.INTERCEDE_KV.put("people", JSON.stringify(incoming));

  return new Response(
    JSON.stringify({ ok: true, count: incoming.length, forced: true }),
    { headers }
  );
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

  // Admins can update the full record.
  if (adminAuthorized) {
    if (!s) return p;

    if ((p.updatedAt || 0) >= (s.updatedAt || 0)) {
      return {
        ...p,
        ...(s.pin ? { pin: s.pin } : {}),
      };
    }

    return s;
  }

  // Leaders cannot create new people.
  if (!s || !leaderSession) return s || null;

  const leaderId = leaderSession.leaderId;
if (
  s.type !== "student" ||
  s.active === false ||
  s.smallGroupLeader !== leaderId
) {
  return s;
}
  // A leader may only change their own leader-specific data.
  const leaderPrayerDates = {
    ...(s.leaderPrayerDates || {}),
  };

  const leaderPrayerHistory = {
    ...(s.leaderPrayerHistory || {}),
  };

  const leaderFollowUps = {
    ...(s.leaderFollowUps || {}),
  };

 if (p.leaderPrayerDates?.[leaderId] !== undefined) {
  leaderPrayerDates[leaderId] = p.leaderPrayerDates[leaderId];
} else {
  delete leaderPrayerDates[leaderId];
}

if (p.leaderPrayerHistory?.[leaderId] !== undefined) {
  leaderPrayerHistory[leaderId] = p.leaderPrayerHistory[leaderId];
} else {
  delete leaderPrayerHistory[leaderId];
}
  if (p.leaderFollowUps?.[leaderId] !== undefined) {
    leaderFollowUps[leaderId] = p.leaderFollowUps[leaderId];
  } else {
    delete leaderFollowUps[leaderId];
  }

  return {
    ...s,
    leaderPrayerDates,
    leaderPrayerHistory,
    leaderFollowUps,
prayerRequests: p.prayerRequests || [],
    
    // Keep these legacy prayer fields working for now.
    prayedAt: p.prayedAt,
    prayedWeek: p.prayedWeek,
    prayedWeekDate: p.prayedWeekDate,

    updatedAt: Date.now(),
  };
}).filter(Boolean);
    for (const s of stored) {
      if (!incomingIds.has(s.id)) merged.push(s);
    }

    await env.INTERCEDE_KV.put("people", JSON.stringify(merged));
    return new Response(JSON.stringify({ ok: true, count: merged.length }), { headers });
  }

  return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers });
}
