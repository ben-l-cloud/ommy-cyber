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
  makeInMemoryStore,
  useSingleFileAuthState,
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

// Session map
const sessions = new Map();

io.on("connection", (socket) => {
  console.log("👤 Client connected:", socket.id);

  socket.on("startPairing", async ({ number, method }) => {
    if (!number || !/^\d{9,15}$/.test(number)) {
      socket.emit("error", "Invalid phone number format.");
      return;
    }

    if (sessions.has(number)) {
      socket.emit("status", "📱 Already connected.");
      return;
    }

    try {
      const authFolder = path.resolve(`./auth/${number}`);
      await fs.ensureDir(authFolder);
      const { state, saveCreds } = await useMultiFileAuthState(authFolder);
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
        const { connection, qr, lastDisconnect, pairingCode } = update;

        if (method === "qr" && qr) {
          const qrImage = await qrcode.toDataURL(qr);
          socket.emit("qr", qrImage);
          socket.emit("status", "📸 Scan the QR code using your WhatsApp.");
        }

        if (method === "code" && pairingCode) {
          socket.emit("pairCode", pairingCode);
          socket.emit("status", "🔐 Enter this code in WhatsApp → Link Device.");
        }

        if (connection === "open") {
          socket.emit("status", "✅ Connected successfully!");
          await saveCreds();
        }

        if (connection === "close") {
          let reason = "Connection closed.";
          if (lastDisconnect?.error?.output?.statusCode === 401) {
            reason = "Session expired or logged out.";
          }
          socket.emit("error", reason);
          sessions.delete(number);
        }
      });

      sock.ev.on("creds.update", saveCreds);
    } catch (err) {
      socket.emit("error", `Failed: ${err.message}`);
    }
  });

  socket.on("disconnect", () => {
    console.log("👤 Disconnected:", socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`🚀 BEN - Whittaker Tech Bot running at: http://localhost:${PORT}`);
});
