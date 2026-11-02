import React, { useState } from 'react';
import { 
  Building2, 
  Lock, 
  Mail, 
  Eye, 
  EyeOff, 
  AlertCircle, 
  ArrowLeft, 
  ShieldCheck, 
  Loader2 
} from 'lucide-react';
import { sounds } from '../../utils/audio';
import { auth } from '../../lib/firebase';
import { createUserWithEmailAndPassword, sendEmailVerification, sendPasswordResetEmail, reload } from 'firebase/auth';

interface ManagerLoginViewProps {
  onLogin: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  onBackToMenu: () => void;
  restaurantName?: string;
}

export const ManagerLoginView: React.FC<ManagerLoginViewProps> = ({
  onLogin,
  onBackToMenu,
  restaurantName = 'Chez Awa'
}) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [registration, setRegistration] = useState({ ownerName: '', restaurantName: '', city: '', phone: '', email: '', password: '', confirmPassword: '' });
  const [verificationPending, setVerificationPending] = useState(false);
  const [registrationNotice, setRegistrationNotice] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setErrorMessage('Veuillez renseigner votre adresse e-mail et votre mot de passe.');
      sounds.playAlert();
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    sounds.playTap();

    try {
      const result = await onLogin(email.trim(), password);
      if (!result.success) {
        sounds.playAlert();
        setErrorMessage(
          result.error ||
          'Identifiants invalides ou privilèges insuffisants. Veuillez vérifier vos accès.'
        );
      } else {
        sounds.playTap();
      }
    } catch {
      sounds.playAlert();
      setErrorMessage('Une erreur est survenue lors de la tentative de connexion.');
    } finally {
      setIsSubmitting(false);
    }
  };


  const handlePasswordReset = async () => {
    const targetEmail = email.trim();
    if (!targetEmail) { setErrorMessage('Saisissez votre adresse e-mail pour recevoir le lien de réinitialisation.'); return; }
    setIsSubmitting(true); setErrorMessage(null); setRegistrationNotice(null);
    try { await sendPasswordResetEmail(auth, targetEmail); setRegistrationNotice('Si cette adresse correspond à un compte, un e-mail de réinitialisation vient d’être envoyé. Vérifiez aussi vos courriers indésirables.'); }
    catch (error: any) { setErrorMessage(error?.code === 'auth/invalid-email' ? 'L’adresse e-mail saisie est invalide.' : 'Impossible d’envoyer le lien pour le moment. Vérifiez l’adresse et réessayez.'); }
    finally { setIsSubmitting(false); }
  };
  const handleRegistration = async (event: React.FormEvent) => {
    event.preventDefault();
    setErrorMessage(null);
    setRegistrationNotice(null);
    if (!registration.ownerName.trim() || !registration.restaurantName.trim() || !registration.city.trim() ||
        !registration.phone.trim() || !registration.email.trim()) {
      setErrorMessage('Veuillez renseigner toutes les informations demandées.');
      return;
    }
    if (registration.password.length < 10 || registration.password !== registration.confirmPassword) {
      setErrorMessage('Le mot de passe doit contenir au moins 10 caractères et les deux saisies doivent correspondre.');
      return;
    }
    setIsSubmitting(true);
    try {
      if (!verificationPending) {
        const credential = await createUserWithEmailAndPassword(auth, registration.email.trim(), registration.password);
        await sendEmailVerification(credential.user);
        setVerificationPending(true);
        setRegistrationNotice('Compte créé. Consultez votre boîte e-mail et confirmez votre adresse. Revenez ensuite ici pour envoyer votre demande.');
        return;
      }
      const user = auth.currentUser;
      if (!user) throw new Error('Session d’inscription introuvable. Reconnectez-vous avec le compte créé.');
      await reload(user);
      if (!user.emailVerified) {
        setRegistrationNotice('Votre adresse e-mail n’est pas encore confirmée. Ouvrez le lien reçu par e-mail puis réessayez.');
        return;
      }
      const token = await user.getIdToken(true);
      const response = await fetch('/api/platform-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          action: 'register_restaurant_request',
          ownerName: registration.ownerName.trim(),
          restaurantName: registration.restaurantName.trim(),
          city: registration.city.trim(),
          phone: registration.phone.trim()
        })
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Impossible d’envoyer la demande.');
      setRegistrationNotice('Votre demande a bien été transmise. Elle est en attente de validation par l’équipe RestauMax. Vous recevrez une confirmation après examen.');
      setVerificationPending(false);
      setRegistration({ ownerName: '', restaurantName: '', city: '', phone: '', email: '', password: '', confirmPassword: '' });
    } catch (error: any) {
      setErrorMessage(error?.message || 'Une erreur est survenue pendant l’inscription.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-[85vh] flex items-center justify-center p-4 bg-[#f4f7fb] text-[#181c1f]">
      <div className="w-full max-w-md bg-white rounded-3xl border border-slate-200/90 shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header Banner */}
        <div className="bg-[#101d2d] text-white p-6 sm:p-8 text-center relative">
          <button
            type="button"
            onClick={() => {
              sounds.playTap();
              onBackToMenu();
            }}
            className="absolute top-5 left-5 p-2 rounded-xl bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white transition-colors flex items-center gap-1.5 text-xs font-semibold"
            title="Revenir au menu client"
          >
            <ArrowLeft size={14} />
            <span className="hidden sm:inline">Menu client</span>
          </button>

          <div className="w-14 h-14 mx-auto rounded-2xl bg-[#ff6500] text-white flex items-center justify-center font-black text-xl shadow-md mb-3">
            RM
          </div>

          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[10px] font-extrabold uppercase tracking-wider mb-2">
            <Lock size={11} />
            <span>Accès Sécurisé</span>
          </div>

          <h1 className="text-xl sm:text-2xl font-black tracking-tight text-white">
            Espace Gestion
          </h1>
          <p className="text-xs text-slate-300 mt-1 max-w-xs mx-auto">
            {restaurantName} — Authentification requise pour piloter le restaurant et la carte
          </p>
        </div>

        {/* Form Body */}
        <div className="p-6 sm:p-8 space-y-6">
          {errorMessage && (
            <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-2.5">
              <AlertCircle size={16} className="text-rose-600 shrink-0 mt-0.5" />
              <div className="leading-relaxed">
                <span className="font-bold">Accès refusé :</span> {errorMessage}
              </div>
            </div>
          )}

          {registrationNotice && <div role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-xs leading-relaxed text-emerald-800">{registrationNotice}</div>}
          {isRegistering ? (
          <form onSubmit={handleRegistration} className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="text-xs font-bold text-slate-700">Nom complet<input required maxLength={160} value={registration.ownerName} onChange={e=>setRegistration({...registration,ownerName:e.target.value})} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 font-medium" placeholder="Votre nom"/></label>
              <label className="text-xs font-bold text-slate-700">E-mail professionnel<input required type="email" autoComplete="email" value={registration.email} onChange={e=>setRegistration({...registration,email:e.target.value})} disabled={verificationPending} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 font-medium"/></label>
              <label className="text-xs font-bold text-slate-700 sm:col-span-2">Nom du restaurant<input required maxLength={200} value={registration.restaurantName} onChange={e=>setRegistration({...registration,restaurantName:e.target.value})} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 font-medium" placeholder="Ex. Maquis Chez Awa"/></label>
              <label className="text-xs font-bold text-slate-700">Ville / Commune<input required maxLength={120} value={registration.city} onChange={e=>setRegistration({...registration,city:e.target.value})} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 font-medium" placeholder="Abidjan, Cocody"/></label>
              <label className="text-xs font-bold text-slate-700">Téléphone<input required maxLength={40} value={registration.phone} onChange={e=>setRegistration({...registration,phone:e.target.value})} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 font-medium" placeholder="+225…"/></label>
              <label className="text-xs font-bold text-slate-700">Mot de passe<input required minLength={10} type="password" autoComplete="new-password" value={registration.password} onChange={e=>setRegistration({...registration,password:e.target.value})} disabled={verificationPending} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 font-medium"/></label>
              <label className="text-xs font-bold text-slate-700">Confirmer le mot de passe<input required minLength={10} type="password" autoComplete="new-password" value={registration.confirmPassword} onChange={e=>setRegistration({...registration,confirmPassword:e.target.value})} disabled={verificationPending} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 font-medium"/></label>
            </div>
            <p className="text-[11px] leading-relaxed text-slate-500">Une confirmation de votre adresse e-mail est obligatoire. Votre restaurant restera en attente jusqu’à validation par RestauMax. Aucun accès de gestion n’est accordé avant approbation.</p>
            <button type="submit" disabled={isSubmitting} className="w-full rounded-xl bg-[#ff6500] py-3 text-xs font-black text-white disabled:opacity-60">{isSubmitting ? 'Traitement…' : verificationPending ? 'J’ai confirmé mon e-mail — envoyer ma demande' : 'Créer mon compte et recevoir le lien de confirmation'}</button>
            <button type="button" onClick={()=>{setIsRegistering(false);setErrorMessage(null);setRegistrationNotice(null);}} className="w-full py-2 text-xs font-bold text-slate-500">Retour à la connexion</button>
          </form>
          ) : (
          <>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                Adresse e-mail
              </label>
              <div className="relative">
                <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="gerant@restaurant.ci"
                  required
                  disabled={isSubmitting}
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#ff6500] focus:bg-white transition-all disabled:opacity-50"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                Mot de passe
              </label>
              <div className="relative">
                <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  required
                  disabled={isSubmitting}
                  className="w-full pl-10 pr-10 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#ff6500] focus:bg-white transition-all disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                  title={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-3 bg-[#ff6500] hover:bg-[#e05800] text-white rounded-xl text-xs font-black shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2 active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  <span>Vérification de la session...</span>
                </>
              ) : (
                <>
                  <ShieldCheck size={16} />
                  <span>Se connecter au Centre de Gestion</span>
                </>
              )}
            </button>
          </form>
          <button type="button" onClick={handlePasswordReset} disabled={isSubmitting} className="w-full py-2 text-xs font-semibold text-[#c64b00] hover:underline disabled:opacity-50">Mot de passe oublié ? Réinitialiser par e-mail</button>
          <button type="button" onClick={()=>{setIsRegistering(true);setErrorMessage(null);setRegistrationNotice(null);}} className="w-full rounded-xl border border-orange-200 bg-orange-50 py-3 text-xs font-extrabold text-[#d94f00] hover:bg-orange-100">Créer un compte restaurateur</button>
          </>
          )}

          {/* Security & Provisioning Note */}
          <div className="pt-4 border-t border-slate-100 text-center">
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Les inscriptions sont ouvertes aux restaurateurs. Chaque demande est vérifiée par l’équipe RestauMax avant l’activation de l’accès de gestion.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
