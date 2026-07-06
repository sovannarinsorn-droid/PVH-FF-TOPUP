let CONFIG = null;
let currentGame = null;
let selectedPackage = null;
let pollTimer = null;

async function loadConfig() {
  CONFIG = await fetch("/api/config").then((r) => r.json());
  document.getElementById("siteLogo").src = CONFIG.site.logo;
  document.getElementById("heroImg").src = CONFIG.site.hero_banner;
  document.getElementById("siteTagline").textContent = CONFIG.site.tagline;
  document.getElementById("supportLink").href = CONFIG.site.support_telegram;
  document.getElementById("year").textContent = new Date().getFullYear();
  renderGames();
}

function renderGames() {
  const grid = document.getElementById("gameGrid");
  grid.innerHTML = "";
  CONFIG.games.forEach((game) => {
    const card = document.createElement("div");
    card.className = "game-card";
    card.innerHTML = `<img src="${game.image}" alt="${game.name}"><div class="name">${game.name}</div>`;
    card.onclick = () => openModal(game);
    grid.appendChild(card);
  });
}

function openModal(game) {
  currentGame = game;
  selectedPackage = null;
  document.getElementById("modalGameName").textContent = game.name;
  document.getElementById("qrPane").classList.add("hidden");
  document.getElementById("generateBtn").disabled = true;

  const fieldsDiv = document.getElementById("fieldInputs");
  fieldsDiv.innerHTML = "";
  game.fields.forEach((f) => {
    const input = document.createElement("input");
    input.placeholder = f === "uid" ? "Player ID / UID" : "Server ID";
    input.dataset.field = f;
    input.oninput = validateForm;
    fieldsDiv.appendChild(input);
  });

  const pkgGrid = document.getElementById("packageGrid");
  pkgGrid.innerHTML = "";
  game.packages.forEach((pkg) => {
    const el = document.createElement("div");
    el.className = "ticket";
    el.innerHTML = `<div class="label">${pkg.label}</div><div class="price">$${pkg.price.toFixed(2)}</div>`;
    el.onclick = () => {
      document.querySelectorAll(".ticket").forEach((t) => t.classList.remove("selected"));
      el.classList.add("selected");
      selectedPackage = pkg;
      validateForm();
    };
    pkgGrid.appendChild(el);
  });

  document.getElementById("orderModal").classList.remove("hidden");
}

function validateForm() {
  const inputs = [...document.querySelectorAll("#fieldInputs input")];
  const allFilled = inputs.every((i) => i.value.trim().length > 0);
  document.getElementById("generateBtn").disabled = !(allFilled && selectedPackage);
}

document.getElementById("closeModal").onclick = () => {
  document.getElementById("orderModal").classList.add("hidden");
  clearInterval(pollTimer);
};

document.getElementById("generateBtn").onclick = async () => {
  const inputs = [...document.querySelectorAll("#fieldInputs input")];
  const payload = {
    game_id: currentGame.id,
    package_id: selectedPackage.id,
    uid: inputs.find((i) => i.dataset.field === "uid")?.value,
    server: inputs.find((i) => i.dataset.field === "server")?.value,
  };

  const res = await fetch("/api/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const order = await res.json();
  if (!res.ok) return alert(order.error || "Order failed");

  document.getElementById("qrPane").classList.remove("hidden");
  document.getElementById("qrAmount").textContent = order.amount.toFixed(2);
  document.getElementById("qrStatus").textContent = "កំពុងរង់ចាំការទូទាត់...";
  document.getElementById("qrStatus").classList.remove("paid");

  const qrDiv = document.getElementById("qrcode");
  qrDiv.innerHTML = "";
  new QRCode(qrDiv, { text: order.qr_string, width: 220, height: 220 });

  clearInterval(pollTimer);
  pollTimer = setInterval(() => checkStatus(order.order_id), 3000);
};

async function checkStatus(orderId) {
  const res = await fetch(`/api/orders/${orderId}/status`);
  const data = await res.json();
  if (data.status === "paid" || data.status === "delivered") {
    clearInterval(pollTimer);
    const statusEl = document.getElementById("qrStatus");
    statusEl.textContent = "✅ ទូទាត់ជោគជ័យ! កំពុងបញ្ចូលដោយស្វ័យប្រវត្តិ...";
    statusEl.classList.add("paid");
  }
}

loadConfig();
