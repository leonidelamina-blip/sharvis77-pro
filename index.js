const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys')
const P = require('pino')

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('./auth')
    const { version } = await fetchLatestBaileysVersion()

    const sock = makeWASocket({
        version,
        auth: state,
        logger: P({ level: 'silent' }),
        printQRInTerminal: false,
        browser: ['Sharvis V7', 'Chrome', '1.0']
    })

    sock.ev.on('creds.update', saveCreds)

    if (!sock.authState.creds.registered) {
        console.log('⏳ Aguardando 10 segundos...')
        await new Promise(r => setTimeout(r, 10000))
        try {
            const numero = '258872698781'
            let code = await sock.requestPairingCode(numero)
            console.log('========================================')
            console.log(`BOT: Leonildo Antonio Lemina - ${numero}`)
            console.log(`CODIGO: ${code}`)
            console.log('No WhatsApp do BOT (87 269 87 81) vai em:')
            console.log('Aparelhos conectados > Conectar com numero de telefone')
            console.log('========================================')
        } catch (e) {
            console.log('Erro ao gerar codigo:', e.message)
        }
    }

    sock.ev.on('connection.update', (up) => {
        const { connection } = up
        if (connection === 'open') console.log('✅ BOT CONECTADO!')
        if (connection === 'close') {
            console.log('Conexão fechada, reconectando...')
            setTimeout(startBot, 5000)
        }
    })

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0]
        if (!m.message || m.key.fromMe) return
        const texto = m.message.conversation || m.message.extendedTextMessage?.text || ''
        if (texto.toLowerCase() === 'ping') {
            await sock.sendMessage(m.key.remoteJid, { text: 'Pong! Sharvis V7 online 👑' })
        }
    })
}

startBot()
