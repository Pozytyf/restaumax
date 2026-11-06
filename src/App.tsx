import React, { useState, useEffect, useMemo } from 'react';
import { 
  Role, 
  MenuItem, 
  CartItem, 
  Table, 
  KitchenTicket, 
  CashDrawerState, 
  PaymentRecord,
  PaymentMethod,
  TicketStatus,
  TableStatus
} from './types/pos';
import { CHEZ_AWA_RESTAURANT } from './data/restaumaxData';
import { RestauMenuItem, ClientCartItem, RestaurantInfo, RestauOrder, RestaurantTable, RestauOrderStatus } from './types/restaumax';
import { 
  subscribeToRestaurant, 
  subscribeToMenuItems, 
  persistMenuItem, 
  persistDishAvailability,
  deleteMenuItem, 
  submitOrderWithServerValidation,
  submitPosOrderWithServerValidation,
  collectCashPaymentWithServerValidation,
  createPayDunyaPaymentWithServerValidation,
  createCustomerPayDunyaPaymentWithServerValidation,
  reconcileCustomerPayDunyaPaymentWithServerValidation,
  refundPayDunyaPaymentWithServerValidation,
  refundCashPaymentWithServerValidation,
  reconcilePayDunyaPaymentWithServerValidation,
  listRecentCashPaymentsWithServerValidation,
  getCashSessionWithServerValidation,
  openCashSessionWithServerValidation,
  closeCashSessionWithServerValidation,
  recordCashMovementWithServerValidation,
  type CashSessionApiRecord,
  subscribeToOrders,
  updateOrderStatus,
  updateKitchenItemCompletionWithServerValidation,
  subscribeToTables,
  persistTable,
  deleteTable,
  testConnection,
  signInManager,
  signOutManager,
  subscribeToAuth,
  type User
} from './lib/firebase';
import { validateAndBuildOrder, generateClientOrderIdempotencyKey } from './utils/pricing';
import { 
  savePendingOrderIntent, 
  loadPendingOrderIntent, 
  clearPendingOrderIntent, 
  updatePendingOrderIntentUncertainty 
} from './utils/orderIntentStorage';
import { formatFCFA } from './utils/format';
import { toClientCartItem } from './utils/posCart';
import { mapRestauOrderToKitchenTicket } from './utils/kitchenTicket';
import { sounds } from './utils/audio';
import { Header } from './components/Header';
import { PosView } from './components/pos/PosView';
import { PaymentModal } from './components/pos/PaymentModal';
import { ReceiptModal } from './components/pos/ReceiptModal';
import { FloorView } from './components/floor/FloorView';
import { KdsView } from './components/kds/KdsView';
import { ManagerView } from './components/manager/ManagerView';

// RestauMax Step 1 Components
import { HomePage } from './components/restaumax/HomePage';
import { ClientMenuView, areCartConfigurationsEqual } from './components/restaumax/ClientMenuView';
import { RestaurantHubView } from './components/restaumax/RestaurantHubView';
import { ManagerLoginView } from './components/restaumax/ManagerLoginView';
import { QrScannerModal } from './components/restaumax/QrScannerModal';
import { PlatformAdminView } from './components/restaumax/PlatformAdminView';

