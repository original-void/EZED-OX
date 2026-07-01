module.exports = {
    name: "menu",
    desc: "Show all commands",
    execute: async ({ sock, from, config, plugins }) => {
        let text = `*${config.BOT_NAME} Menu*\n\n`;
        plugins.forEach(p => {
            text += `${config.PREFIX}${p.name} - ${p.desc}\n`;
        });
        await sock.sendMessage(from, { text });
    }
}
