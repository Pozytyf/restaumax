export type Role = 'pos' | 'floor' | 'kds' | 'manager';

export type Category = 
  | 'tous'
  | 'grillades'
  | 'plats'
  | 'entrees'
  | 'accompagnements'
  | 'boissons'
  | 'desserts';

export interface MenuItem {
  id: string;
  name: string;
  category: Category;
  price: number; // in FCFA
  description: string;
  imageUrl: string;
  available: boolean;
  prepTimeMinutes: number;
  course: 'entree' | 'plat' | 'boisson' | 'dessert';
  tags?: string[];
}

export interface CartItem {
  id: string;
  menuItem: MenuItem;
  quantity: number;
  specialInstructions?: string;
  course: 'entree' | 'plat' | 'dessert' | 'boisson';
}

export type TableStatus = 'available' | 'occupied' | 'billing' | 'reserved';

export interface Table {
  id: string;
  number: string;
  name: string;
  zone: 'salle' | 'terrasse' | 'bar';
  capacity: number;
  status: TableStatus;
  currentOrderId?: string;
  currentTotal?: number;
  assignedWaiter?: string;
  seatedAt?: Date;
  covers?: number;
}

export type TicketStatus = 'in_prep' | 'ready' | 'served' | 'cancelled';

export interface KitchenItem {
  id: string;
  name: string;
  quantity: number;
  course: 'entree' | 'plat' | 'dessert' | 'boisson';
  notes?: string;
  completed: boolean;
}

export interface KitchenTicket {
  id: string;
  ticketNumber: string; // e.g. "#T-108"
  tableNumber: string;
  orderType: 'sur_place' | 'emporter' | 'livraison';
  waiter: string;
  createdAt: Date;
  status: TicketStatus;
  items: KitchenItem[];
  urgent?: boolean;
}

export type PaymentMethod = 'especes' | 'wave' | 'orange_money' | 'carte';

export interface PaymentRecord {
  id: string;
  orderId: string;
  tableNumber: string;
  waiter: string;
  timestamp: Date;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  paidAmount: number;
  changeAmount: number;
  paymentMethod: PaymentMethod;
  items: { name: string; quantity: number; price: number }[];
}

export interface CashDrawerState {
  openingBalance: number;
  currentCash: number;
  totalSales: number;
  cashSales: number;
  mobileMoneySales: number;
  cardSales: number;
  discountsTotal: number;
  transactionCount: number;
}
