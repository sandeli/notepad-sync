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

// 淡雅色板 [底色, 强调色]：耳语般的浅底 + 低饱和柔和色条
const PASTEL_COLORS = [
  ['#FDECEC', '#D89A9A'], ['#FCF3DC', '#C9AE6A'], ['#EBF5EC', '#93BE9B'],
  ['#EAF1FB', '#8FAED6'], ['#F2EEFB', '#AEA0D3'], ['#FCEEF4', '#D29FBB'],
  ['#E9F5F2', '#8FBFB4'], ['#FAF0E4', '#D3A87F'], ['#F3F7E3', '#AEC078'],
  ['#EDEFF9', '#99A3CC'],
];
// 旧版底色（用于识别已存颜色的序号，保证同一条笔记颜色身份不变）
const LEGACY_BGS_V10 = ['#FDE8E8', '#FFF3D6', '#E3F6E3', '#E1F0FF', '#EFE7FF', '#FFE9F3', '#E6F7F4', '#FFF0E1', '#F1F8DC', '#E8EAF6'];
const LEGACY_BGS_V11 = ['#FBD9D9', '#FFEDBE', '#CDEED3', '#C9E2FF', '#DFD3FF', '#FFD3E8', '#C4EEE6', '#FFE0C2', '#E2F0B4', '#D3D9F5'];

function randomColor() {
  return PASTEL_COLORS[Math.floor(Math.random() * PASTEL_COLORS.length)][0];
}

function colorIndexFor(note) {
  if (note && note.color) {
    let i = PASTEL_COLORS.findIndex(([bg]) => bg === note.color);
    if (i >= 0) return i;
    i = LEGACY_BGS_V11.indexOf(note.color);
    if (i >= 0) return i;
    i = LEGACY_BGS_V10.indexOf(note.color);
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
