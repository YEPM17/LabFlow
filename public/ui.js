const toastRegion = document.createElement('div');
toastRegion.className = 'toast-region';
toastRegion.setAttribute('aria-live','polite');
document.body.append(toastRegion);
window.alert = function(message) {
  const toast = document.createElement('div');
  toast.className = /失败|错误|冲突|不能|无法|请|不足|未找到|暂不可/.test(message) ? 'app-toast error' : 'app-toast';
  toast.textContent = message;
  toastRegion.append(toast);
  requestAnimationFrame(()=>toast.classList.add('shown'));
  setTimeout(()=>{toast.classList.remove('shown');setTimeout(()=>toast.remove(),220)},3900);
};
const confirmDialog = document.createElement('dialog');
confirmDialog.className='app-dialog';
confirmDialog.innerHTML='<div class="dialog-inner"><h2>确认操作</h2><p id="dialogMessage"></p><div class="dialog-actions"><button type="button" id="dialogCancel">返回</button><button type="button" id="dialogConfirm">确认</button></div></div>';
document.body.append(confirmDialog);
function confirmAction(message) {
  return new Promise(resolve => {
    confirmDialog.querySelector('#dialogMessage').textContent=message;
    const yes=confirmDialog.querySelector('#dialogConfirm');
    const no=confirmDialog.querySelector('#dialogCancel');
    const close=(value)=>{confirmDialog.close();yes.removeEventListener('click',approve);no.removeEventListener('click',deny);confirmDialog.removeEventListener('cancel',escape);resolve(value)};
    const approve=()=>close(true), deny=()=>close(false), escape=(event)=>{event.preventDefault();close(false)};
    yes.addEventListener('click',approve);no.addEventListener('click',deny);confirmDialog.addEventListener('cancel',escape);
    confirmDialog.showModal();no.focus();
  });
}

function setupNotifications(mountId = "notificationMount") {
  const mount = document.getElementById(mountId);
  if (!mount) return;
  mount.innerHTML = `
    <div class="notification-center">
      <button class="notification-toggle" type="button" aria-label="通知" aria-haspopup="true" aria-expanded="false">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg>
        <span class="notification-badge hidden" aria-live="polite">0</span>
      </button>
      <div class="notification-panel hidden" role="dialog" aria-label="通知中心">
        <div class="notification-head">
          <strong>通知</strong>
          <button type="button" class="notification-read-all">全部已读</button>
        </div>
        <div class="notification-list"><p class="notification-empty">正在加载…</p></div>
      </div>
    </div>`;

  const toggle = mount.querySelector(".notification-toggle");
  const panel = mount.querySelector(".notification-panel");
  const badge = mount.querySelector(".notification-badge");
  const list = mount.querySelector(".notification-list");
  const readAll = mount.querySelector(".notification-read-all");
  let unreadCount = 0;

  function setOpen(open) {
    panel.classList.toggle("hidden", !open);
    toggle.setAttribute("aria-expanded", String(open));
    if (open) refresh();
  }

  function updateBadge() {
    badge.textContent = unreadCount > 99 ? "99+" : String(unreadCount);
    badge.classList.toggle("hidden", unreadCount === 0);
  }

  function renderItems(items) {
    if (!items.length) {
      list.innerHTML = '<p class="notification-empty">暂无通知</p>';
      return;
    }
    list.innerHTML = items.map((item) => `
      <button type="button" class="notification-item ${item.readAt ? "" : "unread"}" data-id="${escapeHTML(item.id)}">
        <span class="notification-item-title">${escapeHTML(item.title)}</span>
        <span class="notification-item-body">${escapeHTML(item.body)}</span>
        <span class="notification-item-time">${escapeHTML(formatShortTime(item.createdAt))}</span>
      </button>
    `).join("");
  }

  async function refresh() {
    try {
      const data = await api("/notifications?limit=30");
      unreadCount = data.unreadCount;
      updateBadge();
      renderItems(data.items);
    } catch (error) {
      if (error.status === 401) return;
      list.innerHTML = `<p class="notification-empty">${escapeHTML(error.message)}</p>`;
    }
  }

  toggle.addEventListener("click", (event) => {
    event.stopPropagation();
    setOpen(panel.classList.contains("hidden"));
  });

  readAll.addEventListener("click", async (event) => {
    event.stopPropagation();
    try {
      await api("/notifications/read-all", { method: "POST" });
      unreadCount = 0;
      updateBadge();
      list.querySelectorAll(".notification-item.unread").forEach((item) => item.classList.remove("unread"));
    } catch (error) {
      if (error.status !== 401) alert(error.message);
    }
  });

  list.addEventListener("click", async (event) => {
    event.stopPropagation();
    const item = event.target.closest(".notification-item");
    if (!item || !item.classList.contains("unread")) return;
    try {
      const result = await api(`/notifications/${encodeURIComponent(item.dataset.id)}/read`, { method: "POST" });
      item.classList.remove("unread");
      unreadCount = result.unreadCount;
      updateBadge();
    } catch (error) {
      if (error.status !== 401) alert(error.message);
    }
  });

  document.addEventListener("click", (event) => {
    if (!mount.contains(event.target)) setOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !panel.classList.contains("hidden")) {
      setOpen(false);
      toggle.focus();
    }
  });
  window.addEventListener("focus", refresh);
  setInterval(() => {
    if (!document.hidden) refresh();
  }, 60000);
  refresh();
}
