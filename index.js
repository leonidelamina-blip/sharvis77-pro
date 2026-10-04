const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys')
const pino = require('pino')

const DONO_NOME = "Leønide Antonio Lâmina"
const DONO_NUM = "258852223969"
const NUM_PAREAMENTO = "258852223969" // TEU NÚMERO SEM O +

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth')
    const sock = makeWASocket({ auth: state, logger: pino({ level: 'silent' }), printQRInTerminal: false, browser: ["Sharvis V7", "Chrome", "1.0"] })

    if(!sock.authState.creds.registered) {
        setTimeout(async () => {
            let code = await sock.requestPairingCode(NUM_PAREAMENTO)
            console.log(`\n👑 TEU CÓDIGO DE PAREAMENTO: ${code}\nVai no WhatsApp > Aparelhos conectados > Conectar com número de telefone > Digita ${code}\n`)
        }, 3000)
    }

    sock.ev.on('creds.update', saveCreds)
    sock.ev.on('connection.update', (update) => {
        const { connection } = update
        if(connection === 'open') console.log(`👑 BOT DO ${DONO_NOME} ONLINE!`)
        if(connection === 'close') startBot()
    })

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0]
        if(!m.message || m.key.fromMe) return
        const from = m.key.remoteJid
        const body = m.message.conversation || m.message.extendedTextMessage?.text || ""
        if(!body.startsWith('.')) return
        const cmd = body.slice(1).toLowerCase().split(' ')[0]

        if(['dono','criador'].includes(cmd)) {
            await sock.sendMessage(from, { text: `👑 DONO: ${DONO_NOME}\n📱 +${DONO_NUM}\nwa.me/${DONO_NUM}` }, { quoted: m })
        }
        if(cmd === 'menu') {
            await sock.sendMessage(from, { text: `╭─ SHARVIS REAL V7 ─\n│ 👑 Dono: ${DONO_NOME}\n╰───\n.dono .menu .ping .todos .abrir .fechar .alugar` }, { quoted: m })
        }
        if(cmd === 'ping') {
            await sock.sendMessage(from, { text: `🏓 Online! Bot do ${DONO_NOME}` }, { quoted: m })
        }
    })
}
startBot()
