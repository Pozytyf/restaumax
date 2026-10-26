import React, { useState } from 'react';
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
import { sounds } from './utils/audio';
import { Header } from './components/Header';
import { PosView } from './components/pos/PosView';
import { PaymentModal } from './components/pos/PaymentModal';
import { ReceiptModal } from './components/pos/ReceiptModal';
import { FloorView } from './components/floor/FloorView';
import { KdsView } from './components/kds/KdsView';
import { ManagerView } from './components/manager/ManagerView';

export default function App() {
  const [currentRole, setCurrentRole] = useState<Role>('pos');
  const [menuItems, setMenuItems] = useState<MenuItem[]>(INITIAL_MENU_ITEMS);
  const [tables, setTables] = useState<Table[]>(INITIAL_TABLES);
  const [selectedTable, setSelectedTable] = useState<Table | null>(tables[1]); // Pre-select Table 02
  const [cart, setCart] = useState<CartItem[]>([
    {
      id: 'cart-1',
      menuItem: INITIAL_MENU_ITEMS[0], // Capitaine braisé
      quantity: 1,
      course: 'plat',
      specialInstructions: 'Sauce piment à part'
    },
    {
      id: 'cart-2',
      menuItem: INITIAL_MENU_ITEMS[8], // Alloco plantain
      quantity: 2,
      course: 'plat'
    },
    {
      id: 'cart-3',
      menuItem: INITIAL_MENU_ITEMS[11], // Cocktail Bissap
      quantity: 2,
      course: 'boisson'
    }
  ]);
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
        { name: 'Alloco Banane Plantain Dorée', quantity: 2, price: 2500 },
        { name: 'Bière Ivoire Spéciale 50cl', quantity: 1, price: 2000 }
      ]
    },
    {
      id: 'tx-2',
      orderId: '#T-098',
      tableNumber: 'Terrasse 07',
      waiter: 'Yao F.',
      timestamp: new Date(Date.now() - 65 * 60 * 1000),
      subtotal: 58500,
      discount: 5000,
      tax: 0,
      total: 53500,
      paidAmount: 53500,
      changeAmount: 0,
      paymentMethod: 'wave',
      items: [
        { name: 'Gambas Royales Flambées au Pastis', quantity: 2, price: 18000 },
        { name: 'Filet de Bœuf Sauce Poivre Vert', quantity: 1, price: 16000 },
        { name: 'Cocktail Hibiscus Bissap & Menthe', quantity: 3, price: 2500 }
      ]
    }
  ]);

  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [activeReceiptModal, setActiveReceiptModal] = useState<PaymentRecord | null>(null);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const serverName = 'Moussa D.';

  // Audio Toggle
  const handleToggleAudio = () => {
    sounds.enabled = !audioEnabled;
    setAudioEnabled(!audioEnabled);
  };

  // Cart Management
  const handleAddToCart = (dish: MenuItem) => {
    setCart((prev) => {
      const existing = prev.find((item) => item.menuItem.id === dish.id);
      if (existing) {
        return prev.map((item) =>
          item.menuItem.id === dish.id
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      } else {
        const newItem: CartItem = {
          id: `ci-${Date.now()}-${dish.id}`,
          menuItem: dish,
          quantity: 1,
          course: dish.course
        };
        return [...prev, newItem];
      }
    });
  };

  const handleUpdateQuantity = (itemId: string, delta: number) => {
    setCart((prev) => {
      return prev
        .map((item) => {
          if (item.id === itemId) {
            const nextQty = item.quantity + delta;
            return nextQty > 0 ? { ...item, quantity: nextQty } : null;
          }
          return item;
        })
        .filter(Boolean) as CartItem[];
    });
  };

  const handleRemoveItem = (itemId: string) => {
    setCart((prev) => prev.filter((item) => item.id !== itemId));
  };

  const handleUpdateItemNotes = (itemId: string, notes: string) => {
    setCart((prev) =>
      prev.map((item) =>
        item.id === itemId ? { ...item, specialInstructions: notes } : item
      )
    );
  };

  const handleClearCart = () => {
    setCart([]);
    setDiscountPercent(0);
  };

  // Kitchen Order Firing
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

    // Update table status if selected
    if (selectedTable) {
      const orderSubtotal = cart.reduce((sum, item) => sum + item.menuItem.price * item.quantity, 0);
      setTables((prev) =>
        prev.map((t) =>
          t.id === selectedTable.id
            ? {
                ...t,
                status: 'occupied',
                currentTotal: (t.currentTotal || 0) + orderSubtotal,
                seatedAt: t.seatedAt || new Date(),
                assignedWaiter: serverName
              }
            : t
        )
      );
    }

    // Alert user with brief feedback
    alert(`Commande envoyée en cuisine avec succès ! Ticket ${ticketNumber}`);
  };

  // Payment Confirmation
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

    // Update cash drawer metrics
    setDrawerState((prev) => {
      const isCash = paymentData.method === 'especes';
      const isWaveOrOM = paymentData.method === 'wave' || paymentData.method === 'orange_money';
      const isCard = paymentData.method === 'carte';

      return {
        ...prev,
        totalSales: prev.totalSales + total,
        currentCash: prev.currentCash + (isCash ? total : 0),
        cashSales: prev.cashSales + (isCash ? total : 0),
        mobileMoneySales: prev.mobileMoneySales + (isWaveOrOM ? total : 0),
        cardSales: prev.cardSales + (isCard ? total : 0),
        discountsTotal: prev.discountsTotal + discountAmount,
        transactionCount: prev.transactionCount + 1
      };
    });

    // Update table status to available if was seated
    if (selectedTable) {
      setTables((prev) =>
        prev.map((t) =>
          t.id === selectedTable.id
            ? { ...t, status: 'available', currentTotal: 0, covers: undefined, seatedAt: undefined }
            : t
        )
      );
    }

    setTransactions((prev) => [newRecord, ...prev]);
    setIsPaymentModalOpen(false);
    setActiveReceiptModal(newRecord);
    setCart([]);
    setDiscountPercent(0);
  };

  // KDS Handlers
  const handleToggleKdsItem = (ticketId: string, itemId: string) => {
    setKitchenTickets((prev) =>
      prev.map((ticket) => {
        if (ticket.id === ticketId) {
          return {
            ...ticket,
            items: ticket.items.map((i) =>
              i.id === itemId ? { ...i, completed: !i.completed } : i
            )
          };
        }
        return ticket;
      })
    );
  };

  const handleUpdateTicketStatus = (ticketId: string, status: TicketStatus) => {
    setKitchenTickets((prev) =>
      prev.map((ticket) => {
        if (ticket.id === ticketId) {
          return { ...ticket, status };
        }
        return ticket;
      })
    );
  };

  // Floor View Handlers
  const handleSelectTableForOrder = (table: Table) => {
    setSelectedTable(table);
    setCurrentRole('pos');
  };

  const handleUpdateTableStatus = (tableId: string, status: TableStatus, covers?: number) => {
    setTables((prev) =>
      prev.map((t) => {
        if (t.id === tableId) {
          return {
            ...t,
            status,
            covers: covers ?? t.covers,
            seatedAt: status === 'occupied' && !t.seatedAt ? new Date() : t.seatedAt
          };
        }
        return t;
      })
    );
  };

  const handleQuickNewOrder = () => {
    setSelectedTable(null);
    setCart([]);
    setDiscountPercent(0);
    setCurrentRole('pos');
  };

  const activeKdsTicketsCount = kitchenTickets.filter(
    (t) => t.status === 'in_prep' || t.status === 'ready'
  ).length;

  return (
    <div className="min-h-screen flex flex-col bg-[#f4f7fb] text-[#181c1f]">
      {/* Strict Top Bar Contract Header */}
      <Header
        currentRole={currentRole}
        onSelectRole={(r) => {
          sounds.playTap();
          setCurrentRole(r);
        }}
        audioEnabled={audioEnabled}
        onToggleAudio={handleToggleAudio}
        onQuickNewOrder={handleQuickNewOrder}
        kitchenTicketsCount={activeKdsTicketsCount}
      />

      {/* Screen Views */}
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
            onClearCart={handleClearCart}
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

      {/* Payment Numpad Modal */}
      <PaymentModal
        isOpen={isPaymentModalOpen}
        onClose={() => setIsPaymentModalOpen(false)}
        cart={cart}
        selectedTable={selectedTable}
        serverName={serverName}
        discountPercent={discountPercent}
        onConfirmPayment={handleConfirmPayment}
      />

      {/* Printable Thermal Receipt Modal */}
      <ReceiptModal
        receipt={activeReceiptModal}
        onClose={() => setActiveReceiptModal(null)}
      />
    </div>
  );
}
