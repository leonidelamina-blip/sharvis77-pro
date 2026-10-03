const { default: makeWASocket, useMultiFileAuthState, delay } = require('@whiskeysockets/baileys')
const express = require('express')
const P = require('pino')
const app = express()
app.get('/', (req,res)=> res.send('SHARVIS 77 PRO ON'))
app.listen(10000, ()=> console.log('Web ON'))

const PHONE = '258872608781'

async function start(){
  const { state, saveCreds } = await useMultiFileAuthState('session')
  const sock = makeWASocket({ auth: state, logger: P({level:'silent'}), printQRInTerminal:false, browser:['Sharvis77 Pro','Chrome','1.0'] })
  sock.ev.on('creds.update', saveCreds)
  if(!sock.authState.creds.registered){
    await delay(8000)
    try{
      const code = await sock.requestPairingCode(PHONE)
      console.log(`\n\n****** CODIGO SHARVIS 77: ${code} ******\n\n`)
    }catch(e){ console.log('Erro, reiniciando...', e.message); await delay(5000); start() }
  }
  sock.ev.on('connection.update', u=>{
    if(u.connection==='open') console.log('✅ CONECTADO 872608781!')
  })
  sock.ev.on('messages.upsert', async ({messages})=>{
    const msg=messages[0]; if(!msg.message) return
    const from=msg.key.remoteJid
    const text=msg.message.conversation || msg.message.extendedTextMessage?.text || ''
    if(text.toLowerCase()==='menu') await sock.sendMessage(from,{text:'*SHARVIS 77 PRO*\nNúmero: 872608781\nBot Profissional para Aluguel\nmenu - menu\nping - teste'})
    if(text.toLowerCase()==='ping') await sock.sendMessage(from,{text:'Pong! 872608781 ON ✅'})
  })
}
start()
