const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs-extra");
const path = require("path");
const qrcode = require("qrcode");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  jidDecode
} = require("@whiskeysockets/baileys");

require("dotenv").config();

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

io.on("connection", (socket) => {
  console.log("✅ User connected:", socket.id);

  socket.on("startPairing", async ({ number, method }) => {
    if (!number || !/^\d{9,15}$/.test(number)) {
      socket.emit("error", "❌ Invalid number. Use format like 2557XXXXXXXX");
      return;
    }

    if (sessions.has(number)) {
      socket.emit("status", "🤖 Already paired.");
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

      sessions.set(number, sock);
      socket.emit("status", "🔗 Connecting to WhatsApp...");

      sock.ev.on("connection.update", async (update) => {
        const { connection, qr, pairingCode, lastDisconnect } = update;

        if (method === "qr" && qr) {
          const qrImage = await qrcode.toDataURL(qr);
          socket.emit("qr", qrImage);
          socket.emit("status", "📸 Scan the QR code from WhatsApp.");
        }

        if (method === "code" && pairingCode) {
          // 🔢 Generate random 8-digit pairing code
          const customCode = Math.floor(10000000 + Math.random() * 90000000).toString();

          socket.emit("pairCode", customCode);
          socket.emit("status", `🔐 Use this 8-digit code on WhatsApp → Link Device`);

          // 🟡 Tuma WhatsApp Message ya Pairing Code
          const jid = `${number}@s.whatsapp.net`;
          try {
            await sock.sendMessage(jid, {
              text: `🔐 Your Custom 8-Digit Pairing Code: *${customCode}*\n\nOpen WhatsApp ➜ Settings ➜ Linked Devices ➜ *Link with Code*`
            });
            console.log("📨 Sent custom pairing code to", number);
          } catch (err) {
            console.error("❌ Failed to send WhatsApp message:", err.message);
          }
        }

        if (connection === "open") {
          socket.emit("status", "✅ Connected successfully!");
          await saveCreds();

          const jid = `${number}@s.whatsapp.net`;
          const sessionId = Buffer.from(authPath).toString("base64");

          try {
            await sock.sendMessage(jid, {
              text: `✅ Your bot is now connected!\n\n📦 *Session ID:* \n\`\`\`${sessionId}\`\`\`\n\nUse this ID to deploy your bot on Render or Heroku.`
            });
            console.log("✅ Session ID sent to", number);
          } catch (err) {
            console.error("❌ Failed to send session ID:", err.message);
          }
        }

        if (connection === "close") {
          sessions.delete(number);
          let reason = "Connection closed.";
          if (lastDisconnect?.error?.output?.statusCode === 401) {
            reason = "Session expired. Please reconnect.";
          }
          socket.emit("error", "❌ " + reason);
        }
      });

      sock.ev.on("creds.update", saveCreds);
    } catch (err) {
      console.error("❌ Pairing error:", err);
      socket.emit("error", "❌ Failed to pair: " + err.message);
    }
  });

  socket.on("disconnect", () => {
    console.log("❌ Disconnected:", socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`🚀 OMMY CYBER BOT live on: http://localhost:${PORT}`);
});
