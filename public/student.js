let studentUser = null;
let selectedDevice = null;
let bookingsCache = [];
let slotRequestToken = 0;
let bookingBusy = false;

function scheduleDeviceSearch() {
  debounceSearch();
}

const debounceSearch = debounce(() => renderDevices(), 260);

function prepareTimeSelects() {
  const startSelect = document.getElementById("bookStart");
  const endSelect = document.getElementById("bookEnd");
  const options = (from, to) => {
    const values = [];
    for (let minutes = from; minutes <= to; minutes += 30) {
      const hour = String(Math.floor(minutes / 60)).padStart(2, "0");
      const minute = String(minutes % 60).padStart(2, "0");
      values.push(`${hour}:${minute}`);
    }
    return values;
  };
  startSelect.innerHTML = options(8 * 60, 22 * 60 - 30)
    .map((value) => `<option value="${value}">${value}</option>`).join("");
  endSelect.innerHTML = options(8 * 60 + 30, 22 * 60)
    .map((value) => `<option value="${value}">${value}</option>`).join("");
  startSelect.value = "09:00";
  endSelect.value = "10:00";
}

function setDefaultBookingWindow() {
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  let startMinutes = Math.ceil((currentMinutes + 10) / 30) * 30;
  const pad = (value) => String(value).padStart(2, "0");
  const format = (minutes) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

  if (startMinutes < 8 * 60) startMinutes = 8 * 60;
  if (startMinutes + 60 > 22 * 60) {
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    document.getElementById("bookDate").value = dateKey(tomorrow);
    document.getElementById("bookStart").value = "09:00";
    document.getElementById("bookEnd").value = "10:00";
    return;
  }
  document.getElementById("bookDate").value = dateKey(now);
  document.getElementById("bookStart").value = format(startMinutes);
  document.getElementById("bookEnd").value = format(startMinutes + 60);
}

function setFilterOptions(selectId, values, emptyLabel) {
  const select = document.getElementById(selectId);
  const current = select.value;
  select.innerHTML = [`<option value="">${escapeHTML(emptyLabel)}</option>`]
    .concat(values.map((value) => `<option value="${escapeHTML(value)}">${escapeHTML(value)}</option>`))
    .join("");
  select.value = values.includes(current) ? current : "";
}

function clearDeviceFilters() {
  document.getElementById("searchInput").value = "";
  document.getElementById("statusFilter").value = "all";
  document.getElementById("roomFilter").value = "";
  document.getElementById("typeFilter").value = "";
  renderDevices();
}

async function refreshPendingCount() {
  try {
    const data = await api("/reservations?pageSize=1");
    document.getElementById("studentPending").textContent = data.summary.pending || 0;
    return data.summary.pending || 0;
  } catch (error) {
    if (error.status !== 401) document.getElementById("studentPending").textContent = "—";
    return 0;
  }
}

async function renderDevices() {
  const keyword = document.getElementById("searchInput").value.trim();
  const status = document.getElementById("statusFilter").value;
  const room = document.getElementById("roomFilter").value;
  const type = document.getElementById("typeFilter").value;
  const params = new URLSearchParams({ pageSize: "200" });
  if (keyword) params.set("q", keyword);
  if (status !== "all") params.set("status", status);
  if (room) params.set("room", room);
  if (type) params.set("type", type);

  const list = document.getElementById("deviceList");
  list.setAttribute("aria-busy", "true");
  try {
    const data = await api(`/devices?${params.toString()}`);
    setFilterOptions("roomFilter", data.filters.rooms, "全部实验室");
    setFilterOptions("typeFilter", data.filters.types, "全部类型");
    document.getElementById("studentAvailable").textContent = data.summary.available;
    document.getElementById("deviceResultCount").textContent = `共找到 ${data.total} 台设备`;
    list.innerHTML = data.items.map((device) => `
      <div class="device-card">
        <div class="device-icon" aria-hidden="true"><svg viewBox="0 0 48 48"><rect x="7" y="8" width="34" height="27" rx="3"/><path d="M11 27h26M13 22h5l3-7 5 12 4-7h5M17 40h14"/></svg></div>
        <p class="device-type">${escapeHTML(device.type)}</p>
        <h3>${escapeHTML(device.name)}</h3>
        <p>${escapeHTML(device.room)}</p>
        <span class="status ${device.status}">${getStatusText(device.status)}</span>
        <button class="primary-btn" type="button" onclick="openDevice(${device.id})">查看详情</button>
      </div>
    `).join("") || '<p class="empty-state">没有找到符合条件的设备。</p>';
  } catch (error) {
    if (error.status !== 401) {
      list.innerHTML = `<p class="empty-state">${escapeHTML(error.message)}</p>`;
      document.getElementById("deviceResultCount").textContent = "设备目录加载失败";
    }
  } finally {
    list.removeAttribute("aria-busy");
  }
}

