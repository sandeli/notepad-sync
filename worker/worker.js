// 云记事本同步后端
// KV: NOTES_KV (note:{id} -> 笔记 JSON; tomb:{id} -> 删除墓碑, 30 天 TTL)
// Secret: NOTE_TOKEN (访问令牌, 请求头 Authorization: Bearer <token>)

const NOTE_PREFIX = 'note:';
const TOMB_PREFIX = 'tomb:';
const MAX_TITLE = 200;
const MAX_CONTENT = 200000;
const TOMB_TTL = 30 * 24 * 3600;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

function authed(request, env) {
  if (!env.NOTE_TOKEN) return false;
  return (request.headers.get('Authorization') || '') === `Bearer ${env.NOTE_TOKEN}`;
}

async function listAll(env, prefix) {
  const out = [];
  let cursor;
  do {
    const res = await env.NOTES_KV.list({ prefix, cursor });
    for (const k of res.keys) {
      const v = await env.NOTES_KV.get(k.name, 'json');
      if (v) out.push(v);
    }
    cursor = res.list_complete ? null : res.cursor;
  } while (cursor);
  return out;
}

function sanitizeNote(body, existing) {
  const now = Date.now();
  return {
    id: body.id,
    title: String(body.title ?? '').slice(0, MAX_TITLE),
    content: String(body.content ?? '').slice(0, MAX_CONTENT),
    color: /^#[0-9a-fA-F]{6}$/.test(String(body.color ?? '')) ? String(body.color) : '',
    updated_at: body.updated_at || now,
    created_at: (existing && existing.created_at) || body.created_at || now,
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET,PUT,POST,DELETE,OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization,Content-Type',
        },
      });
    }

    if (!authed(request, env)) return json({ error: 'unauthorized' }, 401);

    const path = url.pathname;

    // GET /api/ping — 连通性检查
    if (path === '/api/ping' && request.method === 'GET') {
      return json({ ok: true, time: Date.now() });
    }

    // GET /api/notes — 拉全部笔记 + 墓碑
    if (path === '/api/notes' && request.method === 'GET') {
      const notes = await listAll(env, NOTE_PREFIX);
      const tombstones = await listAll(env, TOMB_PREFIX);
      return json({ notes, tombstones });
    }

    const m = path.match(/^\/api\/notes\/([A-Za-z0-9_-]+)$/);

    // PUT /api/notes/:id — 新建/更新一条
    if (m && request.method === 'PUT') {
      const id = m[1];
      const body = await request.json();
      const existing = await env.NOTES_KV.get(NOTE_PREFIX + id, 'json');
      const note = sanitizeNote({ ...body, id }, existing);
      await env.NOTES_KV.put(NOTE_PREFIX + id, JSON.stringify(note));
      await env.NOTES_KV.delete(TOMB_PREFIX + id);
      return json({ ok: true, note });
    }

    // DELETE /api/notes/:id — 删除一条（写墓碑，供其他设备同步删除）
    if (m && request.method === 'DELETE') {
      const id = m[1];
      await env.NOTES_KV.delete(NOTE_PREFIX + id);
      await env.NOTES_KV.put(
        TOMB_PREFIX + id,
        JSON.stringify({ id, deleted_at: Date.now() }),
        { expirationTtl: TOMB_TTL }
      );
      return json({ ok: true });
    }

    // POST /api/sync {notes:[...], tombstones:[...]} — 批量推送本地变更
    if (path === '/api/sync' && request.method === 'POST') {
      const body = await request.json();
      const applied = [];
      for (const n of body.notes || []) {
        if (!n || !n.id) continue;
        const existing = await env.NOTES_KV.get(NOTE_PREFIX + n.id, 'json');
        if (!existing || (n.updated_at || 0) > (existing.updated_at || 0)) {
          await env.NOTES_KV.put(NOTE_PREFIX + n.id, JSON.stringify(sanitizeNote(n, existing)));
          await env.NOTES_KV.delete(TOMB_PREFIX + n.id);
          applied.push(n.id);
        }
      }
      for (const t of body.tombstones || []) {
        if (!t || !t.id) continue;
        await env.NOTES_KV.delete(NOTE_PREFIX + t.id);
        await env.NOTES_KV.put(
          TOMB_PREFIX + t.id,
          JSON.stringify({ id: t.id, deleted_at: t.deleted_at || Date.now() }),
          { expirationTtl: TOMB_TTL }
        );
      }
      return json({ ok: true, applied });
    }

    return json({ error: 'not found' }, 404);
  },
};
