async function getDataset(env) {
  const raw = await env.DATA.get('dataset');
  return raw ? JSON.parse(raw) : null;
}

async function getAllTicks(env) {
  const raw = await env.DATA.get('ticks');
  return raw ? JSON.parse(raw) : {};
}

async function withRetry(fn, attempts = 4, delayMs = 300) {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === attempts - 1) throw err;
      await new Promise(r => setTimeout(r, delayMs * (i + 1)));
    }
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    try {
      // Public: full sheet + all progress marks (used once, on page load)
      if (url.pathname === '/api/state' && request.method === 'GET') {
        const dataset = await getDataset(env);
        const ticks = await getAllTicks(env);
        return json({
          headers: dataset ? dataset.headers : [],
          rows: dataset ? dataset.rows : [],
          tickColIndex: dataset ? dataset.tickColIndex : -1,
          qtyColIndex: dataset ? dataset.qtyColIndex : -1,
          ticks
        });
      }

      // Public: progress marks ONLY — one simple read, used for polling.
      // No "list" operation here on purpose (KV free tier only allows
      // 1,000 list ops/day, but 100,000 plain reads/day).
      if (url.pathname === '/api/ticks' && request.method === 'GET') {
        const ticks = await getAllTicks(env);
        return json({ ticks });
      }

      // Replace the sheet — its own key, never contends with tick writes
      if (url.pathname === '/api/dataset' && request.method === 'POST') {
        const body = await request.json();
        await env.DATA.put('dataset', JSON.stringify({
          headers: body.headers,
          rows: body.rows,
          tickColIndex: body.tickColIndex,
          qtyColIndex: body.qtyColIndex
        }));
        return json({ ok: true });
      }

      // Update one row's progress — read-modify-write on the single
      // "ticks" blob, retried briefly if two edits land in the same
      // instant (KV allows only 1 write/sec on the same key).
      if (url.pathname === '/api/tick' && request.method === 'POST') {
        const body = await request.json();
        await withRetry(async () => {
          const ticks = await getAllTicks(env);
          ticks[body.key] = { qty: body.qty, date: body.date };
          await env.DATA.put('ticks', JSON.stringify(ticks));
        });
        return json({ ok: true });
      }

      // Clear all progress marks
      if (url.pathname === '/api/reset' && request.method === 'POST') {
        await env.DATA.put('ticks', JSON.stringify({}));
        return json({ ok: true });
      }

      // Everything else: serve the static site
      return env.ASSETS.fetch(request);
    } catch (err) {
      return json({ error: String(err && err.message || err) }, 500);
    }
  }
};
