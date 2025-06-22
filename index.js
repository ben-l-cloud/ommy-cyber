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
  jidNormalizedUser
} = require("@whiskeysockets/baileys");

dotenv.config();
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("public"));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));

const sessions = new Map();
const plugins = new Map();
const randomEmojis = ["😄", "👍", "🎉", "✨", "🔥", "❤️", "🤖", "💯", "🚀"];

// Load plugins
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
      socket.emit("error", "❌ Invalid phone number.");
      return;
    }

    const authPath = path.resolve(`./auth/${number}`);
    await fs.remove(authPath).catch(() => {});
    await fs.ensureDir(authPath);

    const { state, saveCreds } = await useMultiFileAuthState(authPath);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      browser: ["OmmyCyberBot", "Chrome", "121"],
      pairingCode: method === "code",
      phone: method === "code" ? { number, name: "Ommy Cyber Bot" } : undefined,
      getMessage: async () => ({ conversation: "✅ Bot Ready" }),
    });

    socket.emit("status", "🔗 Connecting...");

    sock.ev.on("connection.update", async (update) => {
      const { connection, qr, pairingCode, lastDisconnect } = update;

      if (method === "qr" && qr) {
        const qrImage = await qrcode.toDataURL(qr);
        socket.emit("qr", qrImage);
        socket.emit("status", "📸 Scan QR with WhatsApp");
      }

      if (method === "code" && pairingCode) {
        socket.emit("pairCode", pairingCode);
        socket.emit("status", "🔐 Use code in Linked Devices");

        const jid = `${number}@s.whatsapp.net`;
        await sock.sendMessage(jid, {
          text: `🔐 *Your Pair Code:* ${pairingCode}\n📲 Go to WhatsApp > Linked Devices > Link with Code`
        });
      }

      if (connection === "open") {
        await saveCreds();
        socket.emit("status", "✅ Connected!");

        const sessionId = Buffer.from(authPath).toString("base64");
        const jid = `${number}@s.whatsapp.net`;

        await sock.sendMessage(jid, {
          text: `✅ *Ommy Cyber Bot is now connected!*\n🆔 *Session ID:*\n\`\`\`${sessionId}\`\`\``
        });
      }

      if (connection === "close") {
        sessions.delete(number);
        const reason = lastDisconnect?.error?.output?.statusCode === 401
          ? "❌ Session expired"
          : "❌ Disconnected";
        socket.emit("error", reason);
      }
    });

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify") return;
      const msg = messages[0];
      if (!msg.message || msg.key.fromMe) return;

      const from = msg.key.remoteJid;

      // Auto View Status
      if (from === "status@broadcast" && process.env.AUTO_VIEW === "on") {
        try {
          await sock.readMessages([msg.key]);
          console.log("👁️ Auto-viewed status");
        } catch (e) {
          console.log("❌ Failed to view status");
        }
        return;
      }

      // Anti Delete
      if (msg.message.protocolMessage && process.env.ANTI_DELETE === "on") {
        const deletedKey = msg.message.protocolMessage.key;
        const user = jidNormalizedUser(deletedKey.participant || deletedKey.remoteJid);
        sock.sendMessage(user, {
          text: `🚫 *AntiDelete:* A message was deleted by @${user.split("@")[0]}`,
          mentions: [user]
        });
        return;
      }

      // Anti Link
      if (
        process.env.ANTI_LINK === "on" &&
        from.endsWith("@g.us") &&
        (msg.message.conversation || "").match(/(https?:\/\/chat\.whatsapp\.com\/[a-zA-Z0-9]+)/)
      ) {
        await sock.sendMessage(from, {
          text: `⚠️ *AntiLink:* Link sharing not allowed. @${msg.key.participant?.split("@")[0] || ""}`,
          mentions: [msg.key.participant || ""]
        });
        return;
      }

      // Auto React
      if (!from.endsWith("@g.us")) {
        const emoji = randomEmojis[Math.floor(Math.random() * randomEmojis.length)];
        try {
          await sock.sendMessage(from, { react: { text: emoji, key: msg.key } });
        } catch (e) { }
      }

      // Plugins
      const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
      if (!text.startsWith("#")) return;

      const command = text.trim().split(" ")[0].slice(1).toLowerCase();
      if (plugins.has(command)) {
        await plugins.get(command)(sock, msg);
      }
    });

    sock.ev.on("creds.update", saveCreds);
  });

  socket.on("disconnect", () => {
    console.log("❌ Socket disconnected:", socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`🚀 OMMY CYBER BOT is running at http://localhost:${PORT}`);
});
