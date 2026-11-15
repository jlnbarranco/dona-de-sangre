import nodemailer from 'nodemailer';
import { SMTP_HOST, SMTP_PASS, SMTP_PORT, SMTP_USER } from 'astro:env/server';

const CONFIRM_PATH = '/auth/confirm';
const NEXT_PATH = '/auth/update-password';
const EXPIRY_NOTICE = '1 hora';

interface InviteEmailInput {
  /** Origen de la petición (protocolo + host) para construir el enlace. */
  origin: string;
  email: string;
  nombre: string;
  tokenHash: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function buildConfirmUrl({ origin, tokenHash }: InviteEmailInput): URL {
  const url = new URL(CONFIRM_PATH, origin);
  url.searchParams.set('token_hash', tokenHash);
  url.searchParams.set('type', 'invite');
  url.searchParams.set('next', NEXT_PATH);
  return url;
}

function renderText({ nombre, email, url }: { nombre: string; email: string; url: URL }): string {
  return [
    `Hola, ${nombre},`,
    '',
    `Te hemos invitado a crear tu cuenta en Dona de Sangre (${email}).`,
    '',
    'Confirma tu correo y elige tu contraseña con este enlace:',
    url.toString(),
    '',
    `El enlace caduca en ${EXPIRY_NOTICE} y solo puede usarse una vez.`,
    'Si ha caducado o ya lo usaste, pide una nueva invitación al administrador.',
    '',
    'Este mensaje no contiene ninguna contraseña: la defines tú en el siguiente paso.'
  ].join('\n');
}

function renderHtml({ nombre, email, url }: { nombre: string; email: string; url: URL }): string {
  const safeNombre = escapeHtml(nombre);
  const safeEmail = escapeHtml(email);
  const safeUrl = escapeHtml(url.toString());

  return [
    `<p>Hola, ${safeNombre},</p>`,
    `<p>Te hemos invitado a crear tu cuenta en Dona de Sangre (<strong>${safeEmail}</strong>).</p>`,
    `<p><a href="${safeUrl}">Confirmar correo y elegir contraseña</a></p>`,
    `<p>El enlace caduca en ${EXPIRY_NOTICE} y solo puede usarse una vez. Si ha caducado o ya lo usaste, pide una nueva invitación al administrador.</p>`,
    '<p>Este mensaje no contiene ninguna contraseña: la defines tú en el siguiente paso.</p>'
  ].join('\n');
}

export async function sendInviteEmail(input: InviteEmailInput): Promise<void> {
  const url = buildConfirmUrl(input);
  const transport = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: Number(SMTP_PORT) === 465, // TLS directo en 465
    auth: {
      user: SMTP_USER,
      // Google ignora los espacios de la contraseña de aplicación
      pass: SMTP_PASS.replaceAll(' ', '')
    }
  });

  await transport.sendMail({
    from: `"Dona de Sangre" <${SMTP_USER}>`,
    to: input.email,
    subject: 'Invitación a Dona de Sangre',
    text: renderText({ nombre: input.nombre, email: input.email, url }),
    html: renderHtml({ nombre: input.nombre, email: input.email, url })
  });
}
