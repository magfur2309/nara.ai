import nodemailer from 'nodemailer';

export type EmailProviderType = 'smtp' | 'resend' | 'none';
export type WhatsappProviderType = 'fonnte' | 'meta' | 'none';

export interface NotificationGatewayStatus {
  emailConfigured: boolean;
  emailProvider: EmailProviderType;
  emailFromPreview: string;
  whatsappConfigured: boolean;
  whatsappProvider: WhatsappProviderType;
}

export interface DispatchRecipientInput {
  uid?: string;
  name: string;
  email?: string;
  phone?: string;
  erpCode?: string;
}

export interface DispatchNotificationRequest {
  category: 'maintenance' | 'meeting' | 'sop_review' | 'general';
  priority?: 'normal' | 'warning' | 'urgent';
  subject: string;
  message: string;
  channels: {
    email: boolean;
    whatsapp: boolean;
  };
  recipients: DispatchRecipientInput[];
  senderName: string;
}

export type ChannelDeliveryResultStatus =
  | 'not_requested'
  | 'sent'
  | 'failed'
  | 'manual_fallback'
  | 'missing_contact';

export interface RecipientDispatchResult {
  uid: string;
  name: string;
  erpCode: string;
  email: string;
  phoneNormalized: string;
  emailStatus: ChannelDeliveryResultStatus;
  emailDetail: string;
  whatsappStatus: ChannelDeliveryResultStatus;
  whatsappDetail: string;
  mailtoLink: string;
  whatsappWebLink: string;
}

