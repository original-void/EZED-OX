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

const plugins = new Map();
const pluginPath = path.join(__dirname, "plugins");
fs.readdirSync(pluginPath).forEach(file => {
    if (!file.endsWith(".js")) return;
    const plugin = require(path.join(pluginPath, file));
    plugins.set(plugin.name.toLowerCase(), plugin);
    console.log(`Loaded plugin: ${plugin.name}`);
});
console.log(`Total plugins loaded: ${plugins.size}`);

app.get("/", (req, res) => {
    if (isConnected) {
        return res.send(`<center><h1>✅ ${config.BOT_NAME} Online</h1></center>`);
    }
    if (!qrImage) {
        return res.send(`<center><h1>⏳ Generating QR...</h1><p>Refresh this page</p></center>`);
    }
    res.send(`<center><h1>Scan QR for ${config.BOT_NAME}</h1><img src="${qrImage}" width="300"/></center>`);
});
app.listen(PORT, () => console.log(`${config.BOT_NAME} Web Server on ${PORT}`));

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState("./session");
    const { version } = await fetchLatestBaileysVersion();
    console.log(`Using WA v${version.join('.')}`);

    const sock = makeWASocket({
        version,
        auth: state,
        logger: P({ level: "info" }), // Changed to info so we see QR errors
        printQRInTerminal: false,
        browser: [config.BOT_NAME, "Chrome", "1.0.0"] // Helps avoid ban/no-QR
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async ({ connection, qr, lastDisconnect }) => {
        if (qr) {
            qrImage = await QRCode.toDataURL(qr);
            console.log("New QR generated -> Open Render URL to scan");
        }
        if (connection === "open") {
            isConnected = true;
            qrImage = "";
            console.log(`${config.BOT_NAME} Connected ✅`);
        }
        if (connection === "close") {
            isConnected = false;
            qrImage = "";
            const code = lastDisconnect?.error?.output?.statusCode;
            console.log("Connection closed. Code:", code);
            if (code!== DisconnectReason.loggedOut) {
                setTimeout(() => startBot(), 3000); // retry after 3s
            } else {
                console.log("Logged out. Delete./session folder to get new QR.");
            }
        }
    });

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
        if (type!== "notify") return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const sender = msg.key.participant || msg.key.remoteJid;
        const isGroup = from.endsWith("@g.us");

        const body = msg.message.conversation
                   || msg.message.extendedTextMessage?.text
                   || msg.message.imageMessage?.caption
                   || msg.message.videoMessage?.caption
                   || "";
        if (!body ||!body.startsWith(config.PREFIX)) return;

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
