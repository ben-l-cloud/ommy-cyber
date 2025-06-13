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
const AUTO_SEEN = process.env.AUTO_SEEN === "on";

app.get("/", (req, res) => {
    res.send("✅ BEN - Whittaker Tech Pairing Bot is running!");
});

app.get("/pair", async (req, res) => {
    const phoneNumber = req.query.number;

    if (!phoneNumber || !/^\d{10,15}$/.test(phoneNumber)) {
        return res.status(400).send("❌ Invalid or missing phone number.");
    }

    const authFolder = `./auth/${phoneNumber}`;
    fs.ensureDirSync(authFolder);

    // If SESSION_ID_BASE64 is set in .env, decode and save creds.json
    if (process.env.SESSION_ID_BASE64) {
        const credsPath = path.join(authFolder, "creds.json");
        try {
            const sessionJSON = Buffer.from(process.env.SESSION_ID_BASE64, "base64").toString("utf-8");
            fs.writeFileSync(credsPath, sessionJSON);
            console.log(`✅ Loaded session creds.json from env for ${phoneNumber}`);
        } catch (e) {
            console.error("❌ Failed to decode SESSION_ID_BASE64 from env:", e);
        }
    }

    const { state, saveCreds } = await useMultiFileAuthState(authFolder);
    const { version } = await fetchLatestBaileysVersion();

    // Load plugins dynamically from plugins folder
    const pluginsFolder = path.resolve(__dirname, "plugins");
    let plugins = {};
    if (fs.existsSync(pluginsFolder)) {
        const files = fs.readdirSync(pluginsFolder).filter(f => f.endsWith(".js"));
        for (const file of files) {
            try {
                plugins[file] = require(path.join(pluginsFolder, file));
                console.log(`✅ Loaded plugin: ${file}`);
            } catch (e) {
                console.error(`❌ Failed to load plugin ${file}:`, e);
            }
        }
    }

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
                // await fs.remove(authFolder);
            } else {
                console.log("♻️ Attempting to reconnect...");
            }
        } else if (connection === "open") {
            console.log("✅ Connected to WhatsApp");

            await saveCreds();

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

    // Example: run all loaded plugins on incoming messages (you can customize this!)
    sock.ev.on("messages.upsert", async ({ messages }) => {
        if (!messages || !messages[0]) return;
        const msg = messages[0];

        for (const pluginName in plugins) {
            try {
                if (typeof plugins[pluginName] === "function") {
                    await plugins[pluginName](sock, msg);
                }
            } catch (e) {
                console.error(`❌ Plugin ${pluginName} error:`, e);
            }
        }
    });

    const code = await generatePairingCode(`${phoneNumber}@s.whatsapp.net`, sock);

    res.send(`🔗 Pairing code generated and sent to terminal for: ${phoneNumber}`);
});

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
