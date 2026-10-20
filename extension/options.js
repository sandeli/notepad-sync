const $ = (id) => document.getElementById(id);

(async function init() {
  $('version').textContent = '云记事本 v' + chrome.runtime.getManifest().version;
  const config = await getConfig();
  $('apiUrl').value = config.apiUrl || DEFAULT_API_URL;
  $('token').value = config.token || '';
})();

$('saveBtn').addEventListener('click', async () => {
  await setConfig({
    apiUrl: $('apiUrl').value.trim().replace(/\/+$/, ''),
    token: $('token').value.trim(),
  });
  $('result').textContent = '已保存 ✓';
  $('result').style.color = '#15803d';
});

$('testBtn').addEventListener('click', async () => {
  await setConfig({
    apiUrl: $('apiUrl').value.trim().replace(/\/+$/, ''),
    token: $('token').value.trim(),
  });
  $('result').textContent = '测试中…';
  $('result').style.color = '#666';
  try {
    await apiFetch('/api/ping');
    const notes = await syncNotes();
    $('result').textContent = `连接成功 ✓ 当前共 ${Object.keys(notes).length} 条笔记，已完成一次同步`;
    $('result').style.color = '#15803d';
  } catch (e) {
    $('result').textContent = '连接失败：' + e.message + '（检查地址和令牌）';
    $('result').style.color = '#c0392b';
  }
});
