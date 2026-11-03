import React from 'react';
import {
  ArrowRight,
  BarChart3,
  ChefHat,
  ClipboardList,
  CreditCard,
  QrCode,
  ScanLine,
  ShieldCheck,
  Smartphone,
  Store,
  Table2,
  Users,
  Utensils,
  Wallet,
} from 'lucide-react';

interface HomePageProps {
  onGoToMenuWithTable: (table: string | null) => void;
  onGoToStaffTools: () => void;
  onGoToManagementHub: () => void;
  onOpenScanner?: () => void;
}

const modules = [
  {
    icon: Utensils,
    title: 'Menu & catalogue',
    description: 'Présentez vos plats, boissons, options et disponibilités.',
    tone: 'orange',
  },
  {
    icon: ClipboardList,
    title: 'Commandes',
    description: 'Retrouvez les commandes et suivez leur avancement.',
    tone: 'blue',
  },
  {
    icon: Wallet,
    title: 'Caisse & paiements',
    description: 'Organisez les encaissements et le suivi des ventes.',
    tone: 'green',
  },
  {
    icon: ChefHat,
    title: 'Espace cuisine',
    description: 'Visualisez les commandes à préparer et leur statut.',
    tone: 'violet',
  },
  {
    icon: Table2,
    title: 'Tables & QR codes',
    description: 'Associez un QR code à chaque table de votre établissement.',
    tone: 'cyan',
  },
  {
    icon: BarChart3,
    title: 'Pilotage',
    description: 'Accédez aux indicateurs disponibles pour votre activité.',
    tone: 'amber',
  },
] as const;

const toneClasses = {
  orange: 'bg-orange-50 text-orange-600 ring-orange-100',
  blue: 'bg-blue-50 text-blue-600 ring-blue-100',
  green: 'bg-emerald-50 text-emerald-600 ring-emerald-100',
  violet: 'bg-violet-50 text-violet-600 ring-violet-100',
  cyan: 'bg-cyan-50 text-cyan-700 ring-cyan-100',
  amber: 'bg-amber-50 text-amber-700 ring-amber-100',
};

