# Facturation récurrente RestauMax — exploitation

## Fonctionnement implémenté

- Une tâche Vercel Cron quotidienne est déclarée à 02:00 UTC sur `/api/subscriptions/billing-cycle`.
- Le moteur crée une facture récurrente déterministe à l'échéance d'un abonnement mensuel ou annuel.
- La création de facture est idempotente : un rejeu ne crée pas une deuxième facture.
- Le statut passe à `past_due` pendant le délai de grâce configuré (7 jours par défaut, de 0 à 60 jours).
- À la fin du délai, un abonnement impayé est suspendu ; le restaurant est fermé et sa version de session de table est incrémentée. Les sessions QR actives sont révoquées.
- Un abonnement gratuit mensuel/annuel est renouvelé sans facture.
- Un abonnement sans renouvellement automatique est suspendu à son échéance.
- Le Super-admin peut rapprocher une facture après réception réelle du paiement. Le montant doit correspondre exactement à la facture ; le rapprochement est idempotent et audité.
- Le règlement réactive uniquement un restaurant suspendu pour impayé d'abonnement. Une suspension administrative n'est jamais levée par ce mécanisme.

## Statut opérationnel vérifié — 10 novembre 2026

- La déclaration Cron `0 2 * * *` et l'endpoint `/api/subscriptions/billing-cycle` sont inclus dans la version Production déployée.
- Le domaine Production `restaumax.vercel.app` est rattaché au déploiement actif.
- La variable `CRON_SECRET` est présente dans la configuration Vercel Production ; sa valeur n'a pas été consultée.
- **Limite de preuve :** les vérifications effectuées pendant l'audit n'établissent pas encore qu'un cycle Cron complet a effectivement réussi. Il ne faut donc pas présenter la facturation automatique comme validée en exploitation.

Contrôle opérationnel à effectuer sans toucher aux données de Production :
1. Vérifier l'historique des exécutions Cron Vercel et le résultat HTTP de chaque appel.
2. Contrôler les journaux de l'endpoint et confirmer qu'aucune erreur de configuration ou d'autorisation ne survient.
3. Utiliser Firebase Emulator pour vérifier la création idempotente d'une facture, le délai de grâce et la suspension à échéance.
4. Garder le compte plateforme et les moyens de règlement sous contrôle du Super-admin.

## Limite de paiement

Ce moteur automatise la génération des factures, le suivi des impayés et la suspension. Il ne débite pas automatiquement les cartes ou les comptes Mobile Money. Aucun compte marchand PayDunya de la plateforme ni mandat de prélèvement récurrent n'a été configuré. Le paiement est donc rapproché manuellement par le Super-admin après réception effective. Ne jamais confirmer une facture sans preuve de paiement.
