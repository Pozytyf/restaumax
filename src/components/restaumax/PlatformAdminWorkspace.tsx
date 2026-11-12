import React, { useEffect, useMemo, useState } from 'react';
import { auth, requestManagerPasswordReset } from '../../lib/firebase';
import {
  Activity, Bell, Building2, ChevronRight, CircleHelp, ClipboardList,
  CreditCard, LayoutDashboard, LogOut, Plus, RefreshCw, Search, Settings,
  Users, X, AlertTriangle
} from 'lucide-react';

type Subscription = {
  planName?: string; priceFcfa?: number; currency?: string;
  billingCycle?: 'monthly' | 'yearly' | 'custom';
  status?: 'trial' | 'active' | 'past_due' | 'suspended' | 'cancelled';
  startsAt?: number; endsAt?: number; nextBillingAt?: number; autoRenew?: boolean;
  gracePeriodDays?: number; currentInvoiceId?: string | null;
  currentInvoiceAmountFcfa?: number | null; pastDueAt?: number | null;
};
type Restaurant = {
  slug: string; name: string; status?: string; isOpen?: boolean;
  city?: string; country?: string; createdAt?: number | null;
  subscription?: Subscription;
};
type Invoice = {
  id: string; restaurantSlug: string; planName: string; amountFcfa: number;
  currency: string; status: string; issuedAt: number | null; dueAt: number | null;
  paidAt: number | null; paymentReference?: string | null;
};
type AuditEntry = {
  id: string; action: string; actorUid: string; restaurantSlug: string;
  targetRole: string; invoiceId: string; amountFcfa: number | null;
  createdAt: number | null; preservedBusinessData: boolean;
};
type Account = {
  uid: string; email: string; displayName: string; role: string;
  active: boolean; activeKnown: boolean; accountLinked: boolean; emailConflict: boolean;
};
type PlatformAdmin = {
  uid: string; email: string; displayName: string; role: 'billing' | 'support' | 'read_only';
  active: boolean; mfaEnrolled: boolean; disabled: boolean; lastSignInAt?: number | null;
};
type SupportMessage = { id: string; body: string; authorRole: string; authorUid: string; visibility: string; createdAt: number };
type SupportTicket = {
  id: string; restaurantSlug: string; restaurantName: string; subject: string;
  priority: 'low' | 'medium' | 'high'; status: string; createdAt: number; updatedAt: number;
  messageCount: number; source: string;
};
type PlatformConfig = {
  currency: 'XOF'; gracePeriodDays: number; maintenanceMode: boolean; version: number;
  planFeatures: Record<'Essentiel' | 'Pro', Record<'kitchenScreen' | 'advancedReports' | 'inventoryRecipes' | 'loyalty', boolean>>;
  emailTemplates: Record<'invitation' | 'passwordReset' | 'invoice' | 'overdue', { subject: string; body: string }>;
};
type HealthService = { id: string; label: string; status: string; detail: string };
type PlatformAnnouncement = {
  id: string; title: string; message: string; targetType: string; planName: string;
  restaurantSlugs: string[]; status: string; createdAt: number; publishedAt?: number | null; scheduledAt?: number | null;
};
type Props = {
  restaurants: Restaurant[];
  summary: {
    totalRestaurants: number; activeRestaurants: number; suspendedRestaurants: number;
    monthlyRecurringRevenueFcfa: number; subscriptionsByStatus?: Record<string, number>;
  } | null;
  userEmail?: string | null;
  loading: boolean;
  request: (body?: Record<string, unknown>) => Promise<any>;
  onRefresh: () => Promise<void>;
  onBack: () => void;
  onSignOut: () => void;
};

const NAV = [
  { id: 'overview', label: 'Vue d’ensemble', status: 'Partiel', icon: LayoutDashboard },
  { id: 'restaurants', label: 'Restaurants', status: 'Existant', icon: Building2 },
  { id: 'billing', label: 'Abonnements et factures', status: 'Partiel', icon: CreditCard },
  { id: 'accounts', label: 'Comptes et accès', status: 'Existant', icon: Users },
  { id: 'support', label: 'Support', status: 'Existant', icon: CircleHelp },
  { id: 'audit', label: 'Journal d’audit', status: 'Partiel', icon: ClipboardList },
  { id: 'health', label: 'Santé de la plateforme', status: 'Partiel', icon: Activity },
  { id: 'settings', label: 'Configuration', status: 'Partiel', icon: Settings },
  { id: 'communication', label: 'Communication', status: 'Existant', icon: Bell }
] as const;
type Screen = typeof NAV[number]['id'];

const demoTickets = [
  ['T-101', 'Le Palmier', 'Problème d’impression', 'Moyen', 'Ouvert', 'Hier'],
  ['T-102', 'Café Lagune', 'QR code illisible', 'Élevé', 'En cours', 'Aujourd’hui'],
  ['T-103', 'Chez Awa', 'Question sur une facture', 'Faible', 'Résolu', '09/11']
];

const money = (value: number) => `${Math.round(value || 0).toLocaleString('fr-FR')} FCFA`;
const date = (value?: number | null) => value ? new Date(value).toLocaleDateString('fr-FR') : '—';
const statusLabel = (value?: string) => ({
  active: 'Actif', trial: 'Essai', past_due: 'En retard', suspended: 'Suspendu',
  cancelled: 'Résilié', deleted: 'Archivé', unknown: 'Non défini'
}[value || ''] || value || 'Non défini');
const statusClass = (value?: string) => ({
  active: 'bg-emerald-100 text-emerald-800', paid: 'bg-emerald-100 text-emerald-800',
  trial: 'bg-sky-100 text-sky-800', past_due: 'bg-amber-100 text-amber-900',
  suspended: 'bg-rose-100 text-rose-800', cancelled: 'bg-slate-200 text-slate-700',
  deleted: 'bg-slate-200 text-slate-700', open: 'bg-amber-100 text-amber-900'
}[value || ''] || 'bg-slate-100 text-slate-700');

function DemoPill() {
  return <span className="inline-flex min-h-7 items-center rounded-full border border-amber-300 bg-amber-100 px-3 py-1 text-[11px] font-bold text-amber-950">Maquette · valeurs d’exemple</span>;
}
function Panel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-[#dbe3ee] bg-white p-5 shadow-sm ${className}`}>{children}</section>;
}
function Badge({ children, value }: { children?: React.ReactNode; value?: string }) {
  return <span className={`inline-flex min-h-7 items-center rounded-full px-3 py-1 text-xs font-semibold ${statusClass(value)}`}>{children || statusLabel(value)}</span>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="flex min-w-0 flex-col gap-1.5 text-sm font-semibold text-slate-700">{label}{children}</label>;
}
const inputClass = 'min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#c2410c] focus:ring-2 focus:ring-orange-100';

