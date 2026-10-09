// Sign-ups and survey responses for staries.app.
// Deployed as the "staries-survey" Worker: D1 database staries-survey bound as DB,
// beehiiv API key as the BEEHIIV_API_KEY secret.
// Every form on the site posts here. The email goes to beehiiv with the form's tags;
// survey answers are also stored as a row in D1.

const ORIGINS = ['https://staries.app', 'https://www.staries.app'];
const PUBLICATION = 'pub_62e5b738-601a-472b-b9d2-9d5c575e9107';
const BEEHIIV = `https://api.beehiiv.com/v2/publications/${PUBLICATION}/subscriptions`;
const FIELDS = ['interview', 'stories', 'rehearsed', 'disappointed', 'would_pay', 'max_price', 'one_thing'];
const TAGS = ['waitlist', 'beta', 'public-beta', 'android', 'survey-done'];

function cors(request) {
  const origin = request.headers.get('Origin');
  return {
    'Access-Control-Allow-Origin': ORIGINS.includes(origin) ? origin : ORIGINS[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

function text(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

async function beehiiv(env, url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.BEEHIIV_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`beehiiv ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

async function subscribe(env, email, tags, source) {
  const { data } = await beehiiv(env, BEEHIIV, {
    email,
    reactivate_existing: false,
    send_welcome_email: false,
    utm_source: source || 'staries.app',
    referring_site: 'staries.app',
  });
  if (tags.length) await beehiiv(env, `${BEEHIIV}/${data.id}/tags`, { tags });
}

async function storeSurvey(env, request, form, email) {
  const round = text(form.get('metadata__survey_round'), 20) || 'beta';
  const answers = FIELDS.map((f) => text(form.get('metadata__' + f), f === 'one_thing' ? 4000 : 200) || null);
  await env.DB.prepare(
    `INSERT INTO responses (email, round, ${FIELDS.join(', ')}, happy_to_call, country, test)
     VALUES (?, ?, ${FIELDS.map(() => '?').join(', ')}, ?, ?, ?)`
  ).bind(
    email, round, ...answers,
    form.get('metadata__happy_to_call') === 'yes' ? 1 : 0,
    request.cf?.country ?? null,
    round.startsWith('test') ? 1 : 0,
  ).run();
}

export default {
  async fetch(request, env, ctx) {
    const headers = cors(request);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return new Response('Not found', { status: 404, headers });

    let form;
    try { form = await request.formData(); } catch { return new Response('Bad request', { status: 400, headers }); }

    const email = text(form.get('email'), 254).toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return new Response('Email needed', { status: 400, headers });

    const tags = form.getAll('tag').map((t) => text(t, 40)).filter((t) => TAGS.includes(t));
    const source = text(form.get('metadata__source'), 60);
    const isSurvey = form.has('metadata__survey_round');

    // The survey row is the part we can't get back, so it's saved even if beehiiv fails.
    const results = await Promise.allSettled([
      isSurvey ? storeSurvey(env, request, form, email) : null,
      subscribe(env, email, tags, source),
    ]);
    const failed = results.filter((r) => r.status === 'rejected');
    failed.forEach((r) => console.error(r.reason));
    const ok = failed.length === 0 || (isSurvey && results[0].status === 'fulfilled');

    // A plain form post (no JavaScript) goes back to the page it came from.
    const back = request.headers.get('Referer');
    if (!(request.headers.get('Accept') || '').includes('application/json') && back && ORIGINS.includes(new URL(back).origin)) {
      const url = new URL(back);
      url.searchParams.set(ok ? 'joined' : 'error', '1');
      return Response.redirect(url.toString(), 303);
    }
    return new Response(JSON.stringify({ ok }), { status: ok ? 200 : 502, headers: { ...headers, 'Content-Type': 'application/json' } });
  },
};
