import React, { useState, useEffect } from 'react';
import { RestauMenuItem, SelectedOption, SelectedExtra, ClientCartItem } from '../../types/restaumax';
import { formatFCFA } from '../../utils/format';
import { sounds } from '../../utils/audio';
import { X, Plus, Minus, Check, Clock, Sparkles, MessageSquare, AlertCircle } from 'lucide-react';

interface ProductDetailModalProps {
  item: RestauMenuItem | null;
  onClose: () => void;
  onAddToCart: (cartItem: ClientCartItem) => void;
}

export const ProductDetailModal: React.FC<ProductDetailModalProps> = ({
  item,
  onClose,
  onAddToCart
}) => {
  const [quantity, setQuantity] = useState<number>(1);
  const [selectedOptionsByGroup, setSelectedOptionsByGroup] = useState<Record<string, SelectedOption>>({});
  const [selectedExtras, setSelectedExtras] = useState<SelectedExtra[]>([]);
  const [prepNotes, setPrepNotes] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Initialize defaults whenever item changes
  useEffect(() => {
    if (item) {
      setQuantity(1);
      setPrepNotes('');
      setValidationError(null);
      setIsSubmitting(false);

      // Initialize default options per group based on isDefault
      if (item.optionGroups && item.optionGroups.length > 0) {
        const initialSelections: Record<string, SelectedOption> = {};
        for (const group of item.optionGroups) {
          const defaultOpt = group.options.find(o => o.isDefault);
          if (defaultOpt) {
            initialSelections[group.id] = {
              groupId: group.id,
              groupName: group.name,
              optionId: defaultOpt.id,
              optionName: defaultOpt.name,
              extraPrice: defaultOpt.extraPrice
            };
          }
        }
        setSelectedOptionsByGroup(initialSelections);
      } else {
        setSelectedOptionsByGroup({});
      }

      setSelectedExtras([]);
    } else {
      setSelectedOptionsByGroup({});
      setSelectedExtras([]);
      setPrepNotes('');
      setValidationError(null);
    }
  }, [item]);

  if (!item) return null;

  // Price calculations
  const selectedOptionsList = Object.values(selectedOptionsByGroup);
  const optionsCost = selectedOptionsList.reduce((sum, opt) => sum + opt.extraPrice, 0);
  const extrasCost = selectedExtras.reduce((sum, extra) => sum + extra.price, 0);
  const unitPrice = item.price + optionsCost + extrasCost;
  const lineTotalPrice = unitPrice * quantity;

  // Handlers
  const handleQuantityDelta = (delta: number) => {
    sounds.playTap();
    setQuantity(prev => Math.max(1, prev + delta)); // Prevent 0 or negative
  };

  const handleSelectOption = (
    group: { id: string; name: string; required: boolean },
    opt: { id: string; name: string; extraPrice: number }
  ) => {
    sounds.playTap();
    setValidationError(null);
    setSelectedOptionsByGroup(prev => {
      const isAlreadySelected = prev[group.id]?.optionId === opt.id;
      // If group is optional and already selected, allow toggling off
      if (isAlreadySelected && !group.required) {
        const next = { ...prev };
        delete next[group.id];
        return next;
      }
      return {
        ...prev,
        [group.id]: {
          groupId: group.id,
          groupName: group.name,
          optionId: opt.id,
          optionName: opt.name,
          extraPrice: opt.extraPrice
        }
      };
    });
  };

  const handleToggleExtra = (extra: { id: string; name: string; price: number }) => {
    sounds.playTap();
    setSelectedExtras(prev => {
      const exists = prev.some(e => e.extraId === extra.id);
      if (exists) {
        return prev.filter(e => e.extraId !== extra.id);
      } else {
        return [...prev, { extraId: extra.id, name: extra.name, price: extra.price }];
      }
    });
  };

  const handleConfirmAdd = () => {
    if (isSubmitting) return; // Prevent double click

    // Validation: check each required option group
    if (item.optionGroups && item.optionGroups.length > 0) {
      for (const group of item.optionGroups) {
        if (group.required && !selectedOptionsByGroup[group.id]) {
          setValidationError(`Veuillez sélectionner une option pour "${group.name}".`);
          sounds.playAlert();
          return;
        }
      }
    }

    if (quantity < 1) {
      setValidationError("La quantité doit être au minimum de 1.");
      return;
    }

    setIsSubmitting(true);
    sounds.playTap();

    // Preserve compatibility with ClientCartItem contract
    const primaryOption = selectedOptionsList[0];
    const compositeOption: SelectedOption | undefined = selectedOptionsList.length === 0
      ? undefined
      : selectedOptionsList.length === 1
      ? primaryOption
      : {
          groupId: selectedOptionsList.map(o => o.groupId).join('+'),
          groupName: selectedOptionsList.map(o => o.groupName).join(' / '),
          optionId: selectedOptionsList.map(o => o.optionId).join('+'),
          optionName: selectedOptionsList.map(o => `${o.groupName}: ${o.optionName}`).join(' · '),
          extraPrice: optionsCost
        };

    const newCartItem: ClientCartItem = {
      id: `cart-line-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      menuItemId: item.id,
      name: item.name,
      basePrice: item.price,
      unitPrice,
      quantity,
      selectedOption: compositeOption,
      selectedExtras,
      prepNotes: prepNotes.trim() ? prepNotes.trim() : undefined,
      imageUrl: item.imageUrl
    };

    onAddToCart(newCartItem);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-2xs flex items-center justify-center p-3 sm:p-5 overflow-y-auto animate-in fade-in duration-150">
      <div 
        className="bg-white w-full max-w-lg rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col my-auto max-h-[90vh] animate-in zoom-in-95 duration-150"
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-modal-title"
      >
        {/* Header Media */}
        <div className="relative h-48 sm:h-56 bg-slate-900 shrink-0 overflow-hidden">
          <img
            src={item.imageUrl}
            alt={item.name}
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-slate-950/20 to-black/30" />

          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-3 right-3 w-9 h-9 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center backdrop-blur-sm transition-transform active:scale-90"
            aria-label="Fermer"
          >
            <X size={18} />
          </button>

          {/* Prep time chip */}
          <div className="absolute bottom-3 left-4 flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-black/60 text-white backdrop-blur-sm tnum">
              <Clock size={12} className="text-amber-400" />
              {item.prepTimeMinutes} min de préparation
            </span>
            {item.tags && item.tags[0] && (
              <span className="px-2.5 py-1 rounded-full text-xs font-extrabold bg-[#ff6500] text-white shadow-sm">
                {item.tags[0]}
              </span>
            )}
          </div>
        </div>

        {/* Content Body (Scrollable) */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
          {/* Title & Base Price */}
          <div>
            <div className="flex items-start justify-between gap-3">
              <h2 id="product-modal-title" className="text-lg sm:text-xl font-extrabold text-[#101d2d] leading-tight">
                {item.name}
              </h2>
              <span className="text-lg font-black text-[#ff6500] whitespace-nowrap tnum">
                {formatFCFA(item.price)}
              </span>
            </div>
            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed mt-1.5">
              {item.description}
            </p>
          </div>

          {/* Validation Error Alert */}
          {validationError && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold flex items-center gap-2">
              <AlertCircle size={16} className="shrink-0 text-rose-600" />
              <span>{validationError}</span>
            </div>
          )}

          {/* Option Groups (e.g. Accompagnement : Alloco +500 FCFA, Riz, etc.) */}
          {item.optionGroups && item.optionGroups.map((group) => (
            <div key={group.id} className="pt-2 border-t border-slate-100">
              <div className="flex items-center justify-between mb-2.5">
                <label className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                  {group.name}
                </label>
                {group.required ? (
                  <span className="text-[10px] font-bold text-amber-800 bg-amber-50 border border-amber-200/80 px-2 py-0.5 rounded-full">
                    Obligatoire
                  </span>
                ) : (
                  <span className="text-[10px] font-bold text-slate-500">
                    Optionnel
                  </span>
                )}
              </div>

              <div className="space-y-2">
                {group.options.map((opt) => {
                  const isSelected = selectedOptionsByGroup[group.id]?.optionId === opt.id;
                  return (
                    <label
                      key={opt.id}
                      onClick={() => handleSelectOption(group, opt)}
                      className={`flex items-center justify-between p-3 rounded-xl border cursor-pointer select-none transition-all ${
                        isSelected
                          ? 'border-[#ff6500] bg-orange-50/50 shadow-2xs ring-1 ring-[#ff6500]/50'
                          : 'border-slate-200 bg-white hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-4 h-4 rounded-full border flex items-center justify-center transition-colors ${
                          isSelected ? 'border-[#ff6500] bg-[#ff6500]' : 'border-slate-300 bg-white'
                        }`}>
                          {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                        </div>
                        <span className={`text-xs font-bold ${isSelected ? 'text-slate-900' : 'text-slate-700'}`}>
                          {opt.name}
                        </span>
                      </div>

                      <span className={`text-xs font-bold tnum ${isSelected ? 'text-[#ff6500]' : 'text-slate-500'}`}>
                        {opt.extraPrice > 0 ? `+${formatFCFA(opt.extraPrice)}` : 'Inclus'}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Extras / Suppléments (Multi-choice) */}
          {item.availableExtras && item.availableExtras.length > 0 && (
            <div className="pt-2 border-t border-slate-100">
              <div className="flex items-center justify-between mb-2.5">
                <label className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                  Suppléments & Extras
                </label>
                <span className="text-[10px] font-bold text-slate-500">
                  Optionnel
                </span>
              </div>

              <div className="space-y-2">
                {item.availableExtras.map((extra) => {
                  const isChecked = selectedExtras.some(e => e.extraId === extra.id);
                  return (
                    <label
                      key={extra.id}
                      onClick={() => handleToggleExtra(extra)}
                      className={`flex items-center justify-between p-3 rounded-xl border cursor-pointer select-none transition-all ${
                        isChecked
                          ? 'border-[#ff6500] bg-orange-50/40 shadow-2xs'
                          : 'border-slate-200 bg-white hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-4 h-4 rounded-md border flex items-center justify-center transition-colors ${
                          isChecked ? 'border-[#ff6500] bg-[#ff6500] text-white' : 'border-slate-300 bg-white'
                        }`}>
                          {isChecked && <Check size={11} strokeWidth={3} />}
                        </div>
                        <span className={`text-xs font-medium ${isChecked ? 'text-slate-900 font-bold' : 'text-slate-700'}`}>
                          {extra.name}
                        </span>
                      </div>

                      <span className="text-xs font-bold text-[#ff6500] tnum">
                        +{formatFCFA(extra.price)}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {/* Preparation Notes ("sans piment", etc.) */}
          <div className="pt-2 border-t border-slate-100">
            <label className="block text-xs font-bold text-slate-900 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
              <MessageSquare size={13} className="text-slate-500" />
              Notes de préparation pour la cuisine
            </label>
            <input
              type="text"
              placeholder="Ex : sans piment, bien cuit, sauce à part, pas d’oignons..."
              value={prepNotes}
              onChange={(e) => setPrepNotes(e.target.value)}
              maxLength={120}
              className="w-full text-xs bg-slate-50 border border-slate-200 rounded-xl p-3 text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#ff6500]"
            />
            <p className="text-[10px] text-slate-500 mt-1">
              Note conservée dans le panier de démonstration. Elle ne sera pas transmise à la cuisine à cette étape.
            </p>
          </div>
        </div>

        {/* Footer Fixed Bar: Quantity & Add to Cart */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center gap-3 shrink-0">
          {/* Quantity Selector with min >= 1 guarantee */}
          <div className="flex items-center bg-white border border-slate-200 rounded-xl p-1 shadow-2xs shrink-0">
            <button
              type="button"
              onClick={() => handleQuantityDelta(-1)}
              disabled={quantity <= 1}
              className="w-10 h-10 rounded-lg flex items-center justify-center text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:pointer-events-none transition-colors active:scale-95"
              aria-label="Diminuer la quantité"
            >
              <Minus size={15} />
            </button>

            <span className="w-9 text-center text-sm font-extrabold text-slate-900 tnum select-none">
              {quantity}
            </span>

            <button
              type="button"
              onClick={() => handleQuantityDelta(1)}
              className="w-10 h-10 rounded-lg flex items-center justify-center text-slate-600 hover:bg-slate-100 transition-colors active:scale-95"
              aria-label="Augmenter la quantité"
            >
              <Plus size={15} />
            </button>
          </div>

          {/* Add to Cart CTA */}
          <button
            type="button"
            onClick={handleConfirmAdd}
            disabled={isSubmitting}
            className="flex-1 h-12 bg-[#ff6500] hover:bg-[#e05800] active:scale-[0.99] disabled:opacity-50 text-white font-extrabold text-xs sm:text-sm rounded-xl shadow-md shadow-orange-600/20 transition-all flex items-center justify-between px-4"
          >
            <span>Ajouter au panier</span>
            <span className="font-black tnum bg-black/20 px-2 py-0.5 rounded-md">
              {formatFCFA(lineTotalPrice)}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