export const PlatformAdminWorkspace: React.FC<Props> = ({
  restaurants, summary, userEmail, loading, request, onRefresh, onBack, onSignOut
}) => {
  const [screen, setScreen] = useState<Screen>('overview');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selected, setSelected] = useState<Restaurant | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [auditFilters, setAuditFilters] = useState({ actor: '', action: '', restaurant: '', from: '', to: '' });
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountRestaurant, setAccountRestaurant] = useState('');
  const [pageLoading, setPageLoading] = useState(false);
  const [pageError, setPageError] = useState('');
  const [notice, setNotice] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', ownerName: '', ownerEmail: '' });
  const [subscriptionTarget, setSubscriptionTarget] = useState<Restaurant | null>(null);
  const [subscriptionForm, setSubscriptionForm] = useState({ planName: '', priceFcfa: '0', billingCycle: 'monthly', status: 'trial', startsOn: '', endsOn: '', gracePeriodDays: '7', autoRenew: true });
  const [paymentReference, setPaymentReference] = useState('');
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [health, setHealth] = useState<{ checkedAt: number; services: HealthService[] } | null>(null);
  const [platformAdmins, setPlatformAdmins] = useState<PlatformAdmin[]>([]);
  const [platformAdminForm, setPlatformAdminForm] = useState({ displayName: '', email: '', platformRole: 'support' });
  const [supportTickets, setSupportTickets] = useState<SupportTicket[]>([]);
  const [selectedTicket, setSelectedTicket] = useState<SupportTicket | null>(null);
  const [ticketMessages, setTicketMessages] = useState<SupportMessage[]>([]);
  const [ticketReply, setTicketReply] = useState('');
  const [ticketInternalNote, setTicketInternalNote] = useState('');
  const [ticketStatus, setTicketStatus] = useState('in_progress');
  const [ticketPriority, setTicketPriority] = useState('medium');
  const [supportDraft, setSupportDraft] = useState({ restaurantSlug: '', subject: '', message: '', priority: 'medium' });
  const [platformConfig, setPlatformConfig] = useState<PlatformConfig>({
    currency: 'XOF', gracePeriodDays: 7, maintenanceMode: false, version: 1,
    planFeatures: {
      Essentiel: { kitchenScreen: true, advancedReports: false, inventoryRecipes: false, loyalty: false },
      Pro: { kitchenScreen: true, advancedReports: true, inventoryRecipes: true, loyalty: true }
    },
    emailTemplates: {
      invitation: { subject: 'Bienvenue sur RestauMax', body: 'Votre compte RestauMax est prêt. Utilisez le lien sécurisé reçu par e-mail.' },
      passwordReset: { subject: 'Réinitialisation de votre mot de passe', body: 'Suivez le lien sécurisé de Firebase Authentication pour choisir un nouveau mot de passe.' },
      invoice: { subject: 'Votre facture RestauMax', body: 'Votre facture est disponible dans votre espace.' },
      overdue: { subject: 'Rappel de paiement RestauMax', body: 'Une facture reste à régulariser dans votre espace.' }
    }
  });
  const [announcements, setAnnouncements] = useState<PlatformAnnouncement[]>([]);
  const [announcement, setAnnouncement] = useState({ title: '', message: '', targetType: 'all', planName: 'Essentiel', restaurantSlugs: [] as string[], schedule: '' });
  const [announcementPreview, setAnnouncementPreview] = useState(false);

  const read = async (action: string, params: Record<string, string> = {}) => {
    const currentUser = auth.currentUser;
    if (!currentUser) throw new Error('Session super-administrateur expirée.');
    const token = await currentUser.getIdToken(true);
    const query = new URLSearchParams({ action, ...params });
    const response = await fetch(`/api/platform-admin?${query.toString()}`, {
      headers: { Authorization: `Bearer ${token}` }, cache: 'no-store'
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) throw new Error(data.error || 'Lecture impossible.');
    return data;
  };

  useEffect(() => {
    let active = true;
    if (screen === 'billing' || screen === 'overview') {
      setPageLoading(true); setPageError('');
      void read('billing_list').then(data => { if (active) setInvoices(data.invoices || []); })
        .catch(e => { if (active) setPageError(e.message); })
        .finally(() => { if (active) setPageLoading(false); });
    }
    if (screen === 'audit') {
      setPageLoading(true); setPageError('');
      void read('audit_list').then(data => { if (active) setAudit(data.logs || []); })
        .catch(e => { if (active) setPageError(e.message); })
        .finally(() => { if (active) setPageLoading(false); });
    }
    if (screen === 'overview') {
      void read('audit_list').then(data => { if (active) setAudit(data.logs || []); }).catch(() => undefined);
    }
    const load = async (action: string, apply: (data: any) => void) => {
      setPageLoading(true); setPageError('');
      try { const data = await read(action); if (active) apply(data); }
      catch (e: any) { if (active) setPageError(e.message || 'Chargement impossible.'); }
      finally { if (active) setPageLoading(false); }
    };
    if (screen === 'accounts') void load('platform_admin_list', data => setPlatformAdmins(data.admins || []));
    if (screen === 'support') void load('support_list', data => setSupportTickets(data.tickets || []));
    if (screen === 'health') void load('health_details', data => setHealth({ checkedAt: data.checkedAt, services: data.services || [] }));
    if (screen === 'settings') void load('config_read', data => { if (data.config) setPlatformConfig(current => ({ ...current, ...data.config })); });
    if (screen === 'communication') void load('announcement_list', data => setAnnouncements(data.announcements || []));
    return () => { active = false; };
  }, [screen]);

  const filteredRestaurants = useMemo(() => restaurants.filter(r => {
    const term = search.trim().toLowerCase();
    const matchesText = !term || r.name.toLowerCase().includes(term) || r.slug.toLowerCase().includes(term);
    const matchesStatus = statusFilter === 'all' || (r.status || 'unknown') === statusFilter;
    return matchesText && matchesStatus;
  }), [restaurants, search, statusFilter]);

  const openAccounts = async (restaurant: Restaurant) => {
    setAccountRestaurant(restaurant.slug); setAccounts([]); setPageLoading(true); setPageError('');
    try {
      const data = await read('staff_list', { slug: restaurant.slug });
      setAccounts(data.staff || []);
    } catch (e: any) { setPageError(e.message || 'Chargement des comptes impossible.'); }
    finally { setPageLoading(false); }
  };

  const createRestaurant = async (event: React.FormEvent) => {
    event.preventDefault(); setPageLoading(true); setPageError(''); setNotice('');
    try {
      const result = await request({ action: 'create_restaurant', ...createForm });
      const ownerEmail = String(result.owner?.email || createForm.ownerEmail).trim();
      const reset = await requestManagerPasswordReset(ownerEmail);
      setNotice(reset.success ? `Restaurant créé. Le propriétaire recevra un e-mail sécurisé à ${ownerEmail}.` : `Restaurant créé. L’envoi du lien sécurisé a échoué pour ${ownerEmail}; le propriétaire devra utiliser « Mot de passe oublié ». `);
      setCreateForm({ name: '', ownerName: '', ownerEmail: '' }); setCreateOpen(false); await onRefresh();
    } catch (e: any) { setPageError(e.message || 'Création impossible.'); }
    finally { setPageLoading(false); }
  };

  const saveSubscription = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!subscriptionTarget) return;
    const startsAt = Date.parse(`${subscriptionForm.startsOn}T00:00:00.000Z`);
    const endsAt = Date.parse(`${subscriptionForm.endsOn}T23:59:59.999Z`);
    const priceFcfa = Number(subscriptionForm.priceFcfa);
    if (!Number.isSafeInteger(priceFcfa) || priceFcfa < 0 || !Number.isFinite(startsAt) || !Number.isFinite(endsAt) || endsAt <= startsAt) {
      setPageError('Vérifiez le tarif et les dates de validité.'); return;
    }
    setPageLoading(true); setPageError('');
    try {
      await request({ action: 'update_subscription', slug: subscriptionTarget.slug, subscription: {
        planName: subscriptionForm.planName.trim(), priceFcfa, billingCycle: subscriptionForm.billingCycle,
        status: subscriptionForm.status, startsAt, endsAt, nextBillingAt: endsAt,
        autoRenew: subscriptionForm.billingCycle === 'custom' ? false : subscriptionForm.autoRenew,
        gracePeriodDays: Number(subscriptionForm.gracePeriodDays)
      }});
      setNotice(`Abonnement de ${subscriptionTarget.name} mis à jour.`); setSubscriptionTarget(null); await onRefresh();
    } catch (e: any) { setPageError(e.message || 'Mise à jour impossible.'); }
    finally { setPageLoading(false); }
  };

  const startSubscriptionEdit = (restaurant: Restaurant) => {
    const sub = restaurant.subscription || {};
    setSubscriptionTarget(restaurant);
    setSubscriptionForm({
      planName: sub.planName || '', priceFcfa: String(sub.priceFcfa ?? 0),
      billingCycle: sub.billingCycle || 'monthly', status: sub.status || 'trial',
      startsOn: sub.startsAt ? new Date(sub.startsAt).toISOString().slice(0, 10) : '',
      endsOn: sub.endsAt ? new Date(sub.endsAt).toISOString().slice(0, 10) : '',
      gracePeriodDays: String(sub.gracePeriodDays ?? 7), autoRenew: sub.autoRenew !== false
    });
  };

  const setRestaurantStatus = async (restaurant: Restaurant) => {
    const next = restaurant.status === 'suspended' ? 'active' : 'suspended';
    if (!window.confirm(`${next === 'active' ? 'Réactiver' : 'Suspendre'} ${restaurant.name} ?`)) return;
    setPageLoading(true); setPageError('');
    try { await request({ action: 'set_restaurant_status', slug: restaurant.slug, status: next }); await onRefresh(); setSelected({...restaurant,status:next}); setNotice(`${restaurant.name} : ${statusLabel(next)}.`); }
    catch (e: any) { setPageError(e.message || 'Action impossible.'); }
    finally { setPageLoading(false); }
  };

  const archiveRestaurant = async (restaurant: Restaurant) => {
    const confirmation = window.prompt(`Suppression logique de ${restaurant.name}. Les historiques métier seront conservés. Saisissez exactement : ${restaurant.slug}`);
    if (confirmation !== restaurant.slug) return;
    setPageLoading(true); setPageError('');
    try { await request({ action: 'delete_restaurant', slug: restaurant.slug, confirmation }); setSelected(null); await onRefresh(); setNotice('Restaurant archivé logiquement. Historique conservé.'); }
    catch (e: any) { setPageError(e.message || 'Archivage impossible.'); }
    finally { setPageLoading(false); }
  };

  const settleInvoice = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedInvoice) return;
    setPageLoading(true); setPageError('');
    try {
      await request({ action: 'settle_subscription_invoice', slug: selectedInvoice.restaurantSlug, invoiceId: selectedInvoice.id, amountFcfa: selectedInvoice.amountFcfa, paymentReference: paymentReference.trim() });
      setNotice('Paiement de facture confirmé et journalisé.'); setSelectedInvoice(null); setPaymentReference('');
      const data = await read('billing_list'); setInvoices(data.invoices || []); await onRefresh();
    } catch (e: any) { setPageError(e.message || 'Règlement impossible.'); }
    finally { setPageLoading(false); }
  };

  const title = NAV.find(item => item.id === screen)?.label || 'Vue d’ensemble';
  const unpaidInvoices = invoices.filter(i => i.status === 'open' || i.status === 'overdue');
  const filteredAudit = audit.filter(entry => {
    const actor = auditFilters.actor.trim().toLowerCase();
    const action = auditFilters.action.trim().toLowerCase();
    const restaurant = auditFilters.restaurant.trim().toLowerCase();
    const timestamp = entry.createdAt || 0;
    const from = auditFilters.from ? Date.parse(auditFilters.from + 'T00:00:00') : 0;
    const to = auditFilters.to ? Date.parse(auditFilters.to + 'T23:59:59') : Number.MAX_SAFE_INTEGER;
    return (!actor || entry.actorUid.toLowerCase().includes(actor)) &&
      (!action || entry.action.toLowerCase().includes(action)) &&
      (!restaurant || entry.restaurantSlug.toLowerCase().includes(restaurant)) &&
      timestamp >= from && timestamp <= to;
  });
  const unpaidTotal = unpaidInvoices.reduce((sum, invoice) => sum + invoice.amountFcfa, 0);
  const mockupOnly = false;

  const refreshCurrentScreen = async () => {
    setPageError(''); setNotice('');
    await onRefresh();
    if (screen === 'billing' || screen === 'overview') { try { const data = await read('billing_list'); setInvoices(data.invoices || []); } catch (e: any) { setPageError(e.message); } }
    if (screen === 'audit' || screen === 'overview') { try { const data = await read('audit_list'); setAudit(data.logs || []); } catch (e: any) { setPageError(e.message); } }
    if (screen === 'accounts') { try { const data = await read('platform_admin_list'); setPlatformAdmins(data.admins || []); } catch (e: any) { setPageError(e.message); } }
    if (screen === 'support') { try { const data = await read('support_list'); setSupportTickets(data.tickets || []); } catch (e: any) { setPageError(e.message); } }
    if (screen === 'health') { try { const data = await read('health_details'); setHealth({ checkedAt: data.checkedAt, services: data.services || [] }); } catch (e: any) { setPageError(e.message); } }
    if (screen === 'settings') { try { const data = await read('config_read'); if (data.config) setPlatformConfig(current => ({...current,...data.config})); } catch (e: any) { setPageError(e.message); } }
    if (screen === 'communication') { try { const data = await read('announcement_list'); setAnnouncements(data.announcements || []); } catch (e: any) { setPageError(e.message); } }
  };

  const pageHeader = <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
    <div><p className="text-xs font-semibold text-slate-500">Plateforme <span className="px-1">›</span> {title}</p><h2 className="mt-1 text-2xl font-extrabold tracking-tight text-[#101d2d]">{title}</h2></div>
    <div className="flex flex-wrap items-center gap-2"><span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-600">{mockupOnly ? 'Maquette · valeurs d’exemple' : 'Vue plateforme sécurisée'}</span>
      <button type="button" onClick={() => { void refreshCurrentScreen(); }} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50" disabled={loading || pageLoading}><RefreshCw size={15}/> Actualiser</button>
    </div>
  </div>;

  const tableShell = 'w-full min-w-[720px] text-left text-sm';
  return <div className="min-h-screen bg-[#f4f7fb] text-[#101d2d]" style={{ fontFamily: "Inter, sans-serif" }}>
    <div className="flex min-h-screen">
      <aside className="hidden w-[280px] shrink-0 flex-col bg-[#101d2d] text-white lg:flex">
        <div className="border-b border-white/10 px-5 py-6">
          <div className="flex items-center gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#c2410c] text-lg font-black">RM</div><div><p className="text-lg font-extrabold">RestauMax</p><p className="text-xs text-slate-300">Super-administration</p></div></div>
        </div>
        <nav aria-label="Navigation super-administrateur" className="flex-1 space-y-1 px-3 py-4">
          {NAV.map(item => { const Icon = item.icon; return <button key={item.id} type="button" onClick={() => { setScreen(item.id); setPageError(''); setNotice(''); }} aria-current={screen === item.id ? 'page' : undefined} className={`flex min-h-12 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-semibold transition-colors ${screen === item.id ? 'bg-white/15 text-white' : 'text-slate-300 hover:bg-white/10 hover:text-white'}`}>
            <Icon size={17}/><span className="min-w-0 flex-1">{item.label}</span><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${item.status === 'Existant' ? 'bg-emerald-200 text-emerald-950' : item.status === 'Partiel' ? 'bg-amber-200 text-amber-950' : 'bg-slate-600 text-slate-100'}`}>{item.status}</span>
          </button>; })}
        </nav>
        <div className="border-t border-white/10 p-4 text-[11px] text-slate-300"><p className="mb-2 font-bold text-white">Légende</p><p>Vert · Existant</p><p>Jaune · Partiel</p><p>Gris · À créer</p><p className="mt-4 break-all">{userEmail || 'Compte super-administrateur'}</p></div>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex min-h-16 items-center justify-between gap-3 border-b border-[#dbe3ee] bg-white/95 px-4 backdrop-blur md:px-7">
          <div className="flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#c2410c] text-sm font-black text-white lg:hidden">RM</div><div><p className="text-sm font-extrabold text-[#101d2d]">RestauMax · Administration centrale</p><p className="text-xs text-slate-500">Supervision multi-restaurants</p></div></div>
          <div className="flex items-center gap-2"><button type="button" onClick={onBack} className="min-h-11 rounded-xl border border-slate-300 px-3 text-sm font-semibold text-slate-700">Accueil</button><button type="button" onClick={onSignOut} className="flex min-h-11 items-center gap-2 rounded-xl bg-[#101d2d] px-3 text-sm font-semibold text-white"><LogOut size={15}/> Déconnexion</button></div>
        </header>
        <div className="border-b border-slate-200 bg-white px-3 py-2 lg:hidden"><nav aria-label="Rubriques d’administration" className="flex gap-2 overflow-x-auto">{NAV.map(item => <button key={item.id} type="button" onClick={() => setScreen(item.id)} aria-current={screen === item.id ? 'page' : undefined} className={`min-h-11 shrink-0 rounded-lg px-3 text-xs font-bold ${screen === item.id ? 'bg-[#101d2d] text-white' : 'bg-slate-100 text-slate-700'}`}>{item.label}</button>)}</nav></div>
        <main className="mx-auto max-w-[1600px] p-4 md:p-7">
          {pageHeader}
          {pageError && <div role="alert" className="mb-4 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900"><AlertTriangle size={17}/>{pageError}</div>}
          {notice && <div role="status" className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{notice}</div>}
          {screen === 'overview' && <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {[
                ['Restaurants actifs', summary?.activeRestaurants ?? 0, 'bg-emerald-50'],
                ['En essai', summary?.subscriptionsByStatus?.trial ?? 0, 'bg-sky-50'],
                ['Suspendus', summary?.suspendedRestaurants ?? 0, 'bg-rose-50'],
                ['Factures impayées', unpaidInvoices.length, 'bg-amber-50']
              ].map(([label, value, color]) => <Panel key={String(label)} className={String(color)}><p className="text-sm font-semibold text-slate-600">{label}</p><p className="mt-2 text-3xl font-extrabold tabular-nums">{value}</p></Panel>)}
            </div>
            <div className="mt-5 grid gap-5 xl:grid-cols-[1.6fr_1fr]">
              <Panel><div className="mb-4 flex items-center justify-between gap-3"><h3 className="font-extrabold">Restaurants récents</h3><button type="button" onClick={() => setScreen('restaurants')} className="min-h-11 text-sm font-bold text-[#9a3412]">Voir tous <ChevronRight className="inline" size={15}/></button></div>
                <div className="overflow-x-auto"><table className={tableShell}><thead className="bg-slate-50 text-xs text-slate-600"><tr><th className="px-3 py-3">Restaurant</th><th className="px-3 py-3">Plan</th><th className="px-3 py-3">Statut</th><th className="px-3 py-3">Échéance</th></tr></thead><tbody className="divide-y divide-slate-100">{restaurants.slice(0,5).map(r=><tr key={r.slug}><td className="px-3 py-3 font-semibold">{r.name}</td><td className="px-3 py-3">{r.subscription?.planName || 'Non configuré'}</td><td className="px-3 py-3"><Badge value={r.status}/></td><td className="px-3 py-3">{date(r.subscription?.nextBillingAt || r.subscription?.endsAt)}</td></tr>)}</tbody></table></div>
              </Panel>
              <Panel><h3 className="mb-3 font-extrabold">À traiter</h3><ul className="space-y-3 text-sm"><li className="flex items-start justify-between gap-3"><span>Factures en attente de régularisation</span><button type="button" onClick={() => setScreen('billing')} className="min-h-11 font-bold text-[#9a3412]">Ouvrir</button></li><li className="flex items-start justify-between gap-3"><span>Comptes propriétaires à vérifier</span><button type="button" onClick={() => setScreen('accounts')} className="font-bold text-[#9a3412]">Ouvrir</button></li><li className="flex items-start justify-between gap-3"><span>État technique des services</span><button type="button" onClick={() => setScreen('health')} className="font-bold text-[#9a3412]">Ouvrir</button></li></ul><p className="mt-5 border-t border-slate-100 pt-3 text-xs text-slate-500">Les indicateurs agrègent les données de plateforme. Aucun détail de commande ou de caisse restaurant n’est accessible ici.</p></Panel><Panel className="xl:col-span-2"><div className="mb-3 flex items-center justify-between"><h3 className="font-extrabold">Activité récente</h3><button type="button" onClick={() => setScreen('audit')} className="min-h-11 font-bold text-[#9a3412]">Journal complet</button></div>{audit.slice(0,3).length ? <ul className="divide-y divide-slate-100">{audit.slice(0,3).map(entry=><li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"><span className="font-semibold">{entry.action.replaceAll('_',' ')}</span><span className="text-xs text-slate-500">{entry.restaurantSlug || 'Plateforme'} · {entry.createdAt ? new Date(entry.createdAt).toLocaleString('fr-FR') : '—'}</span></li>)}</ul> : <p className="py-4 text-sm text-slate-500">Aucun événement récent retourné.</p>}</Panel>
            </div>
          </>}

          {screen === 'restaurants' && <>
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3"><div className="flex flex-wrap gap-2"><Field label="Rechercher"><span className="relative"><Search className="absolute left-3 top-3 text-slate-400" size={16}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Nom ou identifiant" className={`${inputClass} pl-9`}/></span></Field><Field label="Statut"><select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)} className={inputClass}><option value="all">Tous</option><option value="active">Actif</option><option value="suspended">Suspendu</option><option value="deleted">Archivé</option></select></Field></div><button type="button" onClick={() => setCreateOpen(v=>!v)} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#c2410c] px-4 text-sm font-bold text-white"><Plus size={16}/> Créer un restaurant</button></div>
            {createOpen && <Panel className="mb-4"><div className="mb-4 flex items-center justify-between"><h3 className="font-extrabold">Créer un restaurant</h3><button type="button" aria-label="Fermer" onClick={() => setCreateOpen(false)} className="min-h-11 min-w-11 rounded-lg hover:bg-slate-100"><X size={17}/></button></div><form onSubmit={createRestaurant} className="grid gap-3 md:grid-cols-3"><Field label="Nom du restaurant"><input required maxLength={100} value={createForm.name} onChange={e=>setCreateForm({...createForm,name:e.target.value})} className={inputClass}/></Field><Field label="Nom du propriétaire"><input required maxLength={100} value={createForm.ownerName} onChange={e=>setCreateForm({...createForm,ownerName:e.target.value})} className={inputClass}/></Field><Field label="E-mail du propriétaire"><input required type="email" value={createForm.ownerEmail} onChange={e=>setCreateForm({...createForm,ownerEmail:e.target.value})} className={inputClass}/></Field><div className="md:col-span-3 flex flex-wrap gap-2"><button disabled={pageLoading} className="min-h-11 rounded-xl bg-[#101d2d] px-5 text-sm font-bold text-white">{pageLoading?'Création…':'Créer et inviter'}</button><p className="self-center text-xs text-slate-500">Le propriétaire définit son mot de passe via un e-mail sécurisé.</p></div></form></Panel>}
            <div className="grid gap-5 xl:grid-cols-[1.5fr_1fr]"><Panel><div className="mb-3 font-extrabold">Établissements ({filteredRestaurants.length})</div><div className="overflow-x-auto"><table className={tableShell}><thead className="bg-slate-50 text-xs text-slate-600"><tr><th className="px-3 py-3">Restaurant</th><th className="px-3 py-3">Plan</th><th className="px-3 py-3">Statut</th><th className="px-3 py-3">Échéance</th></tr></thead><tbody className="divide-y divide-slate-100">{filteredRestaurants.map(r=><tr key={r.slug} className={`hover:bg-slate-50 ${selected?.slug===r.slug?'bg-orange-50':''}`}><td className="px-3 py-3 font-semibold"><button type="button" onClick={()=>setSelected(r)} className="min-h-11 text-left underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#c2410c]">{r.name}<span className="block text-xs font-normal text-slate-500">{r.slug}</span></button></td><td className="px-3 py-3">{r.subscription?.planName || '—'}</td><td className="px-3 py-3"><Badge value={r.status}/></td><td className="px-3 py-3">{date(r.subscription?.nextBillingAt || r.subscription?.endsAt)}</td></tr>)}</tbody></table></div></Panel>
              <Panel>{selected ? <><div className="mb-3 flex items-start justify-between"><div><h3 className="font-extrabold">{selected.name}</h3><p className="text-xs text-slate-500">{selected.slug}</p></div><Badge value={selected.status}/></div><dl className="grid grid-cols-2 gap-3 text-sm"><div><dt className="text-slate-500">Plan</dt><dd className="font-bold">{selected.subscription?.planName || 'Non configuré'}</dd></div><div><dt className="text-slate-500">Tarif</dt><dd className="font-bold">{money(selected.subscription?.priceFcfa || 0)}</dd></div><div><dt className="text-slate-500">Échéance</dt><dd className="font-bold">{date(selected.subscription?.endsAt)}</dd></div><div><dt className="text-slate-500">Ouverture</dt><dd className="font-bold">{selected.isOpen?'Ouvert':'Fermé'}</dd></div></dl><div className="mt-5 flex flex-wrap gap-2"><button type="button" onClick={()=>startSubscriptionEdit(selected)} className="min-h-11 rounded-lg border border-slate-300 px-3 text-xs font-bold">Abonnement</button><button type="button" disabled={pageLoading || selected.status==='deleted'} onClick={()=>void setRestaurantStatus(selected)} className="min-h-11 rounded-lg border border-slate-300 px-3 text-xs font-bold">{selected.status==='suspended'?'Réactiver':'Suspendre'}</button><button type="button" onClick={()=>void openAccounts(selected)} className="min-h-11 rounded-lg border border-slate-300 px-3 text-xs font-bold">Comptes liés</button><button type="button" disabled={pageLoading || selected.status==='deleted'} onClick={()=>void archiveRestaurant(selected)} className="min-h-11 rounded-lg border border-rose-300 px-3 text-xs font-bold text-rose-800">Archiver</button></div><p className="mt-4 text-xs text-slate-500">L’archivage coupe les accès mais conserve l’historique métier. Les données de commandes et de caisse ne sont pas affichées.</p></> : <p className="py-10 text-center text-sm text-slate-500">Sélectionnez un restaurant pour consulter ses informations de plateforme.</p>}</Panel></div>
            {subscriptionTarget && <Panel className="mt-4"><h3 className="mb-4 font-extrabold">Abonnement · {subscriptionTarget.name}</h3><form onSubmit={saveSubscription} className="grid gap-3 md:grid-cols-3"><Field label="Plan"><input required value={subscriptionForm.planName} onChange={e=>setSubscriptionForm({...subscriptionForm,planName:e.target.value})} className={inputClass}/></Field><Field label="Tarif FCFA"><input required type="number" min="0" step="1" value={subscriptionForm.priceFcfa} onChange={e=>setSubscriptionForm({...subscriptionForm,priceFcfa:e.target.value})} className={inputClass}/></Field><Field label="Périodicité"><select value={subscriptionForm.billingCycle} onChange={e=>setSubscriptionForm({...subscriptionForm,billingCycle:e.target.value})} className={inputClass}><option value="monthly">Mensuelle</option><option value="yearly">Annuelle</option><option value="custom">Personnalisée</option></select></Field><Field label="Statut"><select value={subscriptionForm.status} onChange={e=>setSubscriptionForm({...subscriptionForm,status:e.target.value})} className={inputClass}><option value="trial">Essai</option><option value="active">Actif</option><option value="past_due">En retard</option><option value="suspended">Suspendu</option><option value="cancelled">Résilié</option></select></Field><Field label="Début"><input required type="date" value={subscriptionForm.startsOn} onChange={e=>setSubscriptionForm({...subscriptionForm,startsOn:e.target.value})} className={inputClass}/></Field><Field label="Fin"><input required type="date" value={subscriptionForm.endsOn} onChange={e=>setSubscriptionForm({...subscriptionForm,endsOn:e.target.value})} className={inputClass}/></Field><Field label="Délai de grâce (jours)"><input type="number" min="0" max="60" value={subscriptionForm.gracePeriodDays} onChange={e=>setSubscriptionForm({...subscriptionForm,gracePeriodDays:e.target.value})} className={inputClass}/></Field><label className="flex min-h-11 items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={subscriptionForm.autoRenew} disabled={subscriptionForm.billingCycle==='custom'} onChange={e=>setSubscriptionForm({...subscriptionForm,autoRenew:e.target.checked})}/> Renouvellement automatique</label><div className="flex items-end gap-2"><button disabled={pageLoading} className="min-h-11 rounded-lg bg-[#101d2d] px-4 text-sm font-bold text-white">Enregistrer</button><button type="button" onClick={()=>setSubscriptionTarget(null)} className="min-h-11 rounded-lg border px-4 text-sm">Annuler</button></div></form></Panel>}
            {accountRestaurant && <Panel className="mt-4"><div className="mb-3 flex items-center justify-between"><h3 className="font-extrabold">Comptes rattachés · {accountRestaurant}</h3><button type="button" onClick={()=>setAccountRestaurant('')} className="min-h-11 min-w-11 rounded-lg hover:bg-slate-100" aria-label="Fermer"><X size={17}/></button></div>{pageLoading?'Chargement…':accounts.length===0?'Aucun compte lié trouvé.':<div className="overflow-x-auto"><table className={tableShell}><thead><tr><th className="px-3 py-2">Compte</th><th className="px-3 py-2">Rôle</th><th className="px-3 py-2">État</th></tr></thead><tbody>{accounts.map(a=><tr key={a.uid} className="border-t"><td className="px-3 py-2">{a.displayName}<span className="block text-xs text-slate-500">{a.email}</span></td><td className="px-3 py-2">{a.role}</td><td className="px-3 py-2">{a.accountLinked===false?'Non lié':a.activeKnown?(a.active?'Actif':'Inactif'):'À vérifier'}</td></tr>)}</tbody></table></div>}<p className="mt-3 text-xs text-slate-500">Lecture seule. Aucune commande ni donnée financière du restaurant n’est exposée.</p></Panel>}
          </>}

          {screen === 'billing' && <>
            <div className="mb-5 grid gap-4 sm:grid-cols-3"><Panel><p className="text-sm text-slate-500">Montant des factures ouvertes</p><p className="mt-2 text-2xl font-extrabold">{money(unpaidTotal)}</p></Panel><Panel><p className="text-sm text-slate-500">Factures à régulariser</p><p className="mt-2 text-2xl font-extrabold">{unpaidInvoices.length}</p></Panel><Panel><p className="text-sm text-slate-500">Délai de grâce standard</p><p className="mt-2 text-2xl font-extrabold">7 jours</p></Panel></div>
            <Panel><div className="mb-3 flex items-center justify-between"><h3 className="font-extrabold">Factures d’abonnement</h3><span className="text-xs text-slate-500">100 dernières au maximum</span></div><div className="overflow-x-auto"><table className={tableShell}><thead className="bg-slate-50 text-xs text-slate-600"><tr><th className="px-3 py-3">Facture</th><th className="px-3 py-3">Restaurant</th><th className="px-3 py-3">Plan</th><th className="px-3 py-3">Montant</th><th className="px-3 py-3">Émise</th><th className="px-3 py-3">Statut</th><th className="px-3 py-3">Action</th></tr></thead><tbody className="divide-y divide-slate-100">{invoices.map(i=><tr key={i.id}><td className="px-3 py-3 font-semibold">{i.id.slice(0,14)}</td><td className="px-3 py-3">{restaurants.find(r=>r.slug===i.restaurantSlug)?.name || i.restaurantSlug}</td><td className="px-3 py-3">{i.planName}</td><td className="px-3 py-3 font-bold">{money(i.amountFcfa)}</td><td className="px-3 py-3">{date(i.issuedAt)}</td><td className="px-3 py-3"><Badge value={i.status}/></td><td className="px-3 py-3">{i.status==='open'?<button type="button" onClick={()=>setSelectedInvoice(i)} className="min-h-11 rounded-lg border border-slate-300 px-3 text-xs font-bold">Enregistrer paiement</button>:<span className="text-xs text-slate-500">—</span>}</td></tr>)}</tbody></table></div>{pageLoading&&<p className="mt-3 text-sm text-slate-500">Chargement des factures…</p>}{invoices.length===0&&!pageLoading&&<p className="py-8 text-center text-sm text-slate-500">Aucune facture d’abonnement trouvée.</p>}</Panel>
            {selectedInvoice&&<Panel className="mt-4"><h3 className="mb-2 font-extrabold">Confirmer le règlement · {selectedInvoice.id}</h3><p className="mb-3 text-sm text-slate-600">Montant exact attendu : <strong>{money(selectedInvoice.amountFcfa)}</strong>. Confirmez uniquement un paiement effectivement reçu.</p><form onSubmit={settleInvoice} className="flex flex-wrap gap-2"><Field label="Référence du paiement"><input required minLength={4} maxLength={128} value={paymentReference} onChange={e=>setPaymentReference(e.target.value)} className={inputClass}/></Field><button disabled={pageLoading} className="min-h-11 self-end rounded-lg bg-[#101d2d] px-4 text-sm font-bold text-white">Confirmer le paiement</button><button type="button" onClick={()=>setSelectedInvoice(null)} className="min-h-11 self-end rounded-lg border px-4 text-sm">Annuler</button></form></Panel>}
          </>}

          {screen === 'accounts' && <div className="grid gap-5 xl:grid-cols-2"><Panel><h3 className="mb-3 font-extrabold">Comptes propriétaires</h3><p className="mb-4 text-sm text-slate-600">Les identités et liens de comptes sont consultables depuis la fiche d’un restaurant. Les invitations et réinitialisations ne sont pas encore centralisées dans ce module.</p><div className="space-y-2">{restaurants.slice(0,8).map(r=><div key={r.slug} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3"><div><p className="font-semibold">{r.name}</p><p className="text-xs text-slate-500">{r.slug}</p></div><button type="button" onClick={()=>void openAccounts(r)} className="min-h-11 rounded-lg border px-3 text-xs font-bold">Voir le compte</button></div>)}</div></Panel><Panel><h3 className="mb-3 font-extrabold">Super-administrateurs</h3><div className="space-y-3"><div className="rounded-xl border p-3"><p className="font-bold">Administrateur principal</p><p className="text-xs text-slate-500">Rôle : Full · MFA requis selon configuration serveur</p></div><div className="rounded-xl border p-3"><p className="font-bold">Administrateur facturation</p><p className="text-xs text-slate-500">Rôle : Billing · gestion granulaire à implémenter</p></div><div className="rounded-xl border p-3"><p className="font-bold">Administrateur support</p><p className="text-xs text-slate-500">Rôle : Support · gestion granulaire à implémenter</p></div></div><p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-950">La gestion des invitations, rôles délégués et révocation centralisée des sessions reste à construire. L’accès actuel est limité par l’autorisation super-administrateur côté serveur.</p></Panel></div>}{accountRestaurant && <Panel className="mt-5"><div className="mb-3 flex items-center justify-between"><h3 className="font-extrabold">Comptes liés · {accountRestaurant}</h3><button type="button" onClick={()=>setAccountRestaurant('')} aria-label="Fermer les comptes" className="min-h-11 min-w-11 rounded-lg hover:bg-slate-100"><X size={16}/></button></div>{pageLoading?'Chargement des comptes…':accounts.length===0?'Aucun compte rattaché trouvé.':<div className="overflow-x-auto"><table className={tableShell}><thead className="bg-slate-50 text-xs"><tr><th className="px-3 py-3">Identité</th><th className="px-3 py-3">Rôle</th><th className="px-3 py-3">État</th><th className="px-3 py-3">Concordance</th></tr></thead><tbody>{accounts.map(a=><tr key={a.uid} className="border-t"><td className="px-3 py-3">{a.displayName||'Identité non renseignée'}<span className="block text-xs text-slate-500">{a.email||'E-mail non renseigné'}</span></td><td className="px-3 py-3">{a.role}</td><td className="px-3 py-3">{a.accountLinked===false?'Non lié':a.activeKnown?(a.active?'Actif':'Inactif'):'À vérifier'}</td><td className="px-3 py-3">{a.emailConflict?'Conflit e-mail':'Concordance non signalée'}</td></tr>)}</tbody></table></div>}<p className="mt-3 text-xs text-slate-500">Données d’identité limitées et en lecture seule. Les données métier ne sont pas exposées.</p></Panel>}

          {screen === 'support' && <div className="grid gap-5 xl:grid-cols-[1.5fr_1fr]"><Panel><h3 className="mb-4 font-extrabold">Tickets de support · exemple</h3><div className="overflow-x-auto"><table className={tableShell}><thead className="bg-slate-50 text-xs"><tr><th className="px-3 py-3">Ticket</th><th className="px-3 py-3">Restaurant</th><th className="px-3 py-3">Sujet</th><th className="px-3 py-3">Priorité</th><th className="px-3 py-3">Statut</th><th className="px-3 py-3">Date</th></tr></thead><tbody>{demoTickets.map(row=><tr key={row[0]} className="border-t">{row.map((v,i)=><td key={i} className="px-3 py-3">{v}</td>)}</tr>)}</tbody></table></div><p className="mt-3 text-xs text-slate-500">Aucun service de tickets n’est encore connecté. Ces lignes sont des exemples visuels et ne correspondent pas à des demandes réelles.</p></Panel><Panel><h3 className="mb-3 font-extrabold">Diagnostic du restaurant · exemple</h3><p className="mb-3 text-xs text-slate-500">Café Lagune · valeurs de démonstration non connectées</p><ul className="mb-4 space-y-2 text-sm"><li className="flex justify-between"><span>Menu</span><span className="font-bold text-emerald-800">Conforme · exemple</span></li><li className="flex justify-between"><span>Tables</span><span className="font-bold text-emerald-800">Conforme · exemple</span></li><li className="flex justify-between"><span>Personnel</span><span className="font-bold text-amber-900">À vérifier · exemple</span></li><li className="flex justify-between"><span>Paramètres</span><span className="font-bold text-emerald-800">Conforme · exemple</span></li></ul><h3 className="mb-3 border-t border-slate-100 pt-4 font-extrabold">Accès temporaire d’assistance</h3><p className="text-sm text-slate-600">Accès conditionné au consentement du propriétaire, limité à une heure et journalisé. Le mécanisme de consentement serveur n’est pas encore implémenté.</p><button type="button" disabled className="mt-4 min-h-11 rounded-xl bg-slate-200 px-4 text-sm font-bold text-slate-500">Demander un accès · indisponible</button></Panel></div>}

          {screen === 'audit' && <Panel><div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><Field label="Acteur"><input value={auditFilters.actor} onChange={e=>setAuditFilters({...auditFilters,actor:e.target.value})} placeholder="UID acteur" className={inputClass}/></Field><Field label="Action"><input value={auditFilters.action} onChange={e=>setAuditFilters({...auditFilters,action:e.target.value})} placeholder="Type d’action" className={inputClass}/></Field><Field label="Restaurant"><input value={auditFilters.restaurant} onChange={e=>setAuditFilters({...auditFilters,restaurant:e.target.value})} placeholder="Identifiant restaurant" className={inputClass}/></Field><Field label="Du"><input type="date" value={auditFilters.from} onChange={e=>setAuditFilters({...auditFilters,from:e.target.value})} className={inputClass}/></Field><Field label="Au"><input type="date" value={auditFilters.to} min={auditFilters.from || undefined} onChange={e=>setAuditFilters({...auditFilters,to:e.target.value})} className={inputClass}/></Field></div><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h3 className="font-extrabold">Journal d’audit plateforme</h3><button type="button" onClick={()=>{const csv=['date,action,acteur,restaurant,role,montant'];filteredAudit.forEach(a=>csv.push([date(a.createdAt),a.action,a.actorUid,a.restaurantSlug,a.targetRole,a.amountFcfa??''].map(v=>`"${String(v).replaceAll('"','""')}"`).join(',')));const blob=new Blob(['\uFEFF'+csv.join('\n')],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download='restaumax-audit.csv';link.click();URL.revokeObjectURL(url);}} className="min-h-11 rounded-lg border border-slate-300 px-3 text-xs font-bold">Exporter CSV</button></div><div className="overflow-x-auto"><table className={tableShell}><thead className="bg-slate-50 text-xs"><tr><th className="px-3 py-3">Date</th><th className="px-3 py-3">Action</th><th className="px-3 py-3">Acteur (UID)</th><th className="px-3 py-3">Restaurant</th><th className="px-3 py-3">Détails</th></tr></thead><tbody>{filteredAudit.map(a=><tr key={a.id} className="border-t"><td className="px-3 py-3">{a.createdAt?new Date(a.createdAt).toLocaleString('fr-FR'):'—'}</td><td className="px-3 py-3 font-semibold">{a.action}</td><td className="px-3 py-3 font-mono text-xs">{a.actorUid||'—'}</td><td className="px-3 py-3">{a.restaurantSlug||'Plateforme'}</td><td className="px-3 py-3">{a.amountFcfa!==null?money(a.amountFcfa):a.targetRole|| (a.preservedBusinessData?'Historique conservé':'—')}</td></tr>)}</tbody></table></div><p className="mt-3 text-xs text-slate-500">Consultation en lecture seule. Les événements ne peuvent être ni modifiés ni supprimés depuis cette interface. {filteredAudit.length} résultat(s) affiché(s).</p>{pageLoading&&<p className="mt-3 text-sm text-slate-500">Chargement…</p>}{filteredAudit.length===0&&!pageLoading&&<p className="py-8 text-center text-sm text-slate-500">Aucun événement d’audit retourné.</p>}</Panel>}

          {screen === 'health' && <div className="grid gap-5 xl:grid-cols-2"><Panel><h3 className="mb-3 font-extrabold">État des services</h3><div className="space-y-3">{[['Authentification','Non instrumenté'],['Base de données','Non instrumenté'],['Paiements Mobile Money','Mode test · supervision à connecter'],['Facturation planifiée','Exécution planifiée à instrumenter'],['Déploiement','État Vercel à connecter']].map(([label,value])=><div key={label} className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3"><span className="text-sm font-semibold">{label}</span><Badge value="unknown">{value}</Badge></div>)}</div><p className="mt-4 text-xs text-slate-500">Ces statuts ne sont pas déduits de suppositions : les contrôles détaillés nécessitent des sondes dédiées.</p></Panel><Panel><h3 className="mb-3 font-extrabold">Point de santé public</h3>{health?<><Badge value={health.status==='ok'?'active':'suspended'}>{health.status==='ok'?'API disponible':'API indisponible'}</Badge><p className="mt-3 text-sm text-slate-600">Dernière réponse : {health.serverTime?new Date(health.serverTime).toLocaleString('fr-FR'):'—'}</p></>:<p className="text-sm text-slate-500">{pageLoading?'Vérification…':'Aucune mesure disponible.'}</p>}<p className="mt-4 text-xs text-slate-500">Le point public ne révèle aucune information d’infrastructure ou de données restaurant.</p><div className="mt-5 rounded-xl border border-slate-200 p-3"><p className="font-bold">Sauvegarde · exemple</p><p className="mt-1 text-xs text-slate-500">Dernière sauvegarde : hier à 03:00 · statut affiché à titre illustratif</p></div></Panel></div>}

          {screen === 'settings' && <div className="grid gap-5 xl:grid-cols-[1.2fr_1fr]"><Panel><h3 className="mb-4 font-extrabold">Fonctionnalités des plans · aperçu</h3><div className="overflow-x-auto"><table className="w-full min-w-[520px] text-sm"><thead><tr className="border-b text-left"><th className="py-3">Fonctionnalité</th><th className="py-3">Essentiel</th><th className="py-3">Pro</th></tr></thead><tbody>{[['Écran cuisine','Activé','Activé'],['Rapports avancés','Désactivé','Activé'],['Stocks et recettes','Désactivé','Activé'],['Fidélité','Désactivé','Activé']].map(row=><tr key={row[0]} className="border-b"><td className="py-3 font-semibold">{row[0]}</td><td className="py-3">{row[1]}</td><td className="py-3">{row[2]}</td></tr>)}</tbody></table></div><p className="mt-3 text-xs text-slate-500">Aperçu uniquement : le catalogue central des fonctionnalités et sa persistance serveur ne sont pas encore connectés.</p></Panel><Panel><h3 className="mb-4 font-extrabold">Paramètres généraux · aperçu</h3><dl className="space-y-3 text-sm"><div className="flex justify-between border-b pb-2"><dt>Devise</dt><dd className="font-bold">FCFA (XOF)</dd></div><div className="flex justify-between border-b pb-2"><dt>Délai de grâce</dt><dd className="font-bold">7 jours</dd></div><div className="flex justify-between border-b pb-2"><dt>Mode maintenance</dt><dd className="font-bold">Désactivé</dd></div></dl><button type="button" onClick={()=>setConfigPreview(v=>!v)} className="mt-4 min-h-11 rounded-lg border border-slate-300 px-4 text-sm font-bold">{configPreview?'Masquer':'Prévisualiser'} les modèles d’e-mail</button>{configPreview&&<ul className="mt-3 space-y-2 text-sm">{['Invitation propriétaire','Réinitialisation du mot de passe','Facture','Rappel d’impayé'].map(x=><li key={x} className="rounded-lg bg-slate-50 p-3">{x} · aperçu non modifiable</li>)}</ul>}</Panel></div>}

          {screen === 'communication' && <div className="grid gap-5 xl:grid-cols-[1.2fr_1fr]"><Panel><h3 className="mb-4 font-extrabold">Nouvelle annonce plateforme</h3><form onSubmit={e=>{e.preventDefault();setAnnouncementPreview(true);}} className="space-y-3"><Field label="Titre"><input required maxLength={100} value={announcement.title} onChange={e=>setAnnouncement({...announcement,title:e.target.value})} className={inputClass}/></Field><Field label="Message"><textarea required rows={5} maxLength={1000} value={announcement.message} onChange={e=>setAnnouncement({...announcement,message:e.target.value})} className={inputClass}/></Field><Field label="Destinataires"><select value={announcement.target} onChange={e=>setAnnouncement({...announcement,target:e.target.value})} className={inputClass}><option value="all">Tous les restaurants</option><option value="plan">Par plan</option><option value="selected">Restaurants sélectionnés</option></select></Field><Field label="Date de diffusion (facultatif)"><input type="datetime-local" value={announcement.schedule} onChange={e=>setAnnouncement({...announcement,schedule:e.target.value})} className={inputClass}/></Field><button className="min-h-11 rounded-xl bg-[#101d2d] px-4 text-sm font-bold text-white">Prévisualiser l’annonce</button></form>{announcementPreview&&<div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4"><p className="font-bold">{announcement.title}</p><p className="mt-2 whitespace-pre-wrap text-sm">{announcement.message}</p><p className="mt-3 text-xs text-amber-950">Prévisualisation locale uniquement. La publication est désactivée tant que le service de communication et ses autorisations ne sont pas implémentés.</p></div>}<button type="button" disabled className="mt-3 min-h-11 rounded-xl bg-slate-200 px-4 text-sm font-bold text-slate-500">Publier · indisponible</button></Panel><Panel><h3 className="mb-4 font-extrabold">Annonces · exemples</h3><div className="space-y-3"><div className="rounded-xl border p-3"><p className="font-bold">Maintenance programmée dimanche à 02 h</p><p className="mt-1 text-xs text-slate-500">Publiée le 10/11 · Exemple</p></div><div className="rounded-xl border p-3"><p className="font-bold">Nouvelle version 1.4</p><p className="mt-1 text-xs text-slate-500">Brouillon · Exemple</p></div></div><p className="mt-4 text-xs text-slate-500">Aucune annonce n’est envoyée depuis cette maquette.</p></Panel></div>}
        </main>
      </div>
    </div>
  </div>;
};
