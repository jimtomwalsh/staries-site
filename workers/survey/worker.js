// Survey responses for staries.app/beta/survey.
// Deployed as the "staries-survey" Worker with the staries-survey D1 database bound as DB.
// The survey page posts here alongside its Buttondown post; this only stores the answers.

const ORIGINS = ['https://staries.app', 'https://www.staries.app'];
const FIELDS = ['interview', 'stories', 'rehearsed', 'disappointed', 'would_pay', 'max_price', 'one_thing'];

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

export default {
  async fetch(request, env) {
    const headers = cors(request);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return new Response('Not found', { status: 404, headers });

    let form;
    try { form = await request.formData(); } catch { return new Response('Bad request', { status: 400, headers }); }

    const email = text(form.get('email'), 254).toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return new Response('Email needed', { status: 400, headers });

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

    return new Response(JSON.stringify({ ok: true }), { headers: { ...headers, 'Content-Type': 'application/json' } });
  },
};
