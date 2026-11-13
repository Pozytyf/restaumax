import React, { useCallback, useEffect, useRef, useState } from 'react';
import { getMultiFactorResolver, multiFactor, onAuthStateChanged, PhoneAuthProvider, PhoneMultiFactorGenerator, RecaptchaVerifier, signInWithEmailAndPassword, signOut, TotpMultiFactorGenerator, type MultiFactorResolver, type User } from 'firebase/auth';
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import QRCode from 'qrcode';
import { auth } from '../../lib/firebase';
import { ShieldCheck, Eye, EyeOff } from 'lucide-react';
import { PlatformAdminWorkspace } from './PlatformAdminWorkspace';

type RestaurantRow = {
  slug: string; name: string;
  status?: string; isOpen?: boolean; deletedAt?: number;
  subscription?: {
    planName?: string; priceFcfa?: number; currency?: string;
    billingCycle?: 'monthly' | 'yearly' | 'custom';
    status?: 'trial' | 'active' | 'past_due' | 'suspended' | 'cancelled';
    startsAt?: number; endsAt?: number; nextBillingAt?: number; notes?: string;
    autoRenew?: boolean; gracePeriodDays?: number; currentInvoiceId?: string | null; currentInvoiceAmountFcfa?: number | null; pastDueAt?: number | null;
  };
};
type PlatformSummary = {
  totalRestaurants: number; activeRestaurants: number; suspendedRestaurants: number;
  deletedRestaurants: number; openRestaurants: number; monthlyRecurringRevenueFcfa: number;
  subscriptionsByPlan: Record<string, number>; subscriptionsByStatus: Record<string, number>;
};
type StaffRow = { uid: string; email: string; displayName: string; role: 'owner' | 'manager' | 'staff' | 'cashier' | 'server' | 'kitchen'; active: boolean; permissions?: string[]; accountLinked?: boolean; activeKnown?: boolean; emailConflict?: boolean; sources?: string[]; readOnly?: boolean };

export const PlatformAdminView: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [restaurants, setRestaurants] = useState<RestaurantRow[]>([]);
  const [summary,...[truncated]