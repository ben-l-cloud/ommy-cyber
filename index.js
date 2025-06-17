const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs-extra");
const path = require("path");
const qrcode = require("qrcode");
const dotenv = require("dotenv");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  makeInMemoryStore
} = require("@whiskeysockets/baileys");

dotenv.config();
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("public"));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

const sessions = new Map();
const plugins = new Map();

// 🔁 Load plugins from /plugins
fs.readdirSync("./plugins").forEach(file => {
  if (file.endsWith(".js")) {
    const plugin = require(`./plugins/${file}`);
    plugins.set(plugin.name, plugin.execute);
  }
});

io.on("connection", (socket) => {
  console.log("✅ Connected:", socket.id);

  socket.on("startPairing", async ({ number, method }) => {
    if (!number || !/^\d{9,15}$/.test(number)) {
      socket.emit("error", "❌ Invalid phone number");
      return;
    }

    if (sessions.has(number)) {
      socket.emit("status", "🤖 Already connected.");
      return;
    }

    try {
      const authPath = path.resolve(`./auth/${number}`);
      await fs.ensureDir(authPath);
      const { state, saveCreds } = await useMultiFileAuthState(authPath);
      const { version } = await fetchLatestBaileysVersion();

      const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        getMessage: async () => ({ conversation: "✅ Connected" }),
      });

      // Auto Presence
      if (process.env.AUTO_TYPING === "on") sock.sendPresenceUpdate("composing");
      if (process.env.AUTO_RECORD === "on") sock.sendPresenceUpdate("recording");
      if (process.env.AUTO_AVAILABLE === "on") sock.sendPresenceUpdate("available");

      sessions.set(number, sock);
      socket.emit("status", "🔗 Connecting to WhatsApp...");

      // 🟠 Events
      sock.ev.on("connection.update", async (update) => {
        const { connection, qr, pairingCode, lastDisconnect } = update;

        if (method === "qr" && qr) {
          const qrImage = await qrcode.toDataURL(qr);
          socket.emit("qr", qrImage);
          socket.emit("status", "📸 Scan QR Code");
        }

        if (method === "code" && pairingCode) {
          const customCode = Math.floor(10000000 + Math.random() * 90000000).toString();
          socket.emit("pairCode", customCode);
          socket.emit("status", `🔐 Use this code on WhatsApp`);

          const jid = `${number}@s.whatsapp.net`;
          await sock.sendMessage(jid, {
            text: `🔐 Pairing Code: *${customCode}*\nOpen WhatsApp ➜ Linked Devices ➜ Link with Code`
          });
        }

        if (connection === "open") {
          socket.emit("status", "✅ Connected!");
          await saveCreds();

          const sessionId = Buffer.from(authPath).toString("base64");
          const jid = `${number}@s.whatsapp.net`;
          await sock.sendMessage(jid, {
            text: `✅ Connected!\n\n📦 Session ID:\n\`\`\`${sessionId}\`\`\`\nUse this for bot deployment.`
          });
        }

        if (connection === "close") {
          sessions.delete(number);
          const code = lastDisconnect?.error?.output?.statusCode;
          const reason = code === 401 ? "Logged out." : "Disconnected.";
          socket.emit("error", "❌ " + reason);
        }
      });

      // 🔌 Handle messages
      sock.ev.on("messages.upsert", async ({ messages, type }) => {
        if (type !== "notify") return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const body = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
        const command = body.trim().split(" ")[0].toLowerCase();

        if (plugins.has(command)) {
          await plugins.get(command)(sock, msg);
        }
      });

      sock.ev.on("creds.update", saveCreds);
    } catch (err) {
      console.error("❌ Pairing error:", err.message);
      socket.emit("error", "❌ " + err.message);
    }
  });

  socket.on("disconnect", () => {
    console.log("❌ Disconnected:", socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`🚀 OMMY CYBER BOT running at: http://localhost:${PORT}`);
});