export interface DispatchNotificationResponse {
  gatewayStatus: NotificationGatewayStatus;
  results: RecipientDispatchResult[];
  summary: {
    totalRecipients: number;
    emailSent: number;
    emailFallback: number;
    emailFailed: number;
    whatsappSent: number;
    whatsappFallback: number;
    whatsappFailed: number;
  };
  dispatchedAt: string;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidEmailAddress(raw: string): boolean {
  const trimmed = String(raw || '').trim();
  if (!trimmed || trimmed.length > 254) return false;
  return EMAIL_REGEX.test(trimmed);
}

/**
 * Normalizes Indonesian / international phone numbers to digits-only international format
 * suitable for WhatsApp APIs & wa.me links (e.g., "0812-3456-7890" -> "6281234567890").
 */
export function normalizePhoneToWhatsApp(raw: string): string {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return '';
  let normalized = digits;
  if (normalized.startsWith('00')) {
    normalized = normalized.slice(2);
  }
  if (normalized.startsWith('0')) {
    normalized = `62${normalized.slice(1)}`;
  } else if (normalized.startsWith('8') && normalized.length >= 9 && normalized.length <= 13) {
    normalized = `62${normalized}`;
  }
  if (normalized.length < 9 || normalized.length > 15) {
    return '';
  }
  return normalized;
}

function buildMailtoLink(email: string, subject: string, message: string): string {
  if (!isValidEmailAddress(email)) return '';
  const safeSubj = encodeURIComponent(subject.slice(0, 180));
  const safeBody = encodeURIComponent(message.slice(0, 1800));
  return `mailto:${encodeURIComponent(email)}?subject=${safeSubj}&body=${safeBody}`;
}

function buildWhatsAppWebLink(phoneNormalized: string, message: string): string {
  if (!phoneNormalized) return '';
  const safeText = encodeURIComponent(message.slice(0, 1800));
  return `https://wa.me/${phoneNormalized}?text=${safeText}`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getSmtpConfig() {
  const host = (process.env.SMTP_HOST || '').trim();
  const port = Number(process.env.SMTP_PORT) || 587;
  const secure =
    (process.env.SMTP_SECURE || '').trim().toLowerCase() === 'true' || port === 465;
  const user = (process.env.SMTP_USER || '').trim();
  const pass = process.env.SMTP_PASS || '';
  const from = (process.env.SMTP_FROM || user || 'SOP Brain <no-reply@company.local>').trim();
  return {
    configured: Boolean(host && user && pass),
    host,
    port,
    secure,
    user,
    pass,
    from,
  };
}

function getResendConfig() {
  const apiKey = (process.env.RESEND_API_KEY || '').trim();
  const from = (process.env.SMTP_FROM || 'SOP Brain <onboarding@resend.dev>').trim();
  return {
    configured: Boolean(apiKey),
    apiKey,
    from,
  };
}

function getWhatsAppConfig() {
  const providerRaw = (process.env.WHATSAPP_PROVIDER || '').trim().toLowerCase();
  const fonnteToken = (process.env.FONNTE_TOKEN || '').trim();
  const metaToken = (process.env.WHATSAPP_META_TOKEN || '').trim();
  const metaPhoneId = (process.env.WHATSAPP_META_PHONE_NUMBER_ID || '').trim();
  const validMetaPhoneId = /^[0-9]{5,30}$/.test(metaPhoneId) ? metaPhoneId : '';

  if (providerRaw === 'meta' && metaToken && validMetaPhoneId) {
    return {
      configured: true,
      provider: 'meta' as WhatsappProviderType,
      fonnteToken: '',
      metaToken,
      metaPhoneId: validMetaPhoneId,
    };
  }
  if (providerRaw === 'fonnte' && fonnteToken) {
    return {
      configured: true,
      provider: 'fonnte' as WhatsappProviderType,
      fonnteToken,
      metaToken: '',
      metaPhoneId: '',
    };
  }
  // Auto-detect if WHATSAPP_PROVIDER was left blank but token is set
  if (!providerRaw && fonnteToken) {
    return {
      configured: true,
      provider: 'fonnte' as WhatsappProviderType,
      fonnteToken,
      metaToken: '',
      metaPhoneId: '',
    };
  }
  if (!providerRaw && metaToken && validMetaPhoneId) {
    return {
      configured: true,
      provider: 'meta' as WhatsappProviderType,
      fonnteToken: '',
      metaToken,
      metaPhoneId: validMetaPhoneId,
    };
  }

  return {
    configured: false,
    provider: 'none' as WhatsappProviderType,
    fonnteToken: '',
    metaToken: '',
    metaPhoneId: '',
  };
}

export function getNotificationGatewayStatus(): NotificationGatewayStatus {
  const smtp = getSmtpConfig();
  const resend = getResendConfig();
  const wa = getWhatsAppConfig();

  let emailProvider: EmailProviderType = 'none';
  let emailFromPreview = '';
  if (smtp.configured) {
    emailProvider = 'smtp';
    emailFromPreview = smtp.from;
  } else if (resend.configured) {
    emailProvider = 'resend';
    emailFromPreview = resend.from;
  }

  return {
    emailConfigured: emailProvider !== 'none',
    emailProvider,
    emailFromPreview,
    whatsappConfigured: wa.configured,
    whatsappProvider: wa.provider,
  };
}

function buildEmailHtml(params: {
  subject: string;
  message: string;
  recipientName: string;
  senderName: string;
  category: string;
  priority: string;
}): string {
  const badgeColor =
    params.priority === 'urgent'
      ? '#EF4444'
      : params.priority === 'warning'
        ? '#F59E0B'
        : '#FFC81F';
  const badgeText =
    params.category === 'maintenance'
      ? 'PENGINGAT ASET & MAINTENANCE'
      : params.category === 'meeting'
        ? 'PENGINGAT JADWAL MEETING'
        : params.category === 'sop_review'
          ? 'PENGINGAT REVIEW SOP'
          : 'NOTIFIKASI SISTEM';

  const messageHtml = escapeHtml(params.message).replace(/\n/g, '<br />');

  return [
    '<div style="font-family:Arial,Helvetica,sans-serif;background:#F5F6F8;padding:24px;color:#18181B;">',
    '  <div style="max-width:600px;margin:0 auto;background:#FFFFFF;border:1px solid #E1E4EA;border-radius:12px;overflow:hidden;">',
    '    <div style="background:#131316;padding:20px 24px;border-bottom:3px solid ' + badgeColor + ';">',
    '      <div style="font-size:11px;font-weight:700;letter-spacing:1px;color:' + badgeColor + ';text-transform:uppercase;">' + badgeText + '</div>',
    '      <h2 style="margin:6px 0 0;font-size:18px;color:#F4F4F5;line-height:1.35;">' + escapeHtml(params.subject) + '</h2>',
    '    </div>',
    '    <div style="padding:24px;font-size:14px;line-height:1.65;color:#18181B;">',
    '      <p style="margin:0 0 14px;">Yth. <strong>' + escapeHtml(params.recipientName || 'Bapak/Ibu') + '</strong>,</p>',
    '      <div style="background:#F8F9FB;border:1px solid #E1E4EA;border-radius:8px;padding:16px;margin:0 0 16px;">' + messageHtml + '</div>',
    '      <p style="margin:0;font-size:12px;color:#6B7280;">Dikirim melalui SOP Brain oleh ' + escapeHtml(params.senderName || 'Administrator') + '.</p>',
    '    </div>',
    '  </div>',
    '</div>',
  ].join('\n');
}

async function sendSingleEmail(params: {
  to: string;
  recipientName: string;
  subject: string;
  message: string;
  senderName: string;
  category: string;
  priority: string;
}): Promise<{ status: ChannelDeliveryResultStatus; detail: string }> {
  const smtp = getSmtpConfig();
  const resend = getResendConfig();

  const html = buildEmailHtml({
    subject: params.subject,
    message: params.message,
    recipientName: params.recipientName,
    senderName: params.senderName,
    category: params.category,
    priority: params.priority,
  });

  if (smtp.configured) {
    try {
      const transporter = nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        auth: {
          user: smtp.user,
          pass: smtp.pass,
        },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 15000,
      });

      await transporter.sendMail({
        from: smtp.from,
        to: params.to,
        subject: params.subject,
        text: `Yth. ${params.recipientName || 'Bapak/Ibu'},\n\n${params.message}\n\nDikirim oleh ${params.senderName} via SOP Brain.`,
        html,
      });

      return { status: 'sent', detail: 'Terkirim via SMTP server.' };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal mengirim via SMTP.';
      return { status: 'failed', detail: `SMTP gagal: ${msg.slice(0, 180)}` };
    }
  }

