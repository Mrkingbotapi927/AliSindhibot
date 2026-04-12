import makeWASocket, {
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore
} from '@whiskeysockets/baileys';
import pino from 'pino';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const spamMap = new Map();

function isSpam(num) {
    const now = Date.now();
    const last = spamMap.get(num) || 0;
    if (now - last < 3000) return true;
    spamMap.set(num, now);
    return false;
}

async function sendWithTyping(sock, jid, content, options = {}) {
    try {
        await sock.presenceSubscribe(jid);
        await sleep(400 + Math.random() * 600);
        await sock.sendPresenceUpdate('composing', jid);
        await sleep(500 + Math.random() * 800);
        await sock.sendPresenceUpdate('paused', jid);
    } catch {}
    return sock.sendMessage(jid, content, options);
}

// ─── CONFIG ───────────────────────────────────────────────
const OWNER = (process.env.OWNER_NUMBER || '').replace(/[^0-9]/g, '');
const PREFIX = '.';
const botImagePath = path.join(__dirname, 'ali_sindhi.png');

const configFile = path.join(__dirname, 'config.json');
const cfg = {
    mode: 'public',
    autoStatus: true,
    callBlock: false,
    onlinePresence: false,
};
if (fs.existsSync(configFile)) {
    try { Object.assign(cfg, JSON.parse(fs.readFileSync(configFile, 'utf8'))); } catch {}
}
function saveCfg() { fs.writeFileSync(configFile, JSON.stringify(cfg, null, 2)); }

function getUptime() {
    const u = process.uptime();
    return `${Math.floor(u/3600)}h ${Math.floor((u%3600)/60)}m ${Math.floor(u%60)}s`;
}
function getMem() { return Math.round(process.memoryUsage().rss / 1024 / 1024) + 'MB'; }

function isOwnerNum(senderNum) {
    const s = senderNum.replace(/[^0-9]/g, '');
    const o = OWNER.replace(/[^0-9]/g, '');
    return s === o || s.slice(-10) === o.slice(-10);
}

// ─── MENUS ────────────────────────────────────────────────
function menuMain() {
    return `┃ 🤖 *DEVELOPER BOY ALI SINDHI* 🚀
┃
┃ 👋 Hello @${OWNER}
┃ ⚡ *Bot Name:* Ali Sindhi Bot
┃ 👑 *Owner:* Ali Sindhi
┃ 🌐 *Mode:* ${cfg.mode.toUpperCase()}
┃ ⏱️ *Uptime:* ${getUptime()}
┃ 💾 *Memory:* ${getMem()}
┃ 🔖 *Prefix:* ${PREFIX}
┃ 📌 *Version:* 1.0.0
━━━━━━━━━━━━━━━━━━━━

📋 *Category select karo:*
❯ ${PREFIX}general — 🔰 General
❯ ${PREFIX}owner  — 👑 Owner
❯ ${PREFIX}group  — 👥 Group
❯ ${PREFIX}media  — 🛠️ Media & AI`;
}

function menuGeneral() {
    return `┃ 🔰 *GENERAL COMMANDS*
┃
┃ ${PREFIX}menu — Main menu
┃ ${PREFIX}alive — Bot check
┃ ${PREFIX}ping — Speed check
┃ ${PREFIX}time — Current time
┃ ${PREFIX}quote — Random quote
┃ ${PREFIX}calc [expr] — Calculator
┃ ${PREFIX}weather [city] — Mausam
━━━━━━━━━━━━━━━━━━━━
> ⚡ 𝐀𝐋𝐈 𝐒𝐈𝐍𝐃𝐇𝐈 ⚡`;
}

function menuOwner() {
    return `┃ 👑 *OWNER COMMANDS*
┃
┃ ${PREFIX}mod public/private — Mode
┃ ${PREFIX}auto status on/off — Status view
┃ ${PREFIX}call on/off — Call block
┃ ${PREFIX}online on/off — Online presence
┃ ${PREFIX}block @user — Block
┃ ${PREFIX}unblock @user — Unblock
┃ ${PREFIX}broadcast [msg] — Sab ko msg
━━━━━━━━━━━━━━━━━━━━
> ⚡ 𝐀𝐋𝐈 𝐒𝐈𝐍𝐃𝐇𝐈 ⚡`;
}

function menuGroup() {
    return `┃ 👥 *GROUP COMMANDS*
┃
┃ ${PREFIX}tagall — Sab ko tag
┃ ${PREFIX}kick @user — Hatao
┃ ${PREFIX}promote @user — Admin banao
┃ ${PREFIX}demote @user — Admin hatao
━━━━━━━━━━━━━━━━━━━━
> ⚡ 𝐀𝐋𝐈 𝐒𝐈𝐍𝐃𝐇𝐈 ⚡`;
}

