importScripts('sync.js');

// 点击工具栏图标时打开侧边栏（常驻，不点别处就消失）
if (chrome.sidePanel) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('periodic-sync', { periodInMinutes: 30 });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'periodic-sync') return;
  try {
    const config = await getConfig();
    if (config.token) await syncNotes();
  } catch (e) {
    // 离线或服务异常时静默跳过，下次再试
  }
});
