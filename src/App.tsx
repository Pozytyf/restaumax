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
  INITIAL_TABLES, 
  INITIAL_KITCHEN_TICKETS, 
  INITIAL_DRAWER_STATE 
} from './data/mockData';
import { CHEZ_AWA_RESTAURANT, CHEZ_AWA_MENU_ITEMS } from './data/restaumaxData';
import { RestauMenuItem, ClientCartItem, RestaurantInfo } from './types/restaumax';
import { 
  subscribeToRestaurant, 
  subscribeToMenuItems, 
  persistMenuItem, 
  persistDishAvailability, 
  testConnection,
  signInManager,
  signOutManager,
  subscribeToAuth,
  type User
} from './lib/firebase';
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

export default function App() {
  // Navigation / Routing State
  const [currentPath, setCurrentPath] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const fullPath = window.location.pathname + window.location.search;
      return fullPath || '/';
    }
    return '/';
  });

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
  const [tables, setTables] = useState<Table[]>(INITIAL_TABLES);
  const [selectedTable, setSelectedTable] = useState<Table | null>(tables[1]);
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

  // Firestore Realtime Synchronization & Initial Boot Seed
  useEffect(() => {
    let isMounted = true;

    // 1. Connection probe (read-only)
    testConnection().catch((err) => console.warn('Firestore test connection:', err));

    // 2. Subscribe to Restaurant document
    const unsubRestaurant = subscribeToRestaurant('chez-awa', (updatedRestaurant) => {
      if (isMounted && updatedRestaurant) {
        setRestaurant(updatedRestaurant);
      }
    });

    // 3. Subscribe to Menu Items subcollection (reflects real state including empty catalog)
    const unsubMenuItems = subscribeToMenuItems('chez-awa', (items) => {
      if (isMounted) {
        setRestauMenuItems(items);
      }
    });

    return () => {
      isMounted = false;
      unsubRestaurant();
      unsubMenuItems();
    };
  }, []);

  // RestauMax Authentication & Manager Authorization State
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [isAuthorizedManager, setIsAuthorizedManager] = useState<boolean>(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState<boolean>(true);

  // Subscribe to Firebase Auth and evaluate Manager privileges
  useEffect(() => {
    const unsubAuth = subscribeToAuth((user, isManager) => {
      setAuthUser(user);
      setIsAuthorizedManager(isManager);
      setIsLoadingAuth(false);
    });

    return () => unsubAuth();
  }, []);

  const handleManagerLogin = async (email: string, pass: string): Promise<{ success: boolean; error?: string }> => {
    const res = await signInManager(email, pass);
    if (res.success && res.user) {
      setAuthUser(res.user);
      setIsAuthorizedManager(true);
      return { success: true };
    }
    return { success: false, error: res.error };
  };

  const handleManagerSignOut = async () => {
    await signOutManager();
    setAuthUser(null);
    setIsAuthorizedManager(false);
  };

  // RestauMax Client Cart State (Preserved across routing)
  const [clientCart, setClientCart] = useState<ClientCartItem[]>([]);

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
    persistDishAvailability('chez-awa', dishId, nextAvailable).catch((err) => {
      console.error('Erreur de persistance de la disponibilité dans Firestore:', err);
    });
  };

  const handleCreateDish = (newDish: RestauMenuItem) => {
    // Optimistic local state update
    setRestauMenuItems((prev) => [newDish, ...prev]);

    // Asynchronous Firestore persistence
    persistMenuItem('chez-awa', newDish).catch((err) => {
      console.error('Erreur de persistance du nouveau plat dans Firestore:', err);
    });
  };

  const handleUpdateDish = (updatedDish: RestauMenuItem) => {
    // Optimistic local state update
    setRestauMenuItems((prev) =>
      prev.map((item) => (item.id === updatedDish.id ? updatedDish : item))
    );

    // Asynchronous Firestore persistence
    persistMenuItem('chez-awa', updatedDish).catch((err) => {
      console.error('Erreur de mise à jour du plat dans Firestore:', err);
    });
  };

  const handleClientAddToCart = (newItem: ClientCartItem): boolean => {
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
    setClientCart((prev) => prev.filter((item) => item.id !== cartItemId));
  };

  const handleClearClientCart = () => {
    setClientCart([]);
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

  const handleSendToKitchen = () => {
    if (cart.length === 0) return;
    const ticketNumber = `#T-${Math.floor(100 + Math.random() * 900)}`;
    const tableName = selectedTable ? selectedTable.name : 'Vente Directe';

    const newTicket: KitchenTicket = {
      id: `kt-${Date.now()}`,
      ticketNumber,
      tableNumber: tableName,
      orderType: selectedTable ? 'sur_place' : 'emporter',
      waiter: serverName,
      createdAt: new Date(),
      status: 'in_prep',
      items: cart.map((item, idx) => ({
        id: `ki-${Date.now()}-${idx}`,
        name: item.menuItem.name,
        quantity: item.quantity,
        course: item.course,
        notes: item.specialInstructions,
        completed: false
      }))
    };

    setKitchenTickets((prev) => [newTicket, ...prev]);
    alert(`Commande envoyée en cuisine ! Ticket ${ticketNumber}`);
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
  };

  const handleSelectTableForOrder = (table: Table) => {
    setSelectedTable(table);
    setCurrentRole('pos');
  };

  const handleUpdateTableStatus = (tableId: string, status: TableStatus, covers?: number) => {
    setTables((prev) =>
      prev.map((t) =>
        t.id === tableId ? { ...t, status, covers: covers ?? t.covers } : t
      )
    );
  };

  const isClientMenuRoute = activePathname.startsWith('/r/');
  const isStaffRoute = activePathname === '/staff';
  const isRestaurantHubRoute = activePathname.startsWith('/gestion');
  const isHomePageRoute = !isClientMenuRoute && !isStaffRoute && !isRestaurantHubRoute;

  const activeTicketsCount = kitchenTickets.filter((t) => t.status === 'in_prep' || t.status === 'ready').length;

  return (
    <div className="min-h-screen flex flex-col bg-[#f4f7fb] text-[#181c1f]">
      {/* Test / URL Switcher Simulator Bar at Top */}
      <UrlSimulatorBar
        currentPath={currentPath}
        onNavigate={navigateTo}
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
          onNavigateHome={() => navigateTo('/')}
          onSelectTableDemo={(tbl) => {
            if (tbl) {
              navigateTo(`/r/chez-awa?table=${tbl}`);
            } else {
              navigateTo('/r/chez-awa');
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
            onBackToMenu={() => navigateTo('/r/chez-awa')}
            restaurantName={restaurant.name}
          />
        ) : (
          <RestaurantHubView
            restaurant={restaurant}
            menuItems={restauMenuItems}
            menuItemsCount={restauMenuItems.length}
            tablesCount={tables.length}
            activeKitchenTicketsCount={activeTicketsCount}
            totalSessionSales={drawerState.totalSales}
            onNavigateHome={() => navigateTo('/')}
            onNavigateToClientMenu={() => navigateTo('/r/chez-awa')}
            onNavigateToStaffRole={(role) => {
              setCurrentRole(role);
              navigateTo('/staff');
            }}
            onToggleDishAvailability={handleToggleDishAvailability}
            onCreateDish={handleCreateDish}
            onUpdateDish={handleUpdateDish}
            currentUserEmail={authUser?.email}
            onSignOut={handleManagerSignOut}
          />
        )
      )}

      {/* 3. RestauMax Home Landing Page: / */}
      {isHomePageRoute && (
        <HomePage
          onGoToMenuWithTable={(tbl) => {
            if (tbl) {
              navigateTo(`/r/chez-awa?table=${tbl}`);
            } else {
              navigateTo('/r/chez-awa');
            }
          }}
          onGoToStaffTools={() => navigateTo('/staff')}
          onGoToManagementHub={() => navigateTo('/gestion')}
        />
      )}

      {/* 4. Staff Internal Workspaces: /staff */}
      {isStaffRoute && (
        <div className="flex-1 flex flex-col">
          <Header
            currentRole={currentRole}
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
            {currentRole === 'pos' && (
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
                onOpenPayment={() => setIsPaymentModalOpen(true)}
                serverName={serverName}
              />
            )}

            {currentRole === 'floor' && (
              <FloorView
                tables={tables}
                onSelectTableForOrder={handleSelectTableForOrder}
                onUpdateTableStatus={handleUpdateTableStatus}
                serverName={serverName}
              />
            )}

            {currentRole === 'kds' && (
              <KdsView
                tickets={kitchenTickets}
                onToggleItemComplete={handleToggleKdsItem}
                onUpdateTicketStatus={handleUpdateTicketStatus}
              />
            )}

            {currentRole === 'manager' && (
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
      )}
    </div>
  );
}
