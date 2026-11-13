import React, { useCallback, useEffect, useRef, useState } from 'react';
import { getMultiFactorResolver, onAuthStateChanged, PhoneAuthProvider, PhoneMultiFactorGenerator, RecaptchaVerifier, signInWithEmailAndPassword, signOut, TotpMultiFactorGenerator, type MultiFactorResolver, type User } from 'firebase/auth';
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
  const mfaRecaptchaVerifier = useRef<RecaptchaVerifier | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const request = useCallback(async (body?: Record<string, unknown>) => {
    if (!auth.currentUser) throw new Error('Session non authentifiée.');
    const token = await auth.currentUser.getIdToken(true);
    const response = await fetch('/api/platform-admin', {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) {
      // /admin is a separate security boundary: a restaurant session must not
      // remain authenticated after the platform API rejects it.
      if ((response.status === 401 || response.status === 403) && !['mfa_verify', 'mfa_status', 'mfa_accept_firebase', 'mfa_recovery_enroll_start'].includes(String(body?.action || ''))) {
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
    if (!['mfa_status', 'mfa_enroll_start', 'mfa_enroll_confirm', 'mfa_accept_firebase', 'mfa_recovery_enroll_start', 'mfa_logout'].includes(String(body?.action || ''))) {
      setIsPlatformAdminAuthorized(true);
    }
    return data;
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
    const status = await request({ action: 'mfa_status' });
    setNeedsPlatformAdminLogin(false);
    if (status.sessionValid === true) {
      if (status.recoverySession === true) {
        const setup = await request({ action: 'mfa_recovery_enroll_start' });
        setTotpSecret({ secretKey: setup.secret, otpauthUri: setup.otpauthUri, recoveryEnrollment: true });
        setCustomMfaSetup(true);
        setCustomMfaRequired(false);
        setIsPlatformAdminAuthorized(false);
        return;
      }
      setCustomMfaRequired(false); setCustomMfaSetup(false); setTotpSecret(null);
      const data = await request();
      setRestaurants(data.restaurants || []); setSummary(data.summary || null);
      return;
    }
    // Firebase adds sign_in_second_factor only after resolveSignIn succeeds.
    // Force refresh so a cached pre-challenge token cannot trigger a second TOTP.
    const tokenResult = await auth.currentUser?.getIdTokenResult(true);
    const firebaseSecondFactor = (tokenResult?.claims?.firebase as any)?.sign_in_second_factor;
    if (firebaseMfaJustCompleted && !(typeof firebaseSecondFactor === 'string' && firebaseSecondFactor)) {
      throw new Error('Firebase n’a pas encore confirmé le second facteur dans le jeton de connexion. Réessayez la connexion.');
    }
    if (firebaseMfaJustCompleted || (typeof firebaseSecondFactor === 'string' && firebaseSecondFactor)) {
      try {
        await request({ action: 'mfa_accept_firebase' });
        const data = await request();
        setRestaurants(data.restaurants || []); setSummary(data.summary || null);
        setCustomMfaRequired(false); setCustomMfaSetup(false); setTotpSecret(null);
        return;
      } catch (error: any) {
        if (String(error?.message || '').includes('authentification Firebase')) {
          await signOut(auth).catch(() => undefined);
          setUser(null); setNeedsPlatformAdminLogin(true);
          return;
        }
        throw error;
      }
    }
    if (status.enrolled === true) {
      setCustomMfaRequired(true);
      setCustomMfaCode('');
      setIsPlatformAdminAuthorized(false);
      return;
    }
    const setup = await request({ action: 'mfa_enroll_start' });
    setTotpSecret({ secretKey: setup.secret, otpauthUri: setup.otpauthUri });
    setCustomMfaSetup(true);
    setCustomMfaRequired(false);
    setIsPlatformAdminAuthorized(false);
  }, [request]);

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
      setRecoveryCodes(Array.isArray(result.recoveryCodes) ? result.recoveryCodes : []);
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
        </form> : customMfaRequired ? <form onSubmit={verifyCustomMfa} className="space-y-3">
          <p className="text-sm text-slate-600">Saisissez le code courant de votre application d’authentification. Les API de plateforme resteront bloquées jusqu’à validation côté serveur.</p>
          <label className="block text-sm font-semibold text-slate-700">Code MFA<input required inputMode="text" pattern="([0-9]{6}|[A-Fa-f0-9]{10})" maxLength={10} autoComplete="one-time-code" value={customMfaCode} onChange={e=>setCustomMfaCode(e.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 tracking-widest"/></label>
          <button disabled={loading} className="min-h-11 w-full rounded-lg bg-[#101d2d] p-3 font-bold text-white disabled:opacity-50">{loading ? 'Vérification…' : 'Vérifier et accéder à la plateforme'}</button>
          <button type="button" onClick={() => { void signOut(auth); }} className="min-h-11 w-full rounded-lg border p-3 text-sm font-semibold">Se déconnecter</button>
        </form> : <>
          <p className="text-sm text-slate-600">{loading ? 'Vérification de votre identité et de vos autorisations côté serveur…' : 'Aucune donnée de plateforme ne sera affichée tant que le serveur n’aura pas confirmé vos droits.'}</p>
          {!loading && <button type="button" onClick={() => void refresh()} className="min-h-11 w-full rounded-lg bg-[#101d2d] p-3 font-bold text-white">Vérifier à nouveau</button>}
        </>}
      </section></div>
    ) : <>
      <PlatformAdminWorkspace
        restaurants={restaurants}
        summary={summary}
        userEmail={user.email}
        loading={loading}
        request={request}
        onRefresh={refresh}
        onBack={onBack}
        onSignOut={async () => { await request({ action: 'mfa_logout' }).catch(() => undefined); await signOut(auth); }}
      />
    </>}
  </div>;
};
