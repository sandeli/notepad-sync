// 侧边栏主逻辑：列表视图 + 编辑视图
let notes = {};
let tombstones = {};
let currentId = null;
let syncTimer = null;

const $ = (id) => document.getElementById(id);
const listView = $('listView');
const editorView = $('editorView');
const editor = $('editor');

function setStatus(text) { $('status').textContent = text; }

function fmtTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const pad = (n) => String(n).padStart(2, '0');
  return sameDay
    ? `${pad(d.getHours())}:${pad(d.getMinutes())}`
    : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function renderList() {
  const arr = Object.values(notes).sort((a, b) => b.updated_at - a.updated_at);
  if (!arr.length) {
    listView.innerHTML = '<div class="empty">还没有笔记<br>点右上角「＋ 新建」写第一条</div>';
    return;
  }
  listView.innerHTML = '';
  for (const n of arr) {
    const div = document.createElement('div');
    div.className = 'note-item';
    div.style.background = colorForNote(n);
    div.style.borderLeft = '5px solid ' + accentForNote(n);
    const t = document.createElement('div');
    t.className = 't';
    t.textContent = n.title || deriveTitle(n.content);
    const p = document.createElement('div');
    p.className = 'p';
    p.textContent = (n.content || '').replace(/\n/g, ' ').slice(0, 60);
    const time = document.createElement('div');
    time.className = 'time';
    time.textContent = fmtTime(n.updated_at);
    div.append(t, p, time);
    div.addEventListener('click', () => openEditor(n.id));
    listView.appendChild(div);
  }
}

function showView(view) {
  const editing = view === 'editor';
  listView.style.display = editing ? 'none' : 'block';
  editorView.style.display = editing ? 'flex' : 'none';
  $('backBtn').classList.toggle('hidden', !editing);
  $('deleteBtn').classList.toggle('hidden', !editing);
  $('newBtn').classList.toggle('hidden', editing);
  $('headerTitle').textContent = editing ? '编辑笔记' : '📝 云记事本';
}

function openEditor(id) {
  currentId = id;
  editor.value = notes[id] ? notes[id].content : '';
  editor.style.background = notes[id] ? colorForNote(notes[id]) : '';
  showView('editor');
  editor.focus();
}

function scheduleSync() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => {
    setStatus('同步中…');
    try {
      notes = await syncNotes();
      setStatus('已同步 ✓ ' + new Date().toLocaleTimeString());
      if (!currentId) renderList();
    } catch (e) {
      setStatus('同步失败（离线？）本地已保存：' + e.message);
    }
  }, 800);
}

editor.addEventListener('input', async () => {
  if (!currentId) return;
  const now = Date.now();
  notes[currentId].content = editor.value;
  notes[currentId].title = deriveTitle(editor.value);
  notes[currentId].updated_at = now;
  await saveLocal(notes, tombstones);
  setStatus('已保存到本地，等待同步…');
  scheduleSync();
});

$('newBtn').addEventListener('click', async () => {
  const id = newId();
  const now = Date.now();
  notes[id] = { id, title: '未命名笔记', content: '', color: randomColor(), created_at: now, updated_at: now };
  await saveLocal(notes, tombstones);
  openEditor(id);
  scheduleSync();
});

$('backBtn').addEventListener('click', () => {
  currentId = null;
  renderList();
  showView('list');
});

$('deleteBtn').addEventListener('click', async () => {
  if (!currentId) return;
  if (!confirm('删除这条笔记？（所有设备同步删除）')) return;
  delete notes[currentId];
  tombstones[currentId] = Date.now();
  currentId = null;
  await saveLocal(notes, tombstones);
  renderList();
  showView('list');
  scheduleSync();
});

$('settingsBtn').addEventListener('click', () => chrome.runtime.openOptionsPage());

(async function init() {
  const local = await loadLocal();
  notes = local.notes;
  tombstones = local.tombstones;
  let colored = false;
  for (const n of Object.values(notes)) {
    if (!n.color) { n.color = colorForNote(n); colored = true; }
  }
  if (colored) await saveLocal(notes, tombstones);
  renderList();
  const config = await getConfig();
  if (!config.token) {
    setStatus('⚠ 还没配置同步令牌，点右上角 ⚙ 设置（仅本地保存）');
    return;
  }
  setStatus('同步中…');
  try {
    notes = await syncNotes();
    renderList();
    setStatus('已同步 ✓ ' + new Date().toLocaleTimeString());
  } catch (e) {
    setStatus('同步失败，显示本地数据：' + e.message);
  }
})();
