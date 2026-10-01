const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys')
const express = require('express')
const pino = require('pino')

const app = express()
app.get('/', (req,res) => res.send('SHARVIS 77 PRO 872698781 ONLINE'))
app.listen(3000, () => console.log('Web ON'))

const PHONE = "258872698781"

async function start(){
  const { state, saveCreds } = await useMultiFileAuthState('session')
  const sock = makeWASocket({ auth: state, logger: pino({level:'silent'}), printQRInTerminal:false, browser:['SHARVIS 77','Chrome','1.0'] })
  sock.ev.on('creds.update', saveCreds)
  if(!sock.authState.creds.registered){
    setTimeout(async()=>{
      try{
        const code = await sock.requestPairingCode(PHONE)
        console.log(`\n\n==== CODIGO SHARVIS 77: ${code} ====\n\n`)
      }catch(e){ console.log(e) }
    },3000)
  }
  sock.ev.on('connection.update', u=>{ if(u.connection==='open') console.log('✅ CONECTADO 872698781') })
  sock.ev.on('messages.upsert', async ({messages})=>{
    const msg=messages[0]
    if(!msg.message) return
    const from=msg.key.remoteJid
    const txt=msg.message.conversation||msg.message.extendedTextMessage?.text||""
    if(txt.toLowerCase()===".menu") await sock.sendMessage(from,{text:"🤖 *SHARVIS 77 PRO*\n\nNúmero: 872698781\n\n✅ Bot Profissional para Aluguel\n\n.menu - menu\n.ping - teste"})
    if(txt.toLowerCase()===".ping") await sock.sendMessage(from,{text:"Pong! 872698781 ON ✅"})
  })
}
start()
