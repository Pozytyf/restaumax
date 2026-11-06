import type { MenuOptionGroup, MenuExtra, SelectedOption, SelectedExtra } from './restaumax';
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
  optionGroups?: MenuOptionGroup[];
  availableExtras?: MenuExtra[];
}

export interface CartItem {
  id: string;
  menuItem: MenuItem;
  quantity: number;
  specialInstructions?: string;
  /** Sélection composite : les identifiants de groupes/options sont concaténés dans l'ordre du catalogue. */
  selectedOption?: SelectedOption;
  /** Suppléments du catalogue, conservés séparément pour le recalcul serveur et le ticket cuisine. */
  selectedExtras?: SelectedExtra[];
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

export type PaymentMethod = 'especes' | 'wave' | 'orange_money' | 'mtn_money' | 'moov_money' | 'djamo' | 'carte';

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
  tenderedAmount?: number;
  previouslyPaidAmount?: number;
  changeAmount: number;
  remainingAmount?: number;
  paymentStatus?: 'partial' | 'paid';
  splitGuests?: number;
  guestNumber?: number;
  guestName?: string;
  guestShareAmount?: number;
  guestPreviouslyPaidAmount?: number;
  guestRemainingAfter?: number;
  paymentMethod: PaymentMethod;
  refundedAmount?: number;
  refundPendingAmount?: number;
  refundStatus?: string;
  refundEligible?: boolean;
  providerChannel?: string;
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
