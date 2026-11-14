import React, { useCallback, useEffect, useRef, useState } from 'react';
import { getMultiFactorResolver, multiFactor, onAuthStateChanged, PhoneAuthProvider, PhoneMultiFactorGenerator, RecaptchaVerifier, signInWithEmailAndPassword, signOut, TotpMultiFactorGenerator, type MultiFactorResolver, type User } from 'firebase/auth';
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import QRCode from 'qrcode';
import { auth } from '../../lib/firebase';
import { ShieldCheck, Eye, EyeOff } from 'lucide-react';
import { PlatformAdminWorkspace } from './PlatformAdminWorkspace';

type RestaurantRow = {
  slug: string; name: string;
  status?: string; isOpen?: boolean; deletedAt?: number;
  subscription?: {
    planName?: string; priceFcfa?: number; currency?: string;
    billingCycle?: 'monthly' | 'yearly' | 'custom';
    status?: 'trial' | 'active' | 'past_due' | 'suspended' | 'cancelled';
    startsAt?: number; endsAt?: number; nextBillingAt?: number; notes?: string;
    autoRenew?: boolean; gracePeriodDays?: number; currentInvoiceId?: string | null; currentInvoiceAmountFcfa?: number | null; pastDueAt?: number | null;
  };
};
type PlatformSummary = {
  totalRestaurants: number; activeRestaurants: number; suspendedRestaurants: number;
  deletedRestaurants: number; openRestaurants: number; monthlyRecurringRevenueFcfa: number;
  subscriptionsByPlan: Record<string, number>; subscriptionsByStatus: Record<string, number>;
};
type StaffRow = { uid: string; email: string; displayName: string; role: 'owner' | 'manager' | 'staff' | 'cashier' | 'server' | 'kitchen'; active: boolean; permissions?: string[]; accountLinked?: boolean; activeKnown?: boolean; emailConflict?: boolean; sources?: string[]; readOnly?: boolean };

