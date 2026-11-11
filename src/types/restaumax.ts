export interface MenuOptionItem {
  id: string;
  name: string;
  extraPrice: number; // in FCFA (e.g. 0 for included, 500 for Alloco)
  isDefault?: boolean;
}

export interface MenuOptionGroup {
  id: string;
  name: string; // e.g. "Choix d'accompagnement"
  required: boolean;
  options: MenuOptionItem[];
}

export interface MenuExtra {
  id: string;
  name: string; // e.g. "Sauce piment maison", "Double oignons"
  price: number; // in FCFA
}

export interface RestauMenuItem {
  id: string;
  restaurantSlug: string;
  name: string;
  category: 'grillades' | 'plats' | 'entrees' | 'accompagnements' | 'boissons' | 'desserts';
  price: number; // in FCFA
  description: string;
  imageUrl: string;
  available: boolean;
  /** When enabled, the remaining sellable portions are enforced server-side. */
  trackStock?: boolean;
  stockQuantity?: number;
  /** Alert threshold for the sellable portions of this menu item. */
  lowStockThreshold?: number;
  /** Public menu details; recipe costs remain in the private menuRecipes collection. */
  allergens?: string[];
  spiceLevel?: 0 | 1 | 2 | 3;
  pairings?: string[];
  translations?: {
    en?: { name?: string; description?: string };
    pt?: { name?: string; description?: string };
  };
  prepTimeMinutes: number;
  optionGroups?: MenuOptionGroup[];
  availableExtras?: MenuExtra[];
  tags?: string[];
}

export interface SelectedOption {
  groupId: string;
  groupName: string;
  optionId: string;
  optionName: string;
  extraPrice: number;
}

export interface SelectedExtra {
  extraId: string;
  name: string;
  price: number;
}

export interface ClientCartItem {
  id: string; // unique cart line ID
  menuItemId: string;
  name: string;
  basePrice: number;
  unitPrice: number; // basePrice + selectedOption.extraPrice + extras
  quantity: number;
  selectedOption?: SelectedOption;
  selectedExtras: SelectedExtra[];
  prepNotes?: string;
  imageUrl: string;
}

export interface RestaurantInfo {
  slug: string;
  name: string;
  tagline: string;
  address: string;
  city: string;
  phone: string;
  currency: 'FCFA';
  bannerUrl: string;
  logoUrl: string;
  isOpen: boolean;
  openingHours: string;
  taxRatePercent?: number;
  taxMode?: 'exclusive' | 'inclusive';
  loyaltyFcfaPerPoint?: number;
  receiptFooter?: string;
  receiptPaperWidth?: '58mm' | '80mm';
}

export type OrderMode = 'sur_place' | 'a_emporter';

export type RestauOrderStatus = 'pending' | 'in_prep' | 'ready' | 'completed' | 'cancelled';

export interface OrderItemOption {
  groupId: string;
  groupName: string;
  optionId: string;
  optionName: string;
  extraPrice: number;
}

export interface OrderItemExtra {
  extraId: string;
  name: string;
  price: number;
}

export interface RestauOrderItem {
  id: string;
  menuItemId: string;
  name: string;
  /** Trusted catalogue category snapshot used by kitchen station routing. */
  category?: string;
  basePrice: number;
  unitPrice: number;
  quantity: number;
  /** Server-verified menu stock tracking snapshot. */
  trackStock?: boolean;
  totalPrice: number;
  selectedOption?: OrderItemOption;
  selectedExtras?: OrderItemExtra[];
  prepNotes?: string;
}

export interface RestauGuestAccount {
  id: string;
  guestNumber: number;
  guestName: string;
  shareAmount: number;
  paidAmount: number;
  remainingAmount: number;
  paymentStatus: 'unpaid' | 'partial' | 'paid';
}

export interface RestauOrder {
  id: string;
  orderNumber: string;
  restaurantSlug: string;
  orderMode: OrderMode;
  tableNumber: string | null;
  /** Server assigned to the table when the order was created. */
  assignedWaiterUid?: string | null;
  items: RestauOrderItem[];
  itemsCount: number;
  customerName?: string;
  customerPhone?: string;
  customerPhoneNormalized?: string;
  loyaltyPointsAwarded?: number;
  loyaltyCustomerId?: string;
  loyaltyAwardedAt?: number;
  loyaltyAwardStatus?: string;
  totalAmount: number; // final amount due in FCFA, including configured tax
  subtotalAmount?: number;
  taxAmount?: number;
  taxRatePercent?: number;
  taxMode?: 'exclusive' | 'inclusive';
  paidAmount?: number;
  refundedAmount?: number;
  netPaidAmount?: number;
  remainingAmount?: number;
  paymentStatus?: 'partial' | 'paid' | 'unpaid';
  /** Customer's requested settlement method; cash is only marked paid after staff records receipt. */
  paymentPreference?: 'especes' | 'mobile_money';
  paymentPreferenceSource?: 'customer_qr' | 'staff';
  paymentPreferenceUpdatedAt?: number;
  splitGuests?: number;
  guestAccounts?: RestauGuestAccount[];
  lastPaymentAt?: number;
  lastPaymentId?: string;
  currency: 'FCFA';
  status: RestauOrderStatus;
  customerNote?: string;
  createdAt: number; // UTC timestamp ms
  createdAtIso: string;
  statusUpdatedAt?: number;
  statusHistory?: Array<{ status: RestauOrderStatus; changedAt: number; reason?: string }>;
  cancellationReason?: string;
  cancelledAt?: number;
  cancelledBy?: string;
  /** Per-line KDS completion state, keyed by stable zero-based order item index. */
  kitchenItemCompletion?: Record<string, boolean>;
  kitchenItemsCompletedCount?: number;
  kitchenItemUpdatedAt?: number;
  kitchenItemUpdatedBy?: string;
  /** Server-computed stock result after entering preparation. */
  stockTrackingStatus?: 'applied' | 'partial' | 'skipped' | 'restored';
  stockUntrackedItemIds?: string[];
  idempotencyKey?: string;
  idempotencyDocId?: string;
  contentSignature?: string;
  /** Hashed one-order capability; never returned to public clients. */
  customerAccessTokenHash?: string;
}

export interface RestaurantTable {
  id: string; // e.g. "table-4" or "4"
  tableNumber: string; // e.g. "4", "12", "Terrasse A"
  section: 'salle' | 'terrasse' | 'bar' | 'vip';
  capacity: number;
  isActive: boolean;
  qrUrl?: string;
  status?: 'available' | 'occupied' | 'billing' | 'reserved';
  currentOrderId?: string;
  currentTotal?: number;
  assignedWaiter?: string;
  covers?: number;
  seatedAt?: number;
}

