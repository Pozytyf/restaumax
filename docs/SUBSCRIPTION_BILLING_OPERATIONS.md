# Facturation récurrente RestauMax — exploitation

## Fonctionnement implémenté

- Une tâche Vercel Cron quotidienne est déclarée à 02:00 UTC sur `/api/subscriptions/billing-cycle`.
- Le moteur crée une facture récurrente déterministe à l'échéance d'un abonnement mensuel, trimestriel ou annuel.
- La création de facture est idempotente : un rejeu ne crée pas une deuxième facture.
- Le statut passe à `past_due` pendant le délai de grâce configuré (7 jours par défaut, de 0 à 60 jours).
- Une facture reste affichée comme `open` pendant ce délai ; le panel et les agrégats financiers ne la classent `overdue` qu’à partir de `graceEndsAt`. Les échéances à venir sont calculées sur cette même date de fin de grâce.
- À la fin du délai, un abonnement impayé est suspendu ; le restaurant est fermé et sa version de session de table est incrémentée. Les sessions QR actives sont révoquées.
- Un abonnement gratuit mensuel/trimestriel/annuel est renouvelé sans facture.
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

## Règle contractuelle catalogue → abonnement → facture

- Le document `restaurantSubscriptions/{restaurantSlug}` est la source canonique de l'abonnement. La valeur historique `restaurants/{restaurantSlug}.subscription` n'est qu'une compatibilité de lecture pour les enregistrements non migrés ; une écriture réussie crée l'abonnement canonique et retire l'ancien champ dans la même écriture atomique.
- Chaque abonnement conserve l'identifiant stable de l'offre, son nom, le tarif mensuel du catalogue, le tarif contractuel de la période, et une copie des droits activés. Une modification ultérieure du catalogue ne doit pas repricer ni modifier les droits d'un abonnement déjà souscrit.
- Chaque modification crée une entrée d'historique versionnée et auditée.
- **Une modification de formule ne crée pas de facture.** La première facture récurrente n'est émise qu'à l'échéance future enregistrée dans `nextBillingAt`, par le cycle planifié. Une formule active ou en essai dont l'échéance est déjà passée est refusée par l'action de modification afin d'éviter toute facturation rétroactive accidentelle.
- Les cycles mensuels, trimestriels et annuels sont normalisés en équivalent mensuel pour le MRR. Un cycle personnalisé n'est inclus que si ses dates de début et de fin permettent de calculer sa durée.
- Les factures ouvertes dont la date d'échéance est dépassée sont présentées comme en retard, sans mutation automatique de leur historique. Elles restent réglables par rapprochement manuel.
- Les indicateurs financiers agrègent uniquement les sous-collections `invoices` et `payments` de `restaurantSubscriptions`. Ils ne doivent jamais mélanger les paiements des commandes clients, les caisses des restaurants ou les données d'un autre tenant.
- Les montants financiers agrégés sont accessibles uniquement aux administrateurs plateforme `full` et `billing`. Les rôles support et lecture seule ne reçoivent pas ces agrégats.

**Chez Awa :** aucune facture de rattrapage ni écriture de paiement ne doit être créée lors de la correction de son abonnement. Toute régularisation d'une période antérieure exige une validation explicite du Super-admin et une preuve de paiement avant rapprochement.
