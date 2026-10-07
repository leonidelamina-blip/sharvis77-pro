'use strict';
/**
 * SHARVIS 8.0 ALUGAVEL - Bot de WhatsApp para aluguer (Moçambique)
 * Baileys + pareamento por código (sem QR Code).
 */
const fs = require('fs-extra');
const path = require('path');
const http = require('http');
const pino = require('pino');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
} = require('@whiskeysockets/baileys');

// 'sharp' é opcional: só é preciso para .sticker e .toimage
let sharp = null;
try { sharp = require('sharp'); } catch {}

/* ================================================================
 *  CONFIGURAÇÃO FIXA
 * ================================================================ */
const BOT_NAME = 'SHARVIS 8.0 ALUGAVEL';
const BOT_NUMBER = '258872698781';
const BOT_LOCAL = '872698781';
const OWNER_NAME = 'Leønide António Lâmina';
const OWNER_NUMBER = '258852223969';
const OWNER_LOCAL = '852223969';
const OWNER_JID = OWNER_NUMBER + '@s.whatsapp.net';
const PREFIX = '.';
const PRECO_ALUGUER = '150MT/mês';
const DIAS_ALUGUER = 30; // duração padrão do aluguer
// false = comandos de moderação (kick, ban, promover...) só para admins do grupo e dono.
// true  = qualquer membro de um grupo alugado pode usar (perigoso: um membro pode remover admins).
const QUALQUER_UM_PODE_MODERAR = false;
// Tabela de megas (edite à vontade): [pacote, GB, preço em MT]
const PRECOS = [['1GB', 1, 50], ['2GB', 2, 100], ['5GB', 5, 250], ['10GB', 10, 500]];

const DATA_DIR = process.env.DATA_DIR || __dirname;
const AUTH_DIR = path.join(DATA_DIR, 'auth_info_baileys');
const DB_DIR = path.join(DATA_DIR, 'database');
fs.ensureDirSync(AUTH_DIR);
fs.ensureDirSync(DB_DIR);

/* ================================================================
 *  BASE DE DADOS (ficheiros JSON em database/)
 * ================================================================ */
const dbs = {};
const dbTimers = {};
function loadDB(nome, padrao) {
  const f = path.join(DB_DIR, nome + '.json');
  if (!fs.existsSync(f)) fs.writeJsonSync(f, padrao, { spaces: 2 });
  try { dbs[nome] = fs.readJsonSync(f); } catch { dbs[nome] = padrao; fs.writeJsonSync(f, padrao, { spaces: 2 }); }
  return dbs[nome];
}
// Grava com um pequeno atraso para não escrever o ficheiro a cada mensagem
function save(nome) {
  clearTimeout(dbTimers[nome]);
  dbTimers[nome] = setTimeout(() => fs.writeJson(path.join(DB_DIR, nome + '.json'), dbs[nome], { spaces: 2 }).catch(() => {}), 800);
}
const alugados = loadDB('alugados', { grupos: {}, numeros: {} });
alugados.grupos ??= {}; alugados.numeros ??= {};
const grupos = loadDB('grupos', {});
const dados = loadDB('usuarios', { users: {}, pedidos: [], agendados: [], contador: 0 });
dados.users ??= {}; dados.pedidos ??= []; dados.agendados ??= []; dados.contador ??= 0;

// Configurações de cada chat (grupo ou privado)
function cfgOf(jid) {
  return (grupos[jid] ??= {
    antilink: false, anticoncorrencia: false, antiestrangeiros: false, antifoto: false, onlyadm: false,
    bemvindo: false, saida: false, autocomprovativo: false, autoresponder: false, vendaauto: true,
    autoremover: false, periodo: 7, ultimaRemocao: 0, autofechar: null,
    respostas: {}, nano: {}, mutados: [], banidos: [], atividade: {}, visto: {},
  });
}
function getUser(n, nome) {
  const u = (dados.users[n] ??= { nome: '', saldo: 0, megas: 0, desde: Date.now() });
  if (nome && nome !== u.nome) { u.nome = nome; save('usuarios'); }
  return u;
}

/* ================================================================
 *  UTILIDADES
 * ================================================================ */
const num = (j = '') => String(j).split('@')[0].split(':')[0];
const normNum = (n) => { n = String(n).replace(/\D/g, ''); return n.length === 9 ? '258' + n : n; };
const MT = (v) => Number(v).toLocaleString('pt-PT') + ' MT';
const fmtMB = (mb) => (mb >= 1024 ? (mb / 1024).toFixed(2).replace(/\.00$/, '') + ' GB' : mb + ' MB');
const OFFSET = 2 * 3600e3; // Maputo = UTC+2 (sem hora de verão)
const mzDate = (t = Date.now()) => new Date(t + OFFSET);
const fmtMZ = (t = Date.now()) => mzDate(t).toISOString().replace('T', ' ').slice(0, 16);
const fmtUptime = (s) => `${Math.floor(s / 86400)}d ${Math.floor(s % 86400 / 3600)}h ${Math.floor(s % 3600 / 60)}min`;
const unwrap = (m) => m?.ephemeralMessage?.message || m?.viewOnceMessage?.message ||
  m?.viewOnceMessageV2?.message || m?.documentWithCaptionMessage?.message || m;
const getText = (m) => m?.conversation || m?.extendedTextMessage?.text || m?.imageMessage?.caption ||
  m?.videoMessage?.caption || m?.documentMessage?.caption || '';
const ctxOf = (m) => { for (const k in m) { const c = m[k]?.contextInfo; if (c) return c; } return null; };
const matches = (p, n) => [p.id, p.phoneNumber, p.lid].some((x) => x && num(x) === n);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// "22:30" => próximo 22:30 (hora de Maputo); "30m" / "2h" => daqui a X
function parseWhen(s) {
  s = (s || '').toLowerCase(); let m;
  if ((m = s.match(/^(\d{1,2}):(\d{2})$/))) {
    const h = +m[1], mi = +m[2]; if (h > 23 || mi > 59) return null;
    const d = mzDate();
    let t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, mi) - OFFSET;
    if (t <= Date.now()) t += 864e5;
    return t;
  }
  if ((m = s.match(/^(\d+)(m|min|h)$/))) return Date.now() + (+m[1]) * (m[2] === 'h' ? 36e5 : 6e4);
  return null;
}
const hhmm = (s) => /^([01]?\d|2[0-3]):[0-5]\d$/.test(s || '');
const pad = (s) => (s.length === 4 ? '0' + s : s);

