// Email to customers through Resend. Optional: without RESEND_API_KEY and
// MAIL_FROM (for example "sha3.si <alerts@sha3.si>", on a domain verified in
// Resend) nothing is sent and the caller tells the owner to write instead.
export const mailConfigured = Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM);

export async function sendMail({ to, subject, text }) {
  if (!mailConfigured || !to) return false;
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ from: process.env.MAIL_FROM, to: [to], subject, text, reply_to: process.env.MAIL_REPLY_TO || "hello@sha3.si" }),
      signal: AbortSignal.timeout(10000),
    });
    return r.ok;
  } catch {
    return false;
  }
}
