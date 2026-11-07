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

## Activation opérationnelle requise

La déclaration Cron et l'endpoint sont dans le dépôt, mais la tâche ne s'exécute pas dans un environnement hébergé tant qu'une version contenant ces changements n'a pas été déployée.

Avant activation :
1. Définir un secret aléatoire robuste dans l'environnement Vercel sous le nom `CRON_SECRET`.
2. Déployer une version contenant `vercel.json` et `api/subscriptions/billing-cycle.ts`.
3. Vérifier le premier appel Cron dans les journaux Vercel et contrôler les factures créées.
4. Garder le compte plateforme et les moyens de règlement sous contrôle du Super-admin.

## Limite de paiement

Ce moteur automatise la génération des factures, le suivi des impayés et la suspension. Il ne débite pas automatiquement les cartes ou les comptes Mobile Money. Aucun compte marchand PayDunya de la plateforme ni mandat de prélèvement récurrent n'a été configuré. Le paiement est donc rapproché manuellement par le Super-admin après réception effective. Ne jamais confirmer une facture sans preuve de paiement.
