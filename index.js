const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys')
const express = require('express')
const fs = require('fs')
const pino = require('pino')
const app = express()
const PORT = process.env.PORT || 10000

const PHONE = '258872698781'
let codeGenerated = false

app.get("/", (req, res) => res.send(`SHARVIS 77 PRO ON ${PHONE} - ONLINE`))

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys')
    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: ["Ubuntu", "Chrome", "20.0.04"]
    })

    if (!sock.authState.creds.registered && !codeGenerated) {
        codeGenerated = true
        await new Promise(r => setTimeout(r, 5000))
        try {
            const code = await sock.requestPairingCode(PHONE)
            console.log(`\n====== CODIGO UNICO: ${code} ======\n`)
            console.log(`DIGITA ESSE CODIGO NO WHATSAPP DO ${PHONE} AGORA!`)
        } catch (e) {
            console.log("Erro:", e.message)
            codeGenerated = false
        }
    }

    sock.ev.on('creds.update', saveCreds)
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut
            if (shouldReconnect) {
                console.log('Reconectando...')
                setTimeout(startBot, 5000)
            }
        } else if (connection === 'open') {
            console.log('BOT CONECTADO COM SUCESSO NO ' + PHONE)
        }
    })
}

startBot()
app.listen(PORT, () => console.log(`Web ON ${PORT}`))
