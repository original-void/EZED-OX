module.exports = {
    name: "ping",
    desc: "Check if bot is alive",
    execute: async ({ sock, from }) => {
        await sock.sendMessage(from, { text: "🏓 pong from EZED OX" });
    }
}