async function openDevice(id) {
  try {
    const data = await api(`/devices/${encodeURIComponent(id)}`);
    selectedDevice = data.device;
    document.getElementById("detailName").textContent = data.device.name;
    document.getElementById("detailRoom").textContent = data.device.room;
    document.getElementById("detailType").textContent = `设备类型：${data.device.type}`;
    document.getElementById("detailDescription").textContent = data.device.description;
    document.getElementById("detailStatus").textContent = getStatusText(data.device.status);
    document.getElementById("repairTitle").value = "";
    document.getElementById("repairDescription").value = "";
    document.getElementById("repairPhotos").value = "";
    await showSection("detail");
    await renderSlots();
  } catch (error) {
    if (error.status !== 401) alert(error.message);
  }
}

async function renderSlots() {
  if (!selectedDevice) return;
  const message = document.getElementById("slotMessage");
  const date = document.getElementById("bookDate").value;
  const start = document.getElementById("bookStart").value;
  const end = document.getElementById("bookEnd").value;
  message.classList.remove("slot-ok", "slot-warn");
  if (!date || start >= end) {
    message.textContent = "请选择正确的开始和结束时间。";
    message.classList.add("slot-warn");
    return;
  }
  const requestToken = ++slotRequestToken;
  message.textContent = "正在检查该时段…";
  try {
    const params = new URLSearchParams({ date, start, end });
    const result = await api(`/devices/${selectedDevice.id}/availability?${params.toString()}`);
    if (requestToken !== slotRequestToken) return;
    message.textContent = result.message;
    message.classList.add(result.available ? "slot-ok" : "slot-warn");
  } catch (error) {
    if (requestToken !== slotRequestToken || error.status === 401) return;
    message.textContent = error.message;
    message.classList.add("slot-warn");
  }
}

async function submitBooking() {
  if (bookingBusy || !selectedDevice) return;
  const date = document.getElementById("bookDate").value;
  const start = document.getElementById("bookStart").value;
  const end = document.getElementById("bookEnd").value;
  if (!date || start >= end) {
    alert("请选择有效的预约日期和时间！");
    return;
  }
  bookingBusy = true;
  try {
    await api("/reservations", {
      method: "POST",
      body: { deviceId: selectedDevice.id, date, start, end }
    });
    alert("预约申请已提交，等待教师审核。");
    await refreshPendingCount();
    await showSection("myBookings");
  } catch (error) {
    if (error.status !== 401) alert(error.message);
  } finally {
    bookingBusy = false;
  }
}

async function renderBookings() {
  try {
    const data = await api("/reservations?pageSize=200");
    bookingsCache = data.items;
    document.getElementById("studentPending").textContent = data.summary.pending || 0;
    document.getElementById("bookingList").innerHTML = data.items.map((reservation) => `
      <div class="record-card">
        <div>
          <h3>${escapeHTML(reservation.deviceName)}</h3>
          <p>预约日期：${escapeHTML(reservation.date)}</p>
          <p>使用时间：${escapeHTML(reservation.start)} - ${escapeHTML(reservation.end)}</p>
          ${reservation.rejectReason ? `<p class="record-note">拒绝原因：${escapeHTML(reservation.rejectReason)}</p>` : ""}
          ${!reservation.canCancel && reservation.cancelBlockedReason ? `<p class="record-note">${escapeHTML(reservation.cancelBlockedReason)}</p>` : ""}
        </div>
        <span class="status ${reservation.status}">${getStatusText(reservation.status)}</span>
        ${reservation.canCancel ? `<button class="small-btn danger-btn" type="button" onclick="cancelBooking('${escapeHTML(reservation.id)}')">取消预约</button>` : ""}
      </div>
    `).join("") || '<p class="empty-state">暂无预约记录。先去设备目录选择一台设备吧。</p>';
  } catch (error) {
    if (error.status !== 401) document.getElementById("bookingList").innerHTML = `<p class="empty-state">${escapeHTML(error.message)}</p>`;
  }
}

async function cancelBooking(id) {
  const booking = bookingsCache.find((item) => item.id === id);
  if (!booking) return;
  if (!await confirmAction(`确定取消「${booking.deviceName}」${booking.date} 的预约吗？`)) return;
  try {
    await api(`/reservations/${encodeURIComponent(id)}/cancel`, { method: "POST" });
    alert("预约已取消，时段已释放。");
    await renderBookings();
  } catch (error) {
    if (error.status !== 401) alert(error.message);
  }
}

