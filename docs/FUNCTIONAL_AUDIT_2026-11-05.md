> **Mise à jour du 2026-11-07 :** cet audit décrit un état historique. Pour les critères réellement validés et les lacunes encore ouvertes, consulter [le bilan de recette du 7 novembre 2026](./RECETTE_FONCTIONNELLE_2026-11-07.md). Les constats ci-dessous ne doivent pas être interprétés comme l'état courant sans cette mise à jour.

# Audit fonctionnel RestauMax — parcours opérationnels

Date : 2026-11-05  
Branche : `fix/authorization-refunds-platform-audit`  
Portée : audit statique du code et des règles Firestore. Les tests automatisés et une exécution Preview restent nécessaires pour qualifier un parcours de validé en conditions réelles.

## Synthèse

| Parcours | État observé | Réserve principale |
|---|---|---|
| Caisse | Implémentation serveur avancée | Exécution réelle et rapprochement multi-moyens à éprouver en Preview |
| Commandes / POS | Parcours persisté côté serveur | Vérifier tous les cas d'annulation, transferts de table et paiements partiels |
| Cuisine / KDS | Progression individuelle persistée et transition prête protégée par les règles | CI/Emulator verts ; parcours multi-postes Preview à valider |
| Menu & catalogue | Catalogue Firestore live : création, édition, suppression, disponibilité ; partagé avec QR client et POS | Validation UI Preview encore nécessaire |
| Stocks | Création, édition des métadonnées, mouvements, archivage et fiches recettes avec panneau de gestion | Déduction automatique des ventes, annulation/restauration et validation transactionnelle non implémentées |
| Abonnements | Gestion manuelle, données privées | Pas de facturation automatique ni suspension automatique à échéance |
| QR Code | Génération serveur et sessions sécurisées | Parcours scan réel, expiration/révocation et reprise à éprouver |
| Paiements | PayDunya PAR et orchestration PUSH préparées | Fournisseur TEST et décaissements réels non validés ; factures partagées non compatibles Mobile Money |
| Administration | Rôles, cloisonnement et rapports agrégés | Vérifier l'expérience réelle des rôles et l'onboarding e-mail en Preview |

## Défauts confirmés

### Menu et catalogue — Module #02
Le module dispose d'un écran de gestion dédié avec recherche/filtres, création, édition, suppression et bascule de disponibilité. Les données sont chargées depuis Firestore et le même catalogue alimente le menu QR client et le POS afin d'éviter les divergences de prix et de disponibilité. La sauvegarde du formulaire attend maintenant la confirmation Firestore, conserve les champs en cas d'échec et réutilise l'identifiant du plat lors d'une nouvelle tentative ambiguë. La référence codée en dur au restaurant de démonstration a été retirée de l'écran multi-restaurant.

Les tests CI couvrent la navigation, la persistance asynchrone et l'isolation du nom du restaurant. **CI complète réussie sur le SHA `dc348f2aa53414d4e86576ca14462bf1e852afcf`** ; le parcours réel propriétaire/manager et client QR reste à vérifier sur Preview.

### Cuisine — pointage individuel : correction implémentée, CI/Emulator verts
Le pointage de chaque ligne est maintenant stocké dans `RestauOrder.kitchenItemCompletion`. Le navigateur appelle `POST /api/kitchen-item` ; le backend vérifie l'identité Firebase, la session, le restaurant, le rôle (propriétaire, manager autorisé ou cuisine) et l'appartenance de la ligne à la commande, puis écrit dans une transaction Admin SDK idempotente. Le KDS reconstruit ses coches depuis Firestore et interdit de déclarer le ticket prêt tant que toutes les lignes ne sont pas terminées. Le backend maintient `kitchenItemsCompletedCount` dans la même transaction que chaque coche ; les règles Firestore refusent toute transition vers `ready` tant que ce compteur n'est pas égal au nombre de lignes, et interdisent au SDK client de le modifier. La transition `pending → in_prep → ready` est ainsi protégée côté interface et côté règles.

Un test de service couvre les permissions, l'isolation, la session révoquée, la ligne invalide, les commandes déjà prêtes et le rejeu. Le test LOT 2 vérifie désormais la restauration depuis les données persistées. **CI complète et Firestore Emulator réussis sur le SHA `dc348f2aa53414d4e86576ca14462bf1e852afcf`** ; le parcours multi-postes en Preview reste à vérifier avant de considérer le module comme terminé.

