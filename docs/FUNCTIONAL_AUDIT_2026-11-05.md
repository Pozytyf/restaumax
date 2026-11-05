# Audit fonctionnel RestauMax — parcours opérationnels

Date : 2026-11-05  
Branche : `fix/authorization-refunds-platform-audit`  
Portée : audit statique du code et des règles Firestore. Les tests automatisés et une exécution Preview restent nécessaires pour qualifier un parcours de validé en conditions réelles.

## Synthèse

| Parcours | État observé | Réserve principale |
|---|---|---|
| Caisse | Implémentation serveur avancée | Exécution réelle et rapprochement multi-moyens à éprouver en Preview |
| Commandes / POS | Parcours persisté côté serveur | Vérifier tous les cas d'annulation, transferts de table et paiements partiels |
| Cuisine / KDS | Progression individuelle désormais persistée par endpoint transactionnel | CI et parcours multi-postes Preview encore à valider |
| Stocks | Mutations manuelles sécurisées côté serveur, journal append-only et historique visible | Nomenclature/recettes et déduction automatique des ventes non implémentées |
| Abonnements | Gestion manuelle, données privées | Pas de facturation automatique ni suspension automatique à échéance |
| QR Code | Génération serveur et sessions sécurisées | Parcours scan réel, expiration/révocation et reprise à éprouver |
| Paiements | PayDunya PAR et orchestration PUSH préparées | Fournisseur TEST et décaissements réels non validés ; factures partagées non compatibles Mobile Money |
| Administration | Rôles, cloisonnement et rapports agrégés | Vérifier l'expérience réelle des rôles et l'onboarding e-mail en Preview |

## Défauts confirmés

### Cuisine — pointage individuel : correction implémentée, validation en attente
Le pointage de chaque ligne est maintenant stocké dans `RestauOrder.kitchenItemCompletion`. Le navigateur appelle `POST /api/kitchen-item` ; le backend vérifie l'identité Firebase, la session, le restaurant, le rôle (propriétaire, manager autorisé ou cuisine) et l'appartenance de la ligne à la commande, puis écrit dans une transaction Admin SDK idempotente. Le KDS reconstruit ses coches depuis Firestore et interdit de déclarer le ticket prêt tant que toutes les lignes ne sont pas terminées. La transition `pending → in_prep → ready` est respectée.

Un test de service couvre les permissions, l'isolation, la session révoquée, la ligne invalide, les commandes déjà prêtes et le rejeu. Le test LOT 2 vérifie désormais la restauration depuis les données persistées. **CI et validation UI sur Preview restent obligatoires** avant de considérer le module comme terminé.

### Stocks — inventaire non relié aux ventes
Les entrées/sorties manuelles sont enregistrées, mais aucune nomenclature/recette ne relie les articles vendus aux matières premières. Les ventes ne décrémentent donc pas automatiquement le stock et les seuils ne peuvent pas refléter une consommation réelle.

**Correction requise :** modèle de recettes et unités, conversion contrôlée, déduction atomique lors de la validation d'une commande, annulation/restauration idempotente et journal immuable. Prévoir les produits sans recette et les corrections manuelles avec motif.

### Stocks — mutations manuelles : sécurisation implémentée, validation en attente
Les créations, entrées/sorties et archivages passent désormais par `POST /api/inventory` et le service Admin SDK transactionnel. Les clés d'idempotence sont liées à la signature des données ; chaque mouvement conserve quantité avant, delta, quantité après, motif et acteur. Les sorties négatives sont refusées, les articles avec stock restant ne peuvent pas être archivés et l'historique reste consultable. Les règles Firestore interdisent toutes les écritures du SDK client sur `inventoryItems` et `stockMovements`.

Les tests de service couvrent création, rejeu, conflit de clé, mouvements, sortie excessive, rôle non autorisé, session périmée et archivage. Les tests des règles Firestore vérifient le refus des écritures directes. **CI et parcours UI sur Preview restent à valider.**

### Stocks — consommation automatique : toujours absente
Aucune nomenclature/recette ne relie encore les plats aux matières premières. Les ventes ne décrémentent donc pas automatiquement le stock. Cette étape nécessitera un modèle de recette privé (non exposé au menu client), une gestion explicite des unités et une déduction atomique au moment de la confirmation de commande, avec restauration idempotente en cas d'annulation.

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
