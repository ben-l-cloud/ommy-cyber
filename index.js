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

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("public"));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Map ya kufuatilia sessions (number -> sock instance)
const sessions = new Map();

io.on("connection", (socket) => {
  console.log("👤 Client connected:", socket.id);

  socket.on("startPairing", async (phoneNumber) => {
    if (!phoneNumber || !/^\d{9,15}$/.test(phoneNumber)) {
      socket.emit("pairingError", "Namba si sahihi. Ingiza namba yenye digits 9-15.");
      return;
    }

    if (sessions.has(phoneNumber)) {
      // Ikiwa session iko tayari, sema pairing imeshafanyika
      socket.emit("pairingStatus", "Umeweza kuunganisha tayari.");
      return;
    }

    try {
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

      sessions.set(phoneNumber, sock);

      // Timeout pairing code 1 min
      const timeout = setTimeout(() => {
        socket.emit("pairingError", "⏰ Timeout: Pairing code haikupatikana ndani ya dakika 1.");
        sock.ws.close();
        sessions.delete(phoneNumber);
      }, 60000);

      sock.ev.on("connection.update", async (update) => {
        const { connection, qr, lastDisconnect } = update;

        if (qr) {
          clearTimeout(timeout);
          const qrDataUrl = await qrcode.toDataURL(qr);
          socket.emit("qr", qrDataUrl);
          socket.emit("pairingStatus", "Tafadhali scan QR code kwa WhatsApp yako.");
        }

        if (connection === "open") {
          clearTimeout(timeout);
          socket.emit("pairingStatus", "✅ WhatsApp imeunganishwa!");

          await saveCreds();

          // Optionally send session files or do other logic here

          // session complete, we can keep socket or close connection based on your need
        }

        if (connection === "close") {
          clearTimeout(timeout);

          let reason = "Pairing imekatika kwa sababu isiyojulikana.";
          if (lastDisconnect?.error?.output?.statusCode === 401) {
            reason = "❌ Session imeisha au namba si sahihi.";
          }

          socket.emit("pairingError", reason);
          sessions.delete(phoneNumber);
        }
      });

      sock.ev.on("creds.update", saveCreds);
    } catch (err) {
      socket.emit("pairingError", `Error: ${err.message}`);
    }
  });

  socket.on("disconnect", () => {
    console.log("👤 Client disconnected:", socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`🚀 BEN - Whittaker Tech Bot is running on http://localhost:${PORT}`);
});
