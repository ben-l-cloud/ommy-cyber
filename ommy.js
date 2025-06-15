const fs = require("fs-extra");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
} = require("@whiskeysockets/baileys");

async function startBot(phoneNumber) {
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
    shouldIgnoreJid: (jid) => false,
    getMessage: async () => ({ conversation: "🟢 Message placeholder." }),
  });

  let pairingCodeValue = null;

  sock.ev.on("connection.update", async ({ connection, pairingCode }) => {
    if (connection === "open") {
      console.log("✅ Connection open!");
      await saveCreds();
    }
    if (pairingCode) {
      console.log("🔗 Got pairingCode:", pairingCode);
      pairingCodeValue = pairingCode;
    }
  });

  // Wait for pairing code
  await new Promise((resolve, reject) => {
    let tries = 0;
    const iv = setInterval(() => {
      if (pairingCodeValue) {
        clearInterval(iv);
        return resolve();
      }
      if (++tries >= 60) {
        clearInterval(iv);
        return reject("timeout");
      }
    }, 300);
  });

  return pairingCodeValue;
}

module.exports = {
  startBot,
};
