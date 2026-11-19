// GradeCalc Worker. Round 0: the site is static (served from ./site without running this code); /api/* and /auth/*
// reach the Worker and answer 404 until accounts are built (Round 5).

const SECURITY_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
};

export const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: SECURITY_HEADERS });

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith('/api/') || pathname.startsWith('/auth/')) return json({ error: 'not_found' }, 404);
    return env.ASSETS.fetch(request);
  },
};