export default function App() {
  // Navigation / Routing State
  const [currentPath, setCurrentPath] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const fullPath = window.location.pathname + window.location.search;
      return fullPath || '/';
    }
    return '/';
  });

  const [isQrScannerOpen, setIsQrScannerOpen] = useState(false);

  // The table identity is never read from a query string: it comes only from the server session.
  const parsePathInfo = (pathStr: string) => {
    try { return { path: new URL(pathStr, 'http://localhost').pathname || '/' }; }
    catch { return { path: '/' }; }
  };

  const { path: activePathname } = parsePathInfo(currentPath);
  const [tableSession, setTableSession] = useState<{ restaurantSlug: string; tableId: string; tableNumber: string; csrfToken: string; expiresAt: number } | null>(null);
  const [tableSessionExpected, setTableSessionExpected] = useState(() => typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('table_session') === '1');
  const [tableSessionChecking, setTableSessionChecking] = useState(false);
  const activeTableNumber = tableSession?.tableNumber || null;
  const [authRestaurantSlug, setAuthRestaurantSlug] = useState<string>('');
  const [authIsSuperAdmin, setAuthIsSuperAdmin] = useState<boolean>(false);
  const routeRestaurantSlug = activePathname.startsWith('/r/') ? activePathname.split('/')[2] : '';
  const queryRestaurantSlug = (() => { try { return new URL(currentPath, 'http://localhost').searchParams.get('restaurant') || new URL(currentPath, 'http://localhost').searchParams.get('restaurantSlug') || ''; } catch { return ''; } })();
  const activeRestaurantSlug = routeRestaurantSlug || (authIsSuperAdmin ? queryRestaurantSlug : authRestaurantSlug || queryRestaurantSlug) || 'chez-awa';

  const isClientMenuRoute = activePathname.startsWith('/r/');
  const isStaffRoute = activePathname === '/staff';
  const isPlatformAdminRoute = activePathname === '/admin';
  const isPaymentReturnRoute = activePathname === '/payments/return';
  const isRestaurantHubRoute = activePathname.startsWith('/gestion');
  const isHomePageRoute = !isClientMenuRoute && !isStaffRoute && !isRestaurantHubRoute && !isPlatformAdminRoute && !isPaymentReturnRoute;
  const paymentReturnOrderId = (() => { try { return new URL(currentPath, 'http://localhost').searchParams.get('orderId') || ''; } catch { return ''; } })();
  const paymentReturnIntentId = (() => { try { return new URL(currentPath, 'http://localhost').searchParams.get('paymentIntentId') || ''; } catch { return ''; } })();

  // Recover the HttpOnly table session after the opaque QR resolver redirects to the menu.
  useEffect(() => {
    if (!isClientMenuRoute) {
      setTableSession(null);
      setTableSessionExpected(false);
      setTableSessionChecking(false);
      return;
    }
    let active = true;
    setTableSessionChecking(true);
    const params = new URLSearchParams(window.location.search);
    setTableSessionExpected(params.get('table_session') === '1');
    fetch('/api/table-session', { credentials: 'same-origin', cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) return null;
        const data = await response.json();
        if (!data?.success || data.restaurantSlug !== activeRestaurantSlug || !data.csrfToken) return null;
        return data;
      })
      .then((data) => {
        if (active) { setTableSession(data); setTableSessionChecking(false); }
      })
      .catch(() => { if (active) { setTableSession(null); setTableSessionChecking(false); } });
    return () => { active = false; };
  }, [isClientMenuRoute, activeRestaurantSlug, currentPath]);

  // Sync with browser history
  useEffect(() => {
    const handlePopState = () => {
      const full = window.location.pathname + window.location.search;
      setCurrentPath(full);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigateTo = (newPath: string) => {
    setCurrentPath(newPath);
    if (typeof window !== 'undefined' && window.history?.pushState) {
      window.history.pushState({}, '', newPath);
    }
  };

  // Staff State (POS, Tables, KDS, Manager)
  const [currentRole, setCurrentRole] = useState<Role>('pos');
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [tables, setTables] = useState<Table[]>([]);
  const [selectedTable, setSelectedTable] = useState<Table | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [discountPercent, setDiscountPercent] = useState<number>(0);
  const [kitchenTickets, setKitchenTickets] = useState<KitchenTicket[]>([]);
  const [restauOrders, setRestauOrders] = useState<RestauOrder[]>([]);
  const [drawerState, setDrawerState] = useState<CashDrawerState>({
    openingBalance: 0,
    currentCash: 0,
    totalSales: 0,
    cashSales: 0,
    mobileMoneySales: 0,
    cardSales: 0,
    discountsTotal: 0,
    transactionCount: 0
  });
  const [transactions, setTransactions] = useState<PaymentRecord[]>([]);
  const [cashSession, setCashSession] = useState<CashSessionApiRecord | null>(null);
  const [cashSessionLoading, setCashSessionLoading] = useState(false);
  const [cashSessionActionLoading, setCashSessionActionLoading] = useState(false);
  const [cashMovementActionLoading, setCashMovementActionLoading] = useState(false);
  const [cashSessionOpenIdempotencyKey, setCashSessionOpenIdempotencyKey] = useState(() => generateClientOrderIdempotencyKey());
  const [cashSessionCloseIdempotencyKey, setCashSessionCloseIdempotencyKey] = useState(() => generateClientOrderIdempotencyKey());
  const [cashMovementIdempotencyKey, setCashMovementIdempotencyKey] = useState(() => generateClientOrderIdempotencyKey());

  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [isSubmittingPosOrder, setIsSubmittingPosOrder] = useState(false);
  const [isSubmittingPayment, setIsSubmittingPayment] = useState(false);
  const [pendingPosOrder, setPendingPosOrder] = useState<RestauOrder | null>(null);
  const [pendingPosPaidAmount, setPendingPosPaidAmount] = useState(0);
  const [posOrderIdempotencyKey, setPosOrderIdempotencyKey] = useState(() => generateClientOrderIdempotencyKey());
  const [paymentIdempotencyKey, setPaymentIdempotencyKey] = useState(() => generateClientOrderIdempotencyKey());
  const [activeReceiptModal, setActiveReceiptModal] = useState<PaymentRecord | null>(null);
  const [audioEnabled, setAudioEnabled] = useState(true);

  const handleToggleAudio = () => {
    sounds.enabled = !audioEnabled;
    setAudioEnabled(!audioEnabled);
  };

  // RestauMax Firestore Persisted State (Restaurant Info & Catalog)
  const [restaurant, setRestaurant] = useState<RestaurantInfo>(CHEZ_AWA_RESTAURANT);
  const [restauMenuItems, setRestauMenuItems] = useState<RestauMenuItem[]>([]);
  const [menuCatalogRestaurantSlug, setMenuCatalogRestaurantSlug] = useState('');
  const [menuCatalogLoading, setMenuCatalogLoading] = useState(true);
  const [menuCatalogError, setMenuCatalogError] = useState<string | null>(null);
  const activeMenuItems = useMemo(
    () => menuCatalogRestaurantSlug === activeRestaurantSlug ? restauMenuItems : [],
    [menuCatalogRestaurantSlug, activeRestaurantSlug, restauMenuItems]
  );
  const activeMenuLoading = menuCatalogRestaurantSlug !== activeRestaurantSlug || menuCatalogLoading;
  const activeMenuError = menuCatalogRestaurantSlug === activeRestaurantSlug ? menuCatalogError : null;
  const [restauTables, setRestauTables] = useState<RestaurantTable[]>([]);

  // The staff POS must use the same live catalogue as the customer QR menu.
  // This prevents different prices, names or availability between the two sales channels.
  useEffect(() => {
    setMenuItems(activeMenuItems.map((dish) => ({
      id: dish.id,
      name: dish.name,
      category: dish.category,
      price: dish.price,
      description: dish.description,
      imageUrl: dish.imageUrl,
      available: dish.available === true,
      prepTimeMinutes: dish.prepTimeMinutes,
      course: dish.category === 'entrees'
        ? 'entree'
        : dish.category === 'boissons'
          ? 'boisson'
          : dish.category === 'desserts'
            ? 'dessert'
            : 'plat',
      tags: dish.tags,
      optionGroups: dish.optionGroups,
      availableExtras: dish.availableExtras
    })));
  }, [activeMenuItems]);

  // Use only tables configured in Firestore; do not show invented POS fallback tables.
  useEffect(() => {
    const mappedTables: Table[] = restauTables.map((table) => ({
      id: table.id,
      number: table.tableNumber,
      name: `Table ${table.tableNumber}`,
      zone: table.section === 'vip' ? 'salle' : table.section,
      capacity: table.capacity,
      status: table.status || (table.isActive ? 'available' : 'reserved'),
      currentOrderId: table.currentOrderId,
      currentTotal: table.currentTotal,
      assignedWaiter: table.assignedWaiter,
      seatedAt: typeof table.seatedAt === 'number' ? new Date(table.seatedAt) : undefined,
      covers: table.covers
    }));
    setTables(mappedTables);
    setSelectedTable((previous) =>
      previous ? mappedTables.find((table) => table.id === previous.id) || null : null
    );
  }, [restauTables]);

  // Firestore Realtime Synchronization & Initial Boot Seed
  useEffect(() => {
    let isMounted = true;

    // 1. Connection probe (read-only)
    testConnection().catch((err) => console.warn('Firestore test connection:', err));

    // 2. Subscribe to Restaurant document
    const unsubRestaurant = subscribeToRestaurant(activeRestaurantSlug, (updatedRestaurant) => {
      if (isMounted && updatedRestaurant) {
        setRestaurant(updatedRestaurant);
      }
    });

    // 3. Subscribe to the selected restaurant catalogue. Never show demo or
    // previous-restaurant items while this tenant's first snapshot is loading.
    setRestauMenuItems([]);
    setMenuCatalogRestaurantSlug('');
    setMenuCatalogLoading(true);
    setMenuCatalogError(null);
    const unsubMenuItems = subscribeToMenuItems(
      activeRestaurantSlug,
      (items) => {
        if (!isMounted) return;
        setRestauMenuItems(items);
        setMenuCatalogRestaurantSlug(activeRestaurantSlug);
        setMenuCatalogLoading(false);
        setMenuCatalogError(null);
      },
      (error) => {
        if (!isMounted) return;
        console.error('Erreur de chargement du catalogue Firestore:', error);
        setRestauMenuItems([]);
        setMenuCatalogRestaurantSlug(activeRestaurantSlug);
        setMenuCatalogLoading(false);
        setMenuCatalogError("Impossible de charger la carte de cet établissement. Vérifiez la connexion ou les autorisations.");
      }
    );

    return () => {
      isMounted = false;
      unsubRestaurant();
      unsubMenuItems();
    };
  }, [activeRestaurantSlug]);

  // RestauMax Authentication & Manager Authorization State
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [paydunyaReturnStatus, setPaydunyaReturnStatus] = useState<'idle' | 'checking' | 'completed' | 'pending' | 'cancelled' | 'failed' | 'error'>('idle');
  const [paydunyaReturnError, setPaydunyaReturnError] = useState('');

  const serverName = authUser?.displayName || authUser?.email?.split('@')[0] || 'Personnel';

  const reconcilePayDunyaReturn = async () => {
    if (!paymentReturnIntentId) {
      setPaydunyaReturnStatus('error');
      setPaydunyaReturnError('Référence de paiement absente de l’URL de retour.');
      return;
    }
    setPaydunyaReturnStatus('checking');
    setPaydunyaReturnError('');
    let result:
      | { success: true; status: string }
      | { success: false; error: string };
    try {
      const tableResponse = await fetch('/api/table-session', { credentials: 'same-origin', cache: 'no-store' });
      const tableData = tableResponse.ok ? await tableResponse.json() : null;
      if (tableData?.success && tableData.restaurantSlug === activeRestaurantSlug && tableData.csrfToken) {
        result = await reconcileCustomerPayDunyaPaymentWithServerValidation(
          activeRestaurantSlug, paymentReturnIntentId, tableData.csrfToken
        );
      } else if (authUser) {
        result = await reconcilePayDunyaPaymentWithServerValidation(activeRestaurantSlug, paymentReturnIntentId);
      } else {
        result = { success: false, error: 'Session QR expirée. Le paiement sera tout de même rapproché par la notification PayDunya ; reconnectez-vous ou rescanez le QR pour consulter son statut.' };
      }
    } catch {
      result = { success: false, error: 'Impossible de récupérer la session de paiement. Le callback PayDunya reste la source de confirmation.' };
    }
    if (!result.success) {
      setPaydunyaReturnStatus('error');
      setPaydunyaReturnError(result.error);
      return;
    }
    if (result.status === 'completed') setPaydunyaReturnStatus('completed');
    else if (result.status === 'cancelled') setPaydunyaReturnStatus('cancelled');
    else if (result.status === 'failed') setPaydunyaReturnStatus('failed');
    else setPaydunyaReturnStatus('pending');
  };

  useEffect(() => {
    if (isPaymentReturnRoute && paymentReturnIntentId) {
      void reconcilePayDunyaReturn();
    }
  }, [isPaymentReturnRoute, authUser, activeRestaurantSlug, paymentReturnIntentId]);

  const [isAuthorizedManager, setIsAuthorizedManager] = useState<boolean>(false);
  const [isRestaurantOwner, setIsRestaurantOwner] = useState<boolean>(false);
  const [authRestaurantRole, setAuthRestaurantRole] = useState<string>('');
  const [userPermissions, setUserPermissions] = useState<string[]>([]);
  const canManageCash = isRestaurantOwner ||
    (authRestaurantRole === 'manager' && userPermissions.includes('cash.manage')) ||
    (authRestaurantRole === 'cashier' && userPermissions.includes('cash.manage'));
  const canCollectPayment = canManageCash;
  const mapCashPaymentRecord = (payment: any): PaymentRecord => ({
    id: String(payment.id),
    orderId: String(payment.orderNumber || payment.orderId),
    tableNumber: payment.tableNumber ? `Table ${payment.tableNumber}` : 'À emporter',
    waiter: String(payment.actorName || payment.actorRole || 'Personnel'),
    timestamp: new Date(Number(payment.createdAt)),
    subtotal: Number(payment.totalAmount || 0),
    discount: 0,
    tax: 0,
    total: Number(payment.totalAmount || 0),
    paidAmount: Number(payment.paidAmount || 0),
    tenderedAmount: Number(payment.amountTendered || payment.paidAmount || 0),
    previouslyPaidAmount: Number(payment.previouslyPaidAmount || 0),
    changeAmount: Number(payment.changeAmount || 0),
    remainingAmount: Number(payment.remainingAfter || 0),
    paymentStatus: payment.paymentStatus === 'partial' ? 'partial' : 'paid',
    splitGuests: Number(payment.splitGuests || 1),
    guestNumber: Number(payment.guestNumber || 1),
    guestName: String(payment.guestName || ''),
    guestShareAmount: payment.guestShareAmount !== undefined ? Number(payment.guestShareAmount) : undefined,
    guestPreviouslyPaidAmount: payment.guestPreviouslyPaidAmount !== undefined ? Number(payment.guestPreviouslyPaidAmount) : undefined,
    guestRemainingAfter: payment.guestRemainingAfter !== undefined ? Number(payment.guestRemainingAfter) : undefined,
    refundedAmount: Number(payment.refundedAmount || 0),
    refundPendingAmount: Number(payment.refundPendingAmount || 0),
    refundStatus: String(payment.refundStatus || ''),
    refundEligible: payment.refundEligible === true,
    providerChannel: String(payment.providerChannel || ''),
    paymentMethod: payment.method === 'paydunya'
      ? (payment.providerChannel === 'wave-ci' ? 'wave'
        : payment.providerChannel === 'orange-money-ci' ? 'orange_money'
        : payment.providerChannel === 'mtn-ci' ? 'mtn_money'
        : payment.providerChannel === 'moov-ci' ? 'moov_money'
        : payment.providerChannel === 'djamo-ci' ? 'djamo' : 'especes')
      : 'especes',
    items: Array.isArray(payment.items) ? payment.items.map((item: any) => ({
      name: String(item.name || 'Article'),
      quantity: Number(item.quantity || 1),
      price: Number(item.unitPrice ?? item.basePrice ?? item.price ?? 0)
    })) : []
  });

  const [isLoadingAuth, setIsLoadingAuth] = useState<boolean>(true);

  useEffect(() => {
    let active = true;
    if (!authUser) { setIsRestaurantOwner(false); setAuthRestaurantRole(''); setUserPermissions([]); return; }
    authUser.getIdTokenResult(true).then((token) => {
      if (!active) return;
      const owner = token.claims.role === 'owner';
      const superAdmin = token.claims.role === 'super_admin' || token.claims.role === 'admin';
      setIsRestaurantOwner(owner);
      setUserPermissions(owner
        ? ['menu.view','menu.manage','orders.view','orders.manage','orders.serve','tables.view','tables.manage','pos.access','kitchen.access','cash.view','cash.manage','reports.view','customers.view','customers.manage','inventory.view','inventory.manage','staff.view','staff.manage','settings.view','settings.manage']
        : superAdmin ? [] : (Array.isArray(token.claims.permissions) ? token.claims.permissions as string[] : []));
      setAuthRestaurantRole(typeof token.claims.role === 'string' ? token.claims.role : '');
    }).catch(() => { if (active) { setIsRestaurantOwner(false); setAuthRestaurantRole(''); setUserPermissions([]); } });
    return () => { active = false; };
  }, [authUser]);

  // Subscribe to Firebase Auth and evaluate Manager privileges
  useEffect(() => {
    const unsubAuth = subscribeToAuth((user, isManager) => {
      setAuthUser(user);
      setIsAuthorizedManager(isManager);
      setIsLoadingAuth(false);
      if (user) user.getIdTokenResult().then((token) => {
        const owner = token.claims.role === 'owner';
        const superAdmin = token.claims.role === 'super_admin' || token.claims.role === 'admin';
        setAuthRestaurantSlug(typeof token.claims.restaurantSlug === 'string' ? token.claims.restaurantSlug : '');
        setAuthIsSuperAdmin(superAdmin);
        setIsRestaurantOwner(owner);
        setUserPermissions(owner
        ? ['menu.view','menu.manage','orders.view','orders.manage','orders.serve','tables.view','tables.manage','pos.access','kitchen.access','cash.view','cash.manage','reports.view','customers.view','customers.manage','inventory.view','inventory.manage','staff.view','staff.manage','settings.view','settings.manage']
        : superAdmin ? [] : (Array.isArray(token.claims.permissions) ? token.claims.permissions as string[] : []));
      setAuthRestaurantRole(typeof token.claims.role === 'string' ? token.claims.role : '');
      }).catch(() => { setAuthRestaurantSlug(''); setAuthIsSuperAdmin(false); setIsRestaurantOwner(false); setAuthRestaurantRole(''); setUserPermissions([]); });
      else { setAuthRestaurantSlug(''); setAuthIsSuperAdmin(false); setIsRestaurantOwner(false); setAuthRestaurantRole(''); setUserPermissions([]); }
    });

    return () => unsubAuth();
  }, []);

  // Subscribe to tables only for members with the explicit tables.view permission.
  useEffect(() => {
    const canViewTables = !!authUser && (
      isRestaurantOwner || userPermissions.includes('tables.view')
    );
    if (!canViewTables) {
      setRestauTables([]);
      return;
    }

    let isMounted = true;
    const unsubTables = subscribeToTables(activeRestaurantSlug, (tbls) => {
      if (isMounted) {
        setRestauTables(tbls);
      }
    });

    return () => {
      isMounted = false;
      unsubTables();
    };
  }, [authUser, isRestaurantOwner, userPermissions, activeRestaurantSlug]);

  // Subscribe to the active restaurant's orders for KDS and unpaid POS recovery.
  useEffect(() => {
    const canViewOrders = !!authUser && (
      isRestaurantOwner ||
      userPermissions.includes('orders.view') ||
      userPermissions.includes('orders.manage') ||
      userPermissions.includes('kitchen.access')
    );

    if (!canViewOrders) {
      setRestauOrders([]);
      setKitchenTickets((previous) => previous.filter((ticket) => !ticket.id.startsWith('ord-')));
      return;
    }

    let isMounted = true;
    setRestauOrders([]);
    setKitchenTickets((previous) => previous.filter((ticket) => !ticket.id.startsWith('ord-')));

    const unsubOrders = subscribeToOrders(
      activeRestaurantSlug,
      (firestoreOrders) => {
        if (!isMounted) return;
        setRestauOrders(firestoreOrders);
        setKitchenTickets((previous) => {
          const nonFirestoreTickets = previous.filter((ticket) => !ticket.id.startsWith('ord-'));
          const mappedTickets = firestoreOrders.map((order) => mapRestauOrderToKitchenTicket(order));
          return [...mappedTickets, ...nonFirestoreTickets];
        });
      },
      (err) => {
        console.warn('Flux des commandes Firestore en attente ou restreint:', err);
      }
    );

    return () => {
      isMounted = false;
      unsubOrders();
    };
  }, [authUser, activeRestaurantSlug, isRestaurantOwner, userPermissions]);


  useEffect(() => {
    const canViewCash = isRestaurantOwner || authRestaurantRole === 'manager' ||
      userPermissions.includes('cash.view') || userPermissions.includes('cash.manage');
    if (!authUser || !canViewCash) {
      setTransactions([]);
      setCashSession(null);
      setCashSessionLoading(false);
      setDrawerState({
        openingBalance: 0, currentCash: 0, totalSales: 0, cashSales: 0,
        mobileMoneySales: 0, cardSales: 0, discountsTotal: 0, transactionCount: 0
      });
      return;
    }

    let active = true;
    setCashSessionLoading(true);
    getCashSessionWithServerValidation(activeRestaurantSlug).then((result) => {
      if (!active) return;
      if (result.success) {
        setCashSession(result.session);
        setDrawerState((previous) => ({
          ...previous,
          openingBalance: Number(result.session?.openingBalance || 0),
          currentCash: Number(result.session?.openingBalance || 0) + Number(result.session?.cashCollected || 0) - Number(result.session?.cashOut || 0)
        }));
      } else {
        setCashSession(null);
        console.warn('Session de caisse indisponible:', result.error);
      }
      setCashSessionLoading(false);
    });
    setTransactions([]);
    setDrawerState({
      openingBalance: 0, currentCash: 0, totalSales: 0, cashSales: 0,
      mobileMoneySales: 0, cardSales: 0, discountsTotal: 0, transactionCount: 0
    });
    listRecentCashPaymentsWithServerValidation(activeRestaurantSlug).then((result) => {
      if (!active || !result.success) {
        if (active && !result.success) console.warn('Journal de caisse indisponible:', result.error);
        return;
      }
      const records = result.payments.map(mapCashPaymentRecord);
      const totalSales = records.reduce((sum, record) => sum + record.paidAmount, 0);
      const cashSales = records.filter((record) => record.paymentMethod === 'especes')
        .reduce((sum, record) => sum + record.paidAmount, 0);
      setTransactions(records);
      setDrawerState((previous) => ({
        ...previous,
        totalSales,
        cashSales,
        mobileMoneySales: records.filter((record) => record.paymentMethod !== 'especes' && record.paymentMethod !== 'carte')
          .reduce((sum, record) => sum + record.paidAmount, 0),
        cardSales: 0,
        discountsTotal: 0,
        transactionCount: records.length
      }));
    });

    return () => { active = false; };
  }, [authUser, activeRestaurantSlug, isRestaurantOwner, authRestaurantRole, userPermissions]);

  const handleManagerLogin = async (email: string, pass: string): Promise<{ success: boolean; error?: string }> => {
    const res = await signInManager(email, pass);
    if (res.success && res.user) {
      setAuthUser(res.user);
      setIsAuthorizedManager(true);
      const token = await res.user.getIdTokenResult(true);
      setAuthRestaurantSlug(typeof token.claims.restaurantSlug === 'string' ? token.claims.restaurantSlug : '');
      setAuthIsSuperAdmin(token.claims.role === 'super_admin' || token.claims.role === 'admin');
      setIsRestaurantOwner(token.claims.role === 'owner');
      setUserPermissions(token.claims.role === 'owner'
        ? ['menu.view','menu.manage','orders.view','orders.manage','orders.serve','orders.cancel','tables.view','tables.manage','pos.access','kitchen.access','cash.view','cash.manage','payments.refund','reports.view','customers.view','customers.manage','inventory.view','inventory.manage','staff.view','staff.manage','settings.view','settings.manage']
        : token.claims.role === 'super_admin' || token.claims.role === 'admin'
          ? []
          : (Array.isArray(token.claims.permissions) ? token.claims.permissions as string[] : []));
      setAuthRestaurantRole(typeof token.claims.role === 'string' ? token.claims.role : '');
      return { success: true };
    }
    return { success: false, error: res.error };
  };

  const handleManagerSignOut = async () => {
    await signOutManager();
    setAuthUser(null);
    setIsAuthorizedManager(false);
    setIsRestaurantOwner(false);
    setAuthIsSuperAdmin(false);
    setAuthRestaurantSlug('');
    setAuthRestaurantRole('');
    setUserPermissions([]);
  };

  // RestauMax Client Cart & Idempotency Key State (Preserved across routing and page reloads via sessionStorage)
  const [clientCart, setClientCart] = useState<ClientCartItem[]>(() => {
    const saved = loadPendingOrderIntent();
    return saved?.cart && saved.cart.length > 0 ? saved.cart : [];
  });
  const [clientOrderIdempotencyKey, setClientOrderIdempotencyKey] = useState<string>(() => {
    const saved = loadPendingOrderIntent();
    return saved?.idempotencyKey ? saved.idempotencyKey : generateClientOrderIdempotencyKey();
  });
  const [isOrderUncertain, setIsOrderUncertain] = useState<boolean>(() => {
    const saved = loadPendingOrderIntent();
    return Boolean(saved?.isUncertain);
  });

  // Synchronisation automatique de l'intention de commande avec sessionStorage
  useEffect(() => {
    if (clientCart.length > 0) {
      savePendingOrderIntent({
        restaurantSlug: activeRestaurantSlug,
        orderMode: activeTableNumber ? 'sur_place' : 'a_emporter',
        tableNumber: activeTableNumber,
        cart: clientCart,
        idempotencyKey: clientOrderIdempotencyKey,
        timestamp: Date.now(),
        isUncertain: isOrderUncertain
      });
    } else if (!isOrderUncertain) {
      clearPendingOrderIntent();
    }
  }, [clientCart, clientOrderIdempotencyKey, isOrderUncertain, activeTableNumber]);

  const handleToggleDishAvailability = async (dishId: string) => {
    const currentDish = activeMenuItems.find((item) => item.id === dishId);
    if (!currentDish) return;
    const nextAvailable = currentDish.available === false;
    try {
      await persistDishAvailability(activeRestaurantSlug, dishId, nextAvailable);
      setRestauMenuItems((prev) => prev.map((item) =>
        item.id === dishId ? { ...item, available: nextAvailable } : item
      ));
    } catch (err) {
      console.error('Erreur de persistance de la disponibilité dans Firestore:', err);
      window.alert("La disponibilité n'a pas été modifiée. Vérifiez votre connexion et vos droits, puis réessayez.");
    }
  };

  const handleCreateDish = async (newDish: RestauMenuItem) => {
    try {
      await persistMenuItem(activeRestaurantSlug, newDish);
      setRestauMenuItems((prev) => [newDish, ...prev]);
    } catch (err) {
      console.error('Erreur de persistance du nouveau plat dans Firestore:', err);
      throw new Error("Le plat n'a pas été enregistré. Vérifiez les champs, vos droits et votre connexion, puis réessayez.");
    }
  };

  const handleUpdateDish = async (updatedDish: RestauMenuItem) => {
    try {
      await persistMenuItem(activeRestaurantSlug, updatedDish);
      setRestauMenuItems((prev) => prev.map((item) =>
        item.id === updatedDish.id ? updatedDish : item
      ));
    } catch (err) {
      console.error('Erreur de mise à jour du plat dans Firestore:', err);
      throw new Error("Les modifications du plat n'ont pas été enregistrées. Vérifiez votre connexion et vos droits, puis réessayez.");
    }
  };

  const handleDeleteDish = async (dishId: string) => {
    try {
      await deleteMenuItem(activeRestaurantSlug, dishId);
      setRestauMenuItems((prev) => prev.filter((item) => item.id !== dishId));
    } catch (err) {
      console.error('Erreur de suppression du plat dans Firestore:', err);
      window.alert("La suppression n'a pas été enregistrée. Vérifiez vos droits de gestion et réessayez.");
    }
  };

  const handleClientAddToCart = (newItem: ClientCartItem): boolean => {
    // Si la commande précédente est incertaine, verrouiller toute modification pour éviter les doublons
    if (isOrderUncertain) {
      return false;
    }

    // 1. Double vérification fondée sur la disponibilité actuelle du catalogue partagé
    const liveDish = activeMenuItems.find((item) => item.id === newItem.menuItemId);
    if (!liveDish || liveDish.available === false) {
      // Rejet strict de l'ajout si le plat est indisponible
      return false;
    }

    // 2. Regroupement déterministe ou ajout d'une nouvelle ligne
    setClientCart((prev) => {
      const existingIdx = prev.findIndex((item) => areCartConfigurationsEqual(item, newItem));
      if (existingIdx >= 0) {
        return prev.map((item, idx) =>
          idx === existingIdx
            ? { ...item, quantity: item.quantity + newItem.quantity }
            : item
        );
      }
      return [...prev, newItem];
    });

    return true;
  };

  const handleUpdateClientCartQuantity = (cartItemId: string, delta: number) => {
    // Si la commande précédente est incertaine, verrouiller toute modification
    if (isOrderUncertain) return;

    setClientCart((prev) =>
      prev.map((item) => {
        if (item.id === cartItemId) {
          const nextQty = item.quantity + delta;
          if (nextQty <= 0) return null;
          return { ...item, quantity: nextQty };
        }
        return item;
      }).filter(Boolean) as ClientCartItem[]
    );
  };

  const handleRemoveClientCartItem = (cartItemId: string) => {
    if (isOrderUncertain) return;
    setClientCart((prev) => prev.filter((item) => item.id !== cartItemId));
  };

  const handleClearClientCart = () => {
    if (isOrderUncertain) return;
    clearPendingOrderIntent();
    setClientCart([]);
  };

  const handleResetUncertainty = () => {
    clearPendingOrderIntent();
    setIsOrderUncertain(false);
    setClientCart([]);
    setClientOrderIdempotencyKey(generateClientOrderIdempotencyKey());
  };

  // Client Order Confirmation Handler (Firestore Persisted with trusted FCFA recalculation & atomic idempotency)
  const handleStartClientPayDunya = async (
    order: RestauOrder,
    channel: 'orange-money-ci' | 'wave-ci' | 'mtn-ci' | 'moov-ci' | 'djamo-ci',
    amount: number
  ): Promise<void> => {
    if (!tableSession || tableSession.restaurantSlug !== activeRestaurantSlug) {
      window.alert('Pour payer par Mobile Money, scannez à nouveau le QR code de votre table afin de sécuriser la session.');
      return;
    }
    const result = await createCustomerPayDunyaPaymentWithServerValidation(
      activeRestaurantSlug, order.id, channel, generateClientOrderIdempotencyKey(), tableSession.csrfToken, amount
    );
    if (!result.success) {
      window.alert(`Facture PayDunya non créée : ${result.error}`);
      return;
    }
    window.location.assign(result.checkoutUrl);
  };

  const handleClientOrderConfirm = async (customerNote?: string): Promise<{ success: boolean; error?: string; order?: RestauOrder; isReplay?: boolean }> => {
    if (tableSessionExpected && !tableSession) {
      return { success: false, error: 'La session de cette table est indisponible ou a été révoquée. Scannez à nouveau le QR code physique.' };
    }
    const orderMode = tableSession ? 'sur_place' : 'a_emporter';
    
    // Sauvegarder l'intention client complète dans sessionStorage AVANT la soumission
    savePendingOrderIntent({
      restaurantSlug: activeRestaurantSlug,
      orderMode,
      tableNumber: tableSession?.tableNumber || null,
      cart: clientCart,
      idempotencyKey: clientOrderIdempotencyKey,
      customerNote,
      timestamp: Date.now(),
      isUncertain: false
    });

    const clientDeclaredTotal = clientCart.reduce(
      (sum, item) => sum + (Number(item.unitPrice) || 0) * (Number(item.quantity) || 1),
      0
    );

    const submitRes = await submitOrderWithServerValidation(activeRestaurantSlug, {
      cart: clientCart,
      orderMode,
      tableNumber: tableSession?.tableNumber || null,
      csrfToken: tableSession?.csrfToken,
      customerNote,
      idempotencyKey: clientOrderIdempotencyKey,
      allowedTables: restauTables.length > 0 ? restauTables : undefined,
      declaredTotal: clientDeclaredTotal,
      fallbackCatalog: activeMenuItems
    });

    if (!submitRes.success) {
      if (submitRes.conflict) {
        // Conflit d'intégrité d'idempotence (Cas D) : vider l'intention et régénérer la clé pour une nouvelle intention propre
        clearPendingOrderIntent();
        setClientOrderIdempotencyKey(generateClientOrderIdempotencyKey());
        setIsOrderUncertain(false);
        return { 
          success: false, 
          error: submitRes.error || "Conflit d'intégrité de clé d'idempotence. Veuillez soumettre à nouveau." 
        };
      }

      // Échec serveur / réseau : état incertain, panier verrouillé, conservation stricte de la même clé et du panier dans sessionStorage
      setIsOrderUncertain(true);
      updatePendingOrderIntentUncertainty(true);
      return { success: false, error: submitRes.error };
    }

    const confirmedOrder = submitRes.order;
    // Succès confirmé (écriture Firestore confirmée) : nettoyage strict de l'intention persistée
    clearPendingOrderIntent();
    setIsOrderUncertain(false);

    // Renouvellement de la clé d'idempotence pour la prochaine intention de commande
    setClientOrderIdempotencyKey(generateClientOrderIdempotencyKey());

    // Add to internal staff KDS tickets with deterministic ID matching Firestore order
    const newKitchenTicket: KitchenTicket = {
      id: `ord-${confirmedOrder.id}`,
      ticketNumber: confirmedOrder.orderNumber,
      tableNumber: confirmedOrder.tableNumber ? `Table ${confirmedOrder.tableNumber}` : 'À emporter',
      orderType: confirmedOrder.orderMode === 'sur_place' ? 'sur_place' : 'emporter',
      waiter: 'QR Menu Client',
      createdAt: new Date(),
      status: 'in_prep',
      items: confirmedOrder.items.map((it, idx) => ({
        id: `ki-${confirmedOrder.id}-${idx}`,
        name: it.name,
        quantity: it.quantity,
        course: 'plat',
        notes: [it.selectedOption?.optionName, it.prepNotes].filter(Boolean).join(' · '),
        completed: false
      }))
    };
    setKitchenTickets(prev => {
      if (prev.some(t => t.id === newKitchenTicket.id)) return prev;
      return [newKitchenTicket, ...prev];
    });
    setRestauOrders(previous => [confirmedOrder, ...previous.filter(order => order.id !== confirmedOrder.id)]);

    // Clear client cart strictly only upon confirmed write
    setClientCart([]);

    return { success: true, order: confirmedOrder, isReplay: submitRes.idempotentReplay };
  };

  const handleSaveTable = async (table: RestaurantTable): Promise<void> => {
    // Ne confirmer la création dans l'interface qu'après l'écriture Firestore.
    // En cas de refus (droits, restaurant inactif ou réseau), l'erreur remonte au formulaire.
    await persistTable(activeRestaurantSlug, table);
    setRestauTables(prev => {
      const idx = prev.findIndex(t => t.id === table.id);
      if (idx >= 0) {
        return prev.map(t => t.id === table.id ? table : t);
      }
      return [...prev, table];
    });
  };

  const handleDeleteTable = async (tableId: string) => {
    try {
      await deleteTable(activeRestaurantSlug, tableId);
      setRestauTables(prev => prev.filter(t => t.id !== tableId));
    } catch (err) {
      console.error('Erreur de suppression de la table dans Firestore:', err);
      window.alert("La table n'a pas été supprimée. Vérifiez vos droits et réessayez.");
    }
  };

  // POS Handlers
  const handleSelectPosTable = (table: Table) => {
    if (pendingPosOrder) {
      window.alert('Terminez le règlement de la commande en cours avant de changer de table.');
      return;
    }
    setSelectedTable(table);
  };

  const handleSetDiscountPercent = (value: number) => {
    if (pendingPosOrder) {
      window.alert('La remise ne peut pas être modifiée tant que le solde de la commande reste dû.');
      return;
    }
    if (value > 0) {
      window.alert("Les remises POS seront réactivées après validation des règles de remise côté serveur.");
      return;
    }
    setDiscountPercent(0);
  };

  const handleClearPosCart = () => {
    if (pendingPosOrder) {
      window.alert('Le panier est verrouillé jusqu’au règlement complet de la commande en cours.');
      return;
    }
    setCart([]);
  };

  const handleAddToCart = (configuredItem: ClientCartItem): boolean => {
    if (pendingPosOrder) {
      window.alert('Terminez le règlement de la commande en cours avant de modifier le panier.');
      return false;
    }
    const dish = menuItems.find((item) => item.id === configuredItem.menuItemId);
    if (!dish || dish.available !== true) return false;
    if (!Number.isInteger(configuredItem.quantity) || configuredItem.quantity < 1 || configuredItem.quantity > 50) return false;

    // Rebuild all selected prices and labels from the latest live catalogue.
    // Never trust values returned by the browser's product configurator.
    const requestedGroupIds = configuredItem.selectedOption?.groupId.split('+') || [];
    const requestedOptionIds = configuredItem.selectedOption?.optionId.split('+') || [];
    if (requestedGroupIds.length !== requestedOptionIds.length ||
        new Set(requestedGroupIds).size !== requestedGroupIds.length) return false;

    const resolvedOptions = requestedGroupIds.map((groupId, index) => {
      const group = dish.optionGroups?.find((candidate) => candidate.id === groupId);
      const option = group?.options.find((candidate) => candidate.id === requestedOptionIds[index]);
      return group && option ? {
        groupId: group.id,
        groupName: group.name,
        optionId: option.id,
        optionName: option.name,
        extraPrice: option.extraPrice
      } : null;
    });
    if (resolvedOptions.some((option) => option === null)) return false;
    if ((dish.optionGroups || []).some((group) =>
      group.required && !resolvedOptions.some((option) => option?.groupId === group.id)
    )) return false;

    const verifiedOptions = resolvedOptions.filter((option): option is NonNullable<typeof option> => option !== null);
    const verifiedSelectedOption: ClientCartItem['selectedOption'] = verifiedOptions.length === 0
      ? undefined
      : {
          groupId: verifiedOptions.map((option) => option.groupId).join('+'),
          groupName: verifiedOptions.map((option) => option.groupName).join(' / '),
          optionId: verifiedOptions.map((option) => option.optionId).join('+'),
          optionName: verifiedOptions.map((option) => `${option.groupName}: ${option.optionName}`).join(' · '),
          extraPrice: verifiedOptions.reduce((sum, option) => sum + option.extraPrice, 0)
        };

    const requestedExtras = configuredItem.selectedExtras || [];
    const requestedExtraIds = requestedExtras.map((extra) => extra.extraId);
    if (new Set(requestedExtraIds).size !== requestedExtraIds.length) return false;
    const verifiedExtras = requestedExtraIds.map((extraId) => {
      const extra = dish.availableExtras?.find((candidate) => candidate.id === extraId);
      return extra ? { extraId: extra.id, name: extra.name, price: extra.price } : null;
    });
    if (verifiedExtras.some((extra) => extra === null)) return false;
    const selectedExtras = verifiedExtras.filter((extra): extra is NonNullable<typeof extra> => extra !== null);
    const prepNotes = (configuredItem.prepNotes || '').trim().slice(0, 150);

    const configurationKey = (option?: ClientCartItem['selectedOption'], extras: ClientCartItem['selectedExtras'] = []) => {
      const groupIds = option?.groupId ? option.groupId.split('+') : [];
      const optionIds = option?.optionId ? option.optionId.split('+') : [];
      const optionPairs = groupIds
        .map((groupId, index) => [groupId, optionIds[index] || ''])
        .sort(([left], [right]) => left.localeCompare(right));
      return JSON.stringify({
        options: optionPairs,
        extras: extras.map((extra) => extra.extraId).sort()
      });
    };

    setCart((prev) => {
      const key = configurationKey(verifiedSelectedOption, selectedExtras);
      const existing = prev.find((item) =>
        item.menuItem.id === dish.id &&
        configurationKey(item.selectedOption, item.selectedExtras || []) === key &&
        (item.specialInstructions || '') === prepNotes
      );
      if (existing) {
        return prev.map((item) =>
          item.id === existing.id ? { ...item, quantity: item.quantity + configuredItem.quantity } : item
        );
      }
      return [...prev, {
        id: configuredItem.id,
        menuItem: dish,
        quantity: configuredItem.quantity,
        selectedOption: verifiedSelectedOption,
        selectedExtras,
        specialInstructions: prepNotes,
        course: dish.course
      }];
    });
    return true;
  };

  const handleUpdateQuantity = (itemId: string, delta: number) => {
    if (pendingPosOrder) { window.alert('Terminez le règlement de la commande en cours avant de modifier le panier.'); return; }
    setCart((prev) =>
      prev
        .map((item) => (item.id === itemId ? { ...item, quantity: item.quantity + delta } : item))
        .filter((item) => item.quantity > 0)
    );
  };

  const handleRemoveItem = (itemId: string) => {
    if (pendingPosOrder) { window.alert('Terminez le règlement de la commande en cours avant de modifier le panier.'); return; }
    setCart((prev) => prev.filter((item) => item.id !== itemId));
  };

  const handleUpdateItemNotes = (itemId: string, notes: string) => {
    if (pendingPosOrder) { window.alert('Terminez le règlement de la commande en cours avant de modifier le panier.'); return; }
    setCart((prev) =>
      prev.map((item) => (item.id === itemId ? { ...item, specialInstructions: notes } : item))
    );
  };

  const handleSendToKitchen = async () => {
    if (pendingPosOrder) { window.alert('Une commande avec un solde restant est en cours d’encaissement. Terminez-la avant de créer une autre commande depuis ce panier.'); return; }
    if (cart.length === 0 || isSubmittingPosOrder) return;

    // Never let a client-side discount silently alter a server-calculated order total.
    if (discountPercent > 0) {
      window.alert("Les remises POS ne sont pas encore validées côté serveur. Retirez la remise avant d'envoyer cette commande.");
      return;
    }

    setIsSubmittingPosOrder(true);
    try {
      const clientCart: ClientCartItem[] = cart.map(toClientCartItem);

      const result = await submitPosOrderWithServerValidation(activeRestaurantSlug, {
        cart: clientCart,
        orderMode: selectedTable ? 'sur_place' : 'a_emporter',
        tableNumber: selectedTable?.number || null,
        idempotencyKey: posOrderIdempotencyKey,
        customerNote: `Commande saisie au comptoir par ${serverName}`
      });

      if (!result.success) {
        window.alert(`Commande non envoyée : ${result.error}`);
        return;
      }

      const ticket = mapRestauOrderToKitchenTicket(result.order);
      setKitchenTickets((previous) => [
        ticket,
        ...previous.filter((existing) => existing.id !== ticket.id)
      ]);
      setRestauOrders(previous => [result.order, ...previous.filter(order => order.id !== result.order.id)]);
      setPosOrderIdempotencyKey(generateClientOrderIdempotencyKey());
      setCart([]);
      window.alert(`Commande enregistrée et envoyée en cuisine : ${result.order.orderNumber}`);
    } catch (err) {
      console.error('Erreur envoi commande POS:', err);
      window.alert("Impossible d'envoyer la commande. Le panier a été conservé ; réessayez.");
    } finally {
      setIsSubmittingPosOrder(false);
    }
  };

  const handleOpenCashSession = async (openingBalance: number) => {
    if (!canManageCash || cashSessionActionLoading) return;
    setCashSessionActionLoading(true);
    try {
      const result = await openCashSessionWithServerValidation(
        activeRestaurantSlug, openingBalance, cashSessionOpenIdempotencyKey
      );
      if (result.success === false) {
        window.alert(result.error || "Impossible d'ouvrir la session de caisse.");
        return;
      }
      if (!result.session) {
        window.alert("Le serveur n'a pas retourné la session ouverte.");
        return;
      }
      setCashSession(result.session);
      setCashSessionOpenIdempotencyKey(generateClientOrderIdempotencyKey());
      setDrawerState((previous) => ({
        ...previous, openingBalance,
        currentCash: openingBalance + Number(result.session?.cashCollected || 0)
      }));
      window.alert("Session de caisse ouverte. Les encaissements seront rattachés à cette session.");
    } finally {
      setCashSessionActionLoading(false);
    }
  };

  const handleCloseCashSession = async (closingCount: number) => {
    if (!canManageCash || cashSessionActionLoading) return;
    setCashSessionActionLoading(true);
    try {
      const result = await closeCashSessionWithServerValidation(
        activeRestaurantSlug, closingCount, cashSessionCloseIdempotencyKey
      );
      if (result.success === false) {
        window.alert(result.error || "Impossible de clôturer la session de caisse.");
        return;
      }
      if (!result.session) {
        window.alert("Le serveur n'a pas retourné le rapport de clôture.");
        return;
      }
      setCashSession(null);
      setCashSessionCloseIdempotencyKey(generateClientOrderIdempotencyKey());
      setDrawerState((previous) => ({
        ...previous, openingBalance: 0, currentCash: 0
      }));
      const variance = Number(result.session.variance || 0);
      window.alert(
        `Session clôturée. Fond théorique : ${formatFCFA(Number(result.session.expectedCash || 0))}. Écart : ${variance > 0 ? '+' : ''}${formatFCFA(variance)}.`
      );
    } finally {
      setCashSessionActionLoading(false);
    }
  };

  const handleRecordCashMovement = async (
    movementType: 'expense' | 'withdrawal',
    amount: number,
    category: string,
    note: string
  ) => {
    if (!canManageCash || cashMovementActionLoading || cashSession?.status !== 'active') return;
    setCashMovementActionLoading(true);
    try {
      const result = await recordCashMovementWithServerValidation(
        activeRestaurantSlug, movementType, amount, category, note, cashMovementIdempotencyKey
      );
      if (result.success === false) {
        window.alert(result.error || "Impossible d'enregistrer la sortie de caisse.");
        return;
      }
      if (!result.session) {
        window.alert("La sortie a été enregistrée, mais le serveur n'a pas retourné la session mise à jour. Actualisez la page.");
        return;
      }
      const refreshed = await getCashSessionWithServerValidation(activeRestaurantSlug);
      const updatedSession = refreshed.success === true ? refreshed.session : result.session;
      setCashSession(updatedSession);
      setCashMovementIdempotencyKey(generateClientOrderIdempotencyKey());
      if (updatedSession) {
        setDrawerState((previous) => ({
          ...previous,
          openingBalance: Number(updatedSession.openingBalance || 0),
          currentCash: Number(updatedSession.openingBalance || 0) +
            Number(updatedSession.cashCollected || 0) - Number(updatedSession.cashOut || 0)
        }));
      } else {
        setDrawerState((previous) => ({ ...previous, openingBalance: 0, currentCash: 0 }));
      }
      window.alert("Sortie de caisse enregistrée et rattachée à la session active.");
    } finally {
      setCashMovementActionLoading(false);
    }
  };

  const handleConfirmPayment = async (paymentData: {
    method: PaymentMethod;
    paidAmount: number;
    changeAmount: number;
    splitGuests: number;
    guestNumber: number;
    guestName: string;
  }) => {
    const isCashPayment = paymentData.method === 'especes';
    if (!canManageCash || (isCashPayment && cashSession?.status !== 'active')) {
      setIsPaymentModalOpen(false);
      window.alert(isCashPayment
        ? "La session de caisse n'est plus active. Ouvrez ou vérifiez votre session avant d'encaisser."
        : "Votre rôle ne permet pas de lancer un paiement Mobile Money.");
      return;
    }
    if (discountPercent > 0) {
      window.alert("Les remises POS ne sont pas encore validées côté serveur. Retirez la remise avant d'encaisser.");
      return;
    }
    if (cart.length === 0 && !pendingPosOrder) return;
    if (isSubmittingPayment || isSubmittingPosOrder) return;

    setIsSubmittingPayment(true);
    try {
      let order = pendingPosOrder;
      if (!order) {
        const clientCart: ClientCartItem[] = cart.map(toClientCartItem);

        const orderResult = await submitPosOrderWithServerValidation(activeRestaurantSlug, {
          cart: clientCart,
          orderMode: selectedTable ? 'sur_place' : 'a_emporter',
          tableNumber: selectedTable?.number || null,
          idempotencyKey: posOrderIdempotencyKey,
          customerNote: `Commande saisie au comptoir par ${serverName}`
        });

        if (!orderResult.success) {
          window.alert(`Commande non créée : ${orderResult.error}`);
          return;
        }

        const createdOrder = orderResult.order;
        if (!createdOrder) {
          window.alert("La commande a été acceptée sans document retourné. Vérifiez l'historique avant toute nouvelle tentative.");
          return;
        }
        order = createdOrder;
        setPosOrderIdempotencyKey(generateClientOrderIdempotencyKey());
        setPendingPosOrder(createdOrder);
        setPendingPosPaidAmount(Number(createdOrder.paidAmount || 0));
        const ticket = mapRestauOrderToKitchenTicket(createdOrder);
        setKitchenTickets((previous) => [
          ticket,
          ...previous.filter((existing) => existing.id !== ticket.id)
        ]);
        setRestauOrders(previous => [createdOrder, ...previous.filter(existing => existing.id !== createdOrder.id)]);
      }

      if (!isCashPayment) {
        const channelByMethod = {
          wave: 'wave-ci',
          orange_money: 'orange-money-ci',
          mtn_money: 'mtn-ci',
          moov_money: 'moov-ci',
          djamo: 'djamo-ci'
        } as const;
        const channel = channelByMethod[paymentData.method as keyof typeof channelByMethod];
        if (!channel) {
          window.alert("Ce moyen de paiement n'est pas disponible.");
          return;
        }
        const checkout = await createPayDunyaPaymentWithServerValidation(
          activeRestaurantSlug, order.id, channel, paymentIdempotencyKey, paymentData.paidAmount
        );
        if (!checkout.success) {
          window.alert(`Facture Mobile Money non créée : ${checkout.error}`);
          return;
        }
        setIsPaymentModalOpen(false);
        window.location.assign(checkout.checkoutUrl);
        return;
      }

      const paymentResult = await collectCashPaymentWithServerValidation(
        activeRestaurantSlug,
        order.id,
        paymentData.paidAmount,
        paymentIdempotencyKey,
        paymentData.splitGuests,
        paymentData.guestNumber,
        paymentData.guestName
      );
      if (!paymentResult.success) {
        window.alert(`Encaissement non enregistré : ${paymentResult.error}`);
        return;
      }

      const payment = paymentResult.payment;
      const refreshedSession = await getCashSessionWithServerValidation(activeRestaurantSlug);
      const refreshedCashSession = refreshedSession.success === true ? refreshedSession.session : null;
      if (refreshedSession.success === true) setCashSession(refreshedCashSession);
      const refreshedCashTotal = refreshedCashSession
        ? Number(refreshedCashSession.openingBalance || 0) + Number(refreshedCashSession.cashCollected || 0) - Number(refreshedCashSession.cashOut || 0)
        : null;
      sounds.playCashRegister();
      const updatedOrder = { ...order, ...paymentResult.order } as RestauOrder;
      setPendingPosOrder(updatedOrder);
      setPendingPosPaidAmount(Number(updatedOrder.paidAmount || 0));
      setPaymentIdempotencyKey(generateClientOrderIdempotencyKey());

      const newRecord = mapCashPaymentRecord(payment);
      const paymentAlreadyCounted = paymentResult.idempotentReplay === true ||
        transactions.some((record) => record.id === newRecord.id);
      if (!paymentAlreadyCounted) {
        setTransactions((previous) => [newRecord, ...previous]);
        setDrawerState((previous) => ({
          ...previous,
          totalSales: previous.totalSales + payment.paidAmount,
          currentCash: refreshedCashTotal ?? previous.currentCash + payment.paidAmount,
          cashSales: previous.cashSales + payment.paidAmount,
          transactionCount: previous.transactionCount + 1
        }));
      } else if (refreshedCashTotal !== null && refreshedCashSession) {
        setDrawerState((previous) => ({
          ...previous,
          openingBalance: Number(refreshedCashSession.openingBalance || 0),
          currentCash: refreshedCashTotal
        }));
      }
      setActiveReceiptModal(newRecord);
      setIsPaymentModalOpen(false);

      if (payment.paymentStatus === 'paid') {
        setCart([]);
        setPendingPosOrder(null);
        setPendingPosPaidAmount(0);
        setPosOrderIdempotencyKey(generateClientOrderIdempotencyKey());
        setDiscountPercent(0);
      } else {
        window.alert(`Paiement partiel enregistré. Reste à payer : ${formatFCFA(payment.remainingAfter)}. Vous pourrez reprendre l'encaissement depuis le panier.`);
      }
    } catch (err) {
      console.error('Erreur encaissement POS:', err);
      window.alert("L'encaissement n'a pas pu être confirmé. Vérifiez le journal avant de réessayer ; le panier a été conservé.");
    } finally {
      setIsSubmittingPayment(false);
    }
  };

  const canRefundPayments = isRestaurantOwner ||
    (authRestaurantRole === 'manager' && userPermissions.includes('payments.refund')) ||
    (authRestaurantRole === 'cashier' && userPermissions.includes('payments.refund'));

  const handleRefundPayment = async (payment: PaymentRecord, amount: number, reason: string) => {
    if (!canRefundPayments) {
      window.alert("Votre rôle ne permet pas de rembourser ce paiement.");
      return;
    }
    const idempotencyKey = generateClientOrderIdempotencyKey();
    const result = payment.paymentMethod === 'especes'
      ? await refundCashPaymentWithServerValidation(
          activeRestaurantSlug, payment.id, amount, reason, idempotencyKey, true
        )
      : await refundPayDunyaPaymentWithServerValidation(
          activeRestaurantSlug, payment.id, amount, reason, idempotencyKey
        );
    if (!result.success) {
      window.alert(`Remboursement refusé : ${result.error}`);
      return;
    }
    if (payment.paymentMethod === 'especes') {
      window.alert("Remboursement espèces enregistré. La confirmation de remise physique au client est journalisée.");
    } else {
      window.alert(result.status === 'completed'
        ? "Remboursement Mobile Money confirmé par PayDunya."
        : result.status === 'failed'
          ? "PayDunya a refusé le décaissement. Le montant réservé a été libéré."
          : result.status === 'created'
            ? "Le décaissement est créé mais pas encore confirmé comme soumis. Il reste réservé pour rapprochement ; ne relancez pas l'opération."
            : "Demande de remboursement transmise. Elle reste en attente de confirmation PayDunya ; ne relancez pas l'opération.");
    }
    const refreshed = await listRecentCashPaymentsWithServerValidation(activeRestaurantSlug);
    if (refreshed.success) {
      const records = refreshed.payments.map(mapCashPaymentRecord);
      setTransactions(records);
      setDrawerState((previous) => ({
        ...previous,
        totalSales: records.reduce((sum, record) => sum + record.paidAmount, 0),
        cashSales: records.filter((record) => record.paymentMethod === 'especes').reduce((sum, record) => sum + record.paidAmount, 0),
        mobileMoneySales: records.filter((record) => record.paymentMethod !== 'especes' && record.paymentMethod !== 'carte').reduce((sum, record) => sum + record.paidAmount, 0),
        transactionCount: records.length
      }));
    }
  };

  const handleToggleKdsItem = async (ticketId: string, itemId: string, completed: boolean) => {
    if (ticketId.startsWith('ord-')) {
      const orderId = ticketId.slice(4);
      const itemPrefix = `ki-${orderId}-`;
      if (!itemId.startsWith(itemPrefix)) {
        window.alert('Ligne de préparation invalide.');
        return;
      }
      const itemIndex = Number(itemId.slice(itemPrefix.length));
      if (!Number.isInteger(itemIndex) || itemIndex < 0) {
        window.alert('Ligne de préparation invalide.');
        return;
      }
      const result = await updateKitchenItemCompletionWithServerValidation(
        activeRestaurantSlug, orderId, itemId, itemIndex, completed
      );
      if (!result.success) {
        window.alert(result.error);
        return;
      }
    }

    setKitchenTickets((prev) =>
      prev.map((ticket) =>
        ticket.id === ticketId
          ? {
              ...ticket,
              items: ticket.items.map((item) => (item.id === itemId ? { ...item, completed } : item))
            }
          : ticket
      )
    );
  };

  const handleUpdateTicketStatus = async (ticketId: string, status: TicketStatus) => {
    const canManageOrders = isRestaurantOwner || userPermissions.includes('orders.manage');
    const canCancelOrders = canManageOrders || userPermissions.includes('orders.cancel');
    const canMarkServed = canManageOrders || userPermissions.includes('orders.serve');
    if (status === 'cancelled' && !canCancelOrders) {
      window.alert("Votre rôle ne permet pas d'annuler une commande.");
      return;
    }
    if (status === 'served' && !canMarkServed) {
      window.alert("La remise au client doit être confirmée par un serveur ou un responsable autorisé.");
      return;
    }

    // Persist Firestore order transitions before changing the visible KDS state.
    if (ticketId.startsWith('ord-')) {
      const rawOrderId = ticketId.replace(/^ord-/, '');
      let firestoreStatus: RestauOrderStatus = 'in_prep';
      if (status === 'ready') firestoreStatus = 'ready';
      else if (status === 'served') firestoreStatus = 'completed';
      else if (status === 'cancelled') firestoreStatus = 'cancelled';
      else firestoreStatus = 'in_prep';

      try {
        const currentOrder = restauOrders.find(order => order.id === rawOrderId);
        // Firestore rules require the kitchen transition pending -> in_prep -> ready.
        if (status === 'ready' && currentOrder?.status === 'pending') {
          await updateOrderStatus(activeRestaurantSlug, rawOrderId, 'in_prep');
        }
        await updateOrderStatus(activeRestaurantSlug, rawOrderId, firestoreStatus);
      } catch (err) {
        console.warn('Erreur mise à jour statut commande Firestore depuis KDS:', err);
        window.alert("La mise à jour a été refusée. Vérifiez les droits du compte et réessayez.");
        return;
      }
    }

    setKitchenTickets((prev) =>
      prev.map((t) => (t.id === ticketId ? { ...t, status } : t))
    );
  };

  const handleSelectTableForOrder = (table: Table) => {
    if (pendingPosOrder) { window.alert('Terminez le règlement de la commande en cours avant de changer de table.'); return; }
    setSelectedTable(table);
    setCurrentRole('pos');
    if (table.status === 'available') {
      handleUpdateTableStatus(table.id, 'occupied', table.covers);
    }
  };

  const handleUpdateTableStatus = (tableId: string, status: TableStatus, covers?: number) => {
    const existing = restauTables.find((table) => table.id === tableId);
    if (!existing) return;

    const updated: RestaurantTable = {
      ...existing,
      status,
      covers: covers ?? existing.covers,
      seatedAt: status === 'occupied'
        ? existing.seatedAt ?? Date.now()
        : status === 'available'
          ? undefined
          : existing.seatedAt
    };

    setRestauTables((previous) =>
      previous.map((table) => table.id === tableId ? updated : table)
    );

    persistTable(activeRestaurantSlug, updated).catch((err) => {
      console.error('Erreur de synchronisation du statut de table:', err);
      setRestauTables((previous) =>
        previous.map((table) => table.id === tableId ? existing : table)
      );
    });
  };


  const unpaidPosOrders = useMemo(() => restauOrders
    .filter((order) => {
      if (order.status === 'cancelled' || order.paymentStatus === 'paid') return false;
      const remaining = Number(order.remainingAmount ?? (order.totalAmount - Number(order.paidAmount || 0)));
      return Number.isFinite(remaining) && remaining > 0;
    })
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 8), [restauOrders]);

  const handleCollectExistingOrder = (order: RestauOrder) => {
    if (!canCollectPayment) {
      window.alert("Votre rôle ne permet pas d'encaisser cette commande.");
      return;
    }
    if (isSubmittingPayment || isSubmittingPosOrder) return;
    if (pendingPosOrder && pendingPosOrder.id !== order.id) {
      window.alert("Un autre règlement partiel est déjà ouvert. Terminez-le avant d'en sélectionner un autre.");
      return;
    }
    if (cart.length > 0 && (!pendingPosOrder || pendingPosOrder.id !== order.id)) {
      const confirmed = window.confirm("Le panier non enregistré sera remplacé par cette commande. Continuer ?");
      if (!confirmed) return;
    }

    const restoredCart: CartItem[] = order.items.map((item) => {
      const existing = menuItems.find((menuItem) => menuItem.id === item.menuItemId);
      const menuItem: MenuItem = {
        id: item.menuItemId || item.id,
        name: item.name,
        category: existing?.category || 'plats',
        price: Number(item.basePrice ?? item.unitPrice),
        description: existing?.description || '',
        imageUrl: existing?.imageUrl || '',
        available: existing?.available ?? false,
        prepTimeMinutes: existing?.prepTimeMinutes || 0,
        course: existing?.course || 'plat',
        tags: existing?.tags
      };
      const notes = [
        item.selectedOption?.optionName,
        item.selectedExtras?.map((extra) => extra.name).join(', '),
        item.prepNotes
      ].filter(Boolean).join(' · ');
      return {
        id: item.id,
        menuItem,
        quantity: item.quantity,
        selectedOption: item.selectedOption,
        selectedExtras: item.selectedExtras || [],
        specialInstructions: item.prepNotes || '',
        course: menuItem.course
      };
    });

    setCart(restoredCart);
    setPendingPosOrder(order);
    setPendingPosPaidAmount(Number(order.paidAmount || 0));
    setSelectedTable(order.tableNumber ? tables.find((table) => table.number === order.tableNumber) || null : null);
    setDiscountPercent(0);
    setCurrentRole('pos');
    setIsPaymentModalOpen(true);
  };

  const activeTicketsCount = kitchenTickets.filter((t) => t.status === 'in_prep' || t.status === 'ready').length;

  return (
    <div className="min-h-screen flex flex-col bg-[#f4f7fb] text-[#181c1f]">
      {/* 1. Client Menu Route: /r/chez-awa?table=4 or /r/chez-awa */}
      {isClientMenuRoute && (
        <ClientMenuView
          restaurant={restaurant}
          menuItems={activeMenuItems}
          tableNumber={activeTableNumber}
          cart={clientCart}
          onAddToCart={handleClientAddToCart}
          onUpdateQuantity={handleUpdateClientCartQuantity}
          onRemoveItem={handleRemoveClientCartItem}
          onClearCart={handleClearClientCart}
          onConfirmOrder={handleClientOrderConfirm}
          onStartPayDunyaPayment={handleStartClientPayDunya}
          isUncertain={isOrderUncertain}
          tableSessionUnavailable={tableSessionExpected && !tableSessionChecking && !tableSession}
          catalogLoading={activeMenuLoading}
          catalogError={activeMenuError}
          onResetUncertainty={handleResetUncertainty}
          onNavigateHome={() => navigateTo('/')}
/>
      )}

      {/* 2. Protected Restaurant Management Hub: /gestion and all sub-routes */}
      {isRestaurantHubRoute && (
        isLoadingAuth ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 bg-[#f4f7fb] min-h-[60vh]">
            <div className="w-14 h-14 rounded-2xl bg-[#ff6500] text-white flex items-center justify-center font-black text-xl shadow-md animate-pulse mb-3">
              RM
            </div>
            <p className="text-xs font-bold text-slate-700">Vérification de la session sécurisée...</p>
            <p className="text-[11px] text-slate-400 mt-1">Connexion sécurisée au Centre de Gestion RestauMax</p>
          </div>
        ) : (authUser && authIsSuperAdmin) ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 bg-[#f4f7fb] p-8 text-center">
            <p className="text-sm font-bold text-slate-800">Le super-administrateur n’a pas accès aux opérations d’un restaurant.</p>
            <button onClick={() => navigateTo('/admin')} className="rounded-xl bg-[#101d2d] px-5 py-3 text-sm font-bold text-white">Accéder à l’administration plateforme</button>
          </div>
        ) : (!authUser || !isAuthorizedManager) ? (
          <ManagerLoginView
            onLogin={handleManagerLogin}
            onBackToMenu={() => navigateTo('/')}
            restaurantName={restaurant.name}
          />
        ) : !(isRestaurantOwner || authRestaurantRole === 'manager') ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 bg-[#f4f7fb] p-8 text-center">
            <p className="text-sm font-bold text-slate-800">Votre rôle ne permet pas d’accéder au Centre de Gestion.</p>
            <button onClick={() => navigateTo('/staff')} className="rounded-xl bg-[#101d2d] px-5 py-3 text-sm font-bold text-white">Ouvrir mon espace de travail</button>
          </div>
        ) : (
          <RestaurantHubView
            restaurant={restaurant}
            menuItems={activeMenuItems}
            menuItemsCount={activeMenuItems.length}
            menuCatalogLoading={activeMenuLoading}
            menuCatalogError={activeMenuError}
            tablesCount={restauTables.length}
            tables={restauTables}
            onSaveTable={handleSaveTable}
            onDeleteTable={handleDeleteTable}
            activeKitchenTicketsCount={activeTicketsCount}
            totalSessionSales={drawerState.totalSales}
            onNavigateHome={() => navigateTo('/')}
            onNavigateToClientMenu={() => navigateTo(`/r/${activeRestaurantSlug}`)}
            onNavigateToStaffRole={(role) => {
              setCurrentRole(role);
              navigateTo('/staff');
            }}
            onToggleDishAvailability={handleToggleDishAvailability}
            onCreateDish={handleCreateDish}
            onUpdateDish={handleUpdateDish}
            onDeleteDish={handleDeleteDish}
            currentUserEmail={authUser?.email}
            canManageStaff={isRestaurantOwner || (authRestaurantRole === 'manager' && userPermissions.includes('staff.manage'))}
            permissions={userPermissions}
            onSignOut={handleManagerSignOut}
          />
        )
      )}

      {/* 3. Central platform administration: /admin */}
      {isPlatformAdminRoute && <PlatformAdminView onBack={() => navigateTo('/')} onOpenRestaurant={(slug) => navigateTo(`/gestion?restaurant=${encodeURIComponent(slug)}`)} />}

      {/* PayDunya hosted checkout return: provider callback remains the payment source of truth */}
      {isPaymentReturnRoute && (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-50 text-amber-700">
              <span className="text-lg font-black">RM</span>
            </div>
            <h1 className="text-xl font-black text-slate-900">Retour du paiement PayDunya</h1>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              {paydunyaReturnStatus === 'checking' ? 'Vérification sécurisée auprès de PayDunya…'
                : paydunyaReturnStatus === 'completed' ? 'Paiement confirmé. La commande et le journal RestauMax ont été mis à jour.'
                : paydunyaReturnStatus === 'cancelled' ? 'Le paiement a été annulé chez PayDunya. Aucun encaissement n’a été enregistré.'
                : paydunyaReturnStatus === 'failed' ? 'PayDunya confirme que le paiement a échoué. Aucun encaissement n’a été enregistré.'
                : paydunyaReturnStatus === 'pending' ? 'Le paiement est encore en attente chez PayDunya. Ne relancez pas un second paiement ; vérifiez à nouveau dans quelques instants.'
                : paydunyaReturnStatus === 'error' ? (paydunyaReturnError || 'Le statut n’a pas pu être rapproché automatiquement.')
                : 'La confirmation sécurisée du paiement va être vérifiée.'}
            </p>
            {paymentReturnOrderId && (
              <p className="mt-3 text-xs font-semibold text-slate-500">Commande : {paymentReturnOrderId}</p>
            )}
            <p className="mt-3 text-xs text-slate-500">
              Seule la confirmation serveur PayDunya fait foi. Le simple retour du navigateur ne valide jamais un paiement.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              <button onClick={() => void reconcilePayDunyaReturn()}
                disabled={paydunyaReturnStatus === 'checking' || !paymentReturnIntentId}
                className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-bold text-slate-800 disabled:opacity-50">
                Vérifier à nouveau
              </button>
              <button onClick={() => navigateTo(authUser ? '/gestion' : `/r/${activeRestaurantSlug}?table_session=1`)}
                className="rounded-xl bg-[#101d2d] px-5 py-3 text-sm font-bold text-white">
                {authUser ? 'Retour à la gestion du restaurant' : 'Retour au menu de la table'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. RestauMax Home Landing Page: / */}
      {isHomePageRoute && (
        <HomePage
          onGoToMenuWithTable={(tbl) => {
            if (tbl) {
              navigateTo(`/r/${activeRestaurantSlug}?table=${tbl}`);
            } else {
              navigateTo(`/r/${activeRestaurantSlug}`);
            }
          }}
          onGoToStaffTools={() => navigateTo('/staff')}
          onGoToManagementHub={() => navigateTo('/gestion')}
          onOpenScanner={() => setIsQrScannerOpen(true)}
        />
      )}

      {/* 5. Protected Staff Internal Workspaces: /staff */}
      {isStaffRoute && (
        isLoadingAuth ? (
          <div className="flex-1 flex items-center justify-center p-8 text-sm text-slate-600">
            Vérification de la session sécurisée...
          </div>
        ) : (!authUser || !isAuthorizedManager) ? (
          <ManagerLoginView
            onLogin={handleManagerLogin}
            onBackToMenu={() => navigateTo('/')}
            restaurantName={restaurant.name}
          />
        ) : (
        <div className="flex-1 flex flex-col">
          <Header
            currentRole={currentRole}
            permissions={userPermissions}
            onSelectRole={(r) => {
              sounds.playTap();
              setCurrentRole(r);
            }}
            audioEnabled={audioEnabled}
            onToggleAudio={handleToggleAudio}
            onQuickNewOrder={() => {
              if (pendingPosOrder) {
                window.alert('Terminez le règlement de la commande en cours avant de démarrer une nouvelle vente.');
                return;
              }
              setSelectedTable(null);
              setCart([]);
              setCurrentRole('pos');
            }}
            kitchenTicketsCount={activeTicketsCount}
            onNavigateToHub={() => navigateTo('/gestion')}
          />

          <main className="flex-1 flex flex-col min-h-0 overflow-hidden">
            {currentRole === 'pos' && userPermissions.includes('pos.access') && (
              <PosView
                restaurantSlug={activeRestaurantSlug}
                menuItems={menuItems}
                cart={cart}
                selectedTable={selectedTable}
                tables={tables}
                onSelectTable={handleSelectPosTable}
                onAddToCart={handleAddToCart}
                onUpdateQuantity={handleUpdateQuantity}
                onRemoveItem={handleRemoveItem}
                onUpdateItemNotes={handleUpdateItemNotes}
                onClearCart={handleClearPosCart}
                discountPercent={discountPercent}
                onSetDiscountPercent={handleSetDiscountPercent}
                onSendToKitchen={handleSendToKitchen}
                isSendingOrder={isSubmittingPosOrder}
                onOpenPayment={() => {
                  if (!canManageCash) {
                    window.alert("Votre rôle ne permet pas d'encaisser un paiement.");
                    return;
                  }
                  setIsPaymentModalOpen(true);
                }}
                serverName={serverName}
                unpaidOrders={canCollectPayment ? unpaidPosOrders : []}
                onCollectOrder={handleCollectExistingOrder}
                alreadyPaidAmount={pendingPosPaidAmount}
                isExistingOrder={pendingPosOrder !== null}
              />
            )}

            {currentRole === 'floor' && userPermissions.includes('tables.manage') && (
              <FloorView
                tables={tables}
                onSelectTableForOrder={handleSelectTableForOrder}
                onUpdateTableStatus={handleUpdateTableStatus}
                serverName={serverName}
              />
            )}

            {currentRole === 'kds' && userPermissions.includes('kitchen.access') && (
              <KdsView
                tickets={kitchenTickets}
                canMarkServed={isRestaurantOwner || userPermissions.includes('orders.manage') || userPermissions.includes('orders.serve')}
                onToggleItemComplete={handleToggleKdsItem}
                onUpdateTicketStatus={handleUpdateTicketStatus}
              />
            )}

            {currentRole === 'manager' && (userPermissions.includes('cash.view') || userPermissions.includes('cash.manage')) && (
              <ManagerView
                restaurantSlug={activeRestaurantSlug}
                isOwner={isRestaurantOwner}
                drawerState={drawerState}
                transactions={transactions}
                cashSession={cashSession}
                cashSessionLoading={cashSessionLoading}
                cashSessionActionLoading={cashSessionActionLoading}
                cashMovementActionLoading={cashMovementActionLoading}
                canManageCash={canManageCash}
                canRefundPayments={canRefundPayments}
                onRefundPayment={handleRefundPayment}
                onOpenCashSession={handleOpenCashSession}
                onCloseCashSession={handleCloseCashSession}
                onRecordCashMovement={handleRecordCashMovement}
                onViewReceipt={(receipt) => setActiveReceiptModal(receipt)}
              />
            )}
          </main>

          <PaymentModal
            isOpen={isPaymentModalOpen && canCollectPayment}
            onClose={() => setIsPaymentModalOpen(false)}
            cart={cart}
            selectedTable={selectedTable}
            serverName={serverName}
            discountPercent={discountPercent}
            alreadyPaidAmount={pendingPosPaidAmount}
            orderTotalAmount={pendingPosOrder?.totalAmount}
            guestAccounts={pendingPosOrder?.guestAccounts}
            isSubmitting={isSubmittingPayment}
            onConfirmPayment={handleConfirmPayment}
          />

          <ReceiptModal
            receipt={activeReceiptModal}
            restaurant={restaurant}
            onClose={() => setActiveReceiptModal(null)}
          />
        </div>
        )
      )}

      {/* Restaurant Table QR Code Camera Scanner Modal */}
      <QrScannerModal
        isOpen={isQrScannerOpen}
        onClose={() => setIsQrScannerOpen(false)}
        onScanResult={(detectedPath: string) => {
          setIsQrScannerOpen(false);
          window.location.assign(detectedPath);
        }}
      />
    </div>
  );
}
