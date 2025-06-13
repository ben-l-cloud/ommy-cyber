const { 
  default: makeWASocket, 
  useMultiFileAuthState, 
  generatePairingCode, 
  DisconnectReason, 
  fetchLatestBaileysVersion 
} = require("@whiskeysockets/baileys");
const { Boom } = require("@hapi/boom");
const express = require("express");
const qrcode = require("qrcode-terminal");
const fs = require("fs-extra");
const path = require("path");
require("dotenv").config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const AUTO_SEEN = process.env.AUTO_SEEN === "on";  // New: load auto-seen from .env

app.get("/", (req, res) => {
    res.send("✅ BEN - Whittaker Tech Pairing Bot is running!");
});

app.get("/pair", async (req, res) => {
    const phoneNumber = req.query.number; // full international e.g. 2557xxxxxxx

    if (!phoneNumber || !/^\d{10,15}$/.test(phoneNumber)) {
        return res.status(400).send("❌ Invalid or missing phone number.");
    }

    const authFolder = `./auth/${phoneNumber}`;
    fs.ensureDirSync(authFolder);

    const { state, saveCreds } = await useMultiFileAuthState(authFolder);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        syncFullHistory: false,
        connectTimeoutMs: 60_000,
        shouldIgnoreJid: jid => false,
        getMessage: async () => ({ conversation: "🟢 Message placeholder." })
    });

    sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr, pairingCode }) => {
        if (connection === "close") {
            const reason = new Boom(lastDisconnect?.error)?.output.statusCode;
            console.log(`🔴 Connection closed, reason: ${reason}`);

            if (reason === DisconnectReason.loggedOut) {
                console.log("🔴 Disconnected: Logged out.");
                // Optionally: delete auth folder to force fresh login next time
                // await fs.remove(authFolder);
            } else {
                console.log("♻️ Attempting to reconnect...");
                // reconnect logic can go here, but baileys auto reconnects by default
            }
        } else if (connection === "open") {
            console.log("✅ Connected to WhatsApp");

            await saveCreds();

            // Load session and convert to base64
            const credsPath = path.join(authFolder, "creds.json");
            const sessionData = fs.readFileSync(credsPath);
            const base64Session = Buffer.from(sessionData).toString("base64");

            const message = `🌐 *BEN - Whittaker Tech | SESSION ID yako:*\n\n\`\`\`\n${base64Session}\n\`\`\`\n🧠 Tumia hii SESSION_ID kudeply WhatsApp bot yako bila QR code.`;

            await sock.sendMessage(`${phoneNumber}@s.whatsapp.net`, { text: message });
            console.log("✅ Session ID sent to user.");
        } else if (qr) {
            console.log(`📟 QR Code received for ${phoneNumber}`);
            qrcode.generate(qr, { small: true });
        } else if (pairingCode) {
            console.log(`🔗 Pairing Code for ${phoneNumber}: ${pairingCode}`);
        }
    });

    // New: Handle new messages - mark as read if AUTO_SEEN=on
    sock.ev.on("messages.upsert", async ({ messages, type }) => {
        if (!messages || !messages[0]) return;
        const msg = messages[0];

        if (AUTO_SEEN && msg.key && !msg.key.fromMe) {
            try {
                await sock.readMessages([msg.key]);
                console.log(`👁️ Marked message as read for ${phoneNumber}`);
            } catch (e) {
                console.error("Error marking message as read:", e);
            }
        }
    });

    const code = await generatePairingCode(`${phoneNumber}@s.whatsapp.net`, sock);

    res.send(`🔗 Pairing code generated and sent to terminal for: ${phoneNumber}`);
});

// New endpoint to check if session is active
app.get("/status", (req, res) => {
    const phoneNumber = req.query.number;
    if (!phoneNumber) return res.status(400).send("Missing number param");
    const authFolder = `./auth/${phoneNumber}`;
    const credsPath = path.join(authFolder, "creds.json");
    if (fs.existsSync(credsPath)) {
        res.json({ status: "active", phoneNumber });
    } else {
        res.json({ status: "not active", phoneNumber });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 BEN - Whittaker Tech session bot running on port ${PORT}`);
    console.log(`📲 Pair with: http://localhost:${PORT}/pair?number=2557XXXXXXX`);
});
