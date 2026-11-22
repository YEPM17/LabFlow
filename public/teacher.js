let teacherUser = null;
let bookingCache = [];
let deviceCache = [];
let repairCache = [];

async function renderTeacherData() {
  await Promise.all([renderOverview(), renderTeacherBookings(), renderTeacherRepairs(), renderEquipment()]);
}

async function renderOverview() {
  try {
    const stats = await api("/stats/overview?days=7");
    document.getElementById("totalDevices").textContent = stats.devices.total;
    document.getElementById("pendingBookings").textContent = stats.reservations.pending || 0;
    document.getElementById("pendingRepairs").textContent = stats.repairs.pending || 0;
    document.getElementById("approvedBookings").textContent = stats.reservations.approved || 0;

    const total = stats.reservations.total || 0;
    const groups = [
      ["待审核", stats.reservations.pending || 0],
      ["已通过", stats.reservations.approved || 0],
      ["已拒绝", stats.reservations.rejected || 0],
      ["已取消", stats.reservations.cancelled || 0]
    ];
    document.getElementById("usageChart").innerHTML = groups.map(([name, count]) => {
      const percent = total ? (count / total) * 100 : 0;
      return `<div class="chart-row">
        <span>${name}</span>
        <div class="chart-track"><div class="chart-fill" style="width:${percent}%"></div></div>
        <strong>${count}</strong>
      </div>`;
    }).join("");

    const weekly = stats.weekly;
    document.getElementById("weeklyReservations").textContent = weekly.reservationCount;
    document.getElementById("weeklyHours").textContent = `${weekly.approvedHours}h`;
    document.getElementById("weeklyUtilization").textContent = `${weekly.utilizationRate}%`;
    document.getElementById("peakHours").textContent = weekly.peakHours.length
      ? `高峰时段：${weekly.peakHours.map((item) => `${item.label}（${item.count} 次）`).join("、")}`
      : "高峰时段：暂无预约数据";

    const maxCount = Math.max(1, ...weekly.daily.map((item) => item.reservationCount));
    document.getElementById("weeklyChart").innerHTML = weekly.daily.map((item) => `
      <div class="weekly-day" title="${item.date}：${item.reservationCount} 次预约">
        <strong>${item.reservationCount}</strong>
        <div class="weekly-bar-track"><div class="weekly-bar" style="height:${(item.reservationCount / maxCount) * 100}%"></div></div>
        <span>${item.date.slice(5)}</span>
      </div>
    `).join("");
  } catch (error) {
    if (error.status !== 401) document.getElementById("usageChart").innerHTML = `<p class="empty-state">${escapeHTML(error.message)}</p>`;
  }
}

async function renderTeacherBookings() {
  try {
    const data = await api("/reservations?pageSize=200");
    bookingCache = data.items;
    document.getElementById("bookingTable").innerHTML = data.items.map((reservation) => `
      <tr>
        <td><span class="table-primary">${escapeHTML(reservation.studentName)}</span><small class="table-secondary">@${escapeHTML(reservation.studentUsername)}</small></td>
        <td>${escapeHTML(reservation.deviceName)}</td>
        <td>${escapeHTML(reservation.date)}</td>
        <td>${escapeHTML(reservation.start)} - ${escapeHTML(reservation.end)}</td>
        <td><span class="status ${reservation.status}">${getStatusText(reservation.status)}</span>${reservation.rejectReason ? `<small class="table-secondary">${escapeHTML(reservation.rejectReason)}</small>` : ""}</td>
        <td class="table-actions">${reservation.status === "pending" ? `
          <button class="small-btn" type="button" onclick="reviewBooking('${escapeHTML(reservation.id)}', 'approved')">通过</button>
          <button class="small-btn danger-btn" type="button" onclick="reviewBooking('${escapeHTML(reservation.id)}', 'rejected')">拒绝</button>
        ` : "已处理"}</td>
      </tr>
    `).join("") || '<tr><td colspan="6">暂无预约申请</td></tr>';
  } catch (error) {
    if (error.status !== 401) document.getElementById("bookingTable").innerHTML = `<tr><td colspan="6">${escapeHTML(error.message)}</td></tr>`;
  }
}

