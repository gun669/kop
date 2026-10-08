// Guest-facing transactional email — booking confirmations and the
// 24-hours-before class reminder (Gün, Oct 5 2026: "I feel like we should
// [send a confirmation]... also a reminder, possibly a day before").
//
// Same fail-open, env-var-gated shape as src/lib/iyzico.ts: every sender
// here no-ops (and logs, never throws) if RESEND_API_KEY or EMAIL_FROM
// isn't set, and a failed send is caught and swallowed rather than ever
// breaking a booking or a reminder run for other guests. Needs a real
// verified sending domain in Resend before EMAIL_FROM can be anything
// other than their onboarding/test address — until then this is simply
// inert, same as Iyzico was before real credentials existed.
import { Resend } from "resend";
import { formatDayLabel, formatTimeInZone } from "./time";

export function isEmailConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

let client: Resend | null = null;
function resend() {
  if (!client) {
    if (!process.env.RESEND_API_KEY) {
      throw new Error("Email is not configured (RESEND_API_KEY missing)");
    }
    client = new Resend(process.env.RESEND_API_KEY);
  }
  return client;
}

function layout(studioName: string, heading: string, bodyHtml: string) {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f5f3ef;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1c1917;">
    <div style="max-width:480px;margin:0 auto;padding:32px 24px;">
      <p style="margin:0 0 20px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#a8a29e;">${escapeHtml(studioName)}</p>
      <h1 style="margin:0 0 16px;font-size:20px;font-weight:600;">${escapeHtml(heading)}</h1>
      ${bodyHtml}
      <p style="margin-top:32px;font-size:12px;color:#a8a29e;">Sent by ${escapeHtml(studioName)} via KOP.</p>
    </div>
  </body>
</html>`;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

type ClassDetails = {
  studioName: string;
  classTypeName: string | null;
  teacherName: string | null;
  room: string | null;
  startsAt: Date;
  timezone: string;
};

function classLine(d: ClassDetails) {
  const when = `${formatDayLabel(d.startsAt, d.timezone)} · ${formatTimeInZone(d.startsAt, d.timezone)}`;
  const who = [d.classTypeName ?? "Class", d.teacherName].filter(Boolean).join(" with ");
  return `<p style="margin:0 0 4px;font-size:16px;font-weight:600;">${escapeHtml(who)}</p>
    <p style="margin:0;font-size:14px;color:#57534e;">${escapeHtml(when)}${d.room ? ` · ${escapeHtml(d.room)}` : ""}</p>`;
}

// Optional action links shown under the class card: sign the one-time
// waiver (only passed when the guest hasn't signed yet) and cancel the
// booking (see /book/cancel/[token]).
function linksBlock(links: { cancelUrl?: string; waiverUrl?: string; cancelWindowHours?: number }) {
  const parts: string[] = [];
  if (links.waiverUrl) {
    parts.push(
      `<p style="margin:16px 0 0;font-size:14px;color:#44403c;">First time with us? Please <a href="${escapeHtml(links.waiverUrl)}" style="color:#8C3B28;">complete the quick health &amp; waiver form</a> before your class.</p>`
    );
  }
  if (links.cancelUrl) {
    const win = links.cancelWindowHours ?? 12;
    parts.push(
      `<p style="margin:16px 0 0;font-size:13px;color:#78716c;">Can't make it? <a href="${escapeHtml(links.cancelUrl)}" style="color:#78716c;">Cancel your booking</a>. Cancelling more than ${win} hours before class is free; later than that costs one class credit.</p>`
    );
  }
  return parts.join("");
}

// Sent right after a booking is confirmed — whether it was free (covered
// by an existing membership / pay-at-studio) or just paid for online via
// Iyzico. `paid` is only set for the latter, to show what was charged.
export async function sendBookingConfirmationEmail(params: {
  to: string;
  guestName: string;
  class: ClassDetails;
  paid?: { amount: string; currency: string };
  cancelUrl?: string;
  waiverUrl?: string;
  cancelWindowHours?: number;
}) {
  if (!isEmailConfigured()) return { sent: false as const, reason: "not_configured" as const };
  try {
    const html = layout(
      params.class.studioName,
      "You're booked!",
      `<p style="margin:0 0 20px;font-size:14px;color:#44403c;">Hi ${escapeHtml(params.guestName)}, you're confirmed for:</p>
       <div style="padding:16px;border:1px solid #e7e5e4;border-radius:12px;margin-bottom:16px;">
         ${classLine(params.class)}
       </div>
       ${
         params.paid
           ? `<p style="margin:0;font-size:14px;color:#44403c;">Paid online: ${escapeHtml(params.paid.amount)} ${escapeHtml(params.paid.currency)}</p>`
           : `<p style="margin:0;font-size:14px;color:#44403c;">Pay at the studio, or use a credit already on your account.</p>`
       }${linksBlock(params)}`
    );
    const result = await resend().emails.send({
      from: process.env.EMAIL_FROM!,
      to: params.to,
      subject: `Booked: ${params.class.classTypeName ?? "Class"} — ${formatDayLabel(params.class.startsAt, params.class.timezone)}`,
      html,
    });
    if (result.error) {
      console.error("Booking confirmation email failed", result.error);
      return { sent: false as const, reason: "send_failed" as const };
    }
    return { sent: true as const };
  } catch (err) {
    console.error("Booking confirmation email failed", err);
    return { sent: false as const, reason: "send_failed" as const };
  }
}

// Sent ~24h before class by the reminders cron (src/app/api/cron/class-reminders).
export async function sendClassReminderEmail(params: {
  to: string;
  guestName: string;
  class: ClassDetails;
  cancelUrl?: string;
  waiverUrl?: string;
  cancelWindowHours?: number;
}) {
  if (!isEmailConfigured()) return { sent: false as const, reason: "not_configured" as const };
  try {
    const html = layout(
      params.class.studioName,
      "See you tomorrow",
      `<p style="margin:0 0 20px;font-size:14px;color:#44403c;">Hi ${escapeHtml(params.guestName)}, a reminder about your class:</p>
       <div style="padding:16px;border:1px solid #e7e5e4;border-radius:12px;">
         ${classLine(params.class)}
       </div>${linksBlock(params)}`
    );
    const result = await resend().emails.send({
      from: process.env.EMAIL_FROM!,
      to: params.to,
      subject: `Reminder: ${params.class.classTypeName ?? "Class"} tomorrow at ${formatTimeInZone(params.class.startsAt, params.class.timezone)}`,
      html,
    });
    if (result.error) {
      console.error("Class reminder email failed", result.error);
      return { sent: false as const, reason: "send_failed" as const };
    }
    return { sent: true as const };
  } catch (err) {
    console.error("Class reminder email failed", err);
    return { sent: false as const, reason: "send_failed" as const };
  }
}
