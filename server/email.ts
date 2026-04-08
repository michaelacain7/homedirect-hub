import nodemailer from "nodemailer";

// Configure SMTP transport from environment variables
// Set these env vars to enable email notifications:
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
const smtpHost = process.env.SMTP_HOST;
const smtpPort = parseInt(process.env.SMTP_PORT || "587", 10);
const smtpUser = process.env.SMTP_USER;
const smtpPass = process.env.SMTP_PASS;
const smtpFrom = process.env.SMTP_FROM || "HomeDirectAI HQ <noreply@homedirectai.com>";

let transporter: nodemailer.Transporter | null = null;

if (smtpHost && smtpUser && smtpPass) {
  transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465,
    auth: { user: smtpUser, pass: smtpPass },
  });
  console.log(`[email] SMTP configured: ${smtpHost}:${smtpPort}`);
} else {
  console.log("[email] SMTP not configured — email notifications disabled. Set SMTP_HOST, SMTP_USER, SMTP_PASS to enable.");
}

export function isEmailEnabled(): boolean {
  return transporter !== null;
}

async function sendMail(to: string, subject: string, html: string) {
  if (!transporter) return;
  try {
    await transporter.sendMail({ from: smtpFrom, to, subject, html });
    console.log(`[email] Sent to ${to}: ${subject}`);
  } catch (err) {
    console.error(`[email] Failed to send to ${to}:`, err);
  }
}

// ── Email Templates ──────────────────────────────

function formatDate(isoStr: string, allDay?: boolean): string {
  const d = new Date(isoStr);
  const dateStr = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  if (allDay) return dateStr;
  const timeStr = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  return `${dateStr} at ${timeStr}`;
}

function wrapHtml(title: string, body: string): string {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
      <div style="background: #4F6BED; color: white; padding: 16px 24px; border-radius: 8px 8px 0 0;">
        <h2 style="margin: 0; font-size: 18px;">HomeDirectAI HQ</h2>
      </div>
      <div style="border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px; padding: 24px;">
        <h3 style="margin-top: 0; color: #1f2937;">${title}</h3>
        ${body}
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
        <p style="color: #9ca3af; font-size: 12px; margin: 0;">This is an automated notification from HomeDirectAI HQ.</p>
      </div>
    </div>
  `;
}

export function sendMeetingRequestEmail(
  recipientEmail: string,
  requesterName: string,
  title: string,
  description: string,
  startDate: string,
  endDate: string,
  allDay: boolean,
) {
  const body = `
    <p><strong>${requesterName}</strong> has requested a meeting with you.</p>
    <div style="background: #f9fafb; border-radius: 8px; padding: 16px; margin: 16px 0;">
      <p style="margin: 0 0 8px 0;"><strong>Meeting:</strong> ${title}</p>
      ${description ? `<p style="margin: 0 0 8px 0;"><strong>Details:</strong> ${description}</p>` : ""}
      <p style="margin: 0 0 8px 0;"><strong>Proposed Time:</strong> ${formatDate(startDate, allDay)} — ${formatDate(endDate, allDay)}</p>
    </div>
    <p>Log in to HomeDirectAI HQ to accept, decline, or propose a new time.</p>
  `;
  sendMail(recipientEmail, `Meeting Request: ${title}`, wrapHtml("New Meeting Request", body));
}

export function sendMeetingAcceptedEmail(
  requesterEmail: string,
  recipientName: string,
  title: string,
  startDate: string,
  endDate: string,
  allDay: boolean,
) {
  const body = `
    <p><strong>${recipientName}</strong> has accepted your meeting request!</p>
    <div style="background: #f0fdf4; border-radius: 8px; padding: 16px; margin: 16px 0;">
      <p style="margin: 0 0 8px 0;"><strong>Meeting:</strong> ${title}</p>
      <p style="margin: 0;"><strong>Time:</strong> ${formatDate(startDate, allDay)} — ${formatDate(endDate, allDay)}</p>
    </div>
    <p>The meeting has been added to the calendar.</p>
  `;
  sendMail(requesterEmail, `Meeting Accepted: ${title}`, wrapHtml("Meeting Accepted", body));
}

export function sendMeetingDeclinedEmail(
  requesterEmail: string,
  recipientName: string,
  title: string,
  message?: string,
) {
  const body = `
    <p><strong>${recipientName}</strong> has declined your meeting request.</p>
    <div style="background: #fef2f2; border-radius: 8px; padding: 16px; margin: 16px 0;">
      <p style="margin: 0 0 8px 0;"><strong>Meeting:</strong> ${title}</p>
      ${message ? `<p style="margin: 0;"><strong>Message:</strong> ${message}</p>` : ""}
    </div>
  `;
  sendMail(requesterEmail, `Meeting Declined: ${title}`, wrapHtml("Meeting Declined", body));
}

export function sendMeetingNewTimeEmail(
  requesterEmail: string,
  recipientName: string,
  title: string,
  newStartDate: string,
  newEndDate: string,
  allDay: boolean,
  message?: string,
) {
  const body = `
    <p><strong>${recipientName}</strong> has proposed a new time for your meeting.</p>
    <div style="background: #fffbeb; border-radius: 8px; padding: 16px; margin: 16px 0;">
      <p style="margin: 0 0 8px 0;"><strong>Meeting:</strong> ${title}</p>
      <p style="margin: 0 0 8px 0;"><strong>New Proposed Time:</strong> ${formatDate(newStartDate, allDay)} — ${formatDate(newEndDate, allDay)}</p>
      ${message ? `<p style="margin: 0;"><strong>Message:</strong> ${message}</p>` : ""}
    </div>
    <p>Log in to HomeDirectAI HQ to accept or respond.</p>
  `;
  sendMail(requesterEmail, `New Time Proposed: ${title}`, wrapHtml("New Time Proposed", body));
}

export function sendNotificationEmail(
  recipientEmail: string,
  title: string,
  body: string,
) {
  const htmlBody = `
    <p>${body}</p>
    <p>Log in to HomeDirectAI HQ to view details.</p>
  `;
  sendMail(recipientEmail, title, wrapHtml(title, htmlBody));
}
