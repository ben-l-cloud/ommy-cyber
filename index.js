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
} = require("@whiskeysockets/baileys");
require("dotenv").config();

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

app.use(express.static("public"));
app.get("/", (_, res) => res.sendFile(path.join(__dirname, "index.html")));

const sessions = new Map();

io.on("connection", (socket) => {
  console.log("🟢 Client connected:", socket.id);

  socket.on("startPairing", async ({ number, method }) => {
    if (!number || !/^\d{9,15}$/.test(number)) {
      return socket.emit("error", "Invalid phone number.");
    }

    if (sessions.has(number)) {
      return socket.emit("status", "⚠️ Already connected.");
    }

    try {
      const authFolder = path.join(__dirname, "auth", number);
      await fs.ensureDir(authFolder);
      const { state, saveCreds } = await useMultiFileAuthState(authFolder);
      const { version } = await fetchLatestBaileysVersion();

      const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        getMessage: async () => ({ conversation: "✅ Paired successfully!" }),
      });

      sessions.set(number, sock);
      socket.emit("status", "🔄 Connecting to WhatsApp...");

      sock.ev.on("connection.update", async (update) => {
        const { connection, qr, pairingCode, lastDisconnect } = update;

        if (method === "qr" && qr) {
          const qrImg = await qrcode.toDataURL(qr);
          socket.emit("qr", qrImg);
          socket.emit("status", "📱 Scan the QR Code with WhatsApp.");
        }

        if (method === "code" && pairingCode) {
          socket.emit("pairCode", pairingCode);
          socket.emit("status", `🔐 Pairing Code: ${pairingCode}`);
        }

        if (connection === "open") {
          await saveCreds();
          socket.emit("status", "✅ Connected!");

          const userJid = sock.user.id;
          const sessionInfo = `🗂 Your session is saved under: /auth/${number}`;
          await sock.sendMessage(userJid, { text: `✅ Hello! Your bot is connected.\n\n${sessionInfo}` });
        }

        if (connection === "close") {
          sessions.delete(number);
          let reason = "Connection closed.";
          if (lastDisconnect?.error?.output?.statusCode === 401) {
            reason = "Session expired.";
          }
          socket.emit("error", reason);
        }
      });

      sock.ev.on("creds.update", saveCreds);
    } catch (e) {
      socket.emit("error", "Error: " + e.message);
    }
  });

  socket.on("disconnect", () => {
    console.log("🔴 Client disconnected:", socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`✅ Server running at: http://localhost:${PORT}`);
});
