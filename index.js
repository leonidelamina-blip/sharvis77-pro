const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys')
const express = require('express')
const fs = require('fs')
const pino = require('pino')
const app = express()
const PORT = process.env.PORT || 10000

const PHONE = '258872698781'

if (fs.existsSync('./auth_info_baileys')) {
    fs.rmSync('./auth_info_baileys', { recursive: true, force: true })
    console.log('SESSAO ANTIGA APAGADA - GERANDO NOVA PARA ' + PHONE)
}

app.get("/", (req, res) => res.send(`SHARVIS 77 PRO ON ${PHONE} - ONLINE`))

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys')
    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: ["Ubuntu", "Chrome", "20.0.04"]
    })

    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(PHONE)
                console.log(`\n====== CODIGO UNICO: ${code} ======\n`)
            } catch (e) {
                console.log("Erro ao gerar:", e.message)
            }
        }, 8000)
    }

    sock.ev.on('creds.update', saveCreds)
    sock.ev.on('connection.update', (u) => {
        if (u.connection === 'open') console.log('CONECTADO COM SUCESSO NO ' + PHONE)
        if (u.connection === 'close') {
            console.log('Conexao fechada, tentando de novo...')
            setTimeout(startBot, 5000)
        }
    })
}

startBot()
app.listen(PORT, () => console.log(`Web ON ${PORT}`))
