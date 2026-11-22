const DEMO_ACCOUNTS = {
  student: { username: "student", password: "Student@2026" },
  teacher: { username: "teacher", password: "Teacher@2026" }
};

const roleSelect = document.getElementById("role");
const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");
const errorBox = document.getElementById("loginError");
const loginButton = document.getElementById("loginButton");

function fillDemoAccount() {
  const account = DEMO_ACCOUNTS[roleSelect.value];
  if (!account) return;
  usernameInput.value = account.username;
  passwordInput.value = account.password;
  errorBox.hidden = true;
}

const requestedRole = new URLSearchParams(location.search).get("role");
if (["student", "teacher"].includes(requestedRole)) roleSelect.value = requestedRole;
fillDemoAccount();
roleSelect.addEventListener("change", () => {
  fillDemoAccount();
  usernameInput.focus();
  usernameInput.select();
});

document.getElementById("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const username = usernameInput.value.trim();
  const password = passwordInput.value;
  if (!username || !password) {
    showError(!username ? "请输入用户名。" : "请输入密码。", !username ? usernameInput : passwordInput);
    return;
  }
  errorBox.hidden = true;
  loginButton.disabled = true;
  loginButton.textContent = "正在登录…";
  try {
    const result = await api("/auth/login", {
      method: "POST",
      body: { username, password },
      redirectOn401: false
    });
    location.replace(roleHome(result.user.role));
  } catch (error) {
    showError(error.message, passwordInput);
    loginButton.disabled = false;
    loginButton.innerHTML = '进入工作台 <span aria-hidden="true">→</span>';
  }
});

function showError(message, focusTarget) {
  errorBox.textContent = message;
  errorBox.hidden = false;
  focusTarget?.focus();
}
