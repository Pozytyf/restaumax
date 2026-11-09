type AppCheckVerifier = { verifyToken(token: string): Promise<unknown> } | null | undefined;

type AppCheckResult =
  | { allowed: true }
  | {
      allowed: false;
      statusCode: number;
      reason: 'not-configured' | 'missing-token' | 'invalid-token';
      message: string;
      code?: string;
    };

type AppCheckGuardInput = {
  isProduction: boolean;
  enforcementEnabled: boolean;
  token: string;
  verifier: AppCheckVerifier;
};

export async function verifyPublicOrderAppCheck({
  isProduction,
  enforcementEnabled,
  token,
  verifier
}: AppCheckGuardInput): Promise<AppCheckResult> {
  if (isProduction && !enforcementEnabled) {
    return {
      allowed: false,
      statusCode: 503,
      reason: 'not-configured',
      message: 'Protection App Check non activée. Commande temporairement indisponible.'
    };
  }
  if (!enforcementEnabled) return { allowed: true };
  if (!verifier || typeof token !== 'string' || !token.trim()) {
    return {
      allowed: false,
      statusCode: 401,
      reason: 'missing-token',
      message: 'Vérification de sécurité requise pour cette commande.'
    };
  }
  try {
    await verifier.verifyToken(token.trim());
    return { allowed: true };
  } catch (error: unknown) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code || 'invalid-token')
        : 'invalid-token';
    return {
      allowed: false,
      statusCode: 401,
      reason: 'invalid-token',
      code,
      message: 'Vérification de sécurité invalide. Actualisez la page et réessayez.'
    };
  }
}
