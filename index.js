const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason } = require("@whiskeysockets/baileys");
const express = require("express");
const QRCode = require("qrcode");
const P = require("pino");
const fs = require("fs");
const path = require("path");
const config = require("./config");

const app = express();
let qrImage = "";
let isConnected = false;
const PORT = process.env.PORT || 3000;

// ===== PLUGIN LOADER =====
const plugins = new Map();
const pluginPath = path.join(__dirname, "plugins");

fs.readdirSync(pluginPath).forEach(file => {
    if (!file.endsWith(".js")) return;
    const plugin = require(path.join(pluginPath, file));
    plugins.set(plugin.name.toLowerCase(), plugin);
    console.log(`Loaded plugin: ${plugin.name}`);
});
console.log(`Total plugins loaded: ${plugins.size}`);
// ===== END PLUGIN LOADER =====

app.get("/", (req, res) => {
    if (isConnected) {
        return res.send(`
        <center>
            <h1>✅ ${config.BOT_NAME} Online</h1>
            <p>Bot is connected to WhatsApp</p>
        </center>
        `);
    }
    if (!qrImage) {
        return res.send(`
        <center>
            <h1>⏳ Waiting for QR...</h1>
            <p>Refresh in 5 seconds</p>
        </center>
        `);
    }
    res.send(`
    <center>
        <h1>Scan QR for ${config.BOT_NAME}</h1>
        <img src="${qrImage}" width="300"/>
        <p>WhatsApp > Settings > Linked Devices > Link a Device</p>
    </center>
    `);
});

app.listen(PORT, () => console.log(`${config.BOT_NAME} Web Server on ${PORT}`));

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState("./session");
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        logger: P({ level: "silent" }),
        printQRInTerminal: false // Web QR only for Render
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async ({ connection, qr, lastDisconnect }) => {
        if (qr) {
            qrImage = await QRCode.toDataURL(qr);
            console.log("New QR generated");
        }
        if (connection === "open") {
            isConnected = true;
            qrImage = "";
            console.log(`${config.BOT_NAME} Connected ✅`);
        }
        if (connection === "close") {
            isConnected = false;
            qrImage = "";
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode!== DisconnectReason.loggedOut;
            console.log("Connection closed, reconnecting:", shouldReconnect);
            if (shouldReconnect) startBot();
        }
    });

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
        if (type!== "notify") return; // only new messages
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const sender = msg.key.participant || msg.key.remoteJid;
        const isGroup = from.endsWith("@g.us");

        // ===== FIXED: Catch all text types =====
        const messageType = Object.keys(msg.message)[0];
        const body = msg.message.conversation
                   || msg.message.extendedTextMessage?.text
                   || msg.message.imageMessage?.caption
                   || msg.message.videoMessage?.caption
                   || "";

        if (!body) return; // ignore stickers, audio, etc with no caption
        if (!body.startsWith(config.PREFIX)) return;
        // ===== END FIX =====

        const args = body.slice(config.PREFIX.length).trim().split(/ +/);
        const command = args.shift().toLowerCase();

        const plugin = plugins.get(command);
        if (!plugin) return;

        try {
            await plugin.execute({ sock, msg, from, sender, isGroup, body, args, config, plugins });
        } catch (err) {
            console.error(err);
            await sock.sendMessage(from, { text: "❌ Error executing command." });
        }
    });
}

startBot();