/* ================================================================
 *  ESTADO DO BOT
 * ================================================================ */
let sock = null;
let conectado = false;
const START_TIME = Date.now();
const sent = new Set();            // IDs das mensagens enviadas pelo próprio bot
const metaCache = new Map();
const avisoPrivado = new Map();    // evita spam de "bot não alugado"
const ultimoAuto = new Map();      // evita spam do auto-responder
const cmds = {};
const add = (nomes, fn, opts = {}) => nomes.split(' ').forEach((n) => (cmds[n] = { fn, ...opts }));
const botNums = () => [BOT_NUMBER, sock?.user?.id && num(sock.user.id), sock?.user?.lid && num(sock.user.lid)].filter(Boolean);

async function send(jid, content, opts = {}) {
  const r = await sock.sendMessage(jid, content, opts);
  if (r?.key?.id) { sent.add(r.key.id); if (sent.size > 1000) sent.delete(sent.values().next().value); }
  return r;
}
async function groupMeta(jid, forcar = false) {
  const c = metaCache.get(jid);
  if (!forcar && c && Date.now() - c.t < 30000) return c.meta;
  const meta = await sock.groupMetadata(jid);
  metaCache.set(jid, { meta, t: Date.now() });
  // regista quando o bot viu cada membro pela primeira vez (usado em .rfantasmas5 e .auto-remover)
  const cfg = cfgOf(jid); let mudou = false;
  for (const p of meta.participants) { const n = num(p.phoneNumber || p.id); if (!cfg.visto[n]) { cfg.visto[n] = Date.now(); mudou = true; } }
  if (mudou) save('grupos');
  return meta;
}
// Descarrega mídia da própria mensagem ou da mensagem respondida
async function midia(msg, tipos) {
  const opts = { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage };
  const m = unwrap(msg.message);
  for (const t of tipos) if (m[t]) return { tipo: t, buffer: await downloadMediaMessage(msg, 'buffer', {}, opts) };
  const ctx = ctxOf(m);
  const q = ctx?.quotedMessage && unwrap(ctx.quotedMessage);
  if (q) for (const t of tipos) if (q[t]) {
    const falsa = { key: { remoteJid: msg.key.remoteJid, id: ctx.stanzaId, participant: ctx.participant }, message: q };
    return { tipo: t, buffer: await downloadMediaMessage(falsa, 'buffer', {}, opts) };
  }
  return null;
}
// Alvo de um comando: mencionado, mensagem respondida ou número digitado
function alvo(c) {
  const ctx = ctxOf(unwrap(c.msg.message));
  let j = ctx?.mentionedJid?.[0] || (ctx?.quotedMessage ? ctx.participant : null);
  if (!j) { const n = normNum(c.args[0] || ''); if (n.length >= 10) j = n + '@s.whatsapp.net'; }
  if (!j) return null;
  const p = c.meta?.participants.find((x) => x.id === j || matches(x, num(j)));
  return { id: p?.id || j, numero: num(p?.phoneNumber || p?.id || j), admin: !!p?.admin, noGrupo: !!p };
}
const protegido = (c, t) => t.numero === OWNER_NUMBER || botNums().includes(t.numero) || (!c.isOwner && !c.isAdmin && t.admin);
const estado = (c) => {
  if (c.name.endsWith('-on')) return true;
  if (c.name.endsWith('-off')) return false;
  const a = (c.args[0] || '').toLowerCase();
  return a === 'on' ? true : a === 'off' ? false : null;
};
const toggle = (campo, rotulo) => (c) => {
  const e = estado(c);
  if (e === null) return c.reply(`${rotulo}: ${c.cfg[campo] ? 'ligado ✅' : 'desligado ❌'}\nUse: ${PREFIX}${c.name} on/off`);
  c.cfg[campo] = e; save('grupos');
  return c.reply(`${rotulo}: ${e ? 'ligado ✅' : 'desligado ❌'}`);
};

/* ================================================================
 *  COMANDOS - MENU E INFORMAÇÕES
 * ================================================================ */
const CATEGORIAS = {
  '👥 GRUPO': '.abrir .abrir-grupo .addgp .auto-fechar .clear .clear-chat .close .close-group .delete .fecha .fechar .fechar-grupo .grupo .grupo-f .hide-tag .kick .limpar .mudar-nome-grupo .nome-grupo .open .open-group .promove .promover .rebaixa .rebaixar .reveal .revelar .set-group-name .set-name .to-tag .abri .abre .abre-grupo .add-adm .adicionar .demote .promote .rm .d .limpa .limgroup .limpargrupo .infogrupo .linkgrupo .gera-link .todos',
  '🛡️ SEGURANÇA': '.anti-link .anticoncorrencia .antiestrangeiros-on .antiestrangeiros-off .ban .desmutar .mutar .mute .only-adm .only-admin .periodo-remocao .remover5 .rfantasmas5 .so-admin .status-remocao .tirar5 .antifoto .so-adm',
  '⚙️ AUTOMAÇÕES': '.agendar .agendar-mensagem .alarme .auto-comprovativo .auto-remover .auto-responder .autoclose .autocomprovativo .bemvindo .calendario .exit .nanoadd .nanocomandos .nanodel .saida .setalarme .welcome .welkom .welkon .boasvindas',
  '💰 VENDAS MB': '.compra .comprovativo .megas .verificarsms .setmegas .addsaldo .addtelefone .telefones .venda-automatica .comprar',
  '📌 OUTROS': '.menu .help .ajuda .ping .perfil .dono .hora .sticker .toimage',
};
const menuTexto = () =>
`╔═════════════════════╗
  🤖 *${BOT_NAME}*
  Dono: ${OWNER_NAME}
  Contacto: ${OWNER_LOCAL}
╚═════════════════════╝
${Object.entries(CATEGORIAS).map(([t, l]) => `\n*${t}*\n${l.split(' ').join('  ')}`).join('\n')}

*🔑 ALUGUER (só dono)*
.alugar  .desalugar  .alugados  .confirmar

Aluguer: ${PRECO_ALUGUER} | Fale com ${OWNER_LOCAL}`;
add('menu help ajuda', (c) => c.reply(menuTexto()));
add('dono', (c) => c.reply(`Dono: ${OWNER_NAME} - ${OWNER_LOCAL}`));
add('ping', (c) => c.reply(`🏓 Pong! ${Math.max(0, Date.now() - Number(c.msg.messageTimestamp) * 1000)} ms | Online há ${fmtUptime((Date.now() - START_TIME) / 1000)}`));
add('hora', (c) => c.reply(`🕒 Hora em Maputo: ${fmtMZ()}`));
add('perfil', (c) => {
  const u = getUser(c.number);
  const al = c.isGroup ? alugados.grupos[c.jid] : alugados.numeros[num(c.jid)];
  return c.reply(`👤 *PERFIL*\nNome: ${c.pushName || u.nome || '-'}\nNúmero: ${c.number}\nCargo: ${c.isOwner ? 'Dono' : c.isAdmin ? 'Admin' : 'Membro'}\n` +
    `Saldo: ${MT(u.saldo)}\nMegas: ${fmtMB(u.megas)}\nAluguer deste chat: ${al ? 'até ' + fmtMZ(al.expira).slice(0, 10) : c.isOwner ? 'dono (livre)' : '-'}`);
});

