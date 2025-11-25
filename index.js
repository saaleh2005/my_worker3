/**
 * AquaWorldBot - نسخه کامل Cloudflare Worker (ES Module)
 * آیدی ربات: @AquaWorldir_bot
 * قابلیت‌ها: مدیریت گروه پیشرفته + هوش مصنوعی تخصصی آکواریوم
 */

const TELEGRAM_API_BASE = (token) => `https://api.telegram.org/bot${token}`;
const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";

export default {
  async fetch(request, env, ctx) {
    return handleRequest(request, env);
  }
};

async function handleRequest(req, env) {
  const url = new URL(req.url);
  if (req.method === "GET") return new Response("AquaWorldBot Worker running.");
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  const path = url.pathname;
  const secret = env.WEBHOOK_SECRET || "";
  if (!path.includes(`/${secret}`)) return new Response("Forbidden", { status: 403 });

  const body = await req.json().catch(() => ({}));
  if (body.message) await handleMessage(body.message, env).catch(e => console.error("handleMessage", e));

  return new Response("ok");
}

// Helpers KV
async function getChatSettings(chatId, env) {
  const key = `settings:${chatId}`;
  const raw = await env.WARNINGS_KV.get(key);
  if (!raw) {
    const defaults = {
      delete_links: true,
      delete_profanity: true,
      delete_media: false,
      anti_spam: true,
      welcome: true,
      ai_on_mention: true,
      ai_on_command: true,
      profanity_list: [
        "بی‌شعور","احمق","دروغگو","حرومزاده","بزدل","نادان","بی‌ادب","کله‌خر","مزخرف","خفه‌شو","کیر","کس","سکس","کسکش"
      ],
      admins: (env.ADMIN_IDS || "").split(",").map(s => s.trim()).filter(Boolean).map(Number)
    };
    await env.WARNINGS_KV.put(key, JSON.stringify(defaults));
    return defaults;
  }
  try { return JSON.parse(raw); } catch { return {}; }
}

async function setChatSettings(chatId, settings, env) {
  await env.WARNINGS_KV.put(`settings:${chatId}`, JSON.stringify(settings));
}

async function getWarningsKey(chatId, userId, env) {
  const raw = await env.WARNINGS_KV.get(`warn:${chatId}:${userId}`);
  return raw ? Number(raw) : 0;
}

async function setWarningsKey(chatId, userId, count, env) {
  await env.WARNINGS_KV.put(`warn:${chatId}:${userId}`, String(count));
}

async function clearWarnings(chatId, userId, env) {
  await env.WARNINGS_KV.delete(`warn:${chatId}:${userId}`);
}

// Telegram wrapper
async function tg(method, params, env) {
  const url = `${TELEGRAM_API_BASE(env.TELEGRAM_TOKEN)}/${method}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params)
  }).catch(e => ({ ok: false, error: e }));

  const j = await res.json().catch(() => ({ ok: false }));
  if (!j.ok) console.error("tg error", method, j);
  return j;
}

// OpenAI helper
async function callOpenAI(userMessage, env, specializeAquarium = false) {
  if (!env.OPENAI_API_KEY) return "هوش مصنوعی فعال نیست — کلید OpenAI را ست کن.";
  const system = specializeAquarium
    ? "You are an expert aquarium and fish care assistant. Answer in Persian with practical, safe advice."
    : "You are a helpful assistant. Answer in Persian.";

  const payload = {
    model: "gpt-4o-mini",
    messages: [{ role: "system", content: system }, { role: "user", content: userMessage }],
    max_tokens: 600,
    temperature: 0.7
  };

  const resp = await fetch(OPENAI_CHAT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${env.OPENAI_API_KEY}`
    },
    body: JSON.stringify(payload)
  }).catch(e => null);

  if (!resp) return "خطا در تماس با OpenAI.";
  const j = await resp.json().catch(() => null);
  if (!j) return "پاسخی دریافت نشد از OpenAI.";
  if (j.choices && j.choices[0] && j.choices[0].message) return j.choices[0].message.content;
  if (j.choices && j.choices[0] && j.choices[0].text) return j.choices[0].text;
  return "پاسخ نامشخص از OpenAI.";
}

// Helpers
function isAdmin(userId, settings, env) {
  const sAdmins = settings && settings.admins ? settings.admins : [];
  const combined = Array.from(new Set([...(sAdmins || []), ...(env.ADMIN_IDS || "").split(",").map(Number)]));
  return combined.map(Number).includes(Number(userId));
}

async function tryDeleteMessage(chatId, messageId, env) {
  try { await tg("deleteMessage", { chat_id: chatId, message_id: messageId }, env); } catch (e) { console.error(e); }
}
async function banUser(chatId, userId, env) {
  try { await tg("banChatMember", { chat_id: chatId, user_id: userId }, env); } catch (e) { console.error(e); }
}
async function muteUser(chatId, userId, seconds, env) {
  await tg("restrictChatMember", {
    chat_id: chatId,
    user_id: userId,
    permissions: { can_send_messages: false, can_send_media_messages: false, can_send_polls: false, can_send_other_messages: false, can_add_web_page_previews: false },
    until_date: Math.floor(Date.now() / 1000) + seconds
  }, env);
}
async function unmuteUser(chatId, userId, env) {
  await tg("restrictChatMember", {
    chat_id: chatId,
    user_id: userId,
    permissions: { can_send_messages: true, can_send_media_messages: true, can_send_polls: true, can_send_other_messages: true, can_add_web_page_previews: true }
  }, env);
  await clearWarnings(chatId, userId, env);
}

