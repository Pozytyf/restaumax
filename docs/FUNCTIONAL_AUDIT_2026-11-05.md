# Audit fonctionnel RestauMax — parcours opérationnels

Date : 2026-11-05  
Branche : `fix/authorization-refunds-platform-audit`  
Portée : audit statique du code et des règles Firestore. Les tests automatisés et une exécution Preview restent nécessaires pour qualifier un parcours de validé en conditions réelles.

## Synthèse

| Parcours | État observé | Réserve principale |
|---|---|---|
| Caisse | Implémentation serveur avancée | Exécution réelle et rapprochement multi-moyens à éprouver en Preview |
| Commandes / POS | Parcours persisté côté serveur | Vérifier tous les cas d'annulation, transferts de table et paiements partiels |
| Cuisine / KDS | Statuts de commande persistés | Pointage individuel des articles non persistant |
| Stocks | CRUD et mouvements manuels présents | Aucun lien recette/consommation automatique avec les ventes |
| Abonnements | Gestion manuelle, données privées | Pas de facturation automatique ni suspension automatique à échéance |
| QR Code | Génération serveur et sessions sécurisées | Parcours scan réel, expiration/révocation et reprise à éprouver |
| Paiements | PayDunya PAR et orchestration PUSH préparées | Fournisseur TEST et décaissements réels non validés ; factures partagées non compatibles Mobile Money |
| Administration | Rôles, cloisonnement et rapports agrégés | Vérifier l'expérience réelle des rôles et l'onboarding e-mail en Preview |

## Défauts confirmés

### Cuisine — pointage individuel non persistant
`handleToggleKdsItem` ne fait que modifier `kitchenTickets` dans l'état React. Le modèle `RestauOrder` ne conserve pas l'état de préparation de chaque ligne. Un rechargement ou un changement d'écran peut donc perdre les coches individuelles, même si le statut global de la commande est sauvegardé.

**Correction requise :** ajouter une opération backend autorisée, transactionnelle et tenant-scoped pour enregistrer l'état de préparation par ligne ; contrôler le rôle cuisine/manager ; tester les conflits et le rechargement. Ne pas contourner les règles Firestore en autorisant des écritures client générales.

### Stocks — inventaire non relié aux ventes
Les entrées/sorties manuelles sont enregistrées, mais aucune nomenclature/recette ne relie les articles vendus aux matières premières. Les ventes ne décrémentent donc pas automatiquement le stock et les seuils ne peuvent pas refléter une consommation réelle.

**Correction requise :** modèle de recettes et unités, conversion contrôlée, déduction atomique lors de la validation d'une commande, annulation/restauration idempotente et journal immuable. Prévoir les produits sans recette et les corrections manuelles avec motif.

### Stocks — cohérence du journal à renforcer
Le navigateur met à jour `inventoryItems` et crée `stockMovements` dans une transaction Firestore. Les règles vérifient les types et les permissions, mais ne garantissent pas que `quantityAfter` correspond à la quantité antérieure plus `delta`. Le journal n'est donc pas une preuve comptable inviolable contre un client autorisé compromis.

**Correction requise :** déplacer les mouvements dans un endpoint backend transactionnel et interdire les écritures directes du SDK client sur les mouvements et les quantités.

### Salle — libellés fictifs supprimés
L'écran affichait une durée de service fixe (« 3h 42m ») et une heure de réservation fixe (« 20h00 »), sans source métier correspondante. Ces valeurs ont été remplacées par des libellés neutres dans ce commit.

## Limites fonctionnelles à ne pas présenter comme terminées

- Le module rapports indique explicitement que les montants sont issus des commandes terminées et ne constituent ni un rapprochement des encaissements ni une analyse de marge.
- Le taux de taxe dans les paramètres est indicatif et n'est pas appliqué automatiquement aux commandes.
- Les abonnements sont gérés manuellement ; aucun prélèvement récurrent ni suspension automatique à échéance n'est implémenté.
- Les factures partagées par convive ne sont pas encore compatibles avec Mobile Money ; les commandes à emporter sans session QR sont payables au comptoir.
- Les remboursements Mobile Money et les callbacks PUSH restent à éprouver avec un compte marchand TEST. Aucun décaissement réel n'a été effectué.
- L'e-mail de définition du mot de passe doit être testé avec Firebase Preview : création effective, réception, expiration du lien et première connexion.

## Preuves attendues avant validation

1. Tests unitaires/transactionnels et règles Firestore pour chaque opération sensible.
2. Lint, build, audit dépendances et workflows GitHub verts sur le SHA exact.
3. Tests multi-comptes et multi-restaurants pour les permissions et l'isolation.
4. Scénarios UI complets sur Preview, y compris erreurs réseau, rechargement, double clic et session expirée.
5. Aucun test fournisseur réel ni déploiement Production sans autorisation distincte.

## État Git

Ce document décrit les constats vérifiés par lecture du code. Il ne signifie pas que les réserves listées sont corrigées ou que les parcours sont validés en conditions réelles.
