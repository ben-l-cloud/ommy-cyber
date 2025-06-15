require("dotenv").config();
const fs = require("fs-extra");
const path = require("path");
const express = require("express");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
} = require("@whiskeysockets/baileys");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));
app.use(express.json());

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.post("/pair", async (req, res) => {
  const phoneNumber = req.body.number;
  if (!phoneNumber || !/^\d{10,15}$/.test(phoneNumber)) {
    return res.send("⚠️ Namba si sahihi.");
  }

  const authFolder = path.resolve(`./auth/${phoneNumber}`);
  await fs.ensureDir(authFolder);

  const { state, saveCreds } = await useMultiFileAuthState(authFolder);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    getMessage: async () => ({ conversation: "🟢 Umeunganishwa!" }),
  });

  let pairingCode = null;
  const jid = `${phoneNumber}@s.whatsapp.net`;

  sock.ev.on("connection.update", async (update) => {
    const { connection, pairingCode: code } = update;

    if (code) {
      pairingCode = code;
      console.log(`🔗 Pairing code: ${code}`);
    }

    if (connection === "open") {
      console.log("✅ Connected!");

      const files = await fs.readdir(authFolder);
      for (const file of files) {
        if (file.endsWith(".json")) {
          const content = await fs.readFile(path.join(authFolder, file));
          await sock.sendMessage(jid, {
            document: content,
            mimetype: "application/json",
            fileName: file,
            caption: "📦 Hii ndio session ID yako. Tumia kudeploy bot yako 💻",
          });
        }
      }

      await saveCreds();
    }
  });

  // Kungojea pairing code mpaka ipatikane
  try {
    await new Promise((resolve, reject) => {
      let tries = 0;
      const check = setInterval(() => {
        if (pairingCode) {
          clearInterval(check);
          resolve();
        }
        if (++tries > 50) {
          clearInterval(check);
          reject(new Error("Timeout: Pairing code haikupatikana."));
        }
      }, 300);
    });

    return res.send(`
      <h2>✅ Weka Code hii kwenye WhatsApp yako:</h2>
      <h1 style="font-size: 50px; color: green;">${pairingCode}</h1>
      <p>Ingia WhatsApp > Linked Devices > Link a Device > Weka Code hii</p>
    `);
  } catch (err) {
    console.log("❌ Pairing failed:", err.message);
    return res.send("❌ Pairing failed: " + err.message);
  }
});

app.listen(PORT, () => {
  console.log(`🚀 BEN - Whittaker Bot pairing server is running on http://localhost:${PORT}`);
});