// Main handler
async function handleMessage(msg, env) {
  const chatId = msg.chat.id;
  const from = msg.from;
  const text = msg.text || "";
  const settings = await getChatSettings(chatId, env);

  // Admin commands
  if (text && isAdmin(from.id, settings, env)) {
    const setMatch = text.match(/^\/تنظیم\s+(\S+)\s+(on|off)/i);
    if (setMatch) {
      const keymap = { "لینک": "delete_links", "فحش": "delete_profanity", "رسانه": "delete_media", "ضداسپم": "anti_spam", "خوشامد": "welcome", "هوش": "ai_on_mention", "دستوری": "ai_on_command" };
      const short = setMatch[1];
      const onoff = setMatch[2].toLowerCase() === "on";
      const real = keymap[short] || short;
      settings[real] = onoff;
      await setChatSettings(chatId, settings, env);
      await tg("sendMessage", { chat_id: chatId, text: `تنظیم ${short} روی ${onoff ? "روشن" : "خاموش"} شد.` }, env);
      return;
    }

    if (text.startsWith("/بن") && msg.reply_to_message) {
      const target = msg.reply_to_message.from;
      await banUser(chatId, target.id, env);
      await tg("sendMessage", { chat_id: chatId, text: `کاربر ${target.first_name} بن شد.` }, env);
      return;
    }

    if (text.startsWith("/اخطار") && msg.reply_to_message) {
      const target = msg.reply_to_message.from;
      const prev = await getWarningsKey(chatId, target.id, env);
      const now = prev + 1;
      await setWarningsKey(chatId, target.id, now, env);
      if (now >= 3) {
        await banUser(chatId, target.id, env);
        await clearWarnings(chatId, target.id, env);
        await tg("sendMessage", { chat_id: chatId, text: `کاربر ${target.first_name} به دلیل رسیدن به حد اخطار (3) بن شد.` }, env);
      } else {
        await tg("sendMessage", { chat_id: chatId, text: `کاربر ${target.first_name} اخطار گرفت. تعداد اخطارها: ${now}/3` }, env);
      }
      return;
    }

    const muteMatch = text.match(/^\/سکوت(?:\s+(\d+))?/i);
    if (muteMatch && msg.reply_to_message) {
      const seconds = muteMatch[1] ? Number(muteMatch[1]) : 3600;
      const target = msg.reply_to_message.from;
      await muteUser(chatId, target.id, seconds, env);
      await tg("sendMessage", { chat_id: chatId, text: `کاربر ${target.first_name} به مدت ${seconds} ثانیه سکوت شد.` }, env);
      return;
    }

    if (text.startsWith("/باز") && msg.reply_to_message) {
      const target = msg.reply_to_message.from;
      await unmuteUser(chatId, target.id, env);
      await tg("sendMessage", { chat_id: chatId, text: `کاربر ${target.first_name} از سکوت خارج شد و اخطارها پاک شد.` }, env);
      return;
    }
  }

  // Welcome
  if (msg.new_chat_members && settings.welcome) {
    for (const member of msg.new_chat_members) {
      const welcomeText = settings.welcome_message || `خوش آمدی ${member.first_name}! قوانین را رعایت کن و @AquaWorldir_bot را منشن کن برای کمک.`;
      await tg("sendMessage", { chat_id: chatId, text: welcomeText }, env);
    }
  }

  // Moderation
  if (!isAdmin(from.id, settings, env)) {
    if (settings.delete_links && text && (text.includes("http://") || text.includes("https://") || text.includes("www.") || text.includes("@")))
      await tryDeleteMessage(chatId, msg.message_id, env);
    if (settings.delete_profanity && text) {
      const lower = text.toLowerCase();
      for (const bad of settings.profanity_list || [])
        if (bad && lower.includes(bad)) { await tryDeleteMessage(chatId, msg.message_id, env); return; }
    }
  }

  // AI
  const botMentioned = text && (text.includes("@AquaWorldir_bot") || text.includes("AquaWorldir_bot"));
  const askCmd = text && text.match(/^\/ask\s+([\s\S]+)/i);
  if ((settings.ai_on_mention && botMentioned) || (settings.ai_on_command && askCmd)) {
    let userQuery = askCmd ? askCmd[1].trim() : text.replace(/@AquaWorldir_bot/ig, "").trim();
    const aqKeywords = ["ماهی","آکواریوم","پرورش","تکثیر","فیلتر","ph","نیترات","نیترایت","پلنت","شریمپ","shrimp"];
    const lower = (userQuery || "").toLowerCase();
    const isAq = aqKeywords.some(k => lower.includes(k));
    const replyText = await callOpenAI(userQuery, env, isAq);
    await tg("sendMessage", { chat_id, text: replyText, reply_to_message_id: msg.message_id }, env);
    return;
  }
}
