// 共享同步逻辑（popup 和 background service worker 共用）
// 本地存储: chrome.storage.local { config, notes: {id: note}, tombstones: {id: deleted_at} }
// 合并策略: 按 updated_at 后写优先（last-write-wins）；删除用墓碑传播

const DEFAULT_API_URL = 'https://notepad-sync.example.workers.dev';

async function getConfig() {
  const { config } = await chrome.storage.local.get('config');
  return config || { apiUrl: DEFAULT_API_URL, token: '' };
}

async function setConfig(config) {
  await chrome.storage.local.set({ config });
}

async function loadLocal() {
  const { notes, tombstones } = await chrome.storage.local.get(['notes', 'tombstones']);
  return { notes: notes || {}, tombstones: tombstones || {} };
}

async function saveLocal(notes, tombstones) {
  await chrome.storage.local.set({ notes, tombstones });
}

async function apiFetch(path, options = {}) {
  const config = await getConfig();
  if (!config.token) throw new Error('未配置同步令牌');
  const res = await fetch(config.apiUrl.replace(/\/+$/, '') + path, {
    ...options,
    headers: {
      'Authorization': `Bearer ${config.token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

// 淡色板 [底色, 强调色]：每条笔记一个颜色，新建时随机选，老笔记按 id 哈希稳定补一个
const PASTEL_COLORS = [
  ['#FBD9D9', '#E57373'], ['#FFEDBE', '#D9A441'], ['#CDEED3', '#66BB6A'],
  ['#C9E2FF', '#5B9BD5'], ['#DFD3FF', '#9575CD'], ['#FFD3E8', '#EC7FA5'],
  ['#C4EEE6', '#4DB6AC'], ['#FFE0C2', '#F0A35E'], ['#E2F0B4', '#9DBE4F'],
  ['#D3D9F5', '#7986CB'],
];

function randomColor() {
  return PASTEL_COLORS[Math.floor(Math.random() * PASTEL_COLORS.length)][0];
}

function colorIndexFor(note) {
  if (note && note.color) {
    const i = PASTEL_COLORS.findIndex(([bg]) => bg === note.color);
    if (i >= 0) return i;
  }
  const id = (note && note.id) || '';
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % PASTEL_COLORS.length;
}

function colorForNote(note) {
  return PASTEL_COLORS[colorIndexFor(note)][0];
}

function accentForNote(note) {
  return PASTEL_COLORS[colorIndexFor(note)][1];
}

function newId() {
  return crypto.randomUUID();
}

function deriveTitle(content) {
  const line = (content || '').split('\n').map(s => s.trim()).find(s => s);
  return line ? line.slice(0, 40) : '未命名笔记';
}

async function syncNotes() {
  const local = await loadLocal();
  const remote = await apiFetch('/api/notes');

  const remoteNotes = {};
  for (const n of remote.notes) remoteNotes[n.id] = n;
  const remoteTombs = {};
  for (const t of remote.tombstones) remoteTombs[t.id] = t.deleted_at;

  // 1) 远端墓碑：删掉本地对应笔记（除非本地在删除之后又编辑过）
  for (const [id, deletedAt] of Object.entries(remoteTombs)) {
    if (local.notes[id] && local.notes[id].updated_at <= deletedAt) {
      delete local.notes[id];
    }
    local.tombstones[id] = Math.max(local.tombstones[id] || 0, deletedAt);
    delete remoteNotes[id];
  }

  const toPush = [];

  // 2) 远端笔记合并进本地；本地更新的排队推送
  for (const [id, rn] of Object.entries(remoteNotes)) {
    const tombAt = local.tombstones[id] || 0;
    if (tombAt >= rn.updated_at) continue; // 本地已删且更新，无需复活
    const ln = local.notes[id];
    if (!ln || rn.updated_at > ln.updated_at) {
      local.notes[id] = rn;
    } else if (ln.updated_at > rn.updated_at) {
      toPush.push(ln);
    }
  }

  // 3) 本地独有笔记（远端没有、也没被删）推送
  for (const [id, ln] of Object.entries(local.notes)) {
    if (!remoteNotes[id] && !(local.tombstones[id] >= ln.updated_at)) toPush.push(ln);
  }

  // 4) 本地墓碑推送给远端
  const tombsToPush = [];
  for (const [id, deletedAt] of Object.entries(local.tombstones)) {
    if (!remoteTombs[id]) tombsToPush.push({ id, deleted_at: deletedAt });
  }

  if (toPush.length || tombsToPush.length) {
    await apiFetch('/api/sync', {
      method: 'POST',
      body: JSON.stringify({ notes: toPush, tombstones: tombsToPush }),
    });
  }

  await saveLocal(local.notes, local.tombstones);
  return local.notes;
}
