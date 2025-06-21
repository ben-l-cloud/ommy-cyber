module.exports = {
  name: "ping",
  execute: async (sock, m) => {
    const start = new Date().getTime();
    await sock.sendMessage(m.key.remoteJid, { text: "📡 *Pinging BEN WHITTAKER TECH BOT...*" }, { quoted: m });
    const end = new Date().getTime();
    const ping = end - start;

    const uptime = runtime(process.uptime());

    const msg = `
╭─〔 🤖 *BEN WHITTAKER TECH BOT* 〕─╮
│ 🟢 *Status:* Online
│ ⚡ *Speed:* ${ping}ms
│ 👑 *Owner:* wa.me/255760317060
│ 🕒 *Uptime:* ${uptime}
│ 🚀 *Hosted on:* ${process.env.HOST || 'Localhost'}
╰───────⧫⧫⧫───────╯

📌 _Type_ *#menu* _to explore 200+ features!_
`;

    await sock.sendMessage(m.key.remoteJid, { text: msg }, { quoted: m });
  }
};

function runtime(seconds) {
  seconds = Number(seconds);
  const d = Math.floor(seconds / (3600 * 24));
  const h = Math.floor((seconds % (3600 * 24)) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${d}d ${h}h ${m}m ${s}s`;
}
