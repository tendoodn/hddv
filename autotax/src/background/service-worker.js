// Mở side panel khi bấm icon; ghi file qua chrome.downloads.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.type === 'download') {
    // Tải lại cùng hóa đơn thì ghi đè, không sinh file trùng
    chrome.downloads.download({ url: msg.url, filename: msg.filename, conflictAction: 'overwrite', saveAs: false })
      .then((id) => reply({ id }), (e) => reply({ error: e.message }));
    return true;
  }
});
