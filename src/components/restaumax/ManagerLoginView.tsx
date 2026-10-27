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

          {/* Security & Provisioning Note */}
          <div className="pt-4 border-t border-slate-100 text-center">
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Pour des raisons de sécurité, les comptes de gestion sont administrés de manière centralisée via Firebase Authentication. Aucun formulaire d’inscription publique n’est exposé.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