async function submitRepair() {
  if (!selectedDevice) return;
  const title = document.getElementById("repairTitle").value.trim();
  const description = document.getElementById("repairDescription").value.trim();
  const files = [...document.getElementById("repairPhotos").files];
  if (!title || !description) {
    alert("请填写故障标题和故障描述！");
    return;
  }
  if (files.length > 3) {
    alert("最多上传 3 张故障照片！");
    return;
  }
  for (const file of files) {
    if (!file.type.startsWith("image/") || file.size > 2 * 1024 * 1024) {
      alert(`照片「${file.name}」格式不支持或超过 2MB。`);
      return;
    }
  }
  try {
    const photos = await Promise.all(files.map(async (file) => ({
      name: file.name,
      type: file.type,
      data: await fileToDataURL(file)
    })));
    await api("/repairs", {
      method: "POST",
      body: { deviceId: selectedDevice.id, title, description, photos }
    });
    alert("报修申请已提交！");
    document.getElementById("repairTitle").value = "";
    document.getElementById("repairDescription").value = "";
    document.getElementById("repairPhotos").value = "";
    await showSection("myRepairs");
  } catch (error) {
    if (error.status !== 401) alert(error.message);
  }
}

async function renderRepairs() {
  try {
    const data = await api("/repairs?pageSize=200");
    document.getElementById("repairList").innerHTML = data.items.map((repair) => `
      <div class="record-card repair-record">
        <div>
          <h3>${escapeHTML(repair.title)}</h3>
          <p class="record-device">${escapeHTML(repair.deviceName)}</p>
          <p>${escapeHTML(repair.description)}</p>
          <p>提交时间：${escapeHTML(repair.createdAt)}</p>
          ${repair.photos.length ? `<div class="repair-photo-grid">${repair.photos.map((photo) => `
            <a href="${escapeHTML(photo.url)}" target="_blank" rel="noopener">
              <img class="repair-image" src="${escapeHTML(photo.url)}" loading="lazy" alt="故障照片：${escapeHTML(photo.originalName)}">
            </a>`).join("")}</div>` : ""}
        </div>
        <span class="status ${repair.status}">${getStatusText(repair.status)}</span>
      </div>
    `).join("") || '<p class="empty-state">暂无报修记录。</p>';
  } catch (error) {
    if (error.status !== 401) document.getElementById("repairList").innerHTML = `<p class="empty-state">${escapeHTML(error.message)}</p>`;
  }
}

function scanCode() {
  const value = prompt("请输入设备编号");
  if (value === null) return;
  const id = Number(value.trim());
  if (!Number.isInteger(id) || id <= 0) {
    alert("请输入有效的设备编号。");
    return;
  }
  openDevice(id).catch((error) => {
    if (error.status !== 401) alert("未找到该设备！");
  });
}

async function showSection(id) {
  document.querySelectorAll(".page-section").forEach((section) => section.classList.add("hidden"));
  document.getElementById(id).classList.remove("hidden");
  document.querySelectorAll(".student-nav button").forEach((button, index) => {
    const active = ["devices", "myBookings", "myRepairs"][index] === (id === "detail" ? "devices" : id);
    button.classList.toggle("active", active);
    button.setAttribute("aria-current", active ? "page" : "false");
  });
  if (id === "devices") await renderDevices();
  if (id === "myBookings") await renderBookings();
  if (id === "myRepairs") await renderRepairs();
}

function startStudentRefresh() {
  setInterval(async () => {
    if (document.hidden) return;
    const devicesVisible = !document.getElementById("devices").classList.contains("hidden");
    if (devicesVisible) await renderDevices();
  }, 60000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && !document.getElementById("devices").classList.contains("hidden")) renderDevices();
  });
}

(async function initStudent() {
  try {
    const me = await getCurrentUser(["student"]);
    if (!me) return;
    studentUser = me.user;
    document.getElementById("studentName").textContent = studentUser.displayName;
    document.getElementById("topStudentName").textContent = studentUser.displayName;
    document.getElementById("bookDate").min = dateKey();
    prepareTimeSelects();
    setDefaultBookingWindow();
    setupNotifications();
    await showSection("devices");
    await refreshPendingCount();

    const requestedDeviceId = Number(new URLSearchParams(location.search).get("device"));
    if (Number.isInteger(requestedDeviceId) && requestedDeviceId > 0) {
      await openDevice(requestedDeviceId);
    }
    startStudentRefresh();
  } catch (error) {
    if (error.status !== 401) alert(error.message);
  }
})();
