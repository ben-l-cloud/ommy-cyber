require("dotenv").config();
const express = require("express");
const fs = require("fs-extra");
const path = require("path");
const bot = require("./ommy");

const app = express();
app.use(express.json());
app.use(express.static("public"));

const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send("✅ BEN - Whittaker Tech Pairing Bot is running!");
});

app.get("/pair", async (req, res) => {
  const phoneNumber = req.query.number;
  console.log("➡️ Request /pair na namba:", phoneNumber);

  if (!phoneNumber || !/^\d{10,15}$/.test(phoneNumber)) {
    return res.status(400).json({ success: false, error: "Namba si sahihi." });
  }

  try {
    const pairingCode = await bot.startBot(phoneNumber);
    res.json({
      success: true,
      phoneNumber,
      pairingCode,
    });
  } catch (err) {
    console.error("❌ Pairing failed:", err);
    res.status(500).json({
      success: false,
      error: `Pairing failed: ${err}`,
    });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
