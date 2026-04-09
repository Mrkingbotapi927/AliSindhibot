import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── ANTI-BAN ─────────────────────────────────────────────
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const randomDelay = (min = 800, max = 2500) => sleep(Math.floor(Math.random() * (max - min + 1)) + min);
const spamMap = new Map();
const SPAM_LIMIT_MS = 3000;

function isSpam(num) {
    const now = Date.now();
    const last = spamMap.get(num) || 0;
    if (now - last < SPAM_LIMIT_MS) return true;
    spamMap.set(num, now);
    return false;
}

async function sendWithTyping(sock, jid, content, options = {}) {
    try {
        await sock.presenceSubscribe(jid);
        await randomDelay(300, 800);
        await sock.sendPresenceUpdate('composing', jid);
        await randomDelay(600, 1800);
        await sock.sendPresenceUpdate('paused', jid);
    } catch {}
    return sock.sendMessage(jid, content, options);
}

// ─── CONFIG ───────────────────────────────────────────────
const configFile = './config.json';
const config = {
    ownerNumber: process.env.OWNER_NUMBER || '',
    prefix: '.',
    mode: 'public',
    autoStatusView: true,
    callBlock: false,
    typingSimulation: true,
    antiSpam: true,
    messageDelay: true,
};

if (fs.existsSync(configFile)) {
    try { Object.assign(config, JSON.parse(fs.readFileSync(configFile))); } catch {}
}

function saveConfig() {
    fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
}

const botImagePath = path.join(__dirname, 'ali_sindhi.png');

function getMenuText() {
    return `▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰
⚡ *DEVELOPER BOY ALI SINDHI* ⚡
▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰
👑 *Owner:* ${config.ownerNumber || 'Not Set!'}
🌐 *Mode:* ${config.mode}
💎 *Status:* Online
▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰

╔══「 🤖 *BOT COMMANDS* 」══╗

🔰 *GENERAL*
├ ${config.prefix}menu — Yeh menu
├ ${config.prefix}alive — Bot online check
├ ${config.prefix}ping — Response speed

⚙️ *SETTINGS*
├ ${config.prefix}mod public — Public mode on
├ ${config.prefix}mod private — Private mode on
├ ${config.prefix}auto status on — Auto status view on
├ ${config.prefix}auto status off — Auto status view off
├ ${config.prefix}call on — Calls block karo
├ ${config.prefix}call off — Calls allow karo

👥 *GROUP*
├ ${config.prefix}tagall — Sab ko tag karo
├ ${config.prefix}kick @user — Member hatao
├ ${config.prefix}promote @user — Admin banao
├ ${config.prefix}demote @user — Admin hatao

🛠️ *UTILITY*
├ ${config.prefix}block @user — Number block
├ ${config.prefix}unblock @user — Number unblock
├ ${config.prefix}broadcast msg — Sab ko message
├ ${config.prefix}sticker — Image to sticker
├ ${config.prefix}tts text — Text to speech
├ ${config.prefix}quote — Random quote
├ ${config.prefix}time — Current time
├ ${config.prefix}weather city — Mausam
├ ${config.prefix}calc expr — Calculator

🤖 *AI*
├ ${config.prefix}ai question — AI se poocho
├ ${config.prefix}imagine prompt — AI image

╚══════════════════════════╝

> ⚡ 𝐀𝐋𝐈 𝐒𝐈𝐍𝐃𝐇𝐈 ⚡`;
}

