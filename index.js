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
      return socket.emit("error", "📛 Invalid phone number.");
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
      socket.emit("status", "⏳ Connecting to WhatsApp...");

      sock.ev.on("connection.update", async (update) => {
        const { connection, qr, pairingCode, lastDisconnect } = update;

        if (method === "qr" && qr) {
          const qrImage = await qrcode.toDataURL(qr);
          socket.emit("qr", qrImage);
          socket.emit("status", "📸 Scan the QR code with WhatsApp.");
        }

        if (method === "code" && pairingCode) {
          socket.emit("pairCode", pairingCode);
          socket.emit("status", `🔐 Enter this Pairing Code in WhatsApp: ${pairingCode}`);
        }

        if (connection === "open") {
          await saveCreds();
          socket.emit("status", "✅ Connected!");

          const jid = sock.user.id;

          // Send session files to the user via WhatsApp
          const files = await fs.readdir(authFolder);
          for (const file of files) {
            if (file.endsWith(".json")) {
              const content = await fs.readFile(path.join(authFolder, file));
              await sock.sendMessage(jid, {
                document: content,
                mimetype: "application/json",
                fileName: file,
                caption: "📦 Your WhatsApp Bot Session ID. Use this to deploy your bot.",
              });
            }
          }

          // Optional: notify user done
          await sock.sendMessage(jid, {
            text: "✅ Your session has been saved successfully. You can now deploy your bot. 💡",
          });
        }

        if (connection === "close") {
          sessions.delete(number);
          let reason = "❌ Disconnected.";
          if (lastDisconnect?.error?.output?.statusCode === 401) {
            reason = "🚫 Session expired or invalid login.";
          }
          socket.emit("error", reason);
        }
      });

      sock.ev.on("creds.update", saveCreds);
    } catch (err) {
      socket.emit("error", `❌ Failed: ${err.message}`);
    }
  });

  socket.on("disconnect", () => {
    console.log("🔴 Client disconnected:", socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`🚀 BEN - Whittaker Tech Bot is live at http://localhost:${PORT}`);
});