export const HomePage: React.FC<HomePageProps> = ({
  onGoToMenuWithTable: _onGoToMenuWithTable,
  onGoToStaffTools,
  onGoToManagementHub,
  onOpenScanner,
}) => {
  return (
    <div className="min-h-screen overflow-hidden bg-[#f7f8fa] text-slate-900">
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
          <a href="/" aria-label="RestauMax, accueil" className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#ff6b35] text-sm font-black tracking-tight text-white shadow-lg shadow-orange-500/20">
              RM
            </span>
            <span>
              <span className="block text-lg font-black leading-tight tracking-tight text-[#14263d]">RestauMax</span>
              <span className="block text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">La gestion restaurant simplifiée</span>
            </span>
          </a>

          <nav aria-label="Navigation principale" className="hidden items-center gap-8 text-sm font-semibold text-slate-600 md:flex">
            <a href="#solution" className="transition hover:text-[#f26535]">La solution</a>
            <a href="#fonctionnalites" className="transition hover:text-[#f26535]">Fonctionnalités</a>
            <a href="#qr-code" className="transition hover:text-[#f26535]">Commande QR</a>
          </nav>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onGoToStaffTools}
              className="hidden rounded-xl px-4 py-2.5 text-sm font-bold text-slate-600 transition hover:bg-slate-100 sm:inline-flex"
            >
              Espace équipe
            </button>
            <button
              type="button"
              onClick={onGoToManagementHub}
              className="inline-flex items-center gap-2 rounded-xl bg-[#14263d] px-4 py-2.5 text-sm font-extrabold text-white shadow-lg shadow-slate-900/10 transition hover:bg-[#203a59] focus:outline-none focus:ring-4 focus:ring-slate-300"
            >
              <span>Se connecter</span>
              <ArrowRight size={16} />
            </button>
          </div>
        </div>
      </header>

      <main>
        <section id="solution" className="relative isolate">
          <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top_right,_rgba(255,107,53,0.13),_transparent_42%),radial-gradient(ellipse_at_bottom_left,_rgba(20,119,94,0.09),_transparent_38%)]" />
          <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 pb-20 pt-16 sm:px-6 sm:pt-20 lg:grid-cols-[1.05fr_0.95fr] lg:px-8 lg:pb-28 lg:pt-24">
            <div>
              <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-orange-200 bg-white/80 px-4 py-2 text-xs font-extrabold text-[#df5929] shadow-sm">
                <span className="h-2 w-2 rounded-full bg-[#ff6b35]" />
                Une expérience plus simple, côté salle et côté cuisine
              </div>
              <h1 className="max-w-2xl text-4xl font-black leading-[1.08] tracking-[-0.045em] text-[#14263d] sm:text-5xl lg:text-6xl">
                Votre restaurant,
                <span className="block text-[#f26535]">mieux organisé.</span>
                <span className="block">Vos clients, mieux servis.</span>
              </h1>
              <p className="mt-7 max-w-xl text-base leading-8 text-slate-600 sm:text-lg">
                RestauMax réunit les outils essentiels pour gérer votre établissement et proposer à vos clients une commande simple depuis leur téléphone, grâce au QR code.
              </p>

              <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={onGoToManagementHub}
                  className="inline-flex items-center justify-center gap-3 rounded-2xl bg-[#ff6b35] px-6 py-4 text-sm font-extrabold text-white shadow-xl shadow-orange-500/20 transition hover:-translate-y-0.5 hover:bg-[#e85b2a] focus:outline-none focus:ring-4 focus:ring-orange-200"
                >
                  <Store size={19} />
                  Accéder à mon restaurant
                  <ArrowRight size={17} />
                </button>
                {onOpenScanner && (
                  <button
                    type="button"
                    onClick={onOpenScanner}
                    className="inline-flex items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white px-6 py-4 text-sm font-extrabold text-[#14263d] shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-slate-200"
                  >
                    <ScanLine size={19} className="text-emerald-600" />
                    Scanner un QR code
                  </button>
                )}
              </div>

              <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3 text-xs font-semibold text-slate-500">
                <span className="inline-flex items-center gap-2"><ShieldCheck size={15} className="text-emerald-600" /> Accès selon vos autorisations</span>
                <span className="inline-flex items-center gap-2"><Smartphone size={15} className="text-emerald-600" /> Ordinateur, tablette et mobile</span>
              </div>
            </div>

            <div className="relative mx-auto w-full max-w-xl">
              <div className="absolute -right-8 -top-8 h-40 w-40 rounded-full bg-orange-200/50 blur-3xl" />
              <div className="absolute -bottom-8 -left-8 h-40 w-40 rounded-full bg-emerald-200/60 blur-3xl" />
              <div className="relative rounded-[2rem] border border-white bg-white p-4 shadow-[0_30px_90px_-35px_rgba(20,38,61,0.35)] sm:p-6">
                <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Votre espace de travail</p>
                    <p className="mt-1 text-lg font-black text-[#14263d]">Tout au même endroit</p>
                  </div>
                  <div className="rounded-xl bg-emerald-50 p-3 text-emerald-600"><Store size={22} /></div>
                </div>
                <div className="grid grid-cols-2 gap-3 pt-5">
                  <div className="rounded-2xl bg-[#14263d] p-4 text-white">
                    <div className="flex items-center justify-between text-slate-300"><ClipboardList size={19} /><span className="text-[10px] font-bold uppercase tracking-wider">Suivi</span></div>
                    <p className="mt-7 text-sm font-bold">Commandes</p>
                    <p className="mt-1 text-xs text-slate-300">De la réception au service</p>
                  </div>
                  <div className="rounded-2xl bg-orange-50 p-4 text-[#14263d]">
                    <div className="flex items-center justify-between text-[#ed693b]"><Utensils size={19} /><span className="text-[10px] font-bold uppercase tracking-wider">Menu</span></div>
                    <p className="mt-7 text-sm font-bold">Catalogue</p>
                    <p className="mt-1 text-xs text-slate-500">Plats et suppléments</p>
                  </div>
                  <div className="rounded-2xl bg-emerald-50 p-4 text-[#14263d]">
                    <div className="flex items-center justify-between text-emerald-600"><CreditCard size={19} /><span className="text-[10px] font-bold uppercase tracking-wider">Caisse</span></div>
                    <p className="mt-7 text-sm font-bold">Encaissements</p>
                    <p className="mt-1 text-xs text-slate-500">Suivi des règlements</p>
                  </div>
                  <div className="rounded-2xl bg-blue-50 p-4 text-[#14263d]">
                    <div className="flex items-center justify-between text-blue-600"><QrCode size={19} /><span className="text-[10px] font-bold uppercase tracking-wider">QR code</span></div>
                    <p className="mt-7 text-sm font-bold">Commande client</p>
                    <p className="mt-1 text-xs text-slate-500">Depuis la table</p>
                  </div>
                </div>
                <div className="mt-4 flex items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50 p-4">
                  <div className="rounded-xl bg-white p-2.5 text-slate-600 shadow-sm"><Users size={19} /></div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-extrabold text-[#14263d]">Une équipe, des accès adaptés</p>
                    <p className="mt-1 text-[11px] text-slate-500">Gérant, responsable et personnel</p>
                  </div>
                  <ArrowRight size={16} className="text-slate-400" />
                </div>
                <p className="px-1 pt-3 text-center text-[10px] font-medium text-slate-400">Illustration de l’interface · les données réelles apparaissent après connexion</p>
              </div>
            </div>
          </div>
        </section>

        <section id="fonctionnalites" className="bg-white py-20 sm:py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-[#f26535]">Une gestion centralisée</p>
              <h2 className="mt-4 text-3xl font-black tracking-tight text-[#14263d] sm:text-4xl">Les bons outils pour chaque moment du service</h2>
              <p className="mt-4 text-sm leading-7 text-slate-500 sm:text-base">Une interface pensée pour faciliter le quotidien du gérant et de son équipe, sans multiplier les outils.</p>
            </div>

            <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {modules.map(({ icon: Icon, title, description, tone }) => (
                <article key={title} className="group rounded-3xl border border-slate-200/80 bg-white p-6 transition duration-200 hover:-translate-y-1 hover:border-orange-200 hover:shadow-xl hover:shadow-slate-900/5">
                  <div className={`inline-flex rounded-2xl p-3 ring-1 ${toneClasses[tone]}`}>
                    <Icon size={22} />
                  </div>
                  <h3 className="mt-5 text-base font-extrabold text-[#14263d]">{title}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-500">{description}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="qr-code" className="bg-[#14263d] py-16 text-white sm:py-20">
          <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-8 px-4 sm:px-6 md:flex-row md:items-center lg:px-8">
            <div className="max-w-2xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-orange-200">
                <QrCode size={14} /> Expérience client par QR code
              </div>
              <h2 className="mt-5 text-3xl font-black tracking-tight sm:text-4xl">Un menu accessible en quelques secondes.</h2>
              <p className="mt-4 max-w-xl text-sm leading-7 text-slate-300 sm:text-base">Vos clients scannent le QR code de leur table, consultent le menu de votre établissement et préparent leur commande sur leur téléphone.</p>
            </div>
            <div className="flex w-full flex-col gap-3 sm:w-auto sm:min-w-[230px]">
              {onOpenScanner && (
                <button type="button" onClick={onOpenScanner} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[#ff6b35] px-6 py-4 text-sm font-extrabold text-white transition hover:bg-[#e85b2a] focus:outline-none focus:ring-4 focus:ring-orange-300/30">
                  <ScanLine size={18} /> Scanner un QR code
                </button>
              )}
              <button type="button" onClick={onGoToManagementHub} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/20 bg-white/10 px-6 py-4 text-sm font-bold text-white transition hover:bg-white/15">
                Configurer mon restaurant <ArrowRight size={16} />
              </button>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-8 text-xs text-slate-500 sm:px-6 md:flex-row md:items-center md:justify-between lg:px-8">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#ff6b35] text-[10px] font-black text-white">RM</span>
            <span className="font-bold text-[#14263d]">RestauMax</span>
            <span>· La gestion restaurant simplifiée</span>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2 font-semibold">
            <button type="button" onClick={onGoToManagementHub} className="transition hover:text-[#f26535]">Connexion restaurateur</button>
            <button type="button" onClick={onGoToStaffTools} className="transition hover:text-[#f26535]">Espace équipe</button>
          </div>
          <span>© {new Date().getFullYear()} RestauMax</span>
        </div>
      </footer>
    </div>
  );
};
