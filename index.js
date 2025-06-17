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

// Homepage
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Optional fallback routes
app.get("/qr", (req, res) => res.redirect("/"));
app.get("/pair", (req, res) => res.redirect("/"));

const sessions = new Map();
const plugins = new Map();

// 🔁 Load plugins
const pluginPath = path.join(__dirname, "plugins");
if (fs.existsSync(pluginPath)) {
  fs.readdirSync(pluginPath).forEach(file => {
    if (file.endsWith(".js")) {
      const plugin = require(path.join(pluginPath, file));
      if (plugin.name && plugin.execute) {
        plugins.set(plugin.name, plugin.execute);
        console.log(`🔌 Loaded plugin: ${plugin.name}`);
      }
    }
  });
}

io.on("connection", (socket) => {
  console.log("✅ Socket connected:", socket.id);

  socket.on("startPairing", async ({ number, method }) => {
    if (!number || !/^\d{9,15}$/.test(number)) {
      socket.emit("error", "❌ Invalid phone number format.");
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
        getMessage: async () => ({ conversation: "✅ Bot Ready" }),
      });

      // Auto presence
      if (process.env.AUTO_TYPING === "on") sock.sendPresenceUpdate("composing");
      if (process.env.AUTO_RECORD === "on") sock.sendPresenceUpdate("recording");
      if (process.env.AUTO_AVAILABLE === "on") sock.sendPresenceUpdate("available");

      sessions.set(number, sock);
      socket.emit("status", "🔗 Connecting to WhatsApp...");

      sock.ev.on("connection.update", async (update) => {
        const { connection, qr, pairingCode, lastDisconnect } = update;

        if (method === "qr" && qr) {
          const qrImage = await qrcode.toDataURL(qr);
          socket.emit("qr", qrImage);
          socket.emit("status", "📸 Scan the QR code with WhatsApp.");
        }

        if (method === "code" && pairingCode) {
          socket.emit("pairCode", pairingCode);
          socket.emit("status", "🔐 Use this code on WhatsApp → Linked Devices");

          const jid = `${number}@s.whatsapp.net`;
          await sock.sendMessage(jid, {
            text: `🔐 *Pairing Code*: ${pairingCode}\nOpen WhatsApp ➜ Linked Devices ➜ Link with Code`
          });
        }

        if (connection === "open") {
          await saveCreds();
          socket.emit("status", "✅ Connected successfully!");

          const sessionId = Buffer.from(authPath).toString("base64");
          const jid = `${number}@s.whatsapp.net`;
          await sock.sendMessage(jid, {
            text: `✅ Bot Connected!\n\n🪪 *Session ID*:\n\`\`\`${sessionId}\`\`\`\nUse this for deployment.`
          });
        }

        if (connection === "close") {
          sessions.delete(number);
          let reason = "❌ Disconnected";
          if (lastDisconnect?.error?.output?.statusCode === 401) {
            reason = "❌ Session expired / logged out.";
          }
          socket.emit("error", reason);
        }
      });

      sock.ev.on("messages.upsert", async ({ messages, type }) => {
        if (type !== "notify") return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
        const command = text.trim().split(" ")[0].toLowerCase();

        if (plugins.has(command)) {
          await plugins.get(command)(sock, msg);
        }
      });

      sock.ev.on("creds.update", saveCreds);
    } catch (err) {
      console.error("❌ Pairing Error:", err.message);
      socket.emit("error", "❌ " + err.message);
    }
  });

  socket.on("disconnect", () => {
    console.log("❌ Socket disconnected:", socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`🚀 OMMY CYBER BOT running at: http://localhost:${PORT}`);
});
