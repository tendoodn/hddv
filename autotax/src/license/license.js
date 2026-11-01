// Chế độ sử dụng nội bộ HoaDon 3.1.0.
// Không gọi máy chủ cấp phép, không dùng thử, không thu thập mã máy.
// Giữ API tương thích để giao diện cũ không bị lỗi trong quá trình chuyển đổi.
(() => {
  const status = async () => ({ tier: 'open', daysLeft: 0 });
  const noop = async () => false;
  const activate = async () => ({ ok: false, reason: 'Phiên bản nội bộ không sử dụng mã kích hoạt.' });
  const machineId = async () => 'LOCAL-INTERNAL';
  globalThis.License = {
    status, syncFlags: noop, syncTrial: noop, useTrial: noop,
    activate, machineId, verify: async () => ({ ok: false, reason: 'Không sử dụng bản quyền máy chủ.' })
  };
})();
