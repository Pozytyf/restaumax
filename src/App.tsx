import React, { useState, useEffect } from 'react';
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
import { CHEZ_AWA_RESTAURANT, CHEZ_AWA_MENU_ITEMS } from './data/restaumaxData';
import { RestauMenuItem, ClientCartItem, RestaurantInfo, RestauOrder, RestaurantTable, RestauOrderStatus } from './types/restaumax';
import { 
  subscribeToRestaurant, 
  subscribeToMenuItems, 
  persistMenuItem, 
  persistDishAvailability,
  deleteMenuItem, 
  submitOrderWithServerValidation,
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
import { UrlSimulatorBar } from './components/restaumax/UrlSimulatorBar';
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

  // Parse path & table from currentPath
  const parsePathInfo = (pathStr: string) => {
    try {
      const url = new URL(pathStr, 'http://localhost');
      const path = url.pathname || '/';
      const table = url.searchParams.get('table');
      return { path, table };
    } catch {
      return { path: '/', table: null };
    }
  };

  const { path: activePathname, table: activeTableNumber } = parsePathInfo(currentPath);
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
  const [restauMenuItems, setRestauMenuItems] = useState<RestauMenuItem[]>(CHEZ_AWA_MENU_ITEMS);
  const [restauTables, setRestauTables] = useState<RestaurantTable[]>([]);

  // The staff POS must use the same live catalogue as the customer QR menu.
  // This prevents different prices, names or availability between the two sales channels.
  useEffect(() => {
    setMenuItems(restauMenuItems.map((dish) => ({
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
  }, [restauMenuItems]);

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

    // 3. Subscribe to Menu Items subcollection (reflects real state including empty catalog)
    const unsubMenuItems = subscribeToMenuItems(activeRestaurantSlug, (items) => {
      if (isMounted) {
        setRestauMenuItems(items);
      }
    });

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
  const [userPermissions, setUserPermissions] = useState<string[]>([]);
  const [isLoadingAuth, setIsLoadingAuth] = useState<boolean>(true);

  useEffect(() => {
    let active = true;
    if (!authUser) { setIsRestaurantOwner(false); setUserPermissions([]); return; }
    authUser.getIdTokenResult(true).then((token) => {
      if (!active) return;
      const owner = token.claims.role === 'owner';
      const superAdmin = token.claims.role === 'super_admin' || token.claims.role === 'admin';
      setIsRestaurantOwner(owner);
      setUserPermissions(owner || superAdmin ? ['menu.view','menu.manage','orders.view','orders.manage','tables.view','tables.manage','pos.access','kitchen.access','cash.view','cash.manage','reports.view','staff.view','staff.manage','settings.view','settings.manage'] : (Array.isArray(token.claims.permissions) ? token.claims.permissions as string[] : []));
    }).catch(() => { if (active) { setIsRestaurantOwner(false); setUserPermissions([]); } });
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
        setUserPermissions(owner || superAdmin ? ['menu.view','menu.manage','orders.view','orders.manage','tables.view','tables.manage','pos.access','kitchen.access','cash.view','cash.manage','reports.view','staff.view','staff.manage','settings.view','settings.manage'] : (Array.isArray(token.claims.permissions) ? token.claims.permissions as string[] : []));
      }).catch(() => { setAuthRestaurantSlug(''); setAuthIsSuperAdmin(false); setIsRestaurantOwner(false); setUserPermissions([]); });
      else { setAuthRestaurantSlug(''); setAuthIsSuperAdmin(false); }
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
      setUserPermissions(token.claims.role === 'owner' || token.claims.role === 'super_admin' || token.claims.role === 'admin' ? ['menu.view','menu.manage','orders.view','orders.manage','tables.view','tables.manage','pos.access','kitchen.access','cash.view','cash.manage','reports.view','staff.view','staff.manage','settings.view','settings.manage'] : (Array.isArray(token.claims.permissions) ? token.claims.permissions as string[] : []));
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

  const handleToggleDishAvailability = (dishId: string) => {
    const currentDish = restauMenuItems.find((i) => i.id === dishId);
    const nextAvailable = currentDish ? currentDish.available === false : false;

    // Optimistic local state update
    setRestauMenuItems((prev) =>
      prev.map((item) =>
        item.id === dishId ? { ...item, available: nextAvailable } : item
      )
    );

    // Asynchronous Firestore persistence
    persistDishAvailability(activeRestaurantSlug, dishId, nextAvailable).catch((err) => {
      console.error('Erreur de persistance de la disponibilité dans Firestore:', err);
    });
  };

  const handleCreateDish = (newDish: RestauMenuItem) => {
    // Optimistic local state update
    setRestauMenuItems((prev) => [newDish, ...prev]);

    // Asynchronous Firestore persistence
    persistMenuItem(activeRestaurantSlug, newDish).catch((err) => {
      console.error('Erreur de persistance du nouveau plat dans Firestore:', err);
    });
  };

  const handleUpdateDish = (updatedDish: RestauMenuItem) => {
    // Optimistic local state update
    setRestauMenuItems((prev) =>
      prev.map((item) => (item.id === updatedDish.id ? updatedDish : item))
    );

    // Asynchronous Firestore persistence
    persistMenuItem(activeRestaurantSlug, updatedDish).catch((err) => {
      console.error('Erreur de mise à jour du plat dans Firestore:', err);
    });
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
    const liveDish = restauMenuItems.find((item) => item.id === newItem.menuItemId);
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
    const orderMode = activeTableNumber ? 'sur_place' : 'a_emporter';
    
    // Sauvegarder l'intention client complète dans sessionStorage AVANT la soumission
    savePendingOrderIntent({
      restaurantSlug: activeRestaurantSlug,
      orderMode,
      tableNumber: activeTableNumber,
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
      tableNumber: activeTableNumber,
      customerNote,
      idempotencyKey: clientOrderIdempotencyKey,
      allowedTables: restauTables.length > 0 ? restauTables : undefined,
      declaredTotal: clientDeclaredTotal,
      fallbackCatalog: restauMenuItems
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

  const handleSaveTable = (table: RestaurantTable) => {
    setRestauTables(prev => {
      const idx = prev.findIndex(t => t.id === table.id);
      if (idx >= 0) {
        return prev.map(t => t.id === table.id ? table : t);
      }
      return [...prev, table];
    });
    persistTable(activeRestaurantSlug, table).catch(err => {
      console.error('Erreur de persistance de la table dans Firestore:', err);
    });
  };

  const handleDeleteTable = (tableId: string) => {
    setRestauTables(prev => prev.filter(t => t.id !== tableId));
    deleteTable(activeRestaurantSlug, tableId).catch(err => {
      console.error('Erreur de suppression de la table dans Firestore:', err);
    });
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

      const result = await submitOrderWithServerValidation(activeRestaurantSlug, {
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

  const handleUpdateTicketStatus = (ticketId: string, status: TicketStatus) => {
    setKitchenTickets((prev) =>
      prev.map((t) => (t.id === ticketId ? { ...t, status } : t))
    );

    // Synchronisation bidirectionnelle Firestore KDS
    if (ticketId.startsWith('ord-')) {
      const rawOrderId = ticketId.replace(/^ord-/, '');
      let firestoreStatus: RestauOrderStatus = 'in_prep';
      if (status === 'ready') firestoreStatus = 'ready';
      else if (status === 'served') firestoreStatus = 'completed';
      else if (status === 'cancelled') firestoreStatus = 'cancelled';
      else firestoreStatus = 'in_prep';

      updateOrderStatus(activeRestaurantSlug, rawOrderId, firestoreStatus).catch((err) => {
        console.warn('Erreur mise à jour statut commande Firestore depuis KDS:', err);
      });
    }
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
      {/* Test / URL Switcher Simulator Bar at Top */}
      <UrlSimulatorBar
        currentPath={currentPath}
        onNavigate={navigateTo}
        onOpenScanner={() => setIsQrScannerOpen(true)}
      />

      {/* 1. Client Menu Route: /r/chez-awa?table=4 or /r/chez-awa */}
      {isClientMenuRoute && (
        <ClientMenuView
          restaurant={restaurant}
          menuItems={restauMenuItems}
          tableNumber={activeTableNumber}
          cart={clientCart}
          onAddToCart={handleClientAddToCart}
          onUpdateQuantity={handleUpdateClientCartQuantity}
          onRemoveItem={handleRemoveClientCartItem}
          onClearCart={handleClearClientCart}
          onConfirmOrder={handleClientOrderConfirm}
          isUncertain={isOrderUncertain}
          onResetUncertainty={handleResetUncertainty}
          onNavigateHome={() => navigateTo('/')}
          onSelectTableDemo={(tbl) => {
            if (tbl) {
              navigateTo(`/r/${activeRestaurantSlug}?table=${tbl}`);
            } else {
              navigateTo(`/r/${activeRestaurantSlug}`);
            }
          }}
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
            onBackToMenu={() => navigateTo(`/r/${activeRestaurantSlug}`)}
            restaurantName={restaurant.name}
          />
        ) : (
          <RestaurantHubView
            restaurant={restaurant}
            menuItems={restauMenuItems}
            menuItemsCount={restauMenuItems.length}
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
            onBackToMenu={() => navigateTo(`/r/${activeRestaurantSlug}`)}
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
                onOpenPayment={() => setIsPaymentModalOpen(true)}
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
            isOpen={isPaymentModalOpen}
            onClose={() => setIsPaymentModalOpen(false)}
            cart={cart}
            selectedTable={selectedTable}
            serverName={serverName}
            discountPercent={discountPercent}
            onConfirmPayment={handleConfirmPayment}
          />

          <ReceiptModal
            receipt={activeReceiptModal}
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
          navigateTo(detectedPath);
          setIsQrScannerOpen(false);
        }}
      />
    </div>
  );
}
