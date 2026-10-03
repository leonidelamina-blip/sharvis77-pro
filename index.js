const { default: makeWASocket, useMultiFileAuthState, delay, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys')
const express = require('express')
const P = require('pino')
const app = express()
app.get('/', (req,res)=> res.send('SHARVIS 77 PRO ON 872608781'))
app.listen(10000, ()=> console.log('Web ON 10000'))

const PHONE = '258872608781'

async function start(){
  const { version } = await fetchLatestBaileysVersion()
  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys')

  const sock = makeWASocket({
    version,
    auth: state,
    logger: P({level:'silent'}),
    printQRInTerminal:false,
    browser:['Ubuntu','Chrome','20.0.04'],
    syncFullHistory: false
  })

  sock.ev.on('creds.update', saveCreds)

  if(!sock.authState.creds.registered){
    await delay(10000)
    console.log('Solicitando codigo para', PHONE)
    try{
      let code = await sock.requestPairingCode(PHONE)
      console.log(`\n\n====== CODIGO: ${code} ======\nColoque no WhatsApp agora!\n\n`)
    }catch(e){
      console.log('Falha pairing:', e.message)
    }
  }

  sock.ev.on('connection.update', async (u)=>{
    const { connection } = u
    if(connection === 'open'){
      console.log('✅ CONECTADO 872608781 COM SUCESSO!')
    }
    if(connection === 'close'){
      console.log('Conexao fechou, reiniciando em 5s...')
      await delay(5000)
      start()
    }
  })

  sock.ev.on('messages.upsert', async ({messages})=>{
    const msg = messages[0]
    if(!msg.message || msg.key.fromMe) return
    const from = msg.key.remoteJid
    const text = msg.message.conversation || msg.message.extendedTextMessage?.text || ''
    if(text.toLowerCase() === 'menu'){
      await sock.sendMessage(from,{text:'*SHARVIS 77 PRO* 🚀\nNumero: 872608781\n\nComandos:\n• menu - este menu\n• ping - teste\n• dono - meu contacto'})
    }
    if(text.toLowerCase() === 'ping'){
      await sock.sendMessage(from,{text:'Pong! ✅ 872608781 ON'})
    }
  })
}
start()
