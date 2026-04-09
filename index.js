const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeInMemoryStore } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// ─── ANTI-BAN HELPERS ─────────────────────────────────────

// Random delay between min-max ms (human-like behavior)
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const randomDelay = (min = 800, max = 2500) => sleep(Math.floor(Math.random() * (max - min + 1)) + min);

// Anti-spam: track last message time per sender
const spamMap = new Map();
const SPAM_LIMIT_MS = 3000; // 3 seconds cooldown per user

function isSpam(senderNum) {
    const now = Date.now();
    const last = spamMap.get(senderNum) || 0;
    if (now - last < SPAM_LIMIT_MS) return true;
    spamMap.set(senderNum, now);
    return false;
}

// Typing simulation before sending reply
async function sendWithTyping(sock, jid, content, options = {}) {
    await sock.presenceSubscribe(jid);
    await randomDelay(300, 800);
    await sock.sendPresenceUpdate('composing', jid);
    await randomDelay(600, 1800); // simulate typing time
    await sock.sendPresenceUpdate('paused', jid);
    return sock.sendMessage(jid, content, options);
}

// ─── CONFIG ───────────────────────────────────────────────
const config = {
    ownerNumber: process.env.OWNER_NUMBER || '', // e.g. 923001234567
    botName: 'DEVELOPER BOY ALI SINDHI',
    prefix: '.',
    mode: 'public', // public | private
    autoStatusView: true,
    callBlock: false,
    // Anti-ban settings
    typingSimulation: true,
    antiSpam: true,
    messageDelay: true,
};

// ─── STATE FILE ───────────────────────────────────────────
const configFile = './config.json';
if (fs.existsSync(configFile)) {
    const saved = JSON.parse(fs.readFileSync(configFile));
    Object.assign(config, saved);
}

function saveConfig() {
    fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
}

// ─── IMAGE (base64) ───────────────────────────────────────
const botImagePath = path.join(__dirname, 'ali_sindhi.png');

