import React, { useState, useEffect } from 'react';
import { 
  X, 
  Plus, 
  Trash2, 
  Clock, 
  Sparkles, 
  SlidersHorizontal, 
  PlusCircle, 
  Check, 
  AlertCircle, 
  UtensilsCrossed,
  Image as ImageIcon
} from 'lucide-react';
import { 
  RestauMenuItem, 
  MenuOptionGroup, 
  MenuExtra, 
  RestaurantInfo 
} from '../../types/restaumax';
import { sounds } from '../../utils/audio';

export interface DishFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  dishToEdit: RestauMenuItem | null;
  restaurant: RestaurantInfo;
  onSave: (dish: RestauMenuItem) => void;
}

const CATEGORY_OPTIONS: { id: RestauMenuItem['category']; label: string }[] = [
  { id: 'grillades', label: 'Grillades & Braisés' },
  { id: 'plats', label: 'Plats Cuisinés & Sauces' },
  { id: 'entrees', label: 'Entrées & Alloco' },
  { id: 'accompagnements', label: 'Accompagnements' },
  { id: 'boissons', label: 'Boissons & Jus Locaux' },
  { id: 'desserts', label: 'Desserts & Douceurs' },
];

/**
 * Internal form item types allowing raw string inputs
 * to prevent silent conversion of invalid inputs (negatives, decimals, text)
 */
interface FormOptionItem {
  id: string;
  name: string;
  extraPrice: string; // raw input string
  isDefault?: boolean;
}

interface FormOptionGroup {
  id: string;
  name: string;
  required: boolean;
  options: FormOptionItem[];
}

interface FormExtra {
  id: string;
  name: string;
  price: string; // raw input string
}