/* ================================================================
 *  COMANDOS - GRUPO
 * ================================================================ */
const G = { group: 1, admin: 1, bot: 1 };
const abrirGrupo = async (c) => { await sock.groupSettingUpdate(c.jid, 'not_announcement'); return c.reply('🔓 Grupo aberto. Todos podem escrever.'); };
const fecharGrupo = async (c) => { await sock.groupSettingUpdate(c.jid, 'announcement'); return c.reply('🔒 Grupo fechado. Só admins podem escrever.'); };
add('abrir abrir-grupo open open-group abri abre abre-grupo', abrirGrupo, G);
add('fechar fecha close close-group fechar-grupo grupo-f', fecharGrupo, G);

const infoGrupo = (c) => {
  const m = c.meta; const adm = m.participants.filter((p) => p.admin).length;
  return c.reply(`ℹ️ *${m.subject}*\nMembros: ${m.participants.length} (admins: ${adm})\nEstado: ${m.announce ? 'fechado 🔒' : 'aberto 🔓'}\n` +
    `Criado: ${m.creation ? fmtMZ(m.creation * 1000).slice(0, 10) : '-'}\n` +
    `Anti-link: ${c.cfg.antilink ? '✅' : '❌'} | Só admins: ${c.cfg.onlyadm ? '✅' : '❌'} | Boas-vindas: ${c.cfg.bemvindo ? '✅' : '❌'}\n` +
    `${m.desc ? '\n📝 ' + m.desc : ''}`);
};
add('infogrupo', infoGrupo, { group: 1 });
add('grupo', (c) => {
  const a = (c.args[0] || '').toLowerCase();
  if (['abrir', 'open', 'a'].includes(a)) return c.pode ? (c.botAdmin ? abrirGrupo(c) : c.reply('⚠️ Preciso ser admin do grupo.')) : c.reply('⛔ Só admins.');
  if (['fechar', 'close', 'f'].includes(a)) return c.pode ? (c.botAdmin ? fecharGrupo(c) : c.reply('⚠️ Preciso ser admin do grupo.')) : c.reply('⛔ Só admins.');
  return infoGrupo(c);
}, { group: 1 });

add('todos', async (c) => {
  const ids = c.meta.participants.map((p) => p.id);
  return send(c.jid, { text: `📢 *ATENÇÃO A TODOS*\n${c.args.join(' ')}\n\n` + ids.map((i) => '@' + num(i)).join(' '), mentions: ids }, { quoted: c.msg });
}, { group: 1, admin: 1 });
add('hide-tag hidetag to-tag', async (c) => {
  const ctx = ctxOf(unwrap(c.msg.message));
  const q = ctx?.quotedMessage && unwrap(ctx.quotedMessage);
  const texto = c.args.join(' ') || getText(q) || '📢';
  return send(c.jid, { text: texto, mentions: c.meta.participants.map((p) => p.id) });
}, { group: 1, admin: 1 });
// Reenvia visivelmente a mensagem respondida (não abre mensagens "ver uma vez", por privacidade)
add('reveal revelar', async (c) => {
  const ctx = ctxOf(unwrap(c.msg.message));
  const bruto = ctx?.quotedMessage;
  if (!bruto) return c.reply(`↩️ Responda a uma mensagem com ${PREFIX}${c.name}.`);
  if (bruto.viewOnceMessage || bruto.viewOnceMessageV2 || bruto.viewOnceMessageV2Extension) return c.reply('🔒 Não revelo mensagens de "ver uma vez" por privacidade.');
  const q = unwrap(bruto);
  const t = getText(q);
  const mm = await midia(c.msg, ['imageMessage', 'videoMessage', 'audioMessage', 'stickerMessage']).catch(() => null);
  if (mm) {
    const campo = { imageMessage: 'image', videoMessage: 'video', audioMessage: 'audio', stickerMessage: 'sticker' }[mm.tipo];
    return send(c.jid, { [campo]: mm.buffer, ...(t && campo !== 'sticker' && campo !== 'audio' ? { caption: t } : {}) }, { quoted: c.msg });
  }
  return t ? c.reply('👁️ ' + t) : c.reply('Não consegui revelar esse tipo de mensagem.');
}, { group: 1, admin: 1 });

