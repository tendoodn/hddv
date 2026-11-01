// Mở side panel khi bấm icon; ghi file qua chrome.downloads.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

// Chỉ báo thành công khi Chrome xác nhận tệp đã tải xong, không phải chỉ mới nhận lệnh.
function waitForDownload(id) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      chrome.downloads.onChanged.removeListener(onChanged);
    };
    const finish = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      error ? reject(new Error(error)) : resolve({ id, complete: true });
    };
    const onChanged = (delta) => {
      if (delta.id !== id) return;
      if (delta.state?.current === 'complete') finish();
      else if (delta.state?.current === 'interrupted') finish(delta.error?.current || 'Tải xuống bị gián đoạn.');
    };
    const timer = setTimeout(() => finish('Quá thời gian chờ Chrome hoàn tất tải xuống.'), 10 * 60 * 1000);
    chrome.downloads.onChanged.addListener(onChanged);
    // Kiểm tra trạng thái hiện tại để tránh bỏ lỡ sự kiện complete đến trước khi listener kịp xử lý.
    chrome.downloads.search({ id }, (items) => {
      if (chrome.runtime.lastError) return finish(chrome.runtime.lastError.message);
      const item = items?.[0];
      if (!item) return finish('Không tìm thấy tác vụ tải xuống trong Chrome.');
      if (item.state === 'complete') finish();
      else if (item.state === 'interrupted') finish(item.error || 'Tải xuống bị gián đoạn.');
    });
  });
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.type === 'download') {
    // Tải lại cùng hóa đơn thì ghi đè, không sinh file trùng.
    chrome.downloads.download({ url: msg.url, filename: msg.filename, conflictAction: 'overwrite', saveAs: false })
      .then((id) => waitForDownload(id).then(reply, (e) => reply({ error: e.message })))
      .catch((e) => reply({ error: e.message }));
    return true;
  }
});
