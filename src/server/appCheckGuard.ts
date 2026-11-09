export async function verifyPublicOrderAppCheck({ isProduction, enforcementEnabled, token, verifier }) {
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
  } catch (error) {
    return {
      allowed: false,
      statusCode: 401,
      reason: 'invalid-token',
      code: String((error as any)?.code || 'invalid-token'),
      message: 'Vérification de sécurité invalide. Actualisez la page et réessayez.'
    };
  }
}