add('delete d', async (c) => {
  const ctx = ctxOf(unwrap(c.msg.message));
  if (!ctx?.stanzaId) return c.reply(`↩️ Responda à mensagem que quer apagar com ${PREFIX}${c.name}.`);
  const meu = botNums().includes(num(ctx.participant || ''));
  await sock.sendMessage(c.jid, { delete: { remoteJid: c.jid, fromMe: meu, id: ctx.stanzaId, participant: ctx.participant } });
}, G);
add('clear clear-chat limpar limpa limgroup limpargrupo', (c) => send(c.jid, { text: '\u200E\n'.repeat(400) + '🧹 Chat limpo!' }), { group: 1, admin: 1 });
add('mudar-nome-grupo nome-grupo set-group-name set-name', async (c) => {
  const nome = c.args.join(' ').trim();
  if (!nome) return c.reply(`Nome atual: *${c.meta.subject}*\nUse: ${PREFIX}${c.name} novo nome`);
  await sock.groupUpdateSubject(c.jid, nome.slice(0, 100));
  return c.reply('✅ Nome do grupo alterado.');
}, G);
add('linkgrupo gera-link', async (c) => c.reply('🔗 Link do grupo:\nhttps://chat.whatsapp.com/' + await sock.groupInviteCode(c.jid)), G);
add('adicionar addgp', async (c) => {
  const n = normNum(c.args[0] || '');
  if (n.length < 10) return c.reply(`Use: ${PREFIX}${c.name} 84xxxxxxx`);
  const r = await sock.groupParticipantsUpdate(c.jid, [n + '@s.whatsapp.net'], 'add');
  const st = String(r?.[0]?.status || '');
  return c.reply(st === '200' ? `✅ @${n} adicionado.` : st === '409' ? '⚠️ Essa pessoa já está no grupo.' : st === '403' ? '⚠️ A privacidade dela não permite adicionar. Envie o link do grupo.' : `⚠️ Não foi possível adicionar (código ${st || '?'}).`);
}, G);

add('kick rm', async (c) => {
  const t = alvo(c);
  if (!t) return c.reply(`Marque, responda ou escreva o número: ${PREFIX}${c.name} @membro`);
  if (protegido(c, t)) return c.reply('⛔ Não posso remover essa pessoa.');
  await sock.groupParticipantsUpdate(c.jid, [t.id], 'remove');
  return c.reply(`👢 @${t.numero} removido.`);
}, G);
add('promover promove promote add-adm', async (c) => {
  const t = alvo(c);
  if (!t) return c.reply(`Marque ou responda: ${PREFIX}${c.name} @membro`);
  await sock.groupParticipantsUpdate(c.jid, [t.id], 'promote');
  return c.reply(`⬆️ @${t.numero} agora é admin.`);
}, G);
add('rebaixar rebaixa demote', async (c) => {
  const t = alvo(c);
  if (!t) return c.reply(`Marque ou responda: ${PREFIX}${c.name} @admin`);
  if (protegido(c, t)) return c.reply('⛔ Não posso rebaixar essa pessoa.');
  await sock.groupParticipantsUpdate(c.jid, [t.id], 'demote');
  return c.reply(`⬇️ @${t.numero} deixou de ser admin.`);
}, G);

/* ================================================================
 *  COMANDOS - SEGURANÇA
 * ================================================================ */
const A = { group: 1, admin: 1 };
add('anti-link antilink', toggle('antilink', '🔗 Anti-link'), A);
add('anticoncorrencia', toggle('anticoncorrencia', '🚫 Anti-concorrência'), A);
add('antiestrangeiros antiestrangeiros-on antiestrangeiros-off', toggle('antiestrangeiros', '🌍 Anti-estrangeiros (só +258)'), A);
add('antifoto', toggle('antifoto', '🖼️ Anti-foto'), A);
add('only-adm only-admin so-admin so-adm', toggle('onlyadm', '👮 Bot só para admins'), A);

add('ban', async (c) => {
  const t = alvo(c);
  if (!t) return c.reply(`Marque, responda ou escreva o número: ${PREFIX}ban @membro`);
  if (protegido(c, t)) return c.reply('⛔ Não posso banir essa pessoa.');
  if (!c.cfg.banidos.includes(t.numero)) c.cfg.banidos.push(t.numero);
  save('grupos');
  if (t.noGrupo) await sock.groupParticipantsUpdate(c.jid, [t.id], 'remove').catch(() => {});
  return c.reply(`🚫 @${t.numero} banido. Se voltar, será removido.`);
}, G);
add('desbanir', (c) => {
  const t = alvo(c); if (!t) return c.reply(`Use: ${PREFIX}desbanir 84xxxxxxx`);
  c.cfg.banidos = c.cfg.banidos.filter((n) => n !== t.numero); save('grupos');
  return c.reply(`✅ @${t.numero} já pode voltar ao grupo.`);
}, A);
add('mutar mute', (c) => {
  const t = alvo(c);
  if (!t) return c.reply(`Marque ou responda: ${PREFIX}${c.name} @membro`);
  if (protegido(c, t)) return c.reply('⛔ Não posso mutar essa pessoa.');
  if (!c.cfg.mutados.includes(t.numero)) c.cfg.mutados.push(t.numero);
  save('grupos');
  return c.reply(`🔇 @${t.numero} mutado. As mensagens dele(a) serão apagadas${c.botAdmin ? '.' : ' (preciso ser admin para apagar).'}`);
}, A);
add('desmutar', (c) => {
  const t = alvo(c); if (!t) return c.reply(`Marque ou responda: ${PREFIX}desmutar @membro`);
  c.cfg.mutados = c.cfg.mutados.filter((n) => n !== t.numero); save('grupos');
  return c.reply(`🔊 @${t.numero} desmutado.`);
}, A);

// Candidatos a remoção
const menosAtivos = (c) => c.meta.participants
  .filter((p) => !p.admin && !botNums().some((b) => matches(p, b)) && !matches(p, OWNER_NUMBER))
  .sort((a, b) => (c.cfg.atividade[num(a.phoneNumber || a.id)] || 0) - (c.cfg.atividade[num(b.phoneNumber || b.id)] || 0));