export const PlatformAdminView: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [restaurants, setRestaurants] = useState<RestaurantRow[]>([]);
  const [summary, setSummary] = useState<PlatformSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [isPlatformAdminAuthorized, setIsPlatformAdminAuthorized] = useState(false);
  const [needsPlatformAdminLogin, setNeedsPlatformAdminLogin] = useState(false);
  const adminLoginInProgress = useRef(false);
  const [error, setError] = useState('');
  // No administrator credentials are embedded or prefilled in public Preview builds.
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaResolver, setMfaResolver] = useState<MultiFactorResolver | null>(null);
  const [mfaFactor, setMfaFactor] = useState<{ kind: 'totp'; uid: string } | { kind: 'phone'; uid: string; phoneNumber: string } | null>(null);
  const [mfaVerificationId, setMfaVerificationId] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [totpSecret, setTotpSecret] = useState<any>(null);
  const [totpEnrollmentCode, setTotpEnrollmentCode] = useState('');
  const [totpEnrollmentBusy, setTotpEnrollmentBusy] = useState(false);
  const [customMfaRequired, setCustomMfaRequired] = useState(false);
  const [customMfaSetup, setCustomMfaSetup] = useState(false);
  const [customMfaCode, setCustomMfaCode] = useState('');
  const [customMfaQrCode, setCustomMfaQrCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [mfaEnrolled, setMfaEnrolled] = useState(false);
  const [recoveryCodesRemaining, setRecoveryCodesRemaining] = useState(0);
  const [recoveryRotationOpen, setRecoveryRotationOpen] = useState(false);
  const [recoveryRotationCode, setRecoveryRotationCode] = useState('');
  const [recoveryRotationCodes, setRecoveryRotationCodes] = useState<string[]>([]);
  const [recoveryRotationBusy, setRecoveryRotationBusy] = useState(false);
  const [passkeyCount, setPasskeyCount] = useState(0);
  const [trustedSessionExpiresAt, setTrustedSessionExpiresAt] = useState<number | null>(null);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [emailRecoveryRequested, setEmailRecoveryRequested] = useState(false);
  const [emailRecoveryCode, setEmailRecoveryCode] = useState('');
  const [emailRecoveryBusy, setEmailRecoveryBusy] = useState(false);
  const [recoveryContactEmail, setRecoveryContactEmail] = useState('');
  const [recoveryContactInput, setRecoveryContactInput] = useState('');
  const [recoveryContactCode, setRecoveryContactCode] = useState('');
  const [recoveryContactPending, setRecoveryContactPending] = useState(false);
  const [recoveryContactBusy, setRecoveryContactBusy] = useState(false);
  const [mfaNotice, setMfaNotice] = useState('');
  const mfaRecaptchaVerifier = useRef<RecaptchaVerifier | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const request = useCallback(async (body?: Record<string, unknown>) => {
    if (!auth.currentUser) throw new Error('Session non authentifiée.');
    const token = await auth.currentUser.getIdToken(true);
    const response = await fetch('/api/platform-admin', {
      method: body ? 'POST' : 'GET',
      // Explicitly retain/send the HttpOnly MFA trust cookie across Firebase sign-out/sign-in.
      credentials: 'include',
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) {
      // /admin is a separate security boundary: a restaurant session must not
      // remain authenticated after the platform API rejects it.
      if ((response.status === 401 || response.status === 403) && ![
        'mfa_verify', 'mfa_status', 'mfa_accept_firebase', 'mfa_recovery_enroll_start',
        'mfa_recovery_regenerate', 'mfa_recovery_contact_start', 'mfa_recovery_contact_verify',
        'mfa_recovery_email_start', 'mfa_recovery_email_verify',
        'mfa_passkey_register_options', 'mfa_passkey_register_verify',
        'mfa_passkey_auth_options', 'mfa_passkey_auth_verify', 'mfa_logout_device'
      ].includes(String(body?.action || ''))) {
        setIsPlatformAdminAuthorized(false);
        setRestaurants([]);
        setSummary(null);
        await signOut(auth).catch(() => undefined);
        setUser(null);
      }
      throw new Error(data.error || 'Accès super-administrateur refusé.');
    }
    // The first allowlisted request may have just received the super-admin custom claim.
    await auth.currentUser?.getIdToken(true);
    if (![
      'mfa_status', 'mfa_enroll_start', 'mfa_enroll_confirm', 'mfa_accept_firebase',
      'mfa_recovery_enroll_start', 'mfa_recovery_regenerate', 'mfa_recovery_contact_start',
      'mfa_recovery_contact_verify', 'mfa_recovery_email_start',
      'mfa_recovery_email_verify', 'mfa_passkey_register_options', 'mfa_passkey_register_verify',
      'mfa_passkey_auth_options', 'mfa_passkey_auth_verify', 'mfa_logout', 'mfa_logout_device'
    ].includes(String(body?.action || ''))) {
      setIsPlatformAdminAuthorized(true);
    }
    return data;
  }, []);

  const refreshSecurityStatus = useCallback(async () => {
    const status = await request({ action: 'mfa_status' });
    setMfaEnrolled(status.enrolled === true);
    setRecoveryCodesRemaining(Number(status.recoveryCodesRemaining || 0));
    setPasskeyCount(Number(status.passkeyCount || 0));
    setTrustedSessionExpiresAt(Number(status.sessionExpiresAt || 0) || null);
    setRecoveryContactEmail(String(status.recoveryContactEmail || ''));
  }, [request]);

  const removeLegacyFirebaseFactors = useCallback(async () => {
    const currentUser = auth.currentUser;
    if (!currentUser) return;
    const enrolledFactors = [...multiFactor(currentUser).enrolledFactors];
    for (const factor of enrolledFactors) await multiFactor(currentUser).unenroll(factor);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const data = await request();
      setRestaurants(data.restaurants || []);
      setSummary(data.summary || null);
    } catch (e: any) {
      setIsPlatformAdminAuthorized(false);
      setError(e.message || 'Accès super-administrateur refusé.');
    }
    finally { setLoading(false); }
  }, [request]);

  const continueAfterAuthentication = useCallback(async (firebaseMfaJustCompleted = false) => {
    if (firebaseMfaJustCompleted) {
      const tokenResult = await auth.currentUser?.getIdTokenResult(true);
      const firebaseSecondFactor = (tokenResult?.claims?.firebase as any)?.sign_in_second_factor;
      if (!(typeof firebaseSecondFactor === 'string' && firebaseSecondFactor)) {
        throw new Error('Firebase n’a pas confirmé le facteur historique. Reconnectez-vous et réessayez.');
      }
    }
    const status = await request({ action: 'mfa_status' });
    setNeedsPlatformAdminLogin(false);
    setMfaEnrolled(status.enrolled === true);
    setRecoveryCodesRemaining(Number(status.recoveryCodesRemaining || 0));
    setPasskeyCount(Number(status.passkeyCount || 0));
    setTrustedSessionExpiresAt(Number(status.sessionExpiresAt || 0) || null);
    setRecoveryContactEmail(String(status.recoveryContactEmail || ''));

    if (status.recoverySession === true) {
      const setup = await request({ action: 'mfa_recovery_enroll_start' });
      setTotpSecret({ secretKey: setup.secret, otpauthUri: setup.otpauthUri, recoveryEnrollment: true });
      setCustomMfaSetup(true);
      setCustomMfaRequired(false);
      setIsPlatformAdminAuthorized(false);
      return;
    }

    const trustedFactor = ['totp', 'passkey'].includes(String(status.sessionFactorSource || '')) ||
      (status.sessionFactorSource === 'firebase' && status.firebaseMfaMigrationEligible !== true);
    if (status.sessionValid === true && trustedFactor) {
      if (status.firebaseMfaMigrationEligible === true) {
        try { await removeLegacyFirebaseFactors(); } catch {
          setError('Le MFA RestauMax est validé, mais un ancien facteur Firebase n’a pas pu être retiré automatiquement. Une vérification complémentaire sera nécessaire à la prochaine connexion.');
        }
      }
      setCustomMfaRequired(false);
      setCustomMfaSetup(false);
      setTotpSecret(null);
      const data = await request();
      setRestaurants(data.restaurants || []);
      setSummary(data.summary || null);
      return;
    }

    if (status.enrolled === true) {
      setCustomMfaRequired(true);
      setCustomMfaCode('');
      setEmailRecoveryRequested(false);
      setEmailRecoveryCode('');
      setMfaNotice('');
      setIsPlatformAdminAuthorized(false);
      return;
    }

    // Firebase is only a short-lived migration bridge; RestauMax TOTP is required before access.
    const setup = await request({ action: 'mfa_enroll_start' });
    setTotpSecret({ secretKey: setup.secret, otpauthUri: setup.otpauthUri });
    setCustomMfaSetup(true);
    setCustomMfaRequired(false);
    setIsPlatformAdminAuthorized(false);
  }, [request, removeLegacyFirebaseFactors]);

  useEffect(() => {
    let active = true;
    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      if (!nextUser) {
        setIsPlatformAdminAuthorized(false);
        setNeedsPlatformAdminLogin(false);
        setCustomMfaRequired(false);
        setCustomMfaSetup(false);
        setTotpSecret(null);
        setCustomMfaCode('');
        setMfaEnrolled(false);
        setRecoveryCodesRemaining(0);
        setRecoveryCodes([]);
        setRecoveryRotationCodes([]);
        setRecoveryRotationCode('');
        setRecoveryRotationOpen(false);
        setPasskeyCount(0);
        setEmailRecoveryRequested(false);
        setEmailRecoveryCode('');
        setMfaNotice('');
        setRestaurants([]);
        setSummary(null);
        return;
      }

      // A pre-existing restaurant session is not silently upgraded by the
      // platform allowlist. It must pass through the dedicated admin login.
      if (adminLoginInProgress.current) return;
      setIsPlatformAdminAuthorized(false);
      setRestaurants([]);
      setSummary(null);
      setLoading(true);
      nextUser.getIdTokenResult().then(async (token) => {
        if (!active) return;
        if (!['super_admin', 'platform_admin'].includes(String(token.claims.role || ''))) {
          setNeedsPlatformAdminLogin(true);
          return;
        }
        setNeedsPlatformAdminLogin(false);
        await continueAfterAuthentication();
        if (!active) return;
      }).catch((e: any) => {
        if (!active) return;
        // Transient server/network errors keep the session pending and retryable;
        // only a confirmed non-platform-admin claim requires the login form.
        setError(e?.message || 'Accès super-administrateur refusé.');
      }).finally(() => {
        if (active) setLoading(false);
      });
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [request, continueAfterAuthentication]);

  const login = async (event: React.FormEvent) => {
    event.preventDefault(); setError(''); setLoading(true);
    adminLoginInProgress.current = true;
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      setPassword('');
      await continueAfterAuthentication();
    } catch (authError: any) {
      const code = authError?.code;
      console.error('[RestauMax SuperAdmin Auth] Échec de connexion:', code || 'unknown');
      if (code === 'auth/user-not-found' || code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
        setError('Adresse e-mail ou mot de passe incorrect.');
      } else if (code === 'auth/multi-factor-auth-required') {
        const resolver = getMultiFactorResolver(auth, authError);
        const totpHint = resolver.hints.find((hint) => hint.factorId === TotpMultiFactorGenerator.FACTOR_ID);
        if (totpHint) {
          setMfaResolver(resolver);
          setMfaFactor({ kind: 'totp', uid: totpHint.uid });
          setMfaCode('');
          setError('Authentification à deux facteurs requise. Saisissez le code de votre application d’authentification.');
        } else {
          const phoneHint = resolver.hints.find((hint) => hint.factorId === PhoneMultiFactorGenerator.FACTOR_ID);
          if (phoneHint) {
            setMfaResolver(resolver);
            setMfaFactor({ kind: 'phone', uid: phoneHint.uid, phoneNumber: String((phoneHint as any).phoneNumber || '') });
            setMfaVerificationId('');
            setMfaCode('');
            setError('Authentification à deux facteurs requise. Préparation de l’envoi du code SMS…');
          } else {
            setError('Ce compte exige un second facteur non pris en charge par cette version. Contactez le support avant toute activation MFA.');
          }
        }
      } else if (code === 'auth/user-disabled') {
        setError('Ce compte super-administrateur est désactivé dans Firebase Authentication.');
      } else if (code === 'auth/too-many-requests') {
        setError('Trop de tentatives. Patientez avant de réessayer.');
      } else if (code === 'auth/operation-not-allowed') {
        setError('La connexion par e-mail et mot de passe est désactivée dans Firebase Authentication.');
      } else if (code === 'auth/unauthorized-domain') {
        setError('Le domaine restaumax.vercel.app doit être autorisé dans Firebase Authentication.');
      } else if (code === 'auth/network-request-failed') {
        setError('Firebase Authentication est injoignable. Vérifiez la connexion réseau.');
      } else if (code === 'auth/invalid-api-key' || code === 'auth/api-key-not-valid') {
        setError('La configuration Firebase de cette version de RestauMax est invalide.');
      } else {
        setError(authError?.message || `Échec de connexion Firebase (code : ${code || 'inconnu'}). Consultez les journaux techniques.`);
      }
    } finally {
      adminLoginInProgress.current = false;
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!mfaResolver || mfaFactor?.kind !== 'phone' || mfaVerificationId) return;
    let active = true;
    const verifier = new RecaptchaVerifier(auth, 'platform-admin-mfa-recaptcha', { size: 'invisible' });
    mfaRecaptchaVerifier.current = verifier;
    const hint = mfaResolver.hints.find((candidate) => candidate.uid === mfaFactor.uid);
    if (!hint) {
      setError('Le facteur SMS associé à ce compte est introuvable.');
      return () => { active = false; verifier.clear(); mfaRecaptchaVerifier.current = null; };
    }
    void new PhoneAuthProvider(auth).verifyPhoneNumber({
      multiFactorHint: hint as any,
      session: mfaResolver.session
    }, verifier).then((verificationId) => {
      if (active) setMfaVerificationId(verificationId);
    }).catch((verificationError: any) => {
      if (active) setError(verificationError?.message || 'Impossible d’envoyer le code MFA par SMS.');
    });
    return () => {
      active = false;
      verifier.clear();
      if (mfaRecaptchaVerifier.current === verifier) mfaRecaptchaVerifier.current = null;
    };
  }, [mfaResolver, mfaFactor, mfaVerificationId]);

  const completeMfaLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!mfaResolver || !mfaFactor) return;
    setError('');
    setLoading(true);
    adminLoginInProgress.current = true;
    try {
      const assertion = mfaFactor.kind === 'totp'
        ? TotpMultiFactorGenerator.assertionForSignIn(mfaFactor.uid, mfaCode.trim())
        : PhoneMultiFactorGenerator.assertion(
            PhoneAuthProvider.credential(mfaVerificationId, mfaCode.trim())
          );
      const credential = await mfaResolver.resolveSignIn(assertion);
      await credential.user.getIdToken(true);
      const verifiedToken = await credential.user.getIdTokenResult(true);
      const verifiedFactor = (verifiedToken.claims.firebase as any)?.sign_in_second_factor;
      if (typeof verifiedFactor !== 'string' || !verifiedFactor) {
        throw new Error('Le second facteur Firebase a été validé, mais sa preuve n’est pas encore disponible. Reconnectez-vous.');
      }
      setMfaResolver(null);
      setMfaFactor(null);
      setMfaVerificationId('');
      setMfaCode('');
      setPassword('');
      await continueAfterAuthentication(true);
    } catch (mfaError: any) {
      setError(mfaError?.message || 'Le code de vérification MFA est invalide ou expiré.');
    } finally {
      adminLoginInProgress.current = false;
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!totpSecret?.otpauthUri) {
      setCustomMfaQrCode('');
      return;
    }
    let active = true;
    void QRCode.toDataURL(totpSecret.otpauthUri, { errorCorrectionLevel: 'M', margin: 2, width: 220 })
      .then((url) => { if (active) setCustomMfaQrCode(url); })
      .catch(() => { if (active) setCustomMfaQrCode(''); });
    return () => { active = false; };
  }, [totpSecret]);

  const confirmTotpEnrollment = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user || !totpSecret) return;
    setError('');
    setTotpEnrollmentBusy(true);
    try {
      const result = await request({ action: 'mfa_enroll_confirm', code: totpEnrollmentCode.trim() });
      if (result.firebaseMfaMigrationEligible === true) {
        try { await removeLegacyFirebaseFactors(); } catch {
          setError('Le MFA RestauMax est activé. Un ancien facteur Firebase reste à retirer lors de la prochaine connexion.');
        }
      }
      setRecoveryCodes(Array.isArray(result.recoveryCodes) ? result.recoveryCodes : []);
      setRecoveryCodesRemaining(Array.isArray(result.recoveryCodes) ? result.recoveryCodes.length : 0);
      setMfaEnrolled(true);
      setTrustedSessionExpiresAt(Number(result.sessionExpiresAt || 0) || null);
      setTotpSecret(null);
      setTotpEnrollmentCode('');
      setCustomMfaSetup(false);
      setCustomMfaRequired(false);
    } catch (enrollmentError: any) {
      setError(enrollmentError?.message || 'Code invalide ou enrôlement MFA impossible. Réessayez avec le code courant.');
    } finally {
      setTotpEnrollmentBusy(false);
    }
  };

  const finishMfaEnrollment = async () => {
    if (!recoveryCodes.length) return;
    setError('');
    await request({ action: 'mfa_logout' }).catch(() => undefined);
    await signOut(auth);
    setUser(null);
    setRecoveryCodes([]);
    setError('MFA activé. Reconnectez-vous avec votre mot de passe, puis saisissez le code de votre application.');
  };

  const verifyCustomMfa = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      await request({ action: 'mfa_verify', code: customMfaCode.trim() });
      setCustomMfaRequired(false);
      setCustomMfaCode('');
      await continueAfterAuthentication();
    } catch (verificationError: any) {
      setError(verificationError?.message || 'Code MFA invalide ou expiré.');
    } finally {
      setLoading(false);
    }
  };

  const authenticateWithPasskey = async () => {
    setError('');
    setPasskeyBusy(true);
    try {
      const challenge = await request({ action: 'mfa_passkey_auth_options' });
      const response = await startAuthentication({ optionsJSON: challenge.options });
      await request({ action: 'mfa_passkey_auth_verify', response });
      await continueAfterAuthentication();
    } catch (passkeyError: any) {
      setError(passkeyError?.message || 'La vérification par passkey a échoué.');
    } finally {
      setPasskeyBusy(false);
    }
  };

  const registerPasskey = async () => {
    setError('');
    setPasskeyBusy(true);
    try {
      const challenge = await request({ action: 'mfa_passkey_register_options' });
      const response = await startRegistration({ optionsJSON: challenge.options });
      await request({ action: 'mfa_passkey_register_verify', response, name: 'Passkey administrateur' });
      const status = await request({ action: 'mfa_status' });
      setPasskeyCount(Number(status.passkeyCount || 0));
      setTrustedSessionExpiresAt(Number(status.sessionExpiresAt || 0) || null);
      setMfaNotice('Passkey ajoutée avec succès à votre compte administrateur.');
    } catch (passkeyError: any) {
      setError(passkeyError?.message || 'Impossible d’ajouter cette passkey.');
    } finally {
      setPasskeyBusy(false);
    }
  };

  const startRecoveryContactVerification = async () => {
    setError('');
    setRecoveryContactBusy(true);
    try {
      const delivery = await request({ action: 'mfa_recovery_contact_start', email: recoveryContactInput.trim() });
      setRecoveryContactCode('');
      if (delivery.testDeliveryOnly) {
        setRecoveryContactPending(false);
        setMfaNotice('Mode test Resend : un message de test a été envoyé à ' + String(delivery.deliveredTo || 'la boîte autorisée').trim() + '. L’adresse ' + recoveryContactInput.trim() + ' reste NON VÉRIFIÉE et ne peut pas servir à récupérer le MFA.');
      } else {
        setRecoveryContactPending(true);
        setMfaNotice('Un code de vérification a été envoyé à la nouvelle adresse. Il expire dans 10 minutes.');
      }
    } catch (contactError: any) {
      setError(contactError?.message || 'Impossible d’envoyer le code de vérification.');
    } finally {
      setRecoveryContactBusy(false);
    }
  };

  const verifyRecoveryContact = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setRecoveryContactBusy(true);
    try {
      const result = await request({ action: 'mfa_recovery_contact_verify', code: recoveryContactCode.trim() });
      setRecoveryContactEmail(String(result.recoveryContactEmail || ''));
      setRecoveryContactInput('');
      setRecoveryContactCode('');
      setRecoveryContactPending(false);
      setMfaNotice('Adresse de récupération vérifiée et enregistrée.');
    } catch (contactError: any) {
      setError(contactError?.message || 'Code de vérification invalide ou expiré.');
    } finally {
      setRecoveryContactBusy(false);
    }
  };

  const startEmailRecovery = async () => {
    if (!recoveryContactEmail) {
      setError('Configurez et vérifiez d’abord une adresse de récupération dans le panneau Sécurité du compte.');
      return;
    }
    if (!window.confirm('Envoyer un code de récupération MFA à ' + recoveryContactEmail + ' ? Ce code permettra de remplacer votre facteur après vérification.')) return;
    setError('');
    setEmailRecoveryBusy(true);
    try {
      await request({ action: 'mfa_recovery_email_start' });
      setEmailRecoveryRequested(true);
      setMfaNotice('Un code à 8 chiffres vient d’être envoyé à votre adresse de récupération vérifiée. Il expire dans 10 minutes.');
    } catch (recoveryError: any) {
      setError(recoveryError?.message || 'Impossible d’envoyer le code de récupération.');
    } finally {
      setEmailRecoveryBusy(false);
    }
  };

  const completeEmailRecovery = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setEmailRecoveryBusy(true);
    try {
      await request({ action: 'mfa_recovery_email_verify', code: emailRecoveryCode.trim() });
      setEmailRecoveryRequested(false);
      setEmailRecoveryCode('');
      setMfaNotice('');
      await continueAfterAuthentication();
    } catch (recoveryError: any) {
      setError(recoveryError?.message || 'Code de récupération invalide ou expiré.');
    } finally {
      setEmailRecoveryBusy(false);
    }
  };

  const regenerateRecoveryCodes = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setRecoveryRotationBusy(true);
    try {
      const result = await request({ action: 'mfa_recovery_regenerate', code: recoveryRotationCode.trim() });
      setRecoveryRotationCodes(Array.isArray(result.recoveryCodes) ? result.recoveryCodes : []);
      setRecoveryCodesRemaining(Number(result.recoveryCodesRemaining || 0));
      setRecoveryRotationCode('');
      setRecoveryRotationOpen(false);
    } catch (rotationError: any) {
      setError(rotationError?.message || 'Impossible de renouveler les codes de secours.');
    } finally {
      setRecoveryRotationBusy(false);
    }
  };

  const cancelMfaLogin = () => {
    mfaRecaptchaVerifier.current?.clear();
    mfaRecaptchaVerifier.current = null;
    setMfaResolver(null);
    setMfaFactor(null);
    setMfaVerificationId('');
    setMfaCode('');
    setError('');
  };


  return <div className="min-h-screen bg-[#f4f7fb]">
    {(!user || needsPlatformAdminLogin) ? (
      <div className="flex min-h-screen items-center justify-center p-5">
        <div className="w-full max-w-md space-y-5 rounded-2xl border border-[#dbe3ee] bg-white p-7 shadow-sm">
          <div className="flex items-center gap-3"><div className="rounded-xl bg-[#c2410c] p-3 text-white"><ShieldCheck size={22}/></div><div><h1 className="text-xl font-extrabold text-[#101d2d]">RestauMax · Super-administration</h1><p className="text-xs text-slate-500">Accès sécurisé à la plateforme</p></div></div>
          {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">{error}</div>}
          {mfaResolver ? <form onSubmit={completeMfaLogin} className="space-y-4">
            <h2 className="text-lg font-bold text-[#101d2d]">Vérification en deux étapes</h2>
            <p className="text-sm text-slate-600">{mfaFactor?.kind === 'totp' ? 'Ouvrez votre application d’authentification et saisissez le code à 6 chiffres.' : 'Un code de vérification sera envoyé au numéro associé à votre compte.'}</p>
            {mfaFactor?.kind === 'phone' && <><div id="platform-admin-mfa-recaptcha" /><p className="text-xs text-slate-500">{mfaVerificationId ? 'Code SMS envoyé. Vérifiez votre téléphone.' : 'Préparation de la vérification SMS…'}</p></>}
            <label className="block text-sm font-semibold text-slate-700">Code de vérification<input required inputMode="numeric" autoComplete="one-time-code" value={mfaCode} onChange={e=>setMfaCode(e.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 tracking-widest"/></label>
            <button disabled={loading || (mfaFactor?.kind === 'phone' && !mfaVerificationId)} className="min-h-11 w-full rounded-lg bg-[#101d2d] p-3 font-bold text-white disabled:opacity-50">{loading ? 'Vérification…' : 'Vérifier et continuer'}</button>
            <button type="button" onClick={cancelMfaLogin} className="min-h-11 w-full rounded-lg border border-slate-300 p-3 text-sm font-semibold text-slate-700">Annuler</button>
          </form> : <form onSubmit={login} className="space-y-4">
            <h2 className="text-lg font-bold text-[#101d2d]">Connexion super-administrateur</h2>
            <p className="text-sm text-slate-600">Accès réservé aux super-administrateurs et aux comptes délégués explicitement autorisés par RestauMax.</p>
            <label className="block text-sm font-semibold text-slate-700">Adresse e-mail<input required type="email" autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3"/></label>
            <label className="block text-sm font-semibold text-slate-700">Mot de passe<div className="relative mt-1"><input required type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} className="min-h-11 w-full rounded-lg border border-slate-300 px-3 pr-12"/><button type="button" onClick={()=>setShowPassword(v=>!v)} aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'} className="absolute right-1 top-1 flex min-h-10 min-w-10 items-center justify-center text-slate-600">{showPassword ? <EyeOff size={18}/> : <Eye size={18}/>}</button></div></label>
            <button disabled={loading} className="min-h-11 w-full rounded-lg bg-[#101d2d] p-3 font-bold text-white disabled:opacity-50">{loading ? 'Connexion…' : 'Se connecter'}</button>
          </form>}
        </div>
      </div>
    ) : !isPlatformAdminAuthorized ? (
      <div className="flex min-h-screen items-center justify-center p-5"><section className="w-full max-w-md space-y-4 rounded-2xl border border-[#dbe3ee] bg-white p-7 shadow-sm">
        <h2 className="text-xl font-bold text-[#101d2d]">{customMfaSetup ? 'Configurer votre authentificateur' : customMfaRequired ? 'Vérification MFA obligatoire' : 'Vérification des droits super-administrateur'}</h2>
        {error && <div role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-900">{error}</div>}
        {recoveryCodes.length > 0 ? <div className="space-y-3">
          <p className="text-sm font-semibold text-amber-800">Enregistrez ces 10 codes de secours maintenant. Chaque code ne peut être utilisé qu’une seule fois. Ils ne seront plus affichés.</p>
          <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-100 p-3 font-mono text-sm">{recoveryCodes.map((code) => <code key={code}>{code}</code>)}</div>
          <button type="button" onClick={() => void finishMfaEnrollment()} className="min-h-11 w-full rounded-lg bg-[#101d2d] p-3 font-bold text-white">J’ai enregistré mes codes de secours — me déconnecter</button>
        </div> : customMfaSetup && totpSecret ? <form onSubmit={confirmTotpEnrollment} className="space-y-3">
          <p className="text-sm text-slate-600">{totpSecret.recoveryEnrollment ? 'Votre code de secours a confirmé votre identité. Configurez maintenant un nouvel authentificateur : l’ancien facteur perdu sera remplacé après validation.' : 'Scannez ce QR code avec Google Authenticator, Microsoft Authenticator ou une application compatible TOTP. Vous pouvez aussi saisir la clé manuellement.'} Vous pouvez aussi saisir la clé manuellement.</p>
          {customMfaQrCode && <img src={customMfaQrCode} alt="QR code de configuration MFA RestauMax" className="mx-auto h-56 w-56 rounded-lg border p-2"/>}
          <code className="block break-all rounded-lg bg-slate-100 p-3 text-xs font-bold">{totpSecret.secretKey}</code>
          <label className="block text-sm font-semibold text-slate-700">Code à 6 chiffres<input required inputMode="numeric" pattern="[0-9]{6}" autoComplete="one-time-code" value={totpEnrollmentCode} onChange={e=>setTotpEnrollmentCode(e.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 tracking-widest"/></label>
          <button disabled={loading || totpEnrollmentBusy} className="min-h-11 w-full rounded-lg bg-[#101d2d] p-3 font-bold text-white disabled:opacity-50">{totpEnrollmentBusy ? 'Validation…' : 'Valider mon enrôlement'}</button>
        </form> : customMfaRequired ? <div className="space-y-3">
          <p className="text-sm text-slate-600">Validez votre second facteur RestauMax. Vous pouvez utiliser Google Authenticator ou une passkey déjà enregistrée.</p>
          <form onSubmit={verifyCustomMfa} className="space-y-3">
            <label className="block text-sm font-semibold text-slate-700">Code Google Authenticator ou code de secours
              <input required inputMode="text" pattern="([0-9]{6}|[A-Fa-f0-9]{10})" maxLength={10} autoComplete="one-time-code" value={customMfaCode} onChange={e=>setCustomMfaCode(e.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 tracking-widest"/>
            </label>
            <button disabled={loading} className="min-h-11 w-full rounded-lg bg-[#101d2d] p-3 font-bold text-white disabled:opacity-50">{loading ? 'Vérification…' : 'Vérifier avec Google Authenticator'}</button>
          </form>
          {passkeyCount > 0 && <button type="button" disabled={passkeyBusy} onClick={() => void authenticateWithPasskey()} className="min-h-11 w-full rounded-lg border border-[#101d2d] p-3 font-bold text-[#101d2d] disabled:opacity-50">{passkeyBusy ? 'Vérification…' : 'Continuer avec une passkey'}</button>}
          {!emailRecoveryRequested ? <button type="button" disabled={emailRecoveryBusy} onClick={() => void startEmailRecovery()} className="min-h-11 w-full rounded-lg border border-slate-300 p-3 text-sm font-semibold disabled:opacity-50">{emailRecoveryBusy ? 'Envoi…' : 'J’ai perdu mon facteur — récupérer par e-mail'}</button> : <form onSubmit={completeEmailRecovery} className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="text-sm text-amber-950">Saisissez le code à 8 chiffres envoyé à votre adresse de récupération vérifiée. La récupération révoquera les passkeys existantes et imposera un nouvel enrôlement TOTP.</p>
            <input required inputMode="numeric" pattern="[0-9]{8}" maxLength={8} autoComplete="one-time-code" value={emailRecoveryCode} onChange={e=>setEmailRecoveryCode(e.target.value)} className="min-h-11 w-full rounded-lg border border-amber-300 bg-white px-3 tracking-widest"/>
            <button disabled={emailRecoveryBusy} className="min-h-11 w-full rounded-lg bg-amber-800 p-3 font-bold text-white disabled:opacity-50">{emailRecoveryBusy ? 'Vérification…' : 'Valider le code e-mail'}</button>
          </form>}
          <button type="button" onClick={() => { void signOut(auth); }} className="min-h-11 w-full rounded-lg border p-3 text-sm font-semibold">Se déconnecter</button>
        </div> : <>
          <p className="text-sm text-slate-600">{loading ? 'Vérification de votre identité et de vos autorisations côté serveur…' : 'Aucune donnée de plateforme ne sera affichée tant que le serveur n’aura pas confirmé vos droits.'}</p>
          {!loading && <button type="button" onClick={() => void refresh()} className="min-h-11 w-full rounded-lg bg-[#101d2d] p-3 font-bold text-white">Vérifier à nouveau</button>}
        </>}
      </section></div>
    ) : <>
            <PlatformAdminWorkspace
        restaurants={restaurants}
        summary={summary}
        userEmail={user.email}
        security={{ passkeyCount, mfaEnrolled, recoveryCodesRemaining, trustedSessionExpiresAt, recoveryContactEmail }}
        onRefreshSecurity={refreshSecurityStatus}
        securityPanel={      {mfaEnrolled && <div className="w-full">
                <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-64 flex-1"><strong>Sécurité du compte · Protection MFA RestauMax</strong><p className="mt-1">Google Authenticator : enrôlé · {passkeyCount} passkey(s) enregistrée(s) · {recoveryCodesRemaining} code(s) de secours disponible(s).</p><p className="mt-1 text-xs text-amber-800">{trustedSessionExpiresAt && trustedSessionExpiresAt > Date.now() ? <>Session de confiance active jusqu’au <strong>{new Date(trustedSessionExpiresAt).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' })}</strong> (90 jours maximum).</> : 'Session de confiance de 90 jours non confirmée par le serveur.'}</p><p className="mt-1 text-xs text-amber-800">Adresse de récupération : <strong>{recoveryContactEmail || "non configurée"}</strong>. Elle est indépendante de l’adresse de connexion Firebase.</p></div>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" disabled={passkeyBusy} onClick={() => void registerPasskey()} className="rounded-lg border border-amber-300 bg-white px-3 py-2 font-semibold disabled:opacity-50">{passkeyBusy ? 'Passkey…' : 'Ajouter une passkey'}</button>
                      <button type="button" onClick={() => { setRecoveryRotationOpen(value => !value); setRecoveryRotationCodes([]); setError(''); }} className="rounded-lg border border-amber-300 bg-white px-3 py-2 font-semibold">Renouveler les 10 codes de secours</button>
                      <button type="button" disabled={emailRecoveryBusy || emailRecoveryRequested} onClick={() => void startEmailRecovery()} className="rounded-lg border border-amber-300 bg-white px-3 py-2 font-semibold disabled:opacity-50">{emailRecoveryBusy ? 'Envoi…' : 'Récupération MFA par e-mail'}</button>
                    </div>
                  </div>
                  <div className="mt-3 rounded-lg border border-amber-300 bg-white p-3">
                    <p className="font-semibold">Adresse e-mail de récupération indépendante</p>
                    <p className="mt-1 text-xs text-slate-600">Cette adresse ne change pas votre identifiant Firebase. Elle sera utilisée uniquement pour récupérer le MFA après vérification de sa propriété.</p>
                    {!recoveryContactPending ? <form onSubmit={event => { event.preventDefault(); void startRecoveryContactVerification(); }} className="mt-2 flex flex-wrap items-end gap-2">
                      <label className="min-w-56 flex-1 font-semibold">Nouvelle adresse de récupération
                        <input required type="email" maxLength={254} autoComplete="email" value={recoveryContactInput} onChange={event => setRecoveryContactInput(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-amber-300 px-3"/>
                      </label>
                      <button disabled={recoveryContactBusy || !recoveryContactInput.trim()} className="min-h-10 rounded-lg bg-[#101d2d] px-4 font-bold text-white disabled:opacity-50">{recoveryContactBusy ? 'Envoi…' : 'Vérifier cette adresse'}</button>
                    </form> : <form onSubmit={verifyRecoveryContact} className="mt-2 flex flex-wrap items-end gap-2">
                      <label className="min-w-56 flex-1 font-semibold">Code à 8 chiffres envoyé à {recoveryContactInput}
                        <input required inputMode="numeric" pattern="[0-9]{8}" maxLength={8} autoComplete="one-time-code" value={recoveryContactCode} onChange={event => setRecoveryContactCode(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-amber-300 px-3 tracking-widest"/>
                      </label>
                      <button disabled={recoveryContactBusy} className="min-h-10 rounded-lg bg-[#101d2d] px-4 font-bold text-white disabled:opacity-50">{recoveryContactBusy ? 'Vérification…' : 'Confirmer l’adresse'}</button>
                      <button type="button" disabled={recoveryContactBusy} onClick={() => { setRecoveryContactPending(false); setRecoveryContactCode(''); }} className="min-h-10 rounded-lg border px-3 font-semibold">Annuler</button>
                    </form>}
                  </div>
                  {emailRecoveryRequested && <form onSubmit={completeEmailRecovery} className="mt-3 flex flex-wrap items-end gap-2 rounded-lg border border-amber-300 bg-white p-3">
                    <label className="min-w-56 flex-1 font-semibold">Code à 8 chiffres reçu par e-mail
                      <input required inputMode="numeric" pattern="[0-9]{8}" maxLength={8} autoComplete="one-time-code" value={emailRecoveryCode} onChange={event => setEmailRecoveryCode(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-amber-300 px-3 tracking-widest"/>
                    </label>
                    <button disabled={emailRecoveryBusy} className="min-h-10 rounded-lg bg-[#101d2d] px-4 font-bold text-white disabled:opacity-50">{emailRecoveryBusy ? 'Vérification…' : 'Vérifier le code'}</button>
                    <button type="button" disabled={emailRecoveryBusy} onClick={() => { setEmailRecoveryRequested(false); setEmailRecoveryCode(''); }} className="min-h-10 rounded-lg border px-3 font-semibold">Annuler</button>
                  </form>}
                  {recoveryRotationOpen && <form onSubmit={regenerateRecoveryCodes} className="mt-3 flex flex-wrap items-end gap-2">
                    <label className="min-w-56 flex-1 font-semibold">Code courant de votre authentificateur TOTP
                      <input required inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" value={recoveryRotationCode} onChange={event => setRecoveryRotationCode(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-amber-300 bg-white px-3 tracking-widest"/>
                    </label>
                    <button disabled={recoveryRotationBusy} className="min-h-10 rounded-lg bg-[#101d2d] px-4 font-bold text-white disabled:opacity-50">{recoveryRotationBusy ? 'Renouvellement…' : 'Confirmer avec MFA'}</button>
                  </form>}
                  {recoveryRotationCodes.length > 0 && <div className="mt-3 rounded-lg border border-amber-300 bg-white p-3">
                    <p className="font-semibold">Les nouveaux codes sont affichés une seule fois. Tous les anciens codes sont maintenant invalides.</p>
                    <div className="mt-2 grid grid-cols-2 gap-2 font-mono">{recoveryRotationCodes.map(code => <code key={code}>{code}</code>)}</div>
                    <button type="button" onClick={() => setRecoveryRotationCodes([])} className="mt-3 rounded-lg bg-[#101d2d] px-3 py-2 font-semibold text-white">J’ai sauvegardé les nouveaux codes</button>
                  </div>}
                  {error && <p role="alert" className="mt-2 text-rose-800">{error}</p>}
                  {mfaNotice && <p role="status" className="mt-2 rounded-lg bg-emerald-50 p-2 text-emerald-900">{mfaNotice}</p>}
                </section>
              </div>}}
        loading={loading}
        request={request}
        onRefresh={refresh}
        onBack={onBack}
        onSignOut={async () => { await signOut(auth); }}
        onSignOutAndRevoke={async () => { await request({ action: 'mfa_logout_device' }); await signOut(auth); }}
      />
    </>}
  </div>;
};