export const DishFormModal: React.FC<DishFormModalProps> = ({
  isOpen,
  onClose,
  dishToEdit,
  restaurant,
  onSave,
}) => {
  const isEditing = Boolean(dishToEdit);

  // Form Fields State
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<RestauMenuItem['category']>('grillades');
  const [price, setPrice] = useState<string>('');
  const [prepTimeMinutes, setPrepTimeMinutes] = useState<string>('20');
  const [imageUrl, setImageUrl] = useState('');
  const [available, setAvailable] = useState(true);
  const [tagsInput, setTagsInput] = useState('');
  const [optionGroups, setOptionGroups] = useState<FormOptionGroup[]>([]);
  const [extras, setExtras] = useState<FormExtra[]>([]);

  // Validation Errors State
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState(false);
  const [imageLoadError, setImageLoadError] = useState(false);

  // Initialize or reset form when modal opens or dish changes
  useEffect(() => {
    if (!isOpen) return;

    if (dishToEdit) {
      setName(dishToEdit.name || '');
      setDescription(dishToEdit.description || '');
      setCategory(dishToEdit.category || 'grillades');
      setPrice(dishToEdit.price !== undefined ? dishToEdit.price.toString() : '');
      setPrepTimeMinutes(dishToEdit.prepTimeMinutes !== undefined ? dishToEdit.prepTimeMinutes.toString() : '20');
      // Preserver l'URL existante lors de la modification
      setImageUrl(dishToEdit.imageUrl || '');
      setAvailable(dishToEdit.available !== false);
      setTagsInput(dishToEdit.tags ? dishToEdit.tags.join(', ') : '');
      setOptionGroups(
        dishToEdit.optionGroups
          ? dishToEdit.optionGroups.map((grp) => ({
              id: grp.id,
              name: grp.name,
              required: grp.required,
              options: grp.options.map((opt) => ({
                id: opt.id,
                name: opt.name,
                extraPrice: opt.extraPrice.toString(),
                isDefault: opt.isDefault,
              })),
            }))
          : []
      );
      setExtras(
        dishToEdit.availableExtras
          ? dishToEdit.availableExtras.map((ext) => ({
              id: ext.id,
              name: ext.name,
              price: ext.price.toString(),
            }))
          : []
      );
    } else {
      // Correction 2: URL vide à la création (aucun préremplissage Unsplash)
      setName('');
      setDescription('');
      setCategory('plats');
      setPrice('');
      setPrepTimeMinutes('20');
      setImageUrl('');
      setAvailable(true);
      setTagsInput('');
      setOptionGroups([]);
      setExtras([]);
    }
    setErrors({});
    setTouched(false);
    setImageLoadError(false);
  }, [isOpen, dishToEdit]);

  if (!isOpen) return null;

  // Validation function
  const validateForm = (): boolean => {
    const errs: Record<string, string> = {};

    // 1. Nom
    if (!name.trim()) {
      errs.name = 'Le nom du plat est obligatoire.';
    }

    // 2. Description
    if (!description.trim()) {
      errs.description = 'La description du plat est obligatoire.';
    }

    // 3. Prix de base
    const rawPrice = price.trim();
    const numPrice = Number(rawPrice);
    if (!rawPrice || isNaN(numPrice)) {
      errs.price = 'Le prix de base est obligatoire et doit être un nombre valide.';
    } else if (numPrice <= 0) {
      errs.price = 'Le prix doit être strictement supérieur à 0 FCFA.';
    } else if (!Number.isInteger(numPrice)) {
      errs.price = 'Le prix doit être un nombre entier en FCFA (sans décimale).';
    }

    // 4. Temps de préparation
    const rawPrep = prepTimeMinutes.trim();
    const numPrep = Number(rawPrep);
    if (!rawPrep || isNaN(numPrep)) {
      errs.prepTimeMinutes = 'Le temps de préparation doit être un nombre valide.';
    } else if (numPrep <= 0) {
      errs.prepTimeMinutes = 'Le temps de préparation doit être au minimum de 1 minute.';
    } else if (!Number.isInteger(numPrep)) {
      errs.prepTimeMinutes = 'Le temps de préparation doit être un nombre entier de minutes.';
    }

    // 5. URL de l'image (Vérification 3 - Validation robuste via constructeur URL)
    const trimmedUrl = imageUrl.trim();
    if (!trimmedUrl) {
      errs.imageUrl = "L'adresse URL de l'image est obligatoire.";
    } else {
      try {
        const parsed = new URL(trimmedUrl);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          errs.imageUrl = "L'URL de l'image doit commencer par http:// ou https://.";
        } else if (
          !parsed.hostname ||
          parsed.hostname.length === 0 ||
          (!parsed.hostname.includes('.') && parsed.hostname !== 'localhost')
        ) {
          errs.imageUrl = "L'URL de l'image doit comporter un nom de domaine valide (ex. https://domaine.com/photo.jpg).";
        }
      } catch {
        errs.imageUrl = "L'URL de l'image est mal formée. Veuillez saisir une adresse web valide (ex. https://...).";
      }
    }

    // 6. Groupes d'options
    optionGroups.forEach((group, gIdx) => {
      if (!group.name.trim()) {
        errs[`group_${gIdx}_name`] = `Le nom du groupe d'options #${gIdx + 1} est obligatoire.`;
      }
      if (group.required && (!group.options || group.options.length === 0)) {
        errs[`group_${gIdx}_options`] = `Un groupe obligatoire doit comporter au moins une option de choix.`;
      }
      group.options.forEach((opt, oIdx) => {
        if (!opt.name.trim()) {
          errs[`group_${gIdx}_opt_${oIdx}_name`] = `Le nom de l'option #${oIdx + 1} dans "${group.name || `Groupe ${gIdx + 1}`}" est requis.`;
        }
        // Correction 1: Contrôle précis du prix de l'option sans conversion silencieuse
        const rawOptPrice = opt.extraPrice.trim();
        const numOptPrice = Number(rawOptPrice);
        if (rawOptPrice === '' || isNaN(numOptPrice)) {
          errs[`group_${gIdx}_opt_${oIdx}_price`] = `Le supplément de l'option doit être un nombre valide (0 FCFA si inclus).`;
        } else if (numOptPrice < 0) {
          errs[`group_${gIdx}_opt_${oIdx}_price`] = `Le supplément ne peut pas être négatif.`;
        } else if (!Number.isInteger(numOptPrice)) {
          errs[`group_${gIdx}_opt_${oIdx}_price`] = `Le supplément doit être un nombre entier en FCFA (sans décimale).`;
        }
      });
    });

    // 7. Suppléments
    extras.forEach((ext, eIdx) => {
      if (!ext.name.trim()) {
        errs[`extra_${eIdx}_name`] = `Le nom du supplément #${eIdx + 1} est requis.`;
      }
      // Correction 1: Contrôle précis du prix du supplément sans conversion silencieuse
      const rawExtPrice = ext.price.trim();
      const numExtPrice = Number(rawExtPrice);
      if (rawExtPrice === '' || isNaN(numExtPrice)) {
        errs[`extra_${eIdx}_price`] = `Le prix du supplément doit être un nombre valide.`;
      } else if (numExtPrice < 0) {
        errs[`extra_${eIdx}_price`] = `Le prix du supplément ne peut pas être négatif.`;
      } else if (!Number.isInteger(numExtPrice)) {
        errs[`extra_${eIdx}_price`] = `Le prix du supplément doit être un nombre entier en FCFA (sans décimale).`;
      }
    });

    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);

    if (!validateForm()) {
      sounds.playAlert();
      return;
    }

    // Parse clean tags
    const tags = tagsInput
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0)
      .filter((t, idx, arr) => arr.indexOf(t) === idx); // Remove duplicates

    const dishId = dishToEdit?.id || `dish-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    // Build finalized option groups with integer numbers
    const savedOptionGroups: MenuOptionGroup[] | undefined =
      optionGroups.length > 0
        ? optionGroups.map((g) => ({
            id: g.id,
            name: g.name.trim(),
            required: g.required,
            options: g.options.map((o) => ({
              id: o.id,
              name: o.name.trim(),
              extraPrice: Math.round(Number(o.extraPrice)),
              isDefault: Boolean(o.isDefault),
            })),
          }))
        : undefined;

    // Build finalized extras with integer numbers
    const savedExtras: MenuExtra[] | undefined =
      extras.length > 0
        ? extras.map((e) => ({
            id: e.id,
            name: e.name.trim(),
            price: Math.round(Number(e.price)),
          }))
        : undefined;

    const savedDish: RestauMenuItem = {
      id: dishId,
      restaurantSlug: dishToEdit?.restaurantSlug || restaurant.slug || 'chez-awa',
      name: name.trim(),
      description: description.trim(),
      category,
      price: Math.round(Number(price)),
      prepTimeMinutes: Math.round(Number(prepTimeMinutes)),
      imageUrl: imageUrl.trim(),
      available,
      tags: tags.length > 0 ? tags : undefined,
      optionGroups: savedOptionGroups,
      availableExtras: savedExtras,
    };

    sounds.playTap();
    onSave(savedDish);
    onClose();
  };

  // Option Groups Handlers
  const handleAddOptionGroup = () => {
    sounds.playTap();
    const newGroup: FormOptionGroup = {
      id: `grp-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      name: '',
      required: true,
      options: [
        {
          id: `opt-${Date.now()}-1`,
          name: '',
          extraPrice: '0',
          isDefault: true,
        },
      ],
    };
    setOptionGroups([...optionGroups, newGroup]);
  };

  const handleRemoveOptionGroup = (groupIndex: number) => {
    sounds.playTap();
    setOptionGroups(optionGroups.filter((_, idx) => idx !== groupIndex));
  };

  const handleUpdateGroupName = (groupIndex: number, newName: string) => {
    const updated = [...optionGroups];
    updated[groupIndex].name = newName;
    setOptionGroups(updated);
  };

  const handleToggleGroupRequired = (groupIndex: number) => {
    sounds.playTap();
    const updated = [...optionGroups];
    updated[groupIndex].required = !updated[groupIndex].required;
    setOptionGroups(updated);
  };

  const handleAddOptionToGroup = (groupIndex: number) => {
    sounds.playTap();
    const updated = [...optionGroups];
    const newOpt: FormOptionItem = {
      id: `opt-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      name: '',
      extraPrice: '0',
      isDefault: updated[groupIndex].options.length === 0,
    };
    updated[groupIndex].options.push(newOpt);
    setOptionGroups(updated);
  };

  const handleRemoveOptionFromGroup = (groupIndex: number, optionIndex: number) => {
    sounds.playTap();
    const updated = [...optionGroups];
    const removedWasDefault = updated[groupIndex].options[optionIndex]?.isDefault;
    updated[groupIndex].options = updated[groupIndex].options.filter((_, idx) => idx !== optionIndex);
    // If the removed option was default, set the first option as default if exists
    if (removedWasDefault && updated[groupIndex].options.length > 0) {
      updated[groupIndex].options[0].isDefault = true;
    }
    setOptionGroups(updated);
  };

  // Correction 1: Conserve la valeur brute saisie par l'utilisateur sans la transformer
  const handleUpdateOption = (
    groupIndex: number,
    optionIndex: number,
    field: keyof FormOptionItem,
    value: string | boolean
  ) => {
    const updated = [...optionGroups];
    const opt = { ...updated[groupIndex].options[optionIndex] };

    if (field === 'isDefault' && value === true) {
      // Ensure only one default option per group
      updated[groupIndex].options.forEach((o, i) => {
        o.isDefault = i === optionIndex;
      });
      setOptionGroups(updated);
      return;
    }

    if (field === 'extraPrice') {
      opt.extraPrice = String(value);
    } else if (field === 'name') {
      opt.name = String(value);
    }

    updated[groupIndex].options[optionIndex] = opt;
    setOptionGroups(updated);
  };

  // Extras Handlers
  const handleAddExtra = () => {
    sounds.playTap();
    const newExtra: FormExtra = {
      id: `ext-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      name: '',
      price: '500',
    };
    setExtras([...extras, newExtra]);
  };

  const handleRemoveExtra = (extraIndex: number) => {
    sounds.playTap();
    setExtras(extras.filter((_, idx) => idx !== extraIndex));
  };

  // Correction 1: Conserve la valeur brute saisie par l'utilisateur sans la transformer
  const handleUpdateExtra = (
    extraIndex: number,
    field: 'name' | 'price',
    value: string
  ) => {
    const updated = [...extras];
    if (field === 'price') {
      updated[extraIndex].price = String(value);
    } else {
      updated[extraIndex].name = String(value);
    }
    setExtras(updated);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs overflow-y-auto">
      <div 
        className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden my-6 border border-slate-200 flex flex-col max-h-[92vh] animate-in fade-in zoom-in-95 duration-150"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-dish-title"
      >
        {/* Header */}
        <div className="px-6 py-4 bg-[#101d2d] text-white flex items-center justify-between border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#ff6500]/20 text-[#ff6500] flex items-center justify-center font-bold">
              <UtensilsCrossed size={20} />
            </div>
            <div>
              <h2 id="modal-dish-title" className="text-base sm:text-lg font-black tracking-tight text-white">
                {isEditing ? `Modifier le plat : ${dishToEdit?.name}` : 'Nouveau plat au catalogue'}
              </h2>
              <p className="text-xs text-slate-300">
                {isEditing
                  ? 'Mise à jour des informations, tarifs et options du plat'
                  : 'Création d’une nouvelle spécialité pour le restaurant'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              sounds.playTap();
              onClose();
            }}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
            title="Fermer la fenêtre"
          >
            <X size={20} />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-6">
          {/* Global error banner if submitted with errors */}
          {touched && Object.keys(errors).length > 0 && (
            <div className="bg-rose-50 border border-rose-200 rounded-xl p-3.5 flex items-start gap-3 text-rose-800 text-xs">
              <AlertCircle size={18} className="text-rose-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">Veuillez corriger les champs invalides :</p>
                <ul className="list-disc list-inside mt-1 space-y-0.5 text-rose-700">
                  {Object.values(errors).slice(0, 4).map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                  {Object.values(errors).length > 4 && (
                    <li>Et {Object.values(errors).length - 4} autre(s) erreur(s)...</li>
                  )}
                </ul>
              </div>
            </div>
          )}

          {/* Section 1: Informations Générales */}
          <div className="space-y-4">
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-500 border-b border-slate-100 pb-2">
              1. Informations Générales
            </h3>

            {/* Nom & Catégorie */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Nom du plat <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="ex. Mérou Braisé du Pêcheur"
                  className={`w-full px-3.5 py-2.5 bg-slate-50 border rounded-xl text-xs font-medium focus:outline-none focus:ring-2 focus:bg-white transition-all ${
                    errors.name ? 'border-rose-400 focus:ring-rose-400 bg-rose-50/20' : 'border-slate-200 focus:ring-[#ff6500]'
                  }`}
                />
                {errors.name && <p className="text-[11px] text-rose-600 mt-1 font-medium">{errors.name}</p>}
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Catégorie du menu <span className="text-rose-500">*</span>
                </label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as RestauMenuItem['category'])}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-[#ff6500] focus:bg-white transition-all"
                >
                  {CATEGORY_OPTIONS.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Description */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Description du plat <span className="text-rose-500">*</span>
              </label>
              <textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Description appétissante, ingrédients principaux, saveurs et accompagnement inclus..."
                className={`w-full px-3.5 py-2.5 bg-slate-50 border rounded-xl text-xs font-medium focus:outline-none focus:ring-2 focus:bg-white transition-all ${
                  errors.description ? 'border-rose-400 focus:ring-rose-400 bg-rose-50/20' : 'border-slate-200 focus:ring-[#ff6500]'
                }`}
              />
              {errors.description && <p className="text-[11px] text-rose-600 mt-1 font-medium">{errors.description}</p>}
            </div>

            {/* Prix, Temps & Disponibilité */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-start">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Prix de base (FCFA) <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <input
                    type="number"
                    step="any"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    placeholder="ex. 12000"
                    className={`w-full pl-3.5 pr-14 py-2.5 bg-slate-50 border rounded-xl text-xs font-black text-[#ff6500] focus:outline-none focus:ring-2 focus:bg-white transition-all ${
                      errors.price ? 'border-rose-400 focus:ring-rose-400 bg-rose-50/20' : 'border-slate-200 focus:ring-[#ff6500]'
                    }`}
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-black text-slate-400">
                    FCFA
                  </span>
                </div>
                {errors.price && <p className="text-[11px] text-rose-600 mt-1 font-medium">{errors.price}</p>}
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Temps de préparation <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <input
                    type="number"
                    step="any"
                    value={prepTimeMinutes}
                    onChange={(e) => setPrepTimeMinutes(e.target.value)}
                    placeholder="ex. 20"
                    className={`w-full pl-3.5 pr-12 py-2.5 bg-slate-50 border rounded-xl text-xs font-medium focus:outline-none focus:ring-2 focus:bg-white transition-all ${
                      errors.prepTimeMinutes ? 'border-rose-400 focus:ring-rose-400 bg-rose-50/20' : 'border-slate-200 focus:ring-[#ff6500]'
                    }`}
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-400">
                    min
                  </span>
                </div>
                {errors.prepTimeMinutes && <p className="text-[11px] text-rose-600 mt-1 font-medium">{errors.prepTimeMinutes}</p>}
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Disponibilité immédiate
                </label>
                <button
                  type="button"
                  onClick={() => {
                    sounds.playTap();
                    setAvailable(!available);
                  }}
                  className={`w-full py-2.5 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-2 transition-all ${
                    available
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                      : 'bg-rose-50 border-rose-200 text-rose-700'
                  }`}
                >
                  <span className={`w-2.5 h-2.5 rounded-full ${available ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
                  <span>{available ? 'Disponible en ligne' : 'En rupture de stock'}</span>
                </button>
              </div>
            </div>

            {/* Image URL with live preview - Correction 2 & Vérification 3 */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                URL de l'image (photo du plat) <span className="text-rose-500">*</span>
              </label>
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="flex-1">
                  <input
                    type="url"
                    value={imageUrl}
                    onChange={(e) => {
                      setImageUrl(e.target.value);
                      setImageLoadError(false);
                    }}
                    placeholder="https://images.unsplash.com/..."
                    className={`w-full px-3.5 py-2.5 bg-slate-50 border rounded-xl text-xs font-medium focus:outline-none focus:ring-2 focus:bg-white transition-all ${
                      errors.imageUrl ? 'border-rose-400 focus:ring-rose-400 bg-rose-50/20' : 'border-slate-200 focus:ring-[#ff6500]'
                    }`}
                  />
                  {errors.imageUrl && <p className="text-[11px] text-rose-600 mt-1 font-medium">{errors.imageUrl}</p>}
                  <p className="text-[11px] text-slate-400 mt-1">
                    Lien HTTPS vers une image web (Unsplash, hébergeur ou CDN). Requis à la création.
                  </p>
                </div>

                {/* Preview Thumbnail */}
                <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-xl overflow-hidden bg-slate-100 border border-slate-200 shrink-0 flex items-center justify-center relative">
                  {imageUrl.trim() && !imageLoadError ? (
                    <img
                      src={imageUrl.trim()}
                      alt="Aperçu plat"
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                      onError={() => setImageLoadError(true)}
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center text-slate-400 text-center p-1">
                      <ImageIcon size={20} />
                      <span className="text-[9px] mt-0.5">Aperçu</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Tags / Badges */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Badges & Tags (séparés par des virgules)
              </label>
              <input
                type="text"
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                placeholder="ex. Signature, Recommandé, Épicé, Nouveauté"
                className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-[#ff6500] focus:bg-white transition-all"
              />
              <p className="text-[11px] text-slate-400 mt-1">
                Ces badges apparaîtront sur la fiche produit du menu client QR.
              </p>
            </div>
          </div>

          {/* Section 2: Groupes d'Options */}
          <div className="space-y-4 pt-2">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <div>
                <h3 className="text-xs font-black uppercase tracking-wider text-slate-500">
                  2. Groupes d'Options & Choix (ex. Accompagnements, Cuisson)
                </h3>
                <p className="text-[11px] text-slate-400">
                  Permet au client de choisir une garniture ou une cuisson personnalisée.
                </p>
              </div>
              <button
                type="button"
                onClick={handleAddOptionGroup}
                className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold transition-all flex items-center gap-1.5 active:scale-95"
              >
                <Plus size={14} className="text-[#ff6500]" />
                <span>Ajouter un groupe</span>
              </button>
            </div>

            {optionGroups.length === 0 ? (
              <div className="p-4 rounded-xl border border-dashed border-slate-200 bg-slate-50 text-center text-xs text-slate-500">
                Aucun groupe d’options défini pour ce plat (plat sans déclinaisons obligatoires).
              </div>
            ) : (
              <div className="space-y-4">
                {optionGroups.map((group, gIdx) => (
                  <div
                    key={group.id}
                    className="p-4 rounded-xl border border-slate-200 bg-slate-50/70 space-y-3"
                  >
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                      <div className="flex-1 w-full sm:w-auto">
                        <label className="block text-[11px] font-bold text-slate-600 mb-1">
                          Nom du groupe #{gIdx + 1}
                        </label>
                        <input
                          type="text"
                          value={group.name}
                          onChange={(e) => handleUpdateGroupName(gIdx, e.target.value)}
                          placeholder="ex. Choix de l'accompagnement"
                          className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold focus:outline-none focus:ring-2 focus:ring-[#ff6500]"
                        />
                        {errors[`group_${gIdx}_name`] && (
                          <p className="text-[10px] text-rose-600 mt-1 font-medium">
                            {errors[`group_${gIdx}_name`]}
                          </p>
                        )}
                      </div>

                      <div className="flex items-center gap-2 self-end sm:self-center">
                        <button
                          type="button"
                          onClick={() => handleToggleGroupRequired(gIdx)}
                          className={`px-2.5 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                            group.required
                              ? 'bg-amber-100 border-amber-300 text-amber-900'
                              : 'bg-white border-slate-200 text-slate-600'
                          }`}
                        >
                          {group.required ? '★ Obligatoire' : 'Facultatif'}
                        </button>

                        <button
                          type="button"
                          onClick={() => handleRemoveOptionGroup(gIdx)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                          title="Supprimer ce groupe"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>

                    {errors[`group_${gIdx}_options`] && (
                      <p className="text-[11px] text-rose-600 font-medium">
                        {errors[`group_${gIdx}_options`]}
                      </p>
                    )}

                    {/* Options list inside group */}
                    <div className="space-y-2.5 pt-2 border-t border-slate-200/60">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                          Choix possibles dans ce groupe
                        </span>
                        <button
                          type="button"
                          onClick={() => handleAddOptionToGroup(gIdx)}
                          className="text-[11px] font-bold text-[#ff6500] hover:text-[#e05800] flex items-center gap-1"
                        >
                          <Plus size={12} />
                          <span>Ajouter une option</span>
                        </button>
                      </div>

                      {group.options.map((opt, oIdx) => (
                        <div
                          key={opt.id}
                          className="bg-white p-2.5 rounded-lg border border-slate-200 space-y-1.5"
                        >
                          <div className="flex items-center gap-2">
                            <div className="flex-1">
                              <input
                                type="text"
                                value={opt.name}
                                onChange={(e) =>
                                  handleUpdateOption(gIdx, oIdx, 'name', e.target.value)
                                }
                                placeholder="ex. Attiéké de Grand-Lahou, Alloco doré..."
                                className={`w-full px-2.5 py-1 text-xs border rounded focus:outline-none focus:ring-1 focus:ring-[#ff6500] ${
                                  errors[`group_${gIdx}_opt_${oIdx}_name`] ? 'border-rose-400 bg-rose-50/20' : 'border-slate-200'
                                }`}
                              />
                            </div>

                            <div className="w-28 shrink-0 relative">
                              <input
                                type="number"
                                step="any"
                                value={opt.extraPrice}
                                onChange={(e) =>
                                  handleUpdateOption(gIdx, oIdx, 'extraPrice', e.target.value)
                                }
                                placeholder="0"
                                className={`w-full pl-2 pr-7 py-1 text-xs font-bold border rounded text-right focus:outline-none focus:ring-1 focus:ring-[#ff6500] ${
                                  errors[`group_${gIdx}_opt_${oIdx}_price`]
                                    ? 'border-rose-400 bg-rose-50/20 text-rose-700'
                                    : 'border-slate-200'
                                }`}
                              />
                              <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[9px] text-slate-400 font-bold">
                                F
                              </span>
                            </div>

                            <button
                              type="button"
                              onClick={() =>
                                handleUpdateOption(gIdx, oIdx, 'isDefault', true)
                              }
                              className={`px-2 py-1 rounded text-[10px] font-bold shrink-0 transition-colors ${
                                opt.isDefault
                                  ? 'bg-emerald-600 text-white'
                                  : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                              }`}
                              title={opt.isDefault ? 'Option sélectionnée par défaut' : 'Définir comme choix par défaut'}
                            >
                              {opt.isDefault ? 'Défaut' : 'Standard'}
                            </button>

                            <button
                              type="button"
                              onClick={() => handleRemoveOptionFromGroup(gIdx, oIdx)}
                              className="p-1 text-slate-300 hover:text-rose-600 transition-colors shrink-0"
                              title="Supprimer cette option"
                            >
                              <X size={14} />
                            </button>
                          </div>

                          {/* Error messages for option row */}
                          {(errors[`group_${gIdx}_opt_${oIdx}_name`] || errors[`group_${gIdx}_opt_${oIdx}_price`]) && (
                            <div className="flex flex-col gap-0.5 pt-0.5 text-[10px] text-rose-600 font-medium">
                              {errors[`group_${gIdx}_opt_${oIdx}_name`] && (
                                <p>{errors[`group_${gIdx}_opt_${oIdx}_name`]}</p>
                              )}
                              {errors[`group_${gIdx}_opt_${oIdx}_price`] && (
                                <p>{errors[`group_${gIdx}_opt_${oIdx}_price`]}</p>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Section 3: Suppléments / Extras */}
          <div className="space-y-4 pt-2">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <div>
                <h3 className="text-xs font-black uppercase tracking-wider text-slate-500">
                  3. Suppléments & Extras Payants
                </h3>
                <p className="text-[11px] text-slate-400">
                  Sauces additionnelles, double portion ou garnitures en extra (optionnel pour le client).
                </p>
              </div>
              <button
                type="button"
                onClick={handleAddExtra}
                className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold transition-all flex items-center gap-1.5 active:scale-95"
              >
                <Plus size={14} className="text-[#ff6500]" />
                <span>Ajouter un supplément</span>
              </button>
            </div>

            {extras.length === 0 ? (
              <div className="p-4 rounded-xl border border-dashed border-slate-200 bg-slate-50 text-center text-xs text-slate-500">
                Aucun supplément payant défini pour ce plat.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {extras.map((ext, eIdx) => (
                  <div
                    key={ext.id}
                    className="bg-slate-50 p-2.5 rounded-xl border border-slate-200 space-y-1.5"
                  >
                    <div className="flex items-center gap-2">
                      <div className="flex-1">
                        <input
                          type="text"
                          value={ext.name}
                          onChange={(e) => handleUpdateExtra(eIdx, 'name', e.target.value)}
                          placeholder="ex. Sauce piment maison"
                          className={`w-full px-2.5 py-1 text-xs border rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-[#ff6500] ${
                            errors[`extra_${eIdx}_name`] ? 'border-rose-400 bg-rose-50/20' : 'border-slate-200'
                          }`}
                        />
                      </div>

                      <div className="w-28 shrink-0 relative">
                        <input
                          type="number"
                          step="any"
                          value={ext.price}
                          onChange={(e) => handleUpdateExtra(eIdx, 'price', e.target.value)}
                          placeholder="0"
                          className={`w-full pl-2 pr-7 py-1 text-xs font-bold border rounded-lg bg-white text-right focus:outline-none focus:ring-1 focus:ring-[#ff6500] ${
                            errors[`extra_${eIdx}_price`] ? 'border-rose-400 bg-rose-50/20 text-rose-700' : 'border-slate-200'
                          }`}
                        />
                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] text-slate-400 font-bold">
                          FCFA
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleRemoveExtra(eIdx)}
                        className="p-1 text-slate-300 hover:text-rose-600 transition-colors shrink-0"
                        title="Supprimer ce supplément"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>

                    {/* Error messages for extra row */}
                    {(errors[`extra_${eIdx}_name`] || errors[`extra_${eIdx}_price`]) && (
                      <div className="flex flex-col gap-0.5 pt-0.5 text-[10px] text-rose-600 font-medium">
                        {errors[`extra_${eIdx}_name`] && (
                          <p>{errors[`extra_${eIdx}_name`]}</p>
                        )}
                        {errors[`extra_${eIdx}_price`] && (
                          <p>{errors[`extra_${eIdx}_price`]}</p>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </form>

        {/* Modal Footer */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-3 shrink-0">
          <button
            type="button"
            onClick={() => {
              sounds.playTap();
              onClose();
            }}
            className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:text-slate-900 hover:bg-slate-200 transition-colors"
          >
            Annuler
          </button>

          <button
            type="button"
            onClick={handleSubmit}
            className="px-6 py-2.5 rounded-xl bg-[#ff6500] hover:bg-[#e05800] text-white text-xs font-black shadow-sm transition-all flex items-center gap-2 active:scale-95"
          >
            <Check size={16} />
            <span>{isEditing ? 'Enregistrer les modifications' : 'Créer et ajouter le plat'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
