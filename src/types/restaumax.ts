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
