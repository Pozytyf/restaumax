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
  basePrice: number;
  unitPrice: number;
  quantity: number;
  totalPrice: number;
  selectedOption?: OrderItemOption;
  selectedExtras?: OrderItemExtra[];
  prepNotes?: string;
}

export interface RestauOrder {
  id: string;
  orderNumber: string;
  restaurantSlug: string;
  orderMode: OrderMode;
  tableNumber: string | null;
  items: RestauOrderItem[];
  itemsCount: number;
  totalAmount: number; // in FCFA
  currency: 'FCFA';
  status: RestauOrderStatus;
  customerNote?: string;
  createdAt: number; // UTC timestamp ms
  createdAtIso: string;
  statusUpdatedAt?: number;
}

export interface RestaurantTable {
  id: string; // e.g. "table-4" or "4"
  tableNumber: string; // e.g. "4", "12", "Terrasse A"
  section: 'salle' | 'terrasse' | 'bar' | 'vip';
  capacity: number;
  isActive: boolean;
  qrUrl?: string;
}

