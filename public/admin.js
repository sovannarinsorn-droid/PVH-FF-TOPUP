let TOKEN = sessionStorage.getItem("mrx_admin_token");
let CONFIG = null;

async function loadConfig() {
  CONFIG = await fetch("/api/config").then((r) => r.json());
  document.getElementById("preview-logo").src = CONFIG.site.logo;
  document.getElementById("preview-hero").src = CONFIG.site.hero_banner;

  const gameGrid = document.getElementById("gameUploadGrid");
  gameGrid.innerHTML = "";
  CONFIG.games.forEach((game) => {
    const slot = document.createElement("div");
    slot.className = "upload-slot";
    slot.innerHTML = `
      <p>${game.name}</p>
      <img class="preview" src="${game.image}" />
      <input type="file" data-target="game:${game.id}" accept="image/*" />
    `;
    gameGrid.appendChild(slot);
  });

  attachUploadHandlers();
}

function attachUploadHandlers() {
  document.querySelectorAll('input[type="file"]').forEach((input) => {
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const target = input.dataset.target;
      const formData = new FormData();
      formData.append("image", file);

      const res = await fetch(`/api/admin/upload?target=${encodeURIComponent(target)}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${TOKEN}` },
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) return alert(data.error || "upload failed");

      const previewId = target.startsWith("game:") ? null : `preview-${target}`;
      if (previewId) {
        document.getElementById(previewId).src = data.url + "?t=" + Date.now();
      } else {
        input.parentElement.querySelector(".preview").src = data.url + "?t=" + Date.now();
      }
    };
  });
}

async function loadOrders() {
  const res = await fetch("/api/admin/orders", { headers: { Authorization: `Bearer ${TOKEN}` } });
  const orders = await res.json();
  const body = document.getElementById("ordersBody");
  body.innerHTML = orders
    .slice()
    .reverse()
    .map(
      (o) => `<tr>
        <td>${o.game_name}</td>
        <td>${o.package_label}</td>
        <td>${o.uid}${o.server ? " / " + o.server : ""}</td>
        <td>$${o.amount.toFixed(2)}</td>
        <td>${o.status}</td>
        <td>${new Date(o.created_at).toLocaleString()}</td>
      </tr>`
    )
    .join("");
}

function showDashboard() {
  document.getElementById("loginBox").classList.add("hidden");
  document.getElementById("dashboard").classList.remove("hidden");
  loadConfig();
  loadOrders();
  setInterval(loadOrders, 8000);
}

document.getElementById("loginBtn").onclick = async () => {
  const password = document.getElementById("pwInput").value;
  const res = await fetch("/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  const data = await res.json();
  if (!res.ok) {
    document.getElementById("loginError").classList.remove("hidden");
    return;
  }
  TOKEN = data.token;
  sessionStorage.setItem("mrx_admin_token", TOKEN);
  showDashboard();
};

if (TOKEN) showDashboard();