function menuMedia() {
    return `┃ 🛠️ *MEDIA & AI*
┃
┃ ${PREFIX}sticker — Image to sticker
┃ ${PREFIX}tts [text] — Text to speech
┃ ${PREFIX}ai [sawaal] — AI se poocho
┃ ${PREFIX}imagine [prompt] — AI image
━━━━━━━━━━━━━━━━━━━━
> ⚡ 𝐀𝐋𝐈 𝐒𝐈𝐍𝐃𝐇𝐈 ⚡`;
}

// ─── BOT ──────────────────────────────────────────────────
let pairingRequested = false;
let onlineInterval = null;

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info/');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
        },
        printQRInTerminal: false,
        browser: ['Ubuntu', 'Chrome', '20.0.04'],
        logger: pino({ level: 'silent' }),
        syncFullHistory: false,
        markOnlineOnConnect: true,
    });

    sock.ev.on('creds.update', saveCreds);

    // ─── CONNECTION ────────────────────────────────────────
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'connecting' && !state.creds.me && !pairingRequested) {
            pairingRequested = true;
            console.log('⏳ Waiting 2s...');
            setTimeout(async () => {
                try {
                    let code = await sock.requestPairingCode(OWNER);
                    code = code?.match(/.{1,4}/g)?.join('-') || code;
                    console.log(`\n🔑 PAIRING CODE: ${code}`);
                    console.log(`👉 WhatsApp → Linked Devices → Link with phone number\n`);
                } catch (err) {
                    console.error('❌ Pairing Error:', err.message);
                    pairingRequested = false;
                }
            }, 2000);
        }

        if (connection === 'open') {
            console.log('✅ DEVELOPER BOY ALI SINDHI is ONLINE!');
            console.log('👑 Owner:', OWNER);
            pairingRequested = false;

            // Auto online presence if enabled
            if (cfg.onlinePresence) {
                onlineInterval = setInterval(async () => {
                    try { await sock.sendPresenceUpdate('available'); } catch {}
                }, 10000);
            }
        }

        if (connection === 'close') {
            if (onlineInterval) clearInterval(onlineInterval);
            const code = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = code !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                pairingRequested = false;
                startBot();
            } else {
                console.log('❌ Logged out. auth_info/ delete karo aur restart karo.');
            }
        }
    });

    // ─── AUTO STATUS VIEW ──────────────────────────────────
    sock.ev.on('messages.upsert', async ({ messages }) => {
        for (const msg of messages) {
            if (msg.key.remoteJid === 'status@broadcast' && cfg.autoStatus) {
                try { await sock.readMessages([msg.key]); } catch {}
            }
        }
    });

    // ─── CALL BLOCK ────────────────────────────────────────
    sock.ev.on('call', async (calls) => {
        for (const call of calls) {
            if (cfg.callBlock && call.status === 'offer') {
                try {
                    await sock.rejectCall(call.id, call.from);
                    await sock.sendMessage(call.from, { text: '❌ *Calls blocked hain!*' });
                } catch {}
            }
        }
    });

    // ─── MESSAGES ──────────────────────────────────────────
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
            try {
                if (!msg.message) continue;
                if (msg.key.remoteJid === 'status@broadcast') continue;

                const from = msg.key.remoteJid;
                const sender = msg.key.participant || msg.key.remoteJid;
                const senderNum = sender.replace('@s.whatsapp.net', '').replace(/[^0-9]/g, '');
                const isOwner = isOwnerNum(senderNum);
                const isGroup = from.endsWith('@g.us');

                const body = msg.message?.conversation
                    || msg.message?.extendedTextMessage?.text
                    || msg.message?.imageMessage?.caption || '';

                if (!body.startsWith(PREFIX)) continue;
                if (!isOwner && isSpam(senderNum)) continue;
                if (cfg.mode === 'private' && !isOwner) continue;

                const args = body.slice(PREFIX.length).trim().split(' ');
                const cmd = args[0].toLowerCase();
                const text = args.slice(1).join(' ');

                const reply = (txt) => sendWithTyping(sock, from, { text: txt }, { quoted: msg });

                console.log(`📩 CMD: .${cmd} | From: ${senderNum} | isOwner: ${isOwner}`);

                // ── MENU ──────────────────────────────────
                if (cmd === 'menu') {
                    const image = fs.readFileSync(botImagePath);
                    await sock.sendMessage(from, { image, caption: menuMain() }, { quoted: msg });
                }
                else if (cmd === 'general') { await reply(menuGeneral()); }
                else if (cmd === 'owner') { await reply(menuOwner()); }
                else if (cmd === 'group') { await reply(menuGroup()); }
                else if (cmd === 'media') { await reply(menuMedia()); }

                // ── GENERAL ────────────────────────────────
                else if (cmd === 'alive') {
                    await reply(`┃ 🤖 *DEVELOPER BOY ALI SINDHI*\n┃\n┃ ✅ *Bot Online Hai!*\n┃ ⏱️ *Uptime:* ${getUptime()}\n┃ 💾 *Memory:* ${getMem()}\n┃ 🌐 *Mode:* ${cfg.mode.toUpperCase()}\n┃ 👁️ *Online Mode:* ${cfg.onlinePresence ? 'ON' : 'OFF'}\n━━━━━━━━━━━━━━━━━━━━\n> ⚡ 𝐀𝐋𝐈 𝐒𝐈𝐍𝐃𝐇𝐈 ⚡`);
                }
                else if (cmd === 'ping') {
                    const t = Date.now();
                    await reply(`🏓 *Pong!*\n⚡ Speed: ${Date.now() - t}ms`);
                }
                else if (cmd === 'time') {
                    const now = new Date();
                    await reply(`🕐 *Time:*\n📅 ${now.toLocaleDateString('en-PK')}\n⏰ ${now.toLocaleTimeString('en-US', { timeZone: 'Asia/Karachi' })}\n🌍 PKT (UTC+5)`);
                }
                else if (cmd === 'quote') {
                    const qs = ['💎 "Kamyabi woh hai jo haar ke bhi larta rahe."','🔥 "Mushkilein tujhe mazboot banati hain."','⚡ "Apne sapnon ke liye khud laro."','👑 "Waqt badalta hai, himmat mat choro."','🌟 "Mehnat kabhi bekar nahi jaati."'];
                    await reply(qs[Math.floor(Math.random() * qs.length)]);
                }
                else if (cmd === 'calc') {
                    if (!text) return reply('❌ Example: .calc 5+5');
                    try {
                        const result = Function(`"use strict"; return (${text.replace(/[^0-9+\-*/().%\s]/g, '')})`)();
                        await reply(`🧮 *Calc:* ${text} = *${result}*`);
                    } catch { await reply('❌ Invalid!'); }
                }
                else if (cmd === 'weather') {
                    if (!text) return reply('❌ Example: .weather Karachi');
                    try {
                        const res = await axios.get(`https://wttr.in/${encodeURIComponent(text)}?format=3`);
                        await reply(`🌤️ *Weather:*\n${res.data}`);
                    } catch { await reply('❌ Weather nahi mila!'); }
                }

                // ── OWNER ──────────────────────────────────
                else if (cmd === 'mod') {
                    if (!isOwner) return reply('❌ Sirf owner use kar sakta hai!');
                    if (text === 'public') { cfg.mode = 'public'; saveCfg(); await reply('✅ *Mode: PUBLIC*\nAb sab use kar sakte hain!'); }
                    else if (text === 'private') { cfg.mode = 'private'; saveCfg(); await reply('🔒 *Mode: PRIVATE*\nSirf owner use kar sakta hai!'); }
                    else await reply('❌ Use: .mod public ya .mod private');
                }
                else if (cmd === 'auto') {
                    if (!isOwner) return reply('❌ Sirf owner use kar sakta hai!');
                    if (text === 'status on') { cfg.autoStatus = true; saveCfg(); await reply('✅ *Auto Status View: ON*'); }
                    else if (text === 'status off') { cfg.autoStatus = false; saveCfg(); await reply('❌ *Auto Status View: OFF*'); }
                    else await reply('❌ Use: .auto status on ya .auto status off');
                }
                else if (cmd === 'call') {
                    if (!isOwner) return reply('❌ Sirf owner use kar sakta hai!');
                    if (text === 'on') { cfg.callBlock = true; saveCfg(); await reply('🚫 *Calls Block: ON*'); }
                    else if (text === 'off') { cfg.callBlock = false; saveCfg(); await reply('✅ *Calls Allow: ON*'); }
                    else await reply('❌ Use: .call on ya .call off');
                }
                else if (cmd === 'online') {
                    if (!isOwner) return reply('❌ Sirf owner use kar sakta hai!');
                    if (text === 'on') {
                        cfg.onlinePresence = true; saveCfg();
                        if (onlineInterval) clearInterval(onlineInterval);
                        onlineInterval = setInterval(async () => {
                            try { await sock.sendPresenceUpdate('available'); } catch {}
                        }, 10000);
                        await reply('🟢 *Online Presence: ON*\nAb tu offline hoga to bhi bot online dikhega!');
                    } else if (text === 'off') {
                        cfg.onlinePresence = false; saveCfg();
                        if (onlineInterval) clearInterval(onlineInterval);
                        onlineInterval = null;
                        await reply('⚫ *Online Presence: OFF*');
                    } else await reply('❌ Use: .online on ya .online off');
                }
                else if (cmd === 'block') {
                    if (!isOwner) return reply('❌ Sirf owner use kar sakta hai!');
                    const m = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                    if (!m) return reply('❌ Tag karo: .block @number');
                    await sock.updateBlockStatus(m, 'block');
                    await reply(`🚫 *Blocked:* @${m.split('@')[0]}`);
                }
                else if (cmd === 'unblock') {
                    if (!isOwner) return reply('❌ Sirf owner use kar sakta hai!');
                    const m = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                    if (!m) return reply('❌ Tag karo: .unblock @number');
                    await sock.updateBlockStatus(m, 'unblock');
                    await reply(`✅ *Unblocked:* @${m.split('@')[0]}`);
                }
                else if (cmd === 'broadcast') {
                    if (!isOwner) return reply('❌ Sirf owner use kar sakta hai!');
                    if (!text) return reply('❌ Message likho: .broadcast Hello!');
                    await reply(`📢 *Broadcast:*\n${text}`);
                }

                // ── GROUP ──────────────────────────────────
                else if (cmd === 'tagall') {
                    if (!isGroup) return reply('❌ Group mein use karo!');
                    if (!isOwner) return reply('❌ Sirf owner use kar sakta hai!');
                    const meta = await sock.groupMetadata(from);
                    let tagText = `📢 *Tag All:*\n${text || 'Attention!'}\n\n`;
                    const mentions = [];
                    for (const m of meta.participants) { tagText += `@${m.id.split('@')[0]} `; mentions.push(m.id); }
                    await sock.sendMessage(from, { text: tagText, mentions }, { quoted: msg });
                }
                else if (cmd === 'kick') {
                    if (!isGroup || !isOwner) return reply('❌ Group owner zaroorat hai!');
                    const m = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                    if (!m) return reply('❌ Tag karo: .kick @user');
                    await sock.groupParticipantsUpdate(from, [m], 'remove');
                    await reply(`✅ *Kicked:* @${m.split('@')[0]}`);
                }
                else if (cmd === 'promote') {
                    if (!isGroup || !isOwner) return reply('❌ Group owner zaroorat hai!');
                    const m = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                    if (!m) return reply('❌ Tag karo: .promote @user');
                    await sock.groupParticipantsUpdate(from, [m], 'promote');
                    await reply(`⬆️ *Admin bana diya:* @${m.split('@')[0]}`);
                }
                else if (cmd === 'demote') {
                    if (!isGroup || !isOwner) return reply('❌ Group owner zaroorat hai!');
                    const m = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                    if (!m) return reply('❌ Tag karo: .demote @user');
                    await sock.groupParticipantsUpdate(from, [m], 'demote');
                    await reply(`⬇️ *Admin hata diya:* @${m.split('@')[0]}`);
                }

                // ── MEDIA & AI ─────────────────────────────
                else if (cmd === 'sticker') {
                    const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                    const imgMsg = quoted?.imageMessage || msg.message?.imageMessage;
                    if (!imgMsg) return reply('❌ Image quote karo ya saath bhejo!');
                    try {
                        const buf = await sock.downloadMediaMessage({ message: { imageMessage: imgMsg }, key: msg.key }, 'buffer');
                        await sock.sendMessage(from, { sticker: buf }, { quoted: msg });
                    } catch { await reply('❌ Sticker nahi bana!'); }
                }
                else if (cmd === 'tts') {
                    if (!text) return reply('❌ Example: .tts Hello');
                    const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=ur&client=tw-ob`;
                    await sock.sendMessage(from, { audio: { url }, mimetype: 'audio/mpeg', ptt: true }, { quoted: msg });
                }
                else if (cmd === 'ai') {
                    if (!text) return reply('❌ Example: .ai Pakistan ki capital?');
                    await reply('🤖 *Sooch raha hoon...*');
                    try {
                        const res = await axios.post('https://api.anthropic.com/v1/messages', {
                            model: 'claude-sonnet-4-20250514', max_tokens: 500,
                            messages: [{ role: 'user', content: text }]
                        }, { headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY || '', 'anthropic-version': '2023-06-01', 'content-type': 'application/json' } });
                        await reply(`🤖 *AI:*\n${res.data.content[0].text}`);
                    } catch { await reply('❌ AI error!'); }
                }
                else if (cmd === 'imagine') {
                    if (!text) return reply('❌ Example: .imagine red lion');
                    await reply('🎨 *Image feature coming soon!*');
                }

            } catch (err) {
                console.error('❌ Error:', err?.message);
            }
        }
    });
}

startBot();
