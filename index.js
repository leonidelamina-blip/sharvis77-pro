const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys')
const pino = require('pino')

// CONFIGURAÇÃO OFICIAL
const DONO_NOME = "Leønide Antonio Lâmina"
const DONO_NUM = "258852223969"
const BOT_NUM = "258872698781"

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth')

    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: ["Sharvis V7", "Chrome", "1.0"]
    })

    // GERA CÓDIGO DE PAREAMENTO
    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(BOT_NUM)
                console.log(`\n======================\n🤖 BOT: ${BOT_NUM}\n👑 DONO: ${DONO_NOME} - ${DONO_NUM}\n🔑 CÓDIGO: ${code}\n======================\nNo WhatsApp do BOT (${BOT_NUM}) vá em:\nAparelhos conectados > Conectar com número de telefone\nDigite: ${code}\n======================\n`)
            } catch (e) {
                console.log("Erro ao gerar código: ", e)
            }
        }, 3000)
    }

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update
        if (connection === 'open') {
            console.log(`✅ BOT ${BOT_NUM} ONLINE! Dono: ${DONO_NOME}`)
        }
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode!== DisconnectReason.loggedOut
            if (shouldReconnect) startBot()
        }
    })

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0]
        if (!m.message || m.key.fromMe) return
        const from = m.key.remoteJid
        const body = m.message.conversation || m.message.extendedTextMessage?.text || ""
        if (!body.startsWith('.')) return

        const cmd = body.slice(1).toLowerCase().split(' ')[0]

        if (cmd === 'dono' || cmd === 'criador') {
            await sock.sendMessage(from, { text: `👑 *DONO OFICIAL*\n\n👤 Nome: ${DONO_NOME}\n📱 Número: +${DONO_NUM}\n🔗 wa.me/${DONO_NUM}\n\n🤖 Bot: +${BOT_NUM}` }, { quoted: m })
        }
        if (cmd === 'menu') {
            await sock.sendMessage(from, { text: `╭─ *SHARVIS V7 PRO* ─╮\n│ 👑 ${DONO_NOME}\n│ 🤖 +${BOT_NUM}\n╰──────────────╯\n\n.dono - Ver dono\n.menu - Ver menu\n.ping - Bot online?` }, { quoted: m })
        }
        if (cmd === 'ping') {
            await sock.sendMessage(from, { text: `🏓 Online! Bot do ${DONO_NOME} pronto!` }, { quoted: m })
        }
    })
}

startBot()
