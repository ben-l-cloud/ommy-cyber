require("dotenv").config();
const fs = require("fs-extra");
const path = require("path");
const express = require("express");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  generatePairingCode,
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

  try {
    const jid = `${phoneNumber}@s.whatsapp.net`;
    const code = await generatePairingCode(sock, phoneNumber);
    console.log(`🔗 Pairing code for ${phoneNumber}: ${code}`);

    sock.ev.on("connection.update", async (update) => {
      const { connection } = update;

      if (connection === "open") {
        console.log("✅ Connection open!");

        // Send all session .json files to the user
        const files = await fs.readdir(authFolder);
        for (const file of files) {
          if (file.endsWith(".json")) {
            const content = await fs.readFile(path.join(authFolder, file));
            await sock.sendMessage(jid, {
              document: content,
              mimetype: "application/json",
              fileName: file,
              caption: "📦 Session ID ya bot yako. Tumia hii kudeploy.",
            });
          }
        }

        await saveCreds();
      }
    });

    return res.send(`
      <h2>✅ Weka Code hii kwenye WhatsApp yako:</h2>
      <h1 style="font-size: 50px; color: green;">${code}</h1>
      <p>Ingia WhatsApp > Linked Devices > Link a Device > Weka Code hii</p>
    `);
  } catch (err) {
    console.log("❌ Pairing failed:", err);
    return res.send("❌ Pairing failed: " + err.message);
  }
});

app.listen(PORT, () => {
  console.log(`🚀 BEN - Whittaker Bot pairing server is running on http://localhost:${PORT}`);
});
