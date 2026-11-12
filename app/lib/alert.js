// Owner alerts on Telegram, sent as rich messages with a plain-text fallback
// (lib/telegram.js). Optional: without a bot token and TELEGRAM_CHAT_ID,
// alerts are skipped and everything else still works.
import { alertNotice } from "./telegram.js";

export async function alert(title, lines = [], rows = []) {
  const r = await alertNotice(title, rows, { lines: lines.filter(Boolean) });
  return Boolean(r.ok);
}