let pairingRequested = false;

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
        generateHighQualityLinkPreview: false,
    });

    sock.ev.on('creds.update', saveCreds);



    sock.ev.on('messages.upsert', async ({ messages }) => {
        for (const msg of messages) {
            if (msg.key.remoteJid === 'status@broadcast' && config.autoStatusView) {
                try { await sock.readMessages([msg.key]); } catch {}
            }
        }
    });

    sock.ev.on('call', async (calls) => {
        for (const call of calls) {
            if (config.callBlock && call.status === 'offer') {
                try {
                    await sock.rejectCall(call.id, call.from);
                    await sock.sendMessage(call.from, { text: '❌ *Calls blocked hain!*' });
                } catch {}
            }
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        for (const msg of messages) {
            try {
                if (!msg.message) continue;
                if (msg.key.remoteJid === 'status@broadcast') continue;

                const from = msg.key.remoteJid;
                const sender = msg.key.participant || msg.key.remoteJid;
                const senderNum = sender.replace('@s.whatsapp.net', '');
                const isOwner = senderNum === config.ownerNumber;
                const isGroup = from.endsWith('@g.us');

                const body = msg.message?.conversation
                    || msg.message?.extendedTextMessage?.text
                    || msg.message?.imageMessage?.caption || '';

                if (!body.startsWith(config.prefix)) continue;
                if (config.antiSpam && !isOwner && isSpam(senderNum)) continue;
                if (config.mode === 'private' && !isOwner) continue;
                if (config.messageDelay) await randomDelay(500, 1500);

                const args = body.slice(config.prefix.length).trim().split(' ');
                const cmd = args[0].toLowerCase();
                const text = args.slice(1).join(' ');

                const reply = async (txt) => {
                    if (config.typingSimulation) return sendWithTyping(sock, from, { text: txt }, { quoted: msg });
                    return sock.sendMessage(from, { text: txt }, { quoted: msg });
                };

                if (cmd === 'menu') {
                    const image = fs.readFileSync(botImagePath);
                    await sock.sendMessage(from, { image, caption: getMenuText() }, { quoted: msg });
                }
                else if (cmd === 'alive') {
                    await reply(`▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n⚡ *DEVELOPER BOY ALI SINDHI* ⚡\n▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n✅ *Bot Online Hai!*\n💎 *Status:* Active\n🌐 *Mode:* ${config.mode}\n⚡ 𝐀𝐋𝐈 𝐒𝐈𝐍𝐃𝐇𝐈 ⚡`);
                }
                else if (cmd === 'ping') {
                    const t = Date.now();
                    await reply(`🏓 *Pong!*\n⚡ Speed: ${Date.now() - t}ms`);
                }
                else if (cmd === 'mod' && isOwner) {
                    if (text === 'public') { config.mode = 'public'; saveConfig(); await reply('✅ *Mode: Public*'); }
                    else if (text === 'private') { config.mode = 'private'; saveConfig(); await reply('🔒 *Mode: Private*'); }
                    else await reply('❌ Use: .mod public ya .mod private');
                }
                else if (cmd === 'auto' && isOwner) {
                    if (text === 'status on') { config.autoStatusView = true; saveConfig(); await reply('✅ *Auto Status View: ON*'); }
                    else if (text === 'status off') { config.autoStatusView = false; saveConfig(); await reply('❌ *Auto Status View: OFF*'); }
                }
                else if (cmd === 'call' && isOwner) {
                    if (text === 'on') { config.callBlock = true; saveConfig(); await reply('🚫 *Calls Block: ON*'); }
                    else if (text === 'off') { config.callBlock = false; saveConfig(); await reply('✅ *Calls Block: OFF*'); }
                }
                else if (cmd === 'block' && isOwner) {
                    const m = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                    if (m) { await sock.updateBlockStatus(m, 'block'); await reply(`🚫 *Blocked:* @${m.split('@')[0]}`); }
                    else await reply('❌ Kisi ko tag karo: .block @number');
                }
                else if (cmd === 'unblock' && isOwner) {
                    const m = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                    if (m) { await sock.updateBlockStatus(m, 'unblock'); await reply(`✅ *Unblocked:* @${m.split('@')[0]}`); }
                    else await reply('❌ Kisi ko tag karo: .unblock @number');
                }
                else if (cmd === 'broadcast' && isOwner) {
                    if (!text) { await reply('❌ Message likho: .broadcast Hello sab!'); continue; }
                    await reply(`✅ Broadcast ready!\n\n*Message:* ${text}`);
                }
                else if (cmd === 'sticker') {
                    const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                    const imgMsg = quoted?.imageMessage || msg.message?.imageMessage;
                    if (!imgMsg) { await reply('❌ Koi image quote karo!'); continue; }
                    try {
                        const buf = await sock.downloadMediaMessage({ message: { imageMessage: imgMsg }, key: msg.key }, 'buffer');
                        await sock.sendMessage(from, { sticker: buf }, { quoted: msg });
                    } catch { await reply('❌ Sticker nahi bana!'); }
                }
                else if (cmd === 'tts') {
                    if (!text) { await reply('❌ Text likho: .tts Hello'); continue; }
                    const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=ur&client=tw-ob`;
                    await sock.sendMessage(from, { audio: { url }, mimetype: 'audio/mpeg', ptt: true }, { quoted: msg });
                }
                else if (cmd === 'quote') {
                    const qs = ['💎 "Kamyabi woh hai jo haar ke bhi larta rahe."', '🔥 "Mushkilein tujhe mazboot banati hain."', '⚡ "Apne sapnon ke liye khud laro."', '👑 "Waqt badalta hai, himmat mat choro."', '🌟 "Mehnat kabhi bekar nahi jaati."'];
                    await reply(qs[Math.floor(Math.random() * qs.length)]);
                }
                else if (cmd === 'time') {
                    const now = new Date();
                    await reply(`🕐 *Current Time:*\n📅 Date: ${now.toLocaleDateString('en-PK')}\n⏰ Time: ${now.toLocaleTimeString('en-PK', { timeZone: 'Asia/Karachi' })}\n🌍 PKT (UTC+5)`);
                }
                else if (cmd === 'weather') {
                    if (!text) { await reply('❌ City likho: .weather Karachi'); continue; }
                    try {
                        const res = await axios.get(`https://wttr.in/${encodeURIComponent(text)}?format=3`);
                        await reply(`🌤️ *Weather:*\n${res.data}`);
                    } catch { await reply('❌ Weather nahi mila!'); }
                }
                else if (cmd === 'calc') {
                    if (!text) { await reply('❌ Expression likho: .calc 5+5'); continue; }
                    try {
                        const result = Function(`"use strict"; return (${text.replace(/[^0-9+\-*/().%\s]/g, '')})`)();
                        await reply(`🧮 *Calc:* ${text} = *${result}*`);
                    } catch { await reply('❌ Invalid expression!'); }
                }
                else if (cmd === 'tagall' && isGroup) {
                    if (!isOwner) { await reply('❌ Sirf owner!'); continue; }
                    const meta = await sock.groupMetadata(from);
                    let tagText = `📢 *Tag All:*\n${text || 'Attention!'}\n\n`;
                    const mentions = [];
                    for (const m of meta.participants) { tagText += `@${m.id.split('@')[0]} `; mentions.push(m.id); }
                    await sock.sendMessage(from, { text: tagText, mentions }, { quoted: msg });
                }
                else if (cmd === 'kick' && isGroup && isOwner) {
                    const m = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                    if (!m) { await reply('❌ Tag karo: .kick @user'); continue; }
                    await sock.groupParticipantsUpdate(from, [m], 'remove');
                    await reply(`✅ *Kicked:* @${m.split('@')[0]}`);
                }
                else if (cmd === 'promote' && isGroup && isOwner) {
                    const m = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                    if (!m) { await reply('❌ Tag karo: .promote @user'); continue; }
                    await sock.groupParticipantsUpdate(from, [m], 'promote');
                    await reply(`⬆️ *Admin bana diya:* @${m.split('@')[0]}`);
                }
                else if (cmd === 'demote' && isGroup && isOwner) {
                    const m = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                    if (!m) { await reply('❌ Tag karo: .demote @user'); continue; }
                    await sock.groupParticipantsUpdate(from, [m], 'demote');
                    await reply(`⬇️ *Admin hata diya:* @${m.split('@')[0]}`);
                }
                else if (cmd === 'ai') {
                    if (!text) { await reply('❌ Sawaal poocho!'); continue; }
                    await reply('🤖 *Sooch raha hoon...*');
                    try {
                        const res = await axios.post('https://api.anthropic.com/v1/messages', {
                            model: 'claude-sonnet-4-20250514', max_tokens: 500,
                            messages: [{ role: 'user', content: text }]
                        }, { headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY || '', 'anthropic-version': '2023-06-01', 'content-type': 'application/json' } });
                        await reply(`🤖 *AI:*\n${res.data.content[0].text}`);
                    } catch { await reply('❌ AI error. API key check karo!'); }
                }
                else if (cmd === 'imagine') {
                    if (!text) { await reply('❌ Prompt likho: .imagine red lion'); continue; }
                    await reply('🎨 *Image feature coming soon!*');
                }

            } catch (err) {
                console.error('Error:', err?.message);
            }
        }
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'connecting' && !state.creds.me && !pairingRequested) {
            pairingRequested = true;
            console.log('⏳ Pairing code aa raha hai...');
            setTimeout(async () => {
                try {
                    let code = await sock.requestPairingCode(config.ownerNumber);
                    code = code?.match(/.{1,4}/g)?.join('-') || code;
                    console.log('');
                    console.log('╔══════════════════════════════════╗');
                    console.log('║   🔑 WHATSAPP PAIRING CODE       ║');
                    console.log(`║        👉  ${code}  👈            ║`);
                    console.log('╚══════════════════════════════════╝');
                    console.log('📱 WhatsApp > Linked Devices > Link with Phone Number');
                    console.log('👆 Upar wala code enter karo!');
                } catch (err) {
                    console.error('❌ Pairing Error:', err.message);
                    pairingRequested = false;
                }
            }, 2000);
        }

        if (connection === 'open') {
            console.log('✅ DEVELOPER BOY ALI SINDHI is ONLINE!');
            pairingRequested = false;
        }

        if (connection === 'close') {
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
}

startBot();
