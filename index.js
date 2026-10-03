const { default: makeWASocket, useMultiFileAuthState, delay, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys')
const express = require('express')
const P = require('pino')
const fs = require('fs')
const app = express()
app.get('/', (req,res)=> res.send('SHARVIS 77 PRO ON 872608781 - ONLINE'))
app.listen(10000, ()=> console.log('Web ON 10000'))
const PHONE = '258872608781'
if(fs.existsSync('auth_info_baileys')){fs.rmSync('auth_info_baileys',{recursive:true,force:true});console.log('Sessao apagada!')}
async function start(){
const { version } = await fetchLatestBaileysVersion()
const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys')
const sock = makeWASocket({version,auth:state,logger:P({level:'silent'}),printQRInTerminal:false,browser:['Ubuntu','Chrome','20.0.04']})
sock.ev.on('creds.update', saveCreds)
if(!sock.authState.creds.registered){await delay(8000);try{let code = await sock.requestPairingCode(PHONE);console.log(`\n\n====== SEU CODIGO: ${code} ======\n\n`)}catch(e){console.log('Erro:',e.message)}}
sock.ev.on('connection.update', async (u)=>{if(u.connection==='open')console.log('CONECTADO 872608781!');if(u.connection==='close'){await delay(10000);start()}})
sock.ev.on('messages.upsert', async ({messages})=>{const msg=messages[0];if(!msg.message||msg.key.fromMe)return;const from=msg.key.remoteJid;const text=msg.message.conversation||msg.message.extendedTextMessage?.text||'';if(text.toLowerCase()==='menu'){await sock.sendMessage(from,{text:'*SHARVIS 77 PRO* 872608781 ON\n\nmenu\nping\ndono'})}if(text.toLowerCase()==='ping'){await sock.sendMessage(from,{text:'Pong!'})}})}
start()