async function reviewBooking(id, status) {
  const booking = bookingCache.find((item) => item.id === id);
  if (!booking) return;
  let rejectReason = null;
  if (status === "rejected") {
    const value = prompt("拒绝原因（可选）");
    if (value === null) return;
    rejectReason = value.trim() || null;
  }
  const label = status === "approved" ? "通过" : "拒绝";
  if (!await confirmAction(`确定${label}「${booking.deviceName}」${booking.date} ${booking.start}-${booking.end} 的预约吗？`)) return;
  try {
    await api(`/reservations/${encodeURIComponent(id)}/review`, {
      method: "POST",
      body: { decision: status, rejectReason }
    });
    alert(status === "approved" ? "预约已通过！" : "预约已拒绝！");
    await renderTeacherData();
  } catch (error) {
    if (error.status !== 401) alert(error.message);
  }
}

async function renderTeacherRepairs() {
  try {
    const data = await api("/repairs?pageSize=200");
    repairCache = data.items;
    document.getElementById("teacherRepairList").innerHTML = data.items.map((repair) => `
      <div class="record-card repair-record">
        <div>
          <h3>${escapeHTML(repair.title)}</h3>
          <p class="record-device">${escapeHTML(repair.deviceName)} · 报修学生：${escapeHTML(repair.studentName)}</p>
          <p>${escapeHTML(repair.description)}</p>
          <p>提交时间：${escapeHTML(repair.createdAt)}</p>
          ${repair.photos.length ? `<div class="repair-photo-grid">${repair.photos.map((photo) => `
            <a href="${escapeHTML(photo.url)}" target="_blank" rel="noopener">
              <img class="repair-image" src="${escapeHTML(photo.url)}" loading="lazy" alt="故障照片：${escapeHTML(photo.originalName)}">
            </a>`).join("")}</div>` : ""}
        </div>
        <span class="status ${repair.status}">${getStatusText(repair.status)}</span>
        ${repair.status === "pending" ? `<button class="small-btn" type="button" onclick="updateRepair('${escapeHTML(repair.id)}', 'start')">开始维修</button>` : ""}
        ${repair.status === "processing" ? `<button class="small-btn" type="button" onclick="updateRepair('${escapeHTML(repair.id)}', 'complete')">维修完成</button>` : ""}
      </div>
    `).join("") || '<p class="empty-state">暂无报修记录。</p>';
  } catch (error) {
    if (error.status !== 401) document.getElementById("teacherRepairList").innerHTML = `<p class="empty-state">${escapeHTML(error.message)}</p>`;
  }
}

async function updateRepair(id, action) {
  const repair = repairCache.find((item) => item.id === id);
  if (!repair) return;
  const message = action === "start"
    ? `开始维修「${repair.deviceName}」？设备将切换为维修中。`
    : `确认「${repair.deviceName}」维修完成？设备将恢复为空闲。`;
  if (!await confirmAction(message)) return;
  try {
    await api(`/repairs/${encodeURIComponent(id)}/${action}`, { method: "POST" });
    alert("报修状态已更新！");
    await renderTeacherData();
  } catch (error) {
    if (error.status !== 401) alert(error.message);
  }
}

async function renderEquipment() {
  try {
    const data = await api("/devices?pageSize=200");
    deviceCache = data.items;
    document.getElementById("equipmentTable").innerHTML = data.items.map((device) => `
      <tr>
        <td>${device.id}</td>
        <td>${escapeHTML(device.name)}</td>
        <td>${escapeHTML(device.room)}</td>
        <td>${escapeHTML(device.type)}</td>
        <td><span class="status ${device.status}">${getStatusText(device.status)}</span></td>
        <td class="table-actions">
          <button class="small-btn" type="button" onclick="editDevice(${device.id})">编辑</button>
          <button class="small-btn" type="button" onclick="setDeviceStatus(${device.id}, 'available')">设为空闲</button>
          <button class="small-btn danger-btn" type="button" onclick="setDeviceStatus(${device.id}, 'maintenance')">设为维修</button>
          <button class="small-btn danger-btn" type="button" onclick="deleteDevice(${device.id})">删除</button>
        </td>
      </tr>
    `).join("") || '<tr><td colspan="6">暂无设备</td></tr>';
  } catch (error) {
    if (error.status !== 401) document.getElementById("equipmentTable").innerHTML = `<tr><td colspan="6">${escapeHTML(error.message)}</td></tr>`;
  }
}