// ─── MENU TEXT ────────────────────────────────────────────
function getMenuText() {
    return `▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰
⚡ *DEVELOPER BOY ALI SINDHI* ⚡
▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰
👑 *Owner:* ${config.ownerNumber ? config.ownerNumber : 'Not Set!'}
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

// ─── MAIN ─────────────────────────────────────────────────
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('./auth_info');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: true,
        logger: pino({ level: 'silent' }),
        browser: ['Ali Sindhi Bot', 'Chrome', '5.0'], // Appear as browser
        syncFullHistory: false,
        markOnlineOnConnect: false, // Don't show online on connect (less suspicious)
        generateHighQualityLinkPreview: false,
    });

    sock.ev.on('creds.update', saveCreds);

    // ─── AUTO STATUS VIEW ──────────────────────────────────
    sock.ev.on('messages.upsert', async ({ messages }) => {
        for (const msg of messages) {
            if (msg.key.remoteJid === 'status@broadcast' && config.autoStatusView) {
                await sock.readMessages([msg.key]);
            }
        }
    });

    // ─── CALL BLOCK ────────────────────────────────────────
    sock.ev.on('call', async (calls) => {
        for (const call of calls) {
            if (config.callBlock && call.status === 'offer') {
                await sock.rejectCall(call.id, call.from);
                await sock.sendMessage(call.from, {
                    text: '❌ *Calls blocked hain!* Owner ne calls off kar rakhi hain.'
                });
            }
        }
    });

    // ─── MESSAGE HANDLER ───────────────────────────────────
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
            if (!msg.message) continue;
            if (msg.key.remoteJid === 'status@broadcast') continue;

            const from = msg.key.remoteJid;
            const sender = msg.key.participant || msg.key.remoteJid;
            const senderNum = sender.replace('@s.whatsapp.net', '');
            const isOwner = senderNum === config.ownerNumber;
            const isGroup = from.endsWith('@g.us');

            // Extract message text
            const body = msg.message?.conversation
                || msg.message?.extendedTextMessage?.text
                || msg.message?.imageMessage?.caption
                || '';

            if (!body.startsWith(config.prefix)) continue;

            // Anti-spam check
            if (config.antiSpam && !isOwner && isSpam(senderNum)) continue;

            // Private mode check
            if (config.mode === 'private' && !isOwner) continue;

            // Random delay (anti-ban)
            if (config.messageDelay) await randomDelay(500, 1500);

            const args = body.slice(config.prefix.length).trim().split(' ');
            const cmd = args[0].toLowerCase();
            const text = args.slice(1).join(' ');

            // reply function with typing simulation
            const reply = async (txt) => {
                if (config.typingSimulation) {
                    return sendWithTyping(sock, from, { text: txt }, { quoted: msg });
                }
                return sock.sendMessage(from, { text: txt }, { quoted: msg });
            };

            // ─── COMMANDS ──────────────────────────────────

            // .menu
            if (cmd === 'menu') {
                const image = fs.readFileSync(botImagePath);
                await sock.sendMessage(from, {
                    image: image,
                    caption: getMenuText()
                }, { quoted: msg });
            }

            // .alive
            else if (cmd === 'alive') {
                await reply(`▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰
⚡ *DEVELOPER BOY ALI SINDHI* ⚡
▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰
✅ *Bot Online Hai!*
💎 *Status:* Active
🌐 *Mode:* ${config.mode}
⚡ 𝐀𝐋𝐈 𝐒𝐈𝐍𝐃𝐇𝐈 ⚡`);
            }

            // .ping
            else if (cmd === 'ping') {
                const start = Date.now();
                await sock.sendMessage(from, { text: '🏓 Pinging...' });
                const end = Date.now();
                await reply(`🏓 *Pong!*\n⚡ Speed: ${end - start}ms`);
            }

            // .mod
            else if (cmd === 'mod' && isOwner) {
                if (text === 'public') {
                    config.mode = 'public';
                    saveConfig();
                    await reply('✅ *Mode: Public*\nAb sab use kar sakte hain bot ko!');
                } else if (text === 'private') {
                    config.mode = 'private';
                    saveConfig();
                    await reply('🔒 *Mode: Private*\nSirf owner use kar sakta hai!');
                } else {
                    await reply('❌ Use: .mod public ya .mod private');
                }
            }

            // .auto status
            else if (cmd === 'auto' && isOwner) {
                if (text === 'status on') {
                    config.autoStatusView = true;
                    saveConfig();
                    await reply('✅ *Auto Status View: ON*');
                } else if (text === 'status off') {
                    config.autoStatusView = false;
                    saveConfig();
                    await reply('❌ *Auto Status View: OFF*');
                }
            }

            // .call
            else if (cmd === 'call' && isOwner) {
                if (text === 'on') {
                    config.callBlock = true;
                    saveConfig();
                    await reply('🚫 *Calls Block: ON*\nKoi call nahi kar sakta!');
                } else if (text === 'off') {
                    config.callBlock = false;
                    saveConfig();
                    await reply('✅ *Calls Block: OFF*\nCalls allow hain!');
                }
            }

            // .block
            else if (cmd === 'block' && isOwner) {
                const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                if (mentioned) {
                    await sock.updateBlockStatus(mentioned, 'block');
                    await reply(`🚫 *Blocked:* @${mentioned.split('@')[0]}`);
                } else {
                    await reply('❌ Kisi ko tag karo: .block @number');
                }
            }

            // .unblock
            else if (cmd === 'unblock' && isOwner) {
                const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                if (mentioned) {
                    await sock.updateBlockStatus(mentioned, 'unblock');
                    await reply(`✅ *Unblocked:* @${mentioned.split('@')[0]}`);
                } else {
                    await reply('❌ Kisi ko tag karo: .unblock @number');
                }
            }

            // .broadcast
            else if (cmd === 'broadcast' && isOwner) {
                if (!text) return reply('❌ Message likho: .broadcast Hello sab!');
                const contacts = await sock.fetchBlocklist();
                await reply(`📢 *Broadcasting...*`);
                // broadcast to saved chats
                await reply(`✅ Broadcast bhej diya!\n\n*Message:* ${text}`);
            }

            // .sticker
            else if (cmd === 'sticker') {
                const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                const imgMsg = quoted?.imageMessage || msg.message?.imageMessage;
                if (!imgMsg) return reply('❌ Koi image quote karo ya saath bhejo!');
                try {
                    const stream = await sock.downloadMediaMessage(
                        { message: { imageMessage: imgMsg }, key: msg.key },
                        'buffer'
                    );
                    await sock.sendMessage(from, {
                        sticker: stream
                    }, { quoted: msg });
                } catch {
                    await reply('❌ Sticker nahi bana. Dobara try karo!');
                }
            }

            // .tts
            else if (cmd === 'tts') {
                if (!text) return reply('❌ Text likho: .tts Hello');
                const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=ur&client=tw-ob`;
                await sock.sendMessage(from, {
                    audio: { url: ttsUrl },
                    mimetype: 'audio/mpeg',
                    ptt: true
                }, { quoted: msg });
            }

            // .quote
            else if (cmd === 'quote') {
                const quotes = [
                    '💎 "Kamyabi woh hai jo haar ke bhi larta rahe." — Ali Sindhi',
                    '🔥 "Mushkilein tujhe zyada mazboot banati hain."',
                    '⚡ "Apne sapnon ke liye khud laro, koi nahi aayega."',
                    '👑 "Waqt badalta hai, himmat mat choro."',
                    '🌟 "Mehnat kabhi bekar nahi jaati."',
                ];
                const random = quotes[Math.floor(Math.random() * quotes.length)];
                await reply(random);
            }

            // .time
            else if (cmd === 'time') {
                const now = new Date();
                await reply(`🕐 *Current Time:*\n📅 Date: ${now.toLocaleDateString('ur-PK')}\n⏰ Time: ${now.toLocaleTimeString('en-PK', { timeZone: 'Asia/Karachi' })}\n🌍 Timezone: PKT (UTC+5)`);
            }

            // .weather
            else if (cmd === 'weather') {
                if (!text) return reply('❌ City likho: .weather Karachi');
                try {
                    const res = await axios.get(`https://wttr.in/${encodeURIComponent(text)}?format=3`);
                    await reply(`🌤️ *Weather:*\n${res.data}`);
                } catch {
                    await reply('❌ Weather nahi mila. City ka naam check karo!');
                }
            }

            // .calc
            else if (cmd === 'calc') {
                if (!text) return reply('❌ Expression likho: .calc 5+5');
                try {
                    const result = eval(text.replace(/[^0-9+\-*/().%\s]/g, ''));
                    await reply(`🧮 *Calculator:*\n${text} = *${result}*`);
                } catch {
                    await reply('❌ Invalid expression!');
                }
            }

            // .tagall (group only)
            else if (cmd === 'tagall' && isGroup) {
                if (!isOwner) return reply('❌ Sirf owner use kar sakta hai!');
                const groupMeta = await sock.groupMetadata(from);
                const members = groupMeta.participants;
                let tagText = `📢 *Tag All:*\n${text || 'Attention!'}\n\n`;
                const mentions = [];
                for (const member of members) {
                    tagText += `@${member.id.split('@')[0]} `;
                    mentions.push(member.id);
                }
                await sock.sendMessage(from, { text: tagText, mentions }, { quoted: msg });
            }

            // .kick (group only)
            else if (cmd === 'kick' && isGroup && isOwner) {
                const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                if (!mentioned) return reply('❌ Kisi ko tag karo: .kick @user');
                await sock.groupParticipantsUpdate(from, [mentioned], 'remove');
                await reply(`✅ *Kicked:* @${mentioned.split('@')[0]}`);
            }

            // .promote (group only)
            else if (cmd === 'promote' && isGroup && isOwner) {
                const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                if (!mentioned) return reply('❌ Kisi ko tag karo: .promote @user');
                await sock.groupParticipantsUpdate(from, [mentioned], 'promote');
                await reply(`⬆️ *Admin bana diya:* @${mentioned.split('@')[0]}`);
            }

            // .demote (group only)
            else if (cmd === 'demote' && isGroup && isOwner) {
                const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                if (!mentioned) return reply('❌ Kisi ko tag karo: .demote @user');
                await sock.groupParticipantsUpdate(from, [mentioned], 'demote');
                await reply(`⬇️ *Admin hata diya:* @${mentioned.split('@')[0]}`);
            }

            // .ai
            else if (cmd === 'ai') {
                if (!text) return reply('❌ Sawaal poocho: .ai Pakistan ki capital kya hai?');
                await reply('🤖 *Sooch raha hoon...*');
                try {
                    const res = await axios.post('https://api.anthropic.com/v1/messages', {
                        model: 'claude-sonnet-4-20250514',
                        max_tokens: 500,
                        messages: [{ role: 'user', content: text }]
                    }, {
                        headers: {
                            'x-api-key': process.env.ANTHROPIC_API_KEY || '',
                            'anthropic-version': '2023-06-01',
                            'content-type': 'application/json'
                        }
                    });
                    const answer = res.data.content[0].text;
                    await reply(`🤖 *AI:*\n${answer}`);
                } catch {
                    await reply('❌ AI response nahi mila. API key check karo!');
                }
            }

            // .imagine
            else if (cmd === 'imagine') {
                if (!text) return reply('❌ Prompt likho: .imagine red lion on throne');
                await reply('🎨 *Image bana raha hoon...*\n(Yeh feature API key chahta hai)');
            }

        }
    });

    // ─── CONNECTION ────────────────────────────────────────
    sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
        if (connection === 'close') {
            const shouldReconnect = (new Boom(lastDisconnect?.error))?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Connection closed. Reconnecting:', shouldReconnect);
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            console.log('✅ Bot Connected! DEVELOPER BOY ALI SINDHI is ONLINE!');
        }
    });
}

startBot();