  if (resend.configured) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resend.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: resend.from,
          to: [params.to],
          subject: params.subject,
          html,
          text: `Yth. ${params.recipientName || 'Bapak/Ibu'},\n\n${params.message}`,
        }),
        signal: AbortSignal.timeout(12000),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        return {
          status: 'failed',
          detail: `Resend HTTP ${res.status}: ${errText.slice(0, 160)}`,
        };
      }
      return { status: 'sent', detail: 'Terkirim via Resend Email API.' };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal menghubungi Resend API.';
      return { status: 'failed', detail: `Resend gagal: ${msg.slice(0, 180)}` };
    }
  }

  return {
    status: 'manual_fallback',
    detail: 'Gateway Email (SMTP / Resend) belum dikonfigurasi di Secrets. Gunakan tombol Buka Email.',
  };
}

async function sendSingleWhatsApp(params: {
  phoneNormalized: string;
  recipientName: string;
  subject: string;
  message: string;
}): Promise<{ status: ChannelDeliveryResultStatus; detail: string }> {
  const wa = getWhatsAppConfig();
  const formattedText = `*${params.subject}*\n\nYth. ${params.recipientName || 'Bapak/Ibu'},\n${params.message}\n\n_Pengingat otomatis dari SOP Brain_`;

  if (wa.provider === 'fonnte' && wa.fonnteToken) {
    try {
      const formBody = new URLSearchParams();
      formBody.set('target', params.phoneNormalized);
      formBody.set('message', formattedText);
      formBody.set('countryCode', '62');

      const res = await fetch('https://api.fonnte.com/send', {
        method: 'POST',
        headers: {
          Authorization: wa.fonnteToken,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formBody.toString(),
        signal: AbortSignal.timeout(12000),
      });

      const body = (await res.json().catch(() => ({}))) as { status?: boolean; reason?: string };
      if (!res.ok || body.status === false) {
        return {
          status: 'failed',
          detail: `Fonnte gagal: ${String(body.reason || `HTTP ${res.status}`).slice(0, 160)}`,
        };
      }
      return { status: 'sent', detail: 'Terkirim via WhatsApp Gateway (Fonnte).' };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal menghubungi Fonnte API.';
      return { status: 'failed', detail: `Fonnte gagal: ${msg.slice(0, 180)}` };
    }
  }

  if (wa.provider === 'meta' && wa.metaToken && wa.metaPhoneId) {
    try {
      const endpoint = `https://graph.facebook.com/v20.0/${wa.metaPhoneId}/messages`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${wa.metaToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: params.phoneNormalized,
          type: 'text',
          text: {
            preview_url: false,
            body: formattedText.slice(0, 4000),
          },
        }),
        signal: AbortSignal.timeout(12000),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        return {
          status: 'failed',
          detail: `WhatsApp Cloud API HTTP ${res.status}: ${errText.slice(0, 160)}`,
        };
      }
      return { status: 'sent', detail: 'Terkirim via WhatsApp Cloud API (Meta).' };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal menghubungi Meta Graph API.';
      return { status: 'failed', detail: `WhatsApp Cloud gagal: ${msg.slice(0, 180)}` };
    }
  }

  return {
    status: 'manual_fallback',
    detail: 'Gateway WhatsApp belum dikonfigurasi di Secrets. Gunakan tombol Buka WhatsApp.',
  };
}