### Stocks — inventaire non relié aux ventes
Les entrées/sorties manuelles sont enregistrées, mais aucune nomenclature/recette ne relie les articles vendus aux matières premières. Les fiches recettes sont maintenant créables, consultables et modifiables depuis le module Stocks. Le panneau vérifie les ingrédients distincts, les quantités positives et affiche l’unité de chaque article. Le service serveur vérifie le restaurant, le plat, les articles actifs et les permissions avant d’écrire dans `menuRecipes`. La sauvegarde d’une recette ne modifie jamais le stock. Les ventes ne décrémentent toujours pas automatiquement le stock et les seuils ne reflètent donc pas encore une consommation réelle.

**Correction requise :** modèle de recettes et unités, conversion contrôlée, déduction atomique lors de la validation d'une commande, annulation/restauration idempotente et journal immuable. Prévoir les produits sans recette et les corrections manuelles avec motif.

### Stocks — gestion des fiches recettes : première tranche implémentée

Le module Stocks affiche les recettes liées aux plats du catalogue et permet au propriétaire/manager autorisé de créer ou modifier une fiche. Chaque ligne associe un article de stock actif à une quantité positive par portion ; les doublons sont refusés. Les unités restent celles des articles de stock et aucune conversion automatique n’est effectuée. Les recettes sont lues depuis la sous-collection privée `menuRecipes` et enregistrées exclusivement par `POST /api/inventory` avec l’action `save_recipe`. Les règles Firestore refusent les écritures directes du navigateur. Le test d’inventaire couvre la persistance, la conservation du stock, le rejet des ingrédients dupliqués et le refus d’un caissier sans permission.

**Limite restante :** aucune déduction automatique n’est encore déclenchée par une commande. Le prochain lot doit lier la transition de commande vers la préparation à une transaction serveur atomique qui déduit les ingrédients, garantit l’idempotence, refuse le stock insuffisant et restaure les quantités en cas d’annulation avec un journal append-only. Aucun stock ne doit être consommé au simple enregistrement d’une commande `pending`.

### Stocks — mutations manuelles : sécurisation implémentée, CI/Emulator verts
Les créations, entrées/sorties et archivages passent désormais par `POST /api/inventory` et le service Admin SDK transactionnel. Les clés d'idempotence sont liées à la signature des données ; chaque mouvement conserve quantité avant, delta, quantité après, motif et acteur. Les sorties négatives sont refusées, les articles avec stock restant ne peuvent pas être archivés et l'historique reste consultable. Les métadonnées peuvent être modifiées sans toucher à la quantité ; le changement d'unité est interdit tant que le stock n'est pas nul. Les règles Firestore interdisent toutes les écritures du SDK client sur `inventoryItems` et `stockMovements`.

Les tests de service couvrent création, modification des métadonnées, interdiction de changer d'unité avec un stock restant, rejeu, conflit de clé, mouvements, sortie excessive, rôle non autorisé, session périmée et archivage. Les clés des mouvements en attente sont conservées pendant les erreurs réseau pour qu'une nouvelle tentative réutilise la même opération au lieu de doubler le stock. Les tests des règles Firestore vérifient le refus des écritures directes. **CI complète et Firestore Emulator réussis sur le SHA `dc348f2aa53414d4e86576ca14462bf1e852afcf`** ; le parcours UI en Preview reste à valider.

### Salle — libellés fictifs supprimés
L'écran affichait une durée de service fixe (« 3h 42m ») et une heure de réservation fixe (« 20h00 »), sans source métier correspondante. Ces valeurs ont été remplacées par des libellés neutres dans ce commit.

## Dernière validation GitHub — SHA `dc348f2aa53414d4e86576ca14462bf1e852afcf`
- RestauMax CI : TypeScript, tests automatisés, build frontend et audit des dépendances — succès.
- Tests Firestore Emulator & qualité : tests d'intention, tests LOT 1/LOT 2, règles de sécurité et transactions — succès.
- Owner UID binding emulator, sécurité des rôles, autorisation de remboursement, cycle PayDunya et confidentialité du tableau super-admin — succès.
- Vercel : contrôle en échec à cause de la limite de déploiements du compte ; aucun déploiement Preview ou Production n'a abouti ; l'intégration Vercel a bloqué la tentative automatique avant déploiement, faute de quota.
- Le code et les règles Firestore restent sur la branche de travail ; aucune fusion dans `main` ni publication des règles Production.

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
6. Dans Vercel, passer la variable Production `FIREBASE_SERVICE_ACCOUNT_JSON` de visibilité `Config` à `Secret/Sensitive`, sans modifier sa valeur. La connexion Vercel disponible ne permet pas d'appliquer ce changement de visibilité de façon sûre.
7. Après réinitialisation du quota Vercel, reconstruire un déploiement Preview afin qu'il prenne en compte la clé de chiffrement PayDunya Preview déjà configurée.

## État Git

Ce document décrit les constats vérifiés par lecture du code. Il ne signifie pas que les réserves listées sont corrigées ou que les parcours sont validés en conditions réelles.
