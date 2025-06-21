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
  proto,
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

const isGroup = jid => jid.endsWith("@g.us");
const randomEmojis = ["🔥", "💯", "🤖", "✨", "🚀", "❤️"];

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
      browser: ["Ommy Cyber Bot", "Chrome", "121"],
      pairingCode: method === "code",
      phone: method === "code" ? { number, name: "Ommy Cyber Bot" } : undefined,
      getMessage: async () => ({ conversation: "🤖 Ommy Cyber Bot Ready!" }),
    });

    sessions.set(number, sock);
    socket.emit("status", "🔗 Connecting...");

    sock.ev.on("connection.update", async (update) => {
      const { connection, qr, pairingCode, lastDisconnect } = update;

      if (method === "qr" && qr) {
        const qrImage = await qrcode.toDataURL(qr);
        socket.emit("qr", qrImage);
        socket.emit("status", "📸 Scan QR on WhatsApp.");
      }

      if (method === "code" && pairingCode) {
        socket.emit("pairCode", pairingCode);
        socket.emit("status", "🔐 Use this code in WhatsApp ➜ Linked Devices");

        const jid = `${number}@s.whatsapp.net`;
        await sock.sendMessage(jid, {
          text: `🔐 *Pair Code*: ${pairingCode}\nGo to WhatsApp ➜ Linked Devices ➜ Link With Code`,
        });
      }

      if (connection === "open") {
        await saveCreds();
        socket.emit("status", "✅ Connected!");

        const jid = `${number}@s.whatsapp.net`;
        const sessionId = Buffer.from(authPath).toString("base64");

        await sock.sendMessage(jid, {
          text: `✅ *Ommy Cyber Bot Active!*\n🆔 *Your Session ID:* \n\`\`\`${sessionId}\`\`\`\nCopy and deploy.`,
        });
      }

      if (connection === "close") {
        sessions.delete(number);
        const reason = lastDisconnect?.error?.output?.statusCode === 401
          ? "❌ Session expired." : "❌ Disconnected.";
        socket.emit("error", reason);
      }
    });

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify") return;
      const msg = messages[0];
      if (!msg.message || msg.key.fromMe) return;
      const from = msg.key.remoteJid;
      const sender = msg.key.participant || from;

      const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";

      // 👁️ Auto-view status
      if (from === "status@broadcast") {
        try {
          await sock.readMessages([msg.key]);
          console.log("👁️ Status viewed.");
        } catch {}
        return;
      }

      // 🤖 React in DM
      if (!isGroup(from)) {
        const emoji = randomEmojis[Math.floor(Math.random() * randomEmojis.length)];
        try {
          await sock.sendMessage(from, { react: { text: emoji, key: msg.key } });
        } catch {}
      }

      // 🔗 Anti-Link
      const isLink = text.includes("chat.whatsapp.com") || /https?:\/\/[^\s]+/i.test(text);
      if (process.env.ANTILINK === "on" && isGroup(from) && isLink) {
        try {
          await sock.sendMessage(from, {
            text: `⚠️ *Links Not Allowed Here!*\nMessage removed.`,
            mentions: [sender],
          });
          await sock.sendMessage(from, { delete: msg.key });
        } catch {}
      }

      // 🔧 Plugin commands
      if (text.startsWith("#")) {
        const cmd = text.split(" ")[0].slice(1).toLowerCase();
        if (plugins.has(cmd)) {
          await plugins.get(cmd)(sock, msg);
        }
      }
    });

    // 🗑️ Anti-Delete
    if (process.env.ANTIDELETE === "on") {
      sock.ev.on("messages.delete", async ({ keys }) => {
        for (const key of keys) {
          if (!key.fromMe) {
            const jid = key.remoteJid;
            const participant = key.participant || jid;
            await sock.sendMessage(jid, {
              text: `🗑️ *Someone deleted a message!*\n👤 ${participant}`,
              mentions: [participant],
            });
          }
        }
      });
    }

    sock.ev.on("creds.update", saveCreds);
  });

  socket.on("disconnect", () => {
    console.log("❌ Socket disconnected:", socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`🚀 OMMY CYBER BOT running at: http://localhost:${PORT}`);
});
