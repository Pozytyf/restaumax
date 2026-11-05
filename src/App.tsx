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
import { 
  INITIAL_MENU_ITEMS, 
  INITIAL_KITCHEN_TICKETS, 
  INITIAL_DRAWER_STATE 
} from './data/mockData';
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
  subscribeToOrders,
  updateOrderStatus,
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

/**
 * Mappe de façon déterministe et stable une commande Firestore RestauOrder vers un ticket KDS KitchenTicket
 */
export function mapRestauOrderToKitchenTicket(
  order: RestauOrder, 
  existingTicket?: KitchenTicket
): KitchenTicket {
  let ticketStatus: TicketStatus = 'in_prep';
  if (order.status === 'ready') ticketStatus = 'ready';
  else if (order.status === 'completed') ticketStatus = 'served';
  else if (order.status === 'cancelled') ticketStatus = 'cancelled';
  else ticketStatus = 'in_prep';

  const existingCompletedNames = new Set(
    existingTicket?.items.filter(i => i.completed).map(i => i.name) || []
  );

  return {
    id: `ord-${order.id}`,
    ticketNumber: order.orderNumber,
    tableNumber: order.tableNumber ? `Table ${order.tableNumber}` : 'À emporter',
    orderType: order.orderMode === 'sur_place' ? 'sur_place' : 'emporter',
    waiter: 'QR Menu Client',
    createdAt: new Date(order.createdAt),
    status: ticketStatus,
    items: order.items.map((it, idx) => {
      const notesArr: string[] = [];
      if (it.selectedOption?.optionName) {
        notesArr.push(`Option: ${it.selectedOption.optionName}`);
      }
      if (it.selectedExtras && it.selectedExtras.length > 0) {
        notesArr.push(`Extras: ${it.selectedExtras.map(e => e.name).join(', ')}`);
      }
      if (it.prepNotes) {
        notesArr.push(`Note: ${it.prepNotes}`);
      }
      return {
        id: `ki-${order.id}-${idx}`,
        name: it.name,
        quantity: it.quantity,
        course: 'plat',
        notes: notesArr.join(' · '),
        completed: existingCompletedNames.has(it.name)
      };
    })
  };
}

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
  const queryRestaurantSlug = (() => { try { return new URL(currentPath, 'http://localhost').searchParams.get('restaurant') || ''; } catch { return ''; } })();
  const activeRestaurantSlug = routeRestaurantSlug || (authIsSuperAdmin ? queryRestaurantSlug : authRestaurantSlug) || authRestaurantSlug || 'chez-awa';

  const isClientMenuRoute = activePathname.startsWith('/r/');
  const isStaffRoute = activePathname === '/staff';
  const isPlatformAdminRoute = activePathname === '/admin';
  const isRestaurantHubRoute = activePathname.startsWith('/gestion');
  const isHomePageRoute = !isClientMenuRoute && !isStaffRoute && !isRestaurantHubRoute && !isPlatformAdminRoute;

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
  const [menuItems, setMenuItems] = useState<MenuItem[]>(INITIAL_MENU_ITEMS);
  const [tables, setTables] = useState<Table[]>([]);
  const [selectedTable, setSelectedTable] = useState<Table | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [discountPercent, setDiscountPercent] = useState<number>(0);
  const [kitchenTickets, setKitchenTickets] = useState<KitchenTicket[]>(INITIAL_KITCHEN_TICKETS);
  const [drawerState, setDrawerState] = useState<CashDrawerState>(INITIAL_DRAWER_STATE);
  const [transactions, setTransactions] = useState<PaymentRecord[]>([
    {
      id: 'tx-1',
      orderId: '#T-101',
      tableNumber: 'Table 03',
      waiter: 'Aïcha K.',
      timestamp: new Date(Date.now() - 40 * 60 * 1000),
      subtotal: 26000,
      discount: 0,
      tax: 0,
      total: 26000,
      paidAmount: 30000,
      changeAmount: 4000,
      paymentMethod: 'especes',
      items: [
        { name: 'Poulet Bicyclette Braisé Entier', quantity: 2, price: 9500 },
        { name: 'Alloco Banane Plantain Dorée', quantity: 2, price: 2500 }
      ]
    }
  ]);

  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [isSubmittingPosOrder, setIsSubmittingPosOrder] = useState(false);
  const [activeReceiptModal, setActiveReceiptModal] = useState<PaymentRecord | null>(null);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const serverName = 'Moussa D.';

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
      available: dish.available !== false,
      prepTimeMinutes: dish.prepTimeMinutes,
      course: dish.category === 'entrees'
        ? 'entree'
        : dish.category === 'boissons'
          ? 'boisson'
          : dish.category === 'desserts'
            ? 'dessert'
            : 'plat',
      tags: dish.tags
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
  const [isAuthorizedManager, setIsAuthorizedManager] = useState<boolean>(false);
  const [isRestaurantOwner, setIsRestaurantOwner] = useState<boolean>(false);
  const [authRestaurantRole, setAuthRestaurantRole] = useState<string>('');
  const [userPermissions, setUserPermissions] = useState<string[]>([]);
  const canCollectPayment = isRestaurantOwner ||
    authRestaurantRole === 'manager' ||
    (authRestaurantRole === 'cashier' && userPermissions.includes('cash.manage'));
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
      }).catch(() => { setAuthRestaurantSlug(''); setAuthIsSuperAdmin(false); setIsRestaurantOwner(false); setUserPermissions([]); });
      else { setAuthRestaurantSlug(''); setAuthIsSuperAdmin(false); setIsRestaurantOwner(false); setAuthRestaurantRole(''); setUserPermissions([]); }
    });

    return () => unsubAuth();
  }, []);

  // Subscribe to Tables subcollection when manager is authorized or management hub is active
  useEffect(() => {
    if (!isAuthorizedManager && !isRestaurantHubRoute) return;

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
  }, [isAuthorizedManager, isRestaurantHubRoute, activeRestaurantSlug]);

  // Correction C: Subscribe to Orders subcollection for persistent KDS stream
  useEffect(() => {
    if (!isAuthorizedManager || (!userPermissions.includes('orders.view') && !userPermissions.includes('orders.manage') && !userPermissions.includes('kitchen.access'))) return;

    let isMounted = true;
    const unsubOrders = subscribeToOrders(
      activeRestaurantSlug,
      (firestoreOrders) => {
        if (!isMounted) return;
        setKitchenTickets((prev) => {
          const existingMap = new Map<string, KitchenTicket>(prev.map((t) => [t.id, t]));
          const nonFirestoreTickets = prev.filter((t) => !t.id.startsWith('ord-'));

          const mappedTickets = firestoreOrders.map((ord) => {
            const existing = existingMap.get(`ord-${ord.id}`);
            return mapRestauOrderToKitchenTicket(ord, existing);
          });

          return [...mappedTickets, ...nonFirestoreTickets];
        });
      },
      (err) => {
        console.warn('Flux KDS Firestore en attente ou restreint:', err);
      }
    );

    return () => {
      isMounted = false;
      unsubOrders();
    };
  }, [isAuthorizedManager, isStaffRoute, userPermissions]);

  const handleManagerLogin = async (email: string, pass: string): Promise<{ success: boolean; error?: string }> => {
    const res = await signInManager(email, pass);
    if (res.success && res.user) {
      setAuthUser(res.user);
      setIsAuthorizedManager(true);
      const token = await res.user.getIdTokenResult(true);
      setAuthRestaurantSlug(typeof token.claims.restaurantSlug === 'string' ? token.claims.restaurantSlug : '');
      setAuthIsSuperAdmin(token.claims.role === 'super_admin' || token.claims.role === 'admin');
      setIsRestaurantOwner(token.claims.role === 'owner');
      setUserPermissions(token.claims.role === 'owner' || token.claims.role === 'super_admin' || token.claims.role === 'admin' ? ['menu.view','menu.manage','orders.view','orders.manage','tables.view','tables.manage','pos.access','kitchen.access','cash.view','cash.manage','reports.view','customers.view','customers.manage','inventory.view','inventory.manage','staff.view','staff.manage','settings.view','settings.manage'] : (Array.isArray(token.claims.permissions) ? token.claims.permissions as string[] : []));
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
      window.alert("Le plat n'a pas été enregistré. Vérifiez les champs et vos droits, puis réessayez.");
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
      window.alert("Les modifications du plat n'ont pas été enregistrées. Réessayez.");
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
  const handleAddToCart = (dish: MenuItem) => {
    setCart((prev) => {
      const existing = prev.find((item) => item.menuItem.id === dish.id);
      if (existing) {
        return prev.map((item) =>
          item.menuItem.id === dish.id ? { ...item, quantity: item.quantity + 1 } : item
        );
      } else {
        return [...prev, { id: `ci-${Date.now()}-${dish.id}`, menuItem: dish, quantity: 1, course: dish.course }];
      }
    });
  };

  const handleUpdateQuantity = (itemId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((item) => (item.id === itemId ? { ...item, quantity: item.quantity + delta } : item))
        .filter((item) => item.quantity > 0)
    );
  };

  const handleRemoveItem = (itemId: string) => {
    setCart((prev) => prev.filter((item) => item.id !== itemId));
  };

  const handleUpdateItemNotes = (itemId: string, notes: string) => {
    setCart((prev) =>
      prev.map((item) => (item.id === itemId ? { ...item, specialInstructions: notes } : item))
    );
  };

  const handleSendToKitchen = async () => {
    if (cart.length === 0 || isSubmittingPosOrder) return;

    // Never let a client-side discount silently alter a server-calculated order total.
    if (discountPercent > 0) {
      window.alert("Les remises POS ne sont pas encore validées côté serveur. Retirez la remise avant d'envoyer cette commande.");
      return;
    }

    setIsSubmittingPosOrder(true);
    try {
      const clientCart: ClientCartItem[] = cart.map((item) => ({
        id: item.id,
        menuItemId: item.menuItem.id,
        name: item.menuItem.name,
        basePrice: item.menuItem.price,
        unitPrice: item.menuItem.price,
        quantity: item.quantity,
        selectedExtras: [],
        prepNotes: item.specialInstructions,
        imageUrl: item.menuItem.imageUrl
      }));

      const result = await submitPosOrderWithServerValidation(activeRestaurantSlug, {
        cart: clientCart,
        orderMode: selectedTable ? 'sur_place' : 'a_emporter',
        tableNumber: selectedTable?.number || null,
        idempotencyKey: generateClientOrderIdempotencyKey(),
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
      setCart([]);
      window.alert(`Commande enregistrée et envoyée en cuisine : ${result.order.orderNumber}`);
    } catch (err) {
      console.error('Erreur envoi commande POS:', err);
      window.alert("Impossible d'envoyer la commande. Le panier a été conservé ; réessayez.");
    } finally {
      setIsSubmittingPosOrder(false);
    }
  };

  const handleConfirmPayment = (paymentData: {
    method: PaymentMethod;
    paidAmount: number;
    changeAmount: number;
    splitGuests: number;
  }) => {
    // Client-side safeguard only; Firestore also denies direct payment writes.
    if (!canCollectPayment) {
      setIsPaymentModalOpen(false);
      window.alert("Votre rôle ne permet pas d'encaisser un paiement.");
      return;
    }
    const subtotal = cart.reduce((sum, item) => sum + item.menuItem.price * item.quantity, 0);
    const discountAmount = Math.round((subtotal * discountPercent) / 100);
    const total = Math.max(0, subtotal - discountAmount);
    const orderId = `#T-${Math.floor(100 + Math.random() * 900)}`;

    const newRecord: PaymentRecord = {
      id: `tx-${Date.now()}`,
      orderId,
      tableNumber: selectedTable ? selectedTable.name : 'Vente Directe',
      waiter: serverName,
      timestamp: new Date(),
      subtotal,
      discount: discountAmount,
      tax: 0,
      total,
      paidAmount: paymentData.paidAmount,
      changeAmount: paymentData.changeAmount,
      paymentMethod: paymentData.method,
      items: cart.map((item) => ({
        name: item.menuItem.name,
        quantity: item.quantity,
        price: item.menuItem.price
      }))
    };

    setDrawerState((prev) => ({
      ...prev,
      totalSales: prev.totalSales + total,
      currentCash: prev.currentCash + (paymentData.method === 'especes' ? total : 0),
      cashSales: prev.cashSales + (paymentData.method === 'especes' ? total : 0),
      transactionCount: prev.transactionCount + 1
    }));

    setTransactions((prev) => [newRecord, ...prev]);
    setIsPaymentModalOpen(false);
    setActiveReceiptModal(newRecord);
    setCart([]);
  };

  const handleToggleKdsItem = (ticketId: string, itemId: string) => {
    setKitchenTickets((prev) =>
      prev.map((ticket) =>
        ticket.id === ticketId
          ? {
              ...ticket,
              items: ticket.items.map((i) => (i.id === itemId ? { ...i, completed: !i.completed } : i))
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
        ) : (!authUser || !isAuthorizedManager) ? (
          <ManagerLoginView
            onLogin={handleManagerLogin}
            onBackToMenu={() => navigateTo('/')}
            restaurantName={restaurant.name}
          />
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
            canManageStaff={isRestaurantOwner || authIsSuperAdmin}
            permissions={userPermissions}
            onSignOut={handleManagerSignOut}
          />
        )
      )}

      {/* 3. Central platform administration: /admin */}
      {isPlatformAdminRoute && <PlatformAdminView onBack={() => navigateTo('/')} onOpenRestaurant={(slug) => navigateTo(`/gestion?restaurant=${encodeURIComponent(slug)}`)} />}

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
                menuItems={menuItems}
                cart={cart}
                selectedTable={selectedTable}
                tables={tables}
                onSelectTable={setSelectedTable}
                onAddToCart={handleAddToCart}
                onUpdateQuantity={handleUpdateQuantity}
                onRemoveItem={handleRemoveItem}
                onUpdateItemNotes={handleUpdateItemNotes}
                onClearCart={() => setCart([])}
                discountPercent={discountPercent}
                onSetDiscountPercent={setDiscountPercent}
                onSendToKitchen={handleSendToKitchen}
                isSendingOrder={isSubmittingPosOrder}
                onOpenPayment={() => {
                  if (!canCollectPayment) {
                    window.alert("Votre rôle ne permet pas d'encaisser un paiement.");
                    return;
                  }
                  setIsPaymentModalOpen(true);
                }}
                serverName={serverName}
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
                drawerState={drawerState}
                transactions={transactions}
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
