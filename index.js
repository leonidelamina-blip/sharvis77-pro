const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys')
const express = require('express')
const fs = require('fs')
const pino = require('pino')
const app = express()
const PORT = process.env.PORT || 10000

const PHONE = '258872698781'

if (fs.existsSync('./auth_info_baileys')) {
    fs.rmSync('./auth_info_baileys', { recursive: true, force: true })
    console.log('Sessao antiga apagada!')
}

app.get("/", (req, res) => res.send(`SHARVIS 77 PRO ON ${PHONE} - ONLINE`))

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys')
    
    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: ["Chrome", "Chrome", "1.0"]
    })

    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(PHONE)
                console.log(`\n====== SEU CODIGO: ${code} ======\n`)
            } catch (e) {
                console.log("Erro ao gerar codigo:", e.message)
            }
        }, 3000)
    }

    sock.ev.on('creds.update', saveCreds)
    
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut
            if (shouldReconnect) startBot()
        } else if (connection === 'open') {
            console.log('BOT CONECTADO COM SUCESSO!')
        }
    })

    sock.ev.on('messages.upsert', async () => {})
}

startBot()
app.listen(PORT, () => console.log(`Web ON ${PORT}`))
