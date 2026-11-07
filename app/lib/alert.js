// Owner alerts on Telegram. Optional: without TELEGRAM_BOT_TOKEN and
// TELEGRAM_CHAT_ID set, alerts are skipped and everything else still works.
export async function alert(title, lines = []) {
  const tokenValue = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!tokenValue || !chat) return false;
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const text = [`<b>sha3.si: ${esc(title)}</b>`, ...lines.map(esc)].join("\n");
  try {
    const r = await fetch(`https://api.telegram.org/bot${tokenValue}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text, parse_mode: "HTML", disable_web_page_preview: true }),
      signal: AbortSignal.timeout(8000),
    });
    return r.ok;
  } catch {
    return false;
  }
}
