// Email to customers through Resend. Optional: without RESEND_API_KEY and
// MAIL_FROM (for example "sha3.si <alerts@sha3.si>", on a domain verified in
// Resend) nothing is sent and the caller tells the owner to write instead.
export const mailConfigured = Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM);

// The same signature as the owner's outreach emails, appended to every message.
export const SIGNATURE = [
  "--",
  "Abdelali El Amrani",
  "Founder, sha3.si",
  "https://sha3.si | hello@sha3.si",
  "sha3.si is a service of Servolia LLC, 30 N Gould St, Ste R, Sheridan, WY 82801, USA",
].join("\n");

export async function sendMail({ to, subject, text }) {
  if (!mailConfigured || !to) return false;
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ from: process.env.MAIL_FROM, to: [to], subject, text: `${text}\n\n${SIGNATURE}`, reply_to: process.env.MAIL_REPLY_TO || "hello@sha3.si" }),
      signal: AbortSignal.timeout(10000),
    });
    return r.ok;
  } catch {
    return false;
  }
}
