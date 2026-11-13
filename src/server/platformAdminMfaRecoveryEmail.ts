import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import {
  createPlatformAdminMfaSession,
  revokePlatformAdminMfaSessions
} from './platformAdminMfa.js';

const RECOVERY_COLLECTION = 'platform_admin_mfa_email_recovery';
const RECOVERY_TTL_MS = 10 * 60 * 1000;
const SEND_WINDOW_MS = 15 * 60 * 1000;
const MAX_SENDS_PER_WINDOW = 3;
const MAX_VERIFY_ATTEMPTS = 5;

function hashRecoveryCode(code: string): string {
  const pepper = String(process.env.RESTAUMAX_MFA_ENCRYPTION_KEY || '').trim();
  if (!pepper) throw new Error('La clé de sécurité MFA n’est pas configurée sur cet environnement.');
  return createHmac('sha256', pepper).update(code).digest('hex');
}

function sameHash(left: string, right: string): boolean {
  const a = Buffer.from(left, 'hex');
  const b = Buffer.from(right, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

async function sendWithResend(email: string, code: string): Promise<void> {
  const apiKey = String(process.env.RESEND_API_KEY || '').trim();
  const from = String(process.env.RESEND_FROM_EMAIL || '').trim();
  if (!apiKey || !from) throw new Error('La récupération par e-mail n’est pas configurée sur cet environnement.');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject: 'Code de récupération MFA RestauMax',
      text: 'Votre code de récupération RestauMax est ' + code + '. Il expire dans 10 minutes. Si vous n’avez pas demandé cette opération, ignorez ce message.',
      html: '<p>Vous avez demandé la récupération de votre accès administrateur RestauMax.</p><p>Votre code à usage unique :</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">' + code + '</p><p>Ce code expire dans 10 minutes et ne peut être utilisé qu’une seule fois.</p><p>Si vous n’êtes pas à l’origine de cette dema...[truncated]