require("dotenv").config();
const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));
const { BakongKHQR, IndividualInfo, khqrData } = require("bakong-khqr");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

const CONFIG_PATH = path.join(__dirname, "data", "config.json");
const ORDERS_PATH = path.join(__dirname, "data", "orders.json");

const readJSON = (p) => JSON.parse(fs.readFileSync(p, "utf-8"));
const writeJSON = (p, d) => fs.writeFileSync(p, JSON.stringify(d, null, 2));

// ---------- Admin auth (simple token, single admin) ----------
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "changeme";
let activeToken = null;

function requireAdmin(req, res, next) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token || token !== activeToken) return res.status(401).json({ error: "unauthorized" });
  next();
}

app.post("/api/admin/login", (req, res) => {
  if (req.body.password !== ADMIN_PASSWORD) return res.status(401).json({ error: "wrong password" });
  activeToken = crypto.randomBytes(24).toString("hex");
  res.json({ token: activeToken });
});

// ---------- Public config ----------
app.get("/api/config", (req, res) => res.json(readJSON(CONFIG_PATH)));

// ---------- Admin: upload image to any slot (logo / hero / game:<id>) ----------
const storage = multer.diskStorage({
  destination: path.join(__dirname, "uploads"),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || ".jpg";
    cb(null, `${req.query.target.replace(":", "-")}-${Date.now()}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

app.post("/api/admin/upload", requireAdmin, upload.single("image"), (req, res) => {
  const target = req.query.target; // "logo" | "hero" | "game:freefire"
  const config = readJSON(CONFIG_PATH);
  const url = `/uploads/${req.file.filename}`;

  if (target === "logo") config.site.logo = url;
  else if (target === "hero") config.site.hero_banner = url;
  else if (target.startsWith("game:")) {
    const gameId = target.split(":")[1];
    const game = config.games.find((g) => g.id === gameId);
    if (game) game.image = url;
  } else {
    return res.status(400).json({ error: "unknown target" });
  }

  writeJSON(CONFIG_PATH, config);
  res.json({ ok: true, url });
});

// ---------- Admin: edit packages / games ----------
app.post("/api/admin/config", requireAdmin, (req, res) => {
  writeJSON(CONFIG_PATH, req.body);
  res.json({ ok: true });
});

app.get("/api/admin/orders", requireAdmin, (req, res) => res.json(readJSON(ORDERS_PATH)));

// ---------- Bakong KHQR: create order + generate QR ----------
const BAKONG_ACCOUNT_ID = process.env.BAKONG_ACCOUNT_ID; // e.g. "yourname@wing"
const BAKONG_MERCHANT_NAME = process.env.BAKONG_MERCHANT_NAME || "MRX TOPUP";
const BAKONG_CITY = process.env.BAKONG_CITY || "Phnom Penh";
const BAKONG_TOKEN = process.env.BAKONG_TOKEN; // Bakong Open API bearer token

app.post("/api/orders", async (req, res) => {
  const { game_id, package_id, uid, server, contact } = req.body;
  const config = readJSON(CONFIG_PATH);
  const game = config.games.find((g) => g.id === game_id);
  const pkg = game?.packages.find((p) => p.id === package_id);
  if (!game || !pkg) return res.status(400).json({ error: "invalid game/package" });

  const optionalData = {
    currency: khqrData.currency.usd,
    amount: pkg.price,
    storeLabel: BAKONG_MERCHANT_NAME,
    terminalLabel: "web",
    purposeOfTransaction: `${game.name} ${pkg.label}`,
  };

  const individualInfo = new IndividualInfo(
    BAKONG_ACCOUNT_ID,
    BAKONG_MERCHANT_NAME,
    BAKONG_CITY,
    optionalData
  );

  const khqr = new BakongKHQR();
  const result = khqr.generateIndividual(individualInfo);

  const order = {
    id: crypto.randomUUID(),
    game_id,
    game_name: game.name,
    package_id,
    package_label: pkg.label,
    bay2game_product_code: pkg.bay2game_product_code,
    amount: pkg.price,
    uid,
    server: server || null,
    contact: contact || null,
    qr_string: result.data.qr,
    md5: result.data.md5,
    status: "pending", // pending | paid | delivered | failed | expired
    created_at: new Date().toISOString(),
  };

  const orders = readJSON(ORDERS_PATH);
  orders.push(order);
  writeJSON(ORDERS_PATH, orders);

  res.json({ order_id: order.id, qr_string: order.qr_string, amount: order.amount });
});

// ---------- Poll Bakong to check if a specific order was paid ----------
app.get("/api/orders/:id/status", async (req, res) => {
  const orders = readJSON(ORDERS_PATH);
  const order = orders.find((o) => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: "not found" });

  if (order.status === "pending") {
    try {
      const r = await fetch("https://api-bakong.nbc.gov.kh/v1/check_transaction_by_md5", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${BAKONG_TOKEN}`,
        },
        body: JSON.stringify({ md5: order.md5 }),
      });
      const data = await r.json();

      if (data.responseCode === 0 && data.data) {
        order.status = "paid";
        order.paid_at = new Date().toISOString();
        writeJSON(ORDERS_PATH, orders);
        await autoDeliver(order);
      }
    } catch (err) {
      console.error("bakong check failed:", err.message);
    }
  }

  res.json({ status: order.status });
});

// ---------- Auto delivery: Bay2Game create_order API ----------
const BAY2GAME_API_KEY = process.env.BAY2GAME_API_KEY;
const BAY2GAME_BASE_URL = "https://api.bay2game.xyz/api/create_order";

async function autoDeliver(order) {
  const orders = readJSON(ORDERS_PATH);
  const target = orders.find((o) => o.id === order.id);

  if (!target.bay2game_product_code) {
    target.status = "failed";
    target.delivery_error = "no bay2game_product_code mapped for this package";
    writeJSON(ORDERS_PATH, orders);
    await notifyAdmin(target, { error: target.delivery_error });
    return;
  }

  const params = new URLSearchParams({
    api_key: BAY2GAME_API_KEY,
    product_code: target.bay2game_product_code,
    game_user_id: target.uid,
    reference: target.id, // our order id, already unique
  });
  if (target.server) params.set("game_zone_id", target.server);

  try {
    const resp = await fetch(`${BAY2GAME_BASE_URL}?${params.toString()}`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    const data = await resp.json();

    if (data.status === "SUCCESS") {
      target.status = "delivered";
      target.delivered_at = new Date().toISOString();
      target.provider_response = data;
    } else {
      // insufficient balance, invalid uid, etc. — needs a human
      target.status = "failed";
      target.delivery_error = data.message || "bay2game_rejected";
      target.provider_response = data;
      await notifyAdmin(target, data);
    }
  } catch (err) {
    target.status = "failed";
    target.delivery_error = err.message;
    await notifyAdmin(target, { error: err.message });
  }

  writeJSON(ORDERS_PATH, orders);
}

async function notifyAdmin(order, detail) {
  if (!process.env.TELEGRAM_ADMIN_BOT_TOKEN || !process.env.TELEGRAM_ADMIN_CHAT_ID) return;
  const text =
    `⚠️ ត្រូវការបញ្ចូលដោយដៃ (auto-delivery failed)\n` +
    `Order: ${order.id}\n` +
    `Game: ${order.game_name} — ${order.package_label}\n` +
    `UID: ${order.uid} / Zone: ${order.server || "-"}\n` +
    `Amount: $${order.amount}\n` +
    `Detail: ${JSON.stringify(detail).slice(0, 300)}`;

  await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_ADMIN_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: process.env.TELEGRAM_ADMIN_CHAT_ID, text }),
  }).catch(() => {});
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`MRX TOPUP running on port ${PORT}`));
