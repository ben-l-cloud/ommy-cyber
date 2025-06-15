require("dotenv").config();
const fs = require("fs-extra");
const path = require("path");
const express = require("express");
const qrcode = require("qrcode-terminal");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  generatePairingCode,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require("@whiskeysockets/baileys");
const { Boom } = require("@hapi/boom");

const app = express();
app.use(express.json());
app.use(express.static("public"));

const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send("✅ BEN - Whittaker Tech Pairing Bot is running!");
});

app.get("/pair", async (req, res) => {
  const phoneNumber = req.query.number;
  console.log("➡️ Request /pair na namba:", phoneNumber);

  if (!phoneNumber || !/^\d{10,15}$/.test(phoneNumber)) {
    return res.status(400).json({ success: false, error: "Namba si sahihi." });
  }

  const authFolder = `./auth/${phoneNumber}`;
  fs.ensureDirSync(authFolder);

  const { state, saveCreds } = await useMultiFileAuthState(authFolder);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    syncFullHistory: false,
    connectTimeoutMs: 60_000,
    shouldIgnoreJid: (jid) => false,
    getMessage: async () => ({ conversation: "🟢 Message placeholder." }),
  });

  let pairingCodeValue = null;

  sock.ev.on("connection.update", async ({ connection, pairingCode }) => {
    console.log("📡 connection.update:", connection);
    if (connection === "open") {
      console.log("✅ Connection open!");
      await saveCreds();
    }
    if (pairingCode) {
      console.log("🔗 Got pairingCode:", pairingCode);
      pairingCodeValue = pairingCode;
    }
  });

  try {
    await new Promise((resolve, reject) => {
      let tries = 0;
      const iv = setInterval(() => {
        if (pairingCodeValue) {
          clearInterval(iv);
          return resolve();
        }
        if (++tries >= 60) {
          clearInterval(iv);
          return reject("timeout");
        }
      }, 300);
    });
  } catch (err) {
    console.log("❌ Pairing failed:", err);
    return res.status(500).json({
      success: false,
      error: `Pairing failed: ${err}`,
    });
  }

  return res.json({
    success: true,
    phoneNumber,
    pairingCode: pairingCodeValue,
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