async function setDeviceStatus(id, status) {
  const device = deviceCache.find((item) => item.id === id);
  if (!device) return;
  try {
    await api(`/devices/${id}`, { method: "PATCH", body: { status } });
    await renderTeacherData();
  } catch (error) {
    if (error.status !== 401) alert(error.message);
  }
}

function toggleAddDevice() {
  const form = document.getElementById("addDeviceForm");
  if (form.classList.contains("hidden")) {
    resetDeviceForm();
    form.classList.remove("hidden");
    document.getElementById("newDeviceName").focus();
  } else {
    closeDeviceForm();
  }
}

function resetDeviceForm() {
  document.getElementById("editingDeviceId").value = "";
  ["newDeviceName", "newDeviceRoom", "newDeviceType", "newDeviceDesc"].forEach((id) => {
    document.getElementById(id).value = "";
  });
  document.getElementById("deviceFormTitle").textContent = "新增设备";
  document.getElementById("deviceSaveButton").textContent = "保存设备";
}

function closeDeviceForm() {
  document.getElementById("addDeviceForm").classList.add("hidden");
  resetDeviceForm();
}

function editDevice(id) {
  const device = deviceCache.find((item) => item.id === id);
  if (!device) return;
  document.getElementById("editingDeviceId").value = String(id);
  document.getElementById("newDeviceName").value = device.name;
  document.getElementById("newDeviceRoom").value = device.room;
  document.getElementById("newDeviceType").value = device.type;
  document.getElementById("newDeviceDesc").value = device.description;
  document.getElementById("deviceFormTitle").textContent = `编辑设备 · ${device.name}`;
  document.getElementById("deviceSaveButton").textContent = "保存修改";
  document.getElementById("addDeviceForm").classList.remove("hidden");
  document.getElementById("addDeviceForm").scrollIntoView({
    behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
    block: "center"
  });
  document.getElementById("newDeviceName").focus();
}

async function addDevice() {
  const name = document.getElementById("newDeviceName").value.trim();
  const room = document.getElementById("newDeviceRoom").value.trim();
  const type = document.getElementById("newDeviceType").value.trim();
  const description = document.getElementById("newDeviceDesc").value.trim();
  if (!name || !room || !type || !description) {
    alert("请完整填写设备名称、实验室、类型和描述！");
    return;
  }
  const editingId = Number(document.getElementById("editingDeviceId").value);
  try {
    if (editingId) {
      await api(`/devices/${editingId}`, { method: "PATCH", body: { name, room, type, description } });
    } else {
      await api("/devices", { method: "POST", body: { name, room, type, description, status: "available" } });
    }
    closeDeviceForm();
    await renderTeacherData();
    alert(editingId ? "设备信息已更新，相关预约与报修记录同步更新。" : "设备已添加");
  } catch (error) {
    if (error.status !== 401) alert(error.message);
  }
}

async function deleteDevice(id) {
  const device = deviceCache.find((item) => item.id === id);
  if (!device) return;
  if (!await confirmAction(`确定删除设备「${device.name}」吗？该操作不可恢复。`)) return;
  try {
    await api(`/devices/${id}`, { method: "DELETE" });
    await renderTeacherData();
    alert("设备已删除！");
  } catch (error) {
    if (error.status !== 401) alert(error.message);
  }
}

async function showTeacherPage(id) {
  document.querySelectorAll(".teacher-section").forEach((section) => section.classList.add("hidden"));
  document.getElementById(id).classList.remove("hidden");
  document.querySelectorAll(".sidebar button").forEach((button, index) => {
    const active = ["overview", "bookings", "repairs", "equipment"][index] === id;
    button.classList.toggle("active", active);
    button.setAttribute("aria-current", active ? "page" : "false");
  });
  await renderTeacherData();
}

function startTeacherRefresh() {
  setInterval(() => {
    if (!document.hidden) renderTeacherData();
  }, 60000);
  window.addEventListener("focus", () => {
    if (!document.hidden) renderTeacherData();
  });
}

(async function initTeacher() {
  try {
    const me = await getCurrentUser(["teacher", "admin"]);
    if (!me) return;
    teacherUser = me.user;
    document.getElementById("teacherName").textContent = teacherUser.displayName;
    document.getElementById("teacherRoleLabel").textContent = teacherUser.role === "admin" ? "系统管理员" : "实验室管理员";
    setupNotifications();
    await showTeacherPage("overview");
    startTeacherRefresh();
  } catch (error) {
    if (error.status !== 401) alert(error.message);
  }
})();
