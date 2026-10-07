import webpush from "web-push";

const VAPID_SUBJECT = "mailto:kkingsley@hillsidegr.org";
const TIME_ZONE = "America/New_York";

async function sendPush(subscription, env) {
  webpush.setVapidDetails(
    VAPID_SUBJECT,
    env.VAPID_PUBLIC_KEY,
    env.VAPID_PRIVATE_KEY
  );

  return webpush.sendNotification(
    subscription,
    JSON.stringify({
      title: "Let’s Pray",
      body: "Take a few minutes to pray for your students this week.",
      url: "/",
    })
  );
}

async function sendReminders(env) {
  const list = await env.INTERCEDE_KV.list({
    prefix: "push_subscription:",
  });

  let sent = 0;
  let failed = 0;

  for (const key of list.keys) {
    const stored = await env.INTERCEDE_KV.get(key.name, "json");

    if (!stored?.subscription) continue;

    try {
      await sendPush(stored.subscription, env);
      sent++;
    } catch (err) {
      failed++;

      if (err?.statusCode === 404 || err?.statusCode === 410) {
        await env.INTERCEDE_KV.delete(key.name);
      }

      console.error("Push failed:", err);
    }
  }

  return { sent, failed };
}

function isWednesdayAtSevenEastern(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    weekday: "short",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const weekday = parts.find(part => part.type === "weekday")?.value;
  const hour = parts.find(part => part.type === "hour")?.value;

  return weekday === "Wed" && hour === "19";
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname !== "/test") {
      return new Response("Let’s Pray reminder worker is running.", {
        status: 200,
      });
    }

    const result = await sendReminders(env);

    return Response.json({
      ok: result.failed === 0,
      ...result,
    });
  },

  async scheduled(event, env, ctx) {
    if (!isWednesdayAtSevenEastern(new Date(event.scheduledTime))) {
      return;
    }

    ctx.waitUntil(sendReminders(env));
  },
};