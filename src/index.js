// ChecklistState: a Durable Object holds the sheet + all progress marks for
// this project. Cloudflare guarantees requests to the SAME Durable Object
// are handled one at a time, in order — so two people incrementing the same
// row's quantity at the same instant can never overwrite each other. That
// is not something Workers KV can guarantee on its own.

export class ChecklistState {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async getDataset() {
    return (await this.state.storage.get('dataset')) || null;
  }

  async getAllTicks() {
    return (await this.state.storage.get('ticks')) || {};
  }

  async getAllNotes() {
    return (await this.state.storage.get('notes')) || {};
  }

  // Mirrors the client's parseExpectedQty logic, so completion can be
  // checked authoritatively on the server (never trust the client alone
  // for something that triggers sending an email).
  parseExpectedQty(row, qtyColIndex) {
    if (qtyColIndex == null || qtyColIndex < 0) return 1;

    const raw = row[qtyColIndex];

    if (
      raw === undefined ||
      raw === null ||
      String(raw).trim() === ''
    ) {
      return 1;
    }

    const normalized = String(raw)
      .trim()
      .replace(/\./g, '')
      .replace(',', '.')
      .replace(/[^0-9.\-]/g, '');

    const n = Math.round(Math.abs(parseFloat(normalized)));

    return Number.isFinite(n) && n > 0 ? n : 1;
  }

  rowKey(row) {
    const str = row
      .map(c => String(c ?? '').trim().toLowerCase())
      .join('|');

    let h = 0;

    for (let i = 0; i < str.length; i++) {
      h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
    }

    return 'r' + (h >>> 0).toString(36);
  }

  async isFullyComplete() {
    const dataset = await this.getDataset();

    if (!dataset || !dataset.rows || !dataset.rows.length) {
      return false;
    }

    const ticks = await this.getAllTicks();
    const seen = {};

    for (const row of dataset.rows) {
      let base = this.rowKey(row);

      seen[base] = (seen[base] || 0) + 1;

      const key =
        seen[base] > 1
          ? base + 'd' + seen[base]
          : base;

      const expected = this.parseExpectedQty(
        row,
        dataset.qtyColIndex
      );

      const done = ticks[key]
        ? (ticks[key].qty || 0)
        : 0;

      if (done < expected) {
        return false;
      }
    }

    return true;
  }

  async buildCsv() {
    const dataset = await this.getDataset();
    const ticks = await this.getAllTicks();
    const notes = await this.getAllNotes();

    if (!dataset) {
      return '';
    }

    const escape = (val) => {
      const s = String(val ?? '');

      return /[",\n]/.test(s)
        ? '"' + s.replace(/"/g, '""') + '"'
        : s;
    };

    const seen = {};
    const lines = [];

    lines.push(
      [...dataset.headers, 'Status', 'Notes']
        .map(escape)
        .join(',')
    );

    dataset.rows.forEach(row => {
      let base = this.rowKey(row);

      seen[base] = (seen[base] || 0) + 1;

      const key =
        seen[base] > 1
          ? base + 'd' + seen[base]
          : base;

      const expected = this.parseExpectedQty(
        row,
        dataset.qtyColIndex
      );

      const state = ticks[key];

      const done = state
        ? (state.qty || 0)
        : 0;

      const status =
        done >= expected
          ? 'Done'
          : (
              done > 0
                ? `Partial (${done}/${expected})`
                : 'Not done'
            );

      const note = notes[key] || '';

      lines.push(
        [...row, status, note]
          .map(escape)
          .join(',')
      );
    });

    return lines.join('\r\n');
  }

  async sendReportEmail() {
    const csv = await this.buildCsv();

    const recipients = (this.env.REPORT_RECIPIENTS || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);

    if (!recipients.length) {
      return {
        ok: false,
        error: 'No REPORT_RECIPIENTS configured'
      };
    }

    // Cloudflare Secrets Store binding
    if (
      !this.env.RESEND_API_KEY ||
      typeof this.env.RESEND_API_KEY.get !== 'function'
    ) {
      return {
        ok: false,
        error: 'RESEND_API_KEY Secrets Store binding is not configured'
      };
    }

    const apiKey = await this.env.RESEND_API_KEY.get();

    if (!apiKey) {
      return {
        ok: false,
        error: 'No RESEND_API_KEY configured'
      };
    }

    const bytes = new TextEncoder().encode(csv);
    let binary = '';

    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }

    const base64 = btoa(binary);

    const res = await fetch(
      'https://api.resend.com/emails',
      {
        method: 'POST',

        headers: {
          'Authorization': 'Bearer ' + apiKey,
          'Content-Type': 'application/json'
        },

        body: JSON.stringify({
          from: 'Check List Tour <onboarding@resend.dev>',
          to: recipients,

          subject:
            'Checklist complete — all items confirmed',

          text:
            'The checklist has been fully checked off. ' +
            'The updated sheet is attached as a CSV.',

          attachments: [
            {
              filename: 'checklist-complete.csv',
              content: base64
            }
          ]
        })
      }
    );

    if (!res.ok) {
      const errText =
        await res.text().catch(() => '');

      return {
        ok: false,
        error:
          'Resend API error (' +
          res.status +
          '): ' +
          errText
      };
    }

    return {
      ok: true
    };
  }

  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;

    // --------------------------------------------------
    // GET /dataset
    // --------------------------------------------------

    if (
      request.method === 'GET' &&
      path === '/dataset'
    ) {
      const dataset = await this.getDataset();

      return Response.json({
        dataset
      });
    }

    // --------------------------------------------------
    // POST /dataset
    // --------------------------------------------------

    if (
      request.method === 'POST' &&
      path === '/dataset'
    ) {
      const body = await request.json();

      await this.state.storage.put(
        'dataset',
        body.dataset || body
      );

      // New dataset = new checklist cycle.
      await this.state.storage.put('ticks', {});
      await this.state.storage.put('notes', {});
      await this.state.storage.put(
        'reportSent',
        false
      );

      return Response.json({
        ok: true
      });
    }

    // --------------------------------------------------
    // GET /progress
    // --------------------------------------------------

    if (
      request.method === 'GET' &&
      path === '/progress'
    ) {
      const ticks = await this.getAllTicks();
      const notes = await this.getAllNotes();

      return Response.json({
        ticks,
        notes
      });
    }

    // --------------------------------------------------
    // POST /progress
    // --------------------------------------------------

    if (
      request.method === 'POST' &&
      path === '/progress'
    ) {
      const body = await request.json();

      if (!body.key) {
        return Response.json(
          {
            ok: false,
            error: 'Missing row key'
          },
          {
            status: 400
          }
        );
      }

      const ticks = await this.getAllTicks();

      ticks[body.key] = {
        qty: Math.max(
          0,
          Number(body.qty) || 0
        )
      };

      await this.state.storage.put(
        'ticks',
        ticks
      );

      return Response.json({
        ok: true
      });
    }

    // --------------------------------------------------
    // POST /note
    // --------------------------------------------------

    if (
      request.method === 'POST' &&
      path === '/note'
    ) {
      const body = await request.json();

      if (!body.key) {
        return Response.json(
          {
            ok: false,
            error: 'Missing row key'
          },
          {
            status: 400
          }
        );
      }

      const notes = await this.getAllNotes();

      notes[body.key] =
        String(body.note ?? '');

      await this.state.storage.put(
        'notes',
        notes
      );

      return Response.json({
        ok: true
      });
    }

    // --------------------------------------------------
    // POST /clear
    // --------------------------------------------------

    if (
      request.method === 'POST' &&
      path === '/clear'
    ) {
      await this.state.storage.put(
        'ticks',
        {}
      );

      await this.state.storage.put(
        'notes',
        {}
      );

      await this.state.storage.put(
        'reportSent',
        false
      );

      return Response.json({
        ok: true
      });
    }

    // --------------------------------------------------
    // POST /send-report
    // --------------------------------------------------

    if (
      request.method === 'POST' &&
      path === '/send-report'
    ) {
      let body = {};

      try {
        body = await request.json();
      } catch {
        body = {};
      }

      const force = body.force === true;

      // Automatic sending requires the checklist
      // to actually be complete.
      if (!force) {
        const complete =
          await this.isFullyComplete();

        if (!complete) {
          return Response.json(
            {
              ok: false,
              sent: false,
              error:
                'Checklist is not fully complete'
            },
            {
              status: 400
            }
          );
        }

        const alreadySent =
          await this.state.storage.get(
            'reportSent'
          );

        if (alreadySent) {
          return Response.json({
            ok: true,
            sent: false,
            alreadySent: true
          });
        }
      }

      const result =
        await this.sendReportEmail();

      if (!result.ok) {
        return Response.json(
          {
            ok: false,
            sent: false,
            error: result.error
          },
          {
            status: 500
          }
        );
      }

      // Test reports do NOT mark the normal
      // checklist report as already sent.
      if (!force) {
        await this.state.storage.put(
          'reportSent',
          true
        );
      }

      return Response.json({
        ok: true,
        sent: true,
        test: force
      });
    }

    return new Response(
      'Not found',
      {
        status: 404
      }
    );
  }
}


// ======================================================
// MAIN CLOUDFLARE WORKER
// ======================================================

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // All /api/* requests are sent to the same
    // Durable Object instance.
    if (url.pathname.startsWith('/api/')) {
      const id =
        env.CHECKLIST.idFromName('global');

      const stub =
        env.CHECKLIST.get(id);

      const internalPath =
        url.pathname.replace(/^\/api/, '');

      const internalUrl =
        new URL(request.url);

      internalUrl.pathname =
        internalPath || '/';

      const internalRequest =
        new Request(
          internalUrl.toString(),
          request
        );

      return stub.fetch(internalRequest);
    }

    // Everything else is served from ./dist
    return env.ASSETS.fetch(request);
  }
};