export async function dispatchMultiChannelNotification(
  input: DispatchNotificationRequest
): Promise<DispatchNotificationResponse> {
  const gatewayStatus = getNotificationGatewayStatus();
  const safeSubject = String(input.subject || '').trim().slice(0, 200);
  const safeMessage = String(input.message || '').trim().slice(0, 4000);
  const safePriority = input.priority || 'normal';
  const safeCategory = input.category || 'general';
  const safeSender = String(input.senderName || 'Administrator').trim().slice(0, 120);

  if (!safeSubject || !safeMessage) {
    throw new Error('Judul dan isi pesan notifikasi wajib diisi.');
  }

  const recipients = Array.isArray(input.recipients) ? input.recipients.slice(0, 50) : [];
  if (recipients.length === 0) {
    throw new Error('Minimal satu penerima notifikasi harus dipilih.');
  }

  const results: RecipientDispatchResult[] = [];
  const summary = {
    totalRecipients: recipients.length,
    emailSent: 0,
    emailFallback: 0,
    emailFailed: 0,
    whatsappSent: 0,
    whatsappFallback: 0,
    whatsappFailed: 0,
  };

  for (const rec of recipients) {
    const cleanName = String(rec.name || 'Karyawan').trim().slice(0, 120);
    const cleanEmail = String(rec.email || '').trim().slice(0, 254);
    const phoneNormalized = normalizePhoneToWhatsApp(rec.phone || '');
    const waText = `*${safeSubject}*\n\nYth. ${cleanName},\n${safeMessage}`;

    let emailStatus: ChannelDeliveryResultStatus = 'not_requested';
    let emailDetail = '';
    if (input.channels.email) {
      if (!isValidEmailAddress(cleanEmail)) {
        emailStatus = 'missing_contact';
        emailDetail = 'Alamat email karyawan belum diisi atau tidak valid.';
      } else {
        const resEmail = await sendSingleEmail({
          to: cleanEmail,
          recipientName: cleanName,
          subject: safeSubject,
          message: safeMessage,
          senderName: safeSender,
          category: safeCategory,
          priority: safePriority,
        });
        emailStatus = resEmail.status;
        emailDetail = resEmail.detail;
        if (emailStatus === 'sent') summary.emailSent += 1;
        else if (emailStatus === 'manual_fallback') summary.emailFallback += 1;
        else if (emailStatus === 'failed') summary.emailFailed += 1;
      }
    }

    let whatsappStatus: ChannelDeliveryResultStatus = 'not_requested';
    let whatsappDetail = '';
    if (input.channels.whatsapp) {
      if (!phoneNormalized) {
        whatsappStatus = 'missing_contact';
        whatsappDetail = 'Nomor HP/WhatsApp karyawan belum diisi atau format tidak valid.';
      } else {
        const resWa = await sendSingleWhatsApp({
          phoneNormalized,
          recipientName: cleanName,
          subject: safeSubject,
          message: safeMessage,
        });
        whatsappStatus = resWa.status;
        whatsappDetail = resWa.detail;
        if (whatsappStatus === 'sent') summary.whatsappSent += 1;
        else if (whatsappStatus === 'manual_fallback') summary.whatsappFallback += 1;
        else if (whatsappStatus === 'failed') summary.whatsappFailed += 1;
      }
    }

    results.push({
      uid: String(rec.uid || '').trim().slice(0, 128),
      name: cleanName,
      erpCode: String(rec.erpCode || '').trim().slice(0, 60),
      email: isValidEmailAddress(cleanEmail) ? cleanEmail : '',
      phoneNormalized,
      emailStatus,
      emailDetail,
      whatsappStatus,
      whatsappDetail,
      mailtoLink: buildMailtoLink(cleanEmail, safeSubject, `Yth. ${cleanName},\n\n${safeMessage}`),
      whatsappWebLink: buildWhatsAppWebLink(phoneNormalized, waText),
    });
  }

  return {
    gatewayStatus,
    results,
    summary,
    dispatchedAt: new Date().toISOString(),
  };
}
