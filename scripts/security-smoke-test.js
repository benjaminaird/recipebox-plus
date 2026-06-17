const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:3000';

async function readJson(res) {
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { raw: text.slice(0, 200) }; }
}

async function main() {
  const results = [];
  async function check(name, fn) {
    try {
      await fn();
      results.push({ name, ok: true });
    } catch (err) {
      results.push({ name, ok: false, error: err.message });
    }
  }

  await check('unauthenticated admin rejected', async () => {
    const res = await fetch(baseUrl + '/api/admin/knowledge');
    if (res.status !== 401) throw new Error(`expected 401, got ${res.status}`);
  });

  await check('public release pages load', async () => {
    for (const path of ['/privacy.html', '/terms.html', '/support.html', '/delete-account.html']) {
      const res = await fetch(baseUrl + path);
      if (res.status !== 200) throw new Error(`${path} returned ${res.status}`);
    }
  });

  await check('normal user cannot access admin', async () => {
    const email = `security-smoke-${Date.now()}@example.com`;
    const password = 'recipebox1';
    let cookie = '';
    async function req(path, body) {
      const res = await fetch(baseUrl + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
        body: JSON.stringify(body),
      });
      const setCookie = res.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0];
      return { res, data: await readJson(res) };
    }
    const signup = await req('/api/auth/signup', { email, password, displayName: 'Security Smoke' });
    if (signup.res.status !== 200) throw new Error(`signup returned ${signup.res.status}: ${signup.data.error || ''}`);
    const admin = await fetch(baseUrl + '/api/admin/knowledge', { headers: { Cookie: cookie } });
    if (admin.status !== 403) throw new Error(`expected 403, got ${admin.status}`);
    const del = await req('/api/auth/delete-account', { password });
    if (del.res.status !== 200) throw new Error(`cleanup returned ${del.res.status}`);
  });

  await check('entitlements require auth', async () => {
    const res = await fetch(baseUrl + '/api/me/entitlements');
    if (res.status !== 401) throw new Error(`expected 401, got ${res.status}`);
  });

  console.log(JSON.stringify(results, null, 2));
  if (results.some((result) => !result.ok)) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
