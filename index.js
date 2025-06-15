require("dotenv").config();
const fs = require("fs-extra");
const express = require("express");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  generatePairingCode,
} = require("@whiskeysockets/baileys");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send("✅ BEN - Whittaker Tech Pairing Bot is running!");
});

app.get("/pair", async (req, res) => {
  const phoneNumber = req.query.number;
  console.log("➡️ Request /pair na namba:", phoneNumber);

  // Hakikisha namba ipo na sahihi
  if (!phoneNumber || !/^\d{10,15}$/.test(phoneNumber)) {
    return res.status(400).json({ success: false, error: "Namba si sahihi." });
  }

  try {
    // Tengeneza folder ya kuhifadhi session
    const authFolder = `./auth/${phoneNumber}`;
    fs.ensureDirSync(authFolder);

    const { state, saveCreds } = await useMultiFileAuthState(authFolder);
    const { version } = await fetchLatestBaileysVersion();

    // Tengeneza WhatsApp socket
    const sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      syncFullHistory: false,
      getMessage: async () => ({ conversation: "🟢 Message placeholder." }),
    });

    sock.ev.on("connection.update", async ({ connection }) => {
      if (connection === "open") {
        console.log("✅ Connection open!");
        await saveCreds();
      }
    });

    // Tumia generatePairingCode kwa namba mpya
    const pairingCode = await generatePairingCode(sock, phoneNumber);
    console.log("🔗 Pairing Code:", pairingCode);

    return res.json({
      success: true,
      phoneNumber,
      pairingCode,
    });

  } catch (err) {
    console.error("❌ Pairing failed:", err);
    return res.status(500).json({
      success: false,
      error: `Pairing failed: ${err}`,
    });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