const fantasmas = (c, minDias = 0) => menosAtivos(c).filter((p) => {
  const n = num(p.phoneNumber || p.id);
  return !(c.cfg.atividade[n] > 0) && Date.now() - (c.cfg.visto[n] || Date.now()) >= minDias * 864e5;
});
async function removerLote(c, lista, titulo) {
  if (!lista.length) return c.reply('✅ Não há ninguém para remover.');
  if ((c.args[0] || '').toLowerCase() !== 'confirmar') {
    return send(c.jid, {
      text: `⚠️ ${titulo}:\n` + lista.map((p) => `• @${num(p.phoneNumber'use strict';
/**
 * SHARVIS 8.0 ALUGAVEL - Bot de WhatsApp para aluguer (Moçambique)
 * Baileys + pareamento por código (sem QR Code).
 */
const fs = require('fs-extra');
const path = require('path');
const http = require('http');
const pino = require('pino');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
} = require('@whiskeysockets/baileys');

// 'sharp' é opcional: só é preciso para .sticker e .toimage
let sharp = null;
try { sharp = require('sharp'); } catch {}

/* ================================================================
 *  CONFIGURAÇÃO FIXA
 * ================================================================ */
const BOT_NAME = 'SHARVIS 8.0 ALUGAVEL';
const BOT_NUMBER = '258872698781';
const BOT_LOCAL = '872698781';
const OWNER_NAME = 'Leønide António Lâmina';
const OWNER_NUMBER = '258852223969';
const OWNER_LOCAL = '852223969';
const OWNER_JID = OWNER_NUMBER + '@s.whatsapp.net';
const PREFIX = '.';
const PRECO_ALUGUER = '150MT/mês';
const DIAS_ALUGUER = 30; // duração padrão do aluguer
// false = comandos de moderação (kick, ban, promover...) só para admins do grupo e dono.
// true  = qualquer membro de um grupo alugado pode usar (perigoso: um membro pode remover admins).
const QUALQUER_UM_PODE_MODERAR = false;
// Tabela de megas (edite à vontade): [pacote, GB, preço em MT]
const PRECOS = [['1GB', 1, 50], ['2GB', 2, 100], ['5GB', 5, 250], ['10GB', 10, 500]];

const DATA_DIR = process.env.DATA_DIR || __dirname;
const AUTH_DIR = path.join(DATA_DIR, 'auth_info_baileys');
const DB_DIR = path.join(DATA_DIR, 'database');
fs.ensureDirSync(AUTH_DIR);
fs.ensureDirSync(DB_DIR);

/* ================================================================
 *  BASE DE DADOS (ficheiros JSON em database/)
 * ================================================================ */
const dbs = {};
const dbTimers = {};
function loadDB(nome, padrao) {
  const f = path.join(DB_DIR, nome + '.json');
  if (!fs.existsSync(f)) fs.writeJsonSync(f, padrao, { spaces: 2 });
  try { dbs[nome] = fs.readJsonSync(f); } catch { dbs[nome] = padrao; fs.writeJsonSync(f, padrao, { spaces: 2 }); }
  return dbs[nome];
}
// Grava com um pequeno atraso para não escrever o ficheiro a cada mensagem
function save(nome) {
  clearTimeout(dbTimers[nome]);
  dbTimers[nome] = setTimeout(() => fs.writeJson(path.join(DB_DIR, nome + '.json'), dbs[nome], { spaces: 2 }).catch(() => {}), 800);
}
const alugados = loadDB('alugados', { grupos: {}, numeros: {} });
alugados.grupos ??= {}; alugados.numeros ??= {};
const grupos = loadDB('grupos', {});
const dados = loadDB('usuarios', { users: {}, pedidos: [], agendados: [], contador: 0 });
dados.users ??= {}; dados.pedidos ??= []; dados.agendados ??= []; dados.contador ??= 0;

// Configurações de cada chat (grupo ou privado)
function cfgOf(jid) {
  return (grupos[jid] ??= {
    antilink: false, anticoncorrencia: false, antiestrangeiros: false, antifoto: false, onlyadm: false,
    bemvindo: false, saida: false, autocomprovativo: false, autoresponder: false, vendaauto: true,
    autoremover: false, periodo: 7, ultimaRemocao: 0, autofechar: null,
    respostas: {}, nano: {}, mutados: [], banidos: [], atividade: {}, visto: {},
  });
}
function getUser(n, nome) {
  const u = (dados.users[n] ??= { nome: '', saldo: 0, megas: 0, desde: Date.now() });
  if (nome && nome !== u.nome) { u.nome = nome; save('usuarios'); }
  return u;
}

/* ================================================================
 *  UTILIDADES
 * ================================================================ */
const num = (j = '') => String(j).split('@')[0].split(':')[0];
const normNum = (n) => { n = String(n).replace(/\D/g, ''); return n.length === 9 ? '258' + n : n; };
const MT = (v) => Number(v).toLocaleString('pt-PT') + ' MT';
const fmtMB = (mb) => (mb >= 1024 ? (mb / 1024).toFixed(2).replace(/\.00$/, '') + ' GB' : mb + ' MB');
const OFFSET = 2 * 3600e3; // Maputo = UTC+2 (sem hora de verão)
const mzDate = (t = Date.now()) => new Date(t + OFFSET);
const fmtMZ = (t = Date.now()) => mzDate(t).toISOString().replace('T', ' ').slice(0, 16);
const fmtUptime = (s) => `${Math.floor(s / 86400)}d ${Math.floor(s % 86400 / 3600)}h ${Math.floor(s % 3600 / 60)}min`;
const unwrap = (m) => m?.ephemeralMessage?.message || m?.viewOnceMessage?.message ||
  m?.viewOnceMessageV2?.message || m?.documentWithCaptionMessage?.message || m;
const getText = (m) => m?.conversation || m?.extendedTextMessage?.text || m?.imageMessage?.caption ||
  m?.videoMessage?.caption || m?.documentMessage?.caption || '';
const ctxOf = (m) => { for (const k in m) { const c = m[k]?.contextInfo; if (c) return c; } return null; };
const matches = (p, n) => [p.id, p.phoneNumber, p.lid].some((x) => x && num(x) === n);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// "22:30" => próximo 22:30 (hora de Maputo); "30m" / "2h" => daqui a X
function parseWhen(s) {
  s = (s || '').toLowerCase(); let m;
  if ((m = s.match(/^(\d{1,2}):(\d{2})$/))) {
    const h = +m[1], mi = +m[2]; if (h > 23 || mi > 59) return null;
    const d = mzDate();
    let t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, mi) - OFFSET;
    if (t <= Date.now()) t += 864e5;
    return t;
  }
  if ((m = s.match(/^(\d+)(m|min|h)$/))) return Date.now() + (+m[1]) * (m[2] === 'h' ? 36e5 : 6e4);
  return null;
}
const hhmm = (s) => /^([01]?\d|2[0-3]):[0-5]\d$/.test(s || '');
const pad = (s) => (s.length === 4 ? '0' + s : s);

/* ================================================================
 *  ESTADO DO BOT
 * ================================================================ */
let sock = null;
let conectado = false;
const START_TIME = Date.now();
const sent = new Set();            // IDs das mensagens enviadas pelo próprio bot
const metaCache = new Map();
const avisoPrivado = new Map();    // evita spam de "bot não alugado"
const ultimoAuto = new Map();      // evita spam do auto-responder
const cmds = {};
const add = (nomes, fn, opts = {}) => nomes.split(' ').forEach((n) => (cmds[n] = { fn, ...opts }));
const botNums = () => [BOT_NUMBER, sock?.user?.id && num(sock.user.id), sock?.user?.lid && num(sock.user.lid)].filter(Boolean);

async function send(jid, content, opts = {}) {
  const r = await sock.sendMessage(jid, content, opts);
  if (r?.key?.id) { sent.add(r.key.id); if (sent.size > 1000) sent.delete(sent.values().next().value); }
  return r;
}
async function groupMeta(jid, forcar = false) {
  const c = metaCache.get(jid);
  if (!forcar && c && Date.now() - c.t < 30000) return c.meta;
  const meta = await sock.groupMetadata(jid);
  metaCache.set(jid, { meta, t: Date.now() });
  // regista quando o bot viu cada membro pela primeira vez (usado em .rfantasmas5 e .auto-remover)
  const cfg = cfgOf(jid); let mudou = false;
  for (const p of meta.participants) { const n = num(p.phoneNumber || p.id); if (!cfg.visto[n]) { cfg.visto[n] = Date.now(); mudou = true; } }
  if (mudou) save('grupos');
  return meta;
}
// Descarrega mídia da própria mensagem ou da mensagem respondida
async function midia(msg, tipos) {
  const opts = { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage };
  const m = unwrap(msg.message);
  for (const t of tipos) if (m[t]) return { tipo: t, buffer: await downloadMediaMessage(msg, 'buffer', {}, opts) };
  const ctx = ctxOf(m);
  const q = ctx?.quotedMessage && unwrap(ctx.quotedMessage);
  if (q) for (const t of tipos) if (q[t]) {
    const falsa = { key: { remoteJid: msg.key.remoteJid, id: ctx.stanzaId, participant: ctx.participant }, message: q };
    return { tipo: t, buffer: await downloadMediaMessage(falsa, 'buffer', {}, opts) };
  }
  return null;
}
// Alvo de um comando: mencionado, mensagem respondida ou número digitado
function alvo(c) {
  const ctx = ctxOf(unwrap(c.msg.message));
  let j = ctx?.mentionedJid?.[0] || (ctx?.quotedMessage ? ctx.participant : null);
  if (!j) { const n = normNum(c.args[0] || ''); if (n.length >= 10) j = n + '@s.whatsapp.net'; }
  if (!j) return null;
  const p = c.meta?.participants.find((x) => x.id === j || matches(x, num(j)));
  return { id: p?.id || j, numero: num(p?.phoneNumber || p?.id || j), admin: !!p?.admin, noGrupo: !!p };
}
const protegido = (c, t) => t.numero === OWNER_NUMBER || botNums().includes(t.numero) || (!c.isOwner && !c.isAdmin && t.admin);
const estado = (c) => {
  if (c.name.endsWith('-on')) return true;
  if (c.name.endsWith('-off')) return false;
  const a = (c.args[0] || '').toLowerCase();
  return a === 'on' ? true : a === 'off' ? false : null;
};
const toggle = (campo, rotulo) => (c) => {
  const e = estado(c);
  if (e === null) return c.reply(`${rotulo}: ${c.cfg[campo] ? 'ligado ✅' : 'desligado ❌'}\nUse: ${PREFIX}${c.name} on/off`);
  c.cfg[campo] = e; save('grupos');
  return c.reply(`${rotulo}: ${e ? 'ligado ✅' : 'desligado ❌'}`);
};

/* ================================================================
 *  COMANDOS - MENU E INFORMAÇÕES
 * ================================================================ */
const CATEGORIAS = {
  '👥 GRUPO': '.abrir .abrir-grupo .addgp .auto-fechar .clear .clear-chat .close .close-group .delete .fecha .fechar .fechar-grupo .grupo .grupo-f .hide-tag .kick .limpar .mudar-nome-grupo .nome-grupo .open .open-group .promove .promover .rebaixa .rebaixar .reveal .revelar .set-group-name .set-name .to-tag .abri .abre .abre-grupo .add-adm .adicionar .demote .promote .rm .d .limpa .limgroup .limpargrupo .infogrupo .linkgrupo .gera-link .todos',
  '🛡️ SEGURANÇA': '.anti-link .anticoncorrencia .antiestrangeiros-on .antiestrangeiros-off .ban .desmutar .mutar .mute .only-adm .only-admin .periodo-remocao .remover5 .rfantasmas5 .so-admin .status-remocao .tirar5 .antifoto .so-adm',
  '⚙️ AUTOMAÇÕES': '.agendar .agendar-mensagem .alarme .auto-comprovativo .auto-remover .auto-responder .autoclose .autocomprovativo .bemvindo .calendario .exit .nanoadd .nanocomandos .nanodel .saida .setalarme .welcome .welkom .welkon .boasvindas',
  '💰 VENDAS MB': '.compra .comprovativo .megas .verificarsms .setmegas .addsaldo .addtelefone .telefones .venda-automatica .comprar',
  '📌 OUTROS': '.menu .help .ajuda .ping .perfil .dono .hora .sticker .toimage',
};
const menuTexto = () =>
`╔═════════════════════╗
  🤖 *${BOT_NAME}*
  Dono: ${OWNER_NAME}
  Contacto: ${OWNER_LOCAL}
╚═════════════════════╝
${Object.entries(CATEGORIAS).map(([t, l]) => `\n*${t}*\n${l.split(' ').join('  ')}`).join('\n')}

*🔑 ALUGUER (só dono)*
.alugar  .desalugar  .alugados  .confirmar

Aluguer: ${PRECO_ALUGUER} | Fale com ${OWNER_LOCAL}`;
add('menu help ajuda', (c) => c.reply(menuTexto()));
add('dono', (c) => c.reply(`Dono: ${OWNER_NAME} - ${OWNER_LOCAL}`));
add('ping', (c) => c.reply(`🏓 Pong! ${Math.max(0, Date.now() - Number(c.msg.messageTimestamp) * 1000)} ms | Online há ${fmtUptime((Date.now() - START_TIME) / 1000)}`));
add('hora', (c) => c.reply(`🕒 Hora em Maputo: ${fmtMZ()}`));
add('perfil', (c) => {
  const u = getUser(c.number);
  const al = c.isGroup ? alugados.grupos[c.jid] : alugados.numeros[num(c.jid)];
  return c.reply(`👤 *PERFIL*\nNome: ${c.pushName || u.nome || '-'}\nNúmero: ${c.number}\nCargo: ${c.isOwner ? 'Dono' : c.isAdmin ? 'Admin' : 'Membro'}\n` +
    `Saldo: ${MT(u.saldo)}\nMegas: ${fmtMB(u.megas)}\nAluguer deste chat: ${al ? 'até ' + fmtMZ(al.expira).slice(0, 10) : c.isOwner ? 'dono (livre)' : '-'}`);
});

/* ================================================================
 *  COMANDOS - GRUPO
 * ================================================================ */
const G = { group: 1, admin: 1, bot: 1 };
const abrirGrupo = async (c) => { await sock.groupSettingUpdate(c.jid, 'not_announcement'); return c.reply('🔓 Grupo aberto. Todos podem escrever.'); };
const fecharGrupo = async (c) => { await sock.groupSettingUpdate(c.jid, 'announcement'); return c.reply('🔒 Grupo fechado. Só admins podem escrever.'); };
add('abrir abrir-grupo open open-group abri abre abre-grupo', abrirGrupo, G);
add('fechar fecha close close-group fechar-grupo grupo-f', fecharGrupo, G);

const infoGrupo = (c) => {
  const m = c.meta; const adm = m.participants.filter((p) => p.admin).length;
  return c.reply(`ℹ️ *${m.subject}*\nMembros: ${m.participants.length} (admins: ${adm})\nEstado: ${m.announce ? 'fechado 🔒' : 'aberto 🔓'}\n` +
    `Criado: ${m.creation ? fmtMZ(m.creation * 1000).slice(0, 10) : '-'}\n` +
    `Anti-link: ${c.cfg.antilink ? '✅' : '❌'} | Só admins: ${c.cfg.onlyadm ? '✅' : '❌'} | Boas-vindas: ${c.cfg.bemvindo ? '✅' : '❌'}\n` +
    `${m.desc ? '\n📝 ' + m.desc : ''}`);
};
add('infogrupo', infoGrupo, { group: 1 });
add('grupo', (c) => {
  const a = (c.args[0] || '').toLowerCase();
  if (['abrir', 'open', 'a'].includes(a)) return c.pode ? (c.botAdmin ? abrirGrupo(c) : c.reply('⚠️ Preciso ser admin do grupo.')) : c.reply('⛔ Só admins.');
  if (['fechar', 'close', 'f'].includes(a)) return c.pode ? (c.botAdmin ? fecharGrupo(c) : c.reply('⚠️ Preciso ser admin do grupo.')) : c.reply('⛔ Só admins.');
  return infoGrupo(c);
}, { group: 1 });

add('todos', async (c) => {
  const ids = c.meta.participants.map((p) => p.id);
  return send(c.jid, { text: `📢 *ATENÇÃO A TODOS*\n${c.args.join(' ')}\n\n` + ids.map((i) => '@' + num(i)).join(' '), mentions: ids }, { quoted: c.msg });
}, { group: 1, admin: 1 });
add('hide-tag hidetag to-tag', async (c) => {
  const ctx = ctxOf(unwrap(c.msg.message));
  const q = ctx?.quotedMessage && unwrap(ctx.quotedMessage);
  const texto = c.args.join(' ') || getText(q) || '📢';
  return send(c.jid, { text: texto, mentions: c.meta.participants.map((p) => p.id) });
}, { group: 1, admin: 1 });
// Reenvia visivelmente a mensagem respondida (não abre mensagens "ver uma vez", por privacidade)
add('reveal revelar', async (c) => {
  const ctx = ctxOf(unwrap(c.msg.message));
  const bruto = ctx?.quotedMessage;
  if (!bruto) return c.reply(`↩️ Responda a uma mensagem com ${PREFIX}${c.name}.`);
  if (bruto.viewOnceMessage || bruto.viewOnceMessageV2 || bruto.viewOnceMessageV2Extension) return c.reply('🔒 Não revelo mensagens de "ver uma vez" por privacidade.');
  const q = unwrap(bruto);
  const t = getText(q);
  const mm = await midia(c.msg, ['imageMessage', 'videoMessage', 'audioMessage', 'stickerMessage']).catch(() => null);
  if (mm) {
    const campo = { imageMessage: 'image', videoMessage: 'video', audioMessage: 'audio', stickerMessage: 'sticker' }[mm.tipo];
    return send(c.jid, { [campo]: mm.buffer, ...(t && campo !== 'sticker' && campo !== 'audio' ? { caption: t } : {}) }, { quoted: c.msg });
  }
  return t ? c.reply('👁️ ' + t) : c.reply('Não consegui revelar esse tipo de mensagem.');
}, { group: 1, admin: 1 });

add('delete d', async (c) => {
  const ctx = ctxOf(unwrap(c.msg.message));
  if (!ctx?.stanzaId) return c.reply(`↩️ Responda à mensagem que quer apagar com ${PREFIX}${c.name}.`);
  const meu = botNums().includes(num(ctx.participant || ''));
  await sock.sendMessage(c.jid, { delete: { remoteJid: c.jid, fromMe: meu, id: ctx.stanzaId, participant: ctx.participant } });
}, G);
add('clear clear-chat limpar limpa limgroup limpargrupo', (c) => send(c.jid, { text: '\u200E\n'.repeat(400) + '🧹 Chat limpo!' }), { group: 1, admin: 1 });
add('mudar-nome-grupo nome-grupo set-group-name set-name', async (c) => {
  const nome = c.args.join(' ').trim();
  if (!nome) return c.reply(`Nome atual: *${c.meta.subject}*\nUse: ${PREFIX}${c.name} novo nome`);
  await sock.groupUpdateSubject(c.jid, nome.slice(0, 100));
  return c.reply('✅ Nome do grupo alterado.');
}, G);
add('linkgrupo gera-link', async (c) => c.reply('🔗 Link do grupo:\nhttps://chat.whatsapp.com/' + await sock.groupInviteCode(c.jid)), G);
add('adicionar addgp', async (c) => {
  const n = normNum(c.args[0] || '');
  if (n.length < 10) return c.reply(`Use: ${PREFIX}${c.name} 84xxxxxxx`);
  const r = await sock.groupParticipantsUpdate(c.jid, [n + '@s.whatsapp.net'], 'add');
  const st = String(r?.[0]?.status || '');
  return c.reply(st === '200' ? `✅ @${n} adicionado.` : st === '409' ? '⚠️ Essa pessoa já está no grupo.' : st === '403' ? '⚠️ A privacidade dela não permite adicionar. Envie o link do grupo.' : `⚠️ Não foi possível adicionar (código ${st || '?'}).`);
}, G);

add('kick rm', async (c) => {
  const t = alvo(c);
  if (!t) return c.reply(`Marque, responda ou escreva o número: ${PREFIX}${c.name} @membro`);
  if (protegido(c, t)) return c.reply('⛔ Não posso remover essa pessoa.');
  await sock.groupParticipantsUpdate(c.jid, [t.id], 'remove');
  return c.reply(`👢 @${t.numero} removido.`);
}, G);
add('promover promove promote add-adm', async (c) => {
  const t = alvo(c);
  if (!t) return c.reply(`Marque ou responda: ${PREFIX}${c.name} @membro`);
  await sock.groupParticipantsUpdate(c.jid, [t.id], 'promote');
  return c.reply(`⬆️ @${t.numero} agora é admin.`);
}, G);
add('rebaixar rebaixa demote', async (c) => {
  const t = alvo(c);
  if (!t) return c.reply(`Marque ou responda: ${PREFIX}${c.name} @admin`);
  if (protegido(c, t)) return c.reply('⛔ Não posso rebaixar essa pessoa.');
  await sock.groupParticipantsUpdate(c.jid, [t.id], 'demote');
  return c.reply(`⬇️ @${t.numero} deixou de ser admin.`);
}, G);

/* ================================================================
 *  COMANDOS - SEGURANÇA
 * ================================================================ */
const A = { group: 1, admin: 1 };
add('anti-link antilink', toggle('antilink', '🔗 Anti-link'), A);
add('anticoncorrencia', toggle('anticoncorrencia', '🚫 Anti-concorrência'), A);
add('antiestrangeiros antiestrangeiros-on antiestrangeiros-off', toggle('antiestrangeiros', '🌍 Anti-estrangeiros (só +258)'), A);
add('antifoto', toggle('antifoto', '🖼️ Anti-foto'), A);
add('only-adm only-admin so-admin so-adm', toggle('onlyadm', '👮 Bot só para admins'), A);

add('ban', async (c) => {
  const t = alvo(c);
  if (!t) return c.reply(`Marque, responda ou escreva o número: ${PREFIX}ban @membro`);
  if (protegido(c, t)) return c.reply('⛔ Não posso banir essa pessoa.');
  if (!c.cfg.banidos.includes(t.numero)) c.cfg.banidos.push(t.numero);
  save('grupos');
  if (t.noGrupo) await sock.groupParticipantsUpdate(c.jid, [t.id], 'remove').catch(() => {});
  return c.reply(`🚫 @${t.numero} banido. Se voltar, será removido.`);
}, G);
add('desbanir', (c) => {
  const t = alvo(c); if (!t) return c.reply(`Use: ${PREFIX}desbanir 84xxxxxxx`);
  c.cfg.banidos = c.cfg.banidos.filter((n) => n !== t.numero); save('grupos');
  return c.reply(`✅ @${t.numero} já pode voltar ao grupo.`);
}, A);
add('mutar mute', (c) => {
  const t = alvo(c);
  if (!t) return c.reply(`Marque ou responda: ${PREFIX}${c.name} @membro`);
  if (protegido(c, t)) return c.reply('⛔ Não posso mutar essa pessoa.');
  if (!c.cfg.mutados.includes(t.numero)) c.cfg.mutados.push(t.numero);
  save('grupos');
  return c.reply(`🔇 @${t.numero} mutado. As mensagens dele(a) serão apagadas${c.botAdmin ? '.' : ' (preciso ser admin para apagar).'}`);
}, A);
add('desmutar', (c) => {
  const t = alvo(c); if (!t) return c.reply(`Marque ou responda: ${PREFIX}desmutar @membro`);
  c.cfg.mutados = c.cfg.mutados.filter((n) => n !== t.numero); save('grupos');
  return c.reply(`🔊 @${t.numero} desmutado.`);
}, A);

// Candidatos a remoção
const menosAtivos = (c) => c.meta.participants
  .filter((p) => !p.admin && !botNums().some((b) => matches(p, b)) && !matches(p, OWNER_NUMBER))
  .sort((a, b) => (c.cfg.atividade[num(a.phoneNumber || a.id)] || 0) - (c.cfg.atividade[num(b.phoneNumber || b.id)] || 0));
const fantasmas = (c, minDias = 0) => menosAtivos(c).filter((p) => {
  const n = num(p.phoneNumber || p.id);
  return !(c.cfg.atividade[n] > 0) && Date.now() - (c.cfg.visto[n] || Date.now()) >= minDias * 864e5;
});
async function removerLote(c, lista, titulo) {
  if (!lista.length) return c.reply('✅ Não há ninguém para remover.');
  if ((c.args[0] || '').toLowerCase() !== 'confirmar') {
    return send(c.jid, {
      text: `⚠️ ${titulo}:\n` + lista.map((p) => `• @${num(p.phoneNumber
