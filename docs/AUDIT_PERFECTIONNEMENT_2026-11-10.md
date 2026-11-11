# RestauMax — Audit fonctionnel et plan de perfectionnement

Date de référence : 2026-11-10  
Branche d'audit : `fix/functional-hardening-modules-2026-11-10`  
Commit Production audité : `920453a72ed0da5a3a9be5b2acaca11d23c2e786`  
Domaine Production : `https://restaumax.vercel.app`

## Règles non négociables

- Ne jamais écrire, supprimer ou migrer des données Firebase Production pendant cet audit.
- Ne jamais appliquer de correctif directement sur `main` ou sur Production.
- Ne pas fusionner de PR ni lancer de déploiement pendant la phase de diagnostic.
- Développer et valider les corrections sur une branche dédiée.
- Les contrôles GitHub Actions sont la preuve minimale requise ; aucun test fonctionnel n'est déclaré réussi sans exécution réelle.
- PayDunya reste en mode TEST.
- Toute mise en production ultérieure nécessite une validation distincte et explicite.

## État initial vérifié

Sur le commit `920453a`, les trois workflows post-merge suivants sont verts :
- RestauMax CI — typecheck, tests Firestore Emulator et build.
- RestauMax security hardening.
- Tests Firestore Emulator & qualité.

Le déploiement Vercel Production correspondant est `READY` et l'alias `restaumax.vercel.app` pointe vers lui. Aucun test HTTP indépendant n'est revendiqué dans cet audit.

La configuration Vercel contient notamment `CRON_SECRET`, `APP_ORIGIN`, les clés de chiffrement QR/PayDunya, la clé de limitation des commandes et les variables Firebase nécessaires. Les valeurs secrètes n'ont pas été déchiffrées ni consultées.

## Registre des constats par module

### 1. Sécurité et permissions

**S1 — Vérifications financières dépendantes du rôle Manager**
- Priorité : haute.
- Fichiers : `src/App.tsx`, `server.ts`, `src/server/paymentService.ts`, `src/server/paydunyaPaymentService.ts`.
- Constat : plusieurs contrôles caisse/encaissement/remboursement acceptent le rôle `manager` sans relire la permission effective. Le profil Manager reçoit actuellement ces permissions par défaut, mais les services ne doivent pas contourner le modèle de permissions lorsque des données historiques ou incohérentes sont rencontrées.
- Correction : appliquer `cash.manage`, `cash.view` et `payments.refund` explicitement dans les contrôles client, API et services transactionnels.
- Non-régression : Manager avec permission autorisé ; Manager sans permission refusé ; Caissier autorisé uniquement selon ses permissions ; Serveur et Cuisine/Bar refusés pour les opérations financières.

**S2 — Garde d'accès aux modules administratifs**
- Priorité : moyenne.
- Fichiers : `src/components/restaumax/RestaurantHubView.tsx`, `src/components/restaumax/RestaurantAdminModuleView.tsx`.
- Constat : la PR #104 contient des gardes d'interface utiles pour les permissions de caisse et les modules clients/stocks/rapports/paramètres, mais elle n'est pas intégrée à la version Production et sa base est ancienne.
- Correction : intégrer les protections pertinentes sur la branche courante, sans fusionner la PR #104.
- Non-régression : aucun chargement Firestore ou rapport si la permission de consultation manque.

**S3 — MFA du Super-admin**
- Priorité : haute, durcissement opérationnel.
- Constat : le code sait imposer MFA via `RESTAUMAX_SUPER_ADMIN_REQUIRE_MFA=true`, mais cette variable n'est pas présente dans les variables Vercel Production consultées.
- Décision : ne pas activer cette variable pendant l'audit ; tester d'abord l'enrôlement et la récupération du compte sur Preview pour éviter un verrouillage du Super-admin.

### 2. QR et commandes clients

**Q1 — Métadonnées client perdues lors d'une reprise après rechargement**
- Priorité : critique.
- Fichiers : `src/App.tsx`, `src/components/restaumax/ClientMenuView.tsx`, `src/components/restaumax/CartDrawer.tsx`, `src/utils/orderIntentStorage.ts`.
- Constat : l'intention initiale sauvegarde la note et les coordonnées, mais l'effet de synchronisation suivant réécrit le panier sans ces champs. Le formulaire du panier n'est pas réhydraté après rechargement.
- Cause : la signature d'idempotence serveur inclut note, nom et téléphone ; la même clé peut donc être rejouée avec un contenu différent.
- Correction : conserver et restaurer ces champs dans l'état persistant, sans changer la clé.
- Non-régression : simulation d'un échec ambigu, rechargement de page, reprise avec payload strictement identique et une seule commande enregistrée.

**Q2 — Erreur transactionnelle classée comme refus définitif**
- Priorité : critique.
- Fichiers : `src/server/orderService.ts`, `server.ts`, `src/lib/firebase.ts`.
- Constat : une exception de la transaction d'écriture de commande est transformée en résultat d'échec générique ; le handler `/api/orders` renvoie HTTP 400 pour les échecs non-conflit. Le client considère un 4xx comme définitif et libère la clé.
- Risque : si l'écriture Firestore a été validée mais que la réponse a échoué, une nouvelle clé pourrait créer un doublon.
- Correction : marquer les erreurs d'infrastructure transactionnelle comme rejouables et renvoyer HTTP 503 ; conserver la même clé côté client.
- Non-régression : transaction interrompue après commit simulé, reprise même clé, replay idempotent et une seule commande.

**Q3 — App Check absent pour les commandes à emporter Production**
- Priorité : blocage fonctionnel.
- Fichier : `src/server/appCheckGuard.ts` et configuration Vercel.
- Constat : le garde renvoie 503 en Production lorsque `FIREBASE_APPCHECK_ENFORCE_PUBLIC_ORDERS` n'est pas activée. Cette variable n'apparaît pas dans les variables Vercel Production listées, même si la clé de site App Check est présente.
- Impact : le parcours QR sur place peut fonctionner alors que les commandes publiques à emporter sont refusées.
- Action : ne pas modifier Production pendant l'audit. Préparer une activation et une validation sur Preview uniquement avant toute décision ultérieure.
- Non-régression : token App Check valide accepté ; token absent/invalide refusé ; mode Production non configuré clairement distingué d'une commande incertaine.

**Q4 — Numéro de table non garanti unique côté serveur**
- Priorité : moyenne.
- Fichiers : `src/server/tableService.ts`, `server.ts`, `api/index.ts`, `src/lib/firebase.ts`, `src/App.tsx`, `firestore.rules`, `vercel.json`.
- Cause confirmée : contrôle de doublon uniquement local avant écriture directe.
- Correction sur la branche : création via `POST /api/tables`, autorisation propriétaire/manager, transaction Firestore et réservation déterministe `table_number_index`. Les anciennes tables sont aussi vérifiées ; la création directe et la modification du numéro par SDK client sont refusées.
- Non-régression : deux demandes concurrentes avec variantes de casse/espaces ; une seule réussit ; une table legacy empêche aussi un doublon ; les autres numéros restent créables.

### 3. Caisse et paiements

**P1 — Autorisations financières serveur**
- Couvert par S1 ; mêmes fichiers et mêmes tests négatifs.

**P2 — Limites PayDunya à documenter**
- Les paiements partiels sont couverts par les tests.
- Le partage d'addition Mobile Money est désactivé tant que le rapprochement par convive n'est pas validé.
- Les remboursements PayDunya exigent le mode LIVE et ne doivent pas être activés pendant la période TEST.
- Aucun paiement réel ne sera effectué pendant l'audit.

### 4. Stocks et recettes

**ST1 — Fondations transactionnelles présentes**
- Fichiers : `src/server/inventoryService.ts`, `src/server/orderLifecycleService.ts`.
- Les entrées/sorties, recettes, recettes d'options/suppléments, consommation au passage en préparation et restauration à l'annulation sont gérées côté serveur.
- Les unités doivent correspondre exactement ; aucune conversion implicite kg/g ou L/ml n'est effectuée.
- Les commandes dont certaines recettes sont absentes portent un statut de suivi partiel/incomplet ; les rapports signalent les coûts non couverts.
- Tests existants : `test-inventory-service`, `test-order-lifecycle-stock`, `test-order-kds-cash-integration`, tests Emulator.
- Vérification : `test-order-lifecycle-stock.mjs` couvre déjà les recettes de plat, plusieurs options, les suppléments, l'agrégation des ingrédients, la consommation, la restauration à l'annulation et le statut partiel si une recette de personnalisation manque. Aucun défaut critique confirmé à ce stade.

### 5. Cuisine / Bar

**K1 — Filtres de station inactifs**
- Priorité : haute.
- Fichiers : `src/components/kds/KdsView.tsx`, `src/utils/kitchenTicket.ts`, `src/server/orderService.ts`, `src/types/restaumax.ts`, `src/types/pos.ts`.
- Constat : `filterStation` change d'état mais ne filtre pas les tickets ; le mapping persistant attribue `course: 'plat'` à toutes les lignes ; aucun onglet Bar n'est rendu.
- Correction sur la branche : catégorie catalogue persistée dans la ligne de commande, mapping Grillades/Fourneaux/Bar, filtre appliqué aux lignes et onglet Bar ajouté.
- Non-régression : commande mixte grillades + plat + boisson ; chaque station ne voit que ses lignes ; l'état « prêt » reste bloqué tant que toutes les lignes du ticket ne sont pas terminées.

**K2 — Raccourcis clavier perturbant l'accessibilité**
- Priorité : moyenne.
- Fichier : `src/components/kds/KdsView.tsx`.
- Constat : Tab/Maj+Tab sont interceptées comme raccourcis de navigation ; Entrée/Espace peuvent aussi détourner l'activation native d'un contrôle focalisé.
- Correction sur la branche : Tab/Maj+Tab restent natives et les raccourcis globaux sont ignorés lorsque le focus est dans un champ, bouton, lien ou contrôle interactif.
- Non-régression : navigation clavier standard entre les boutons, raccourcis KDS actifs hors contrôles.

**K3 — Confirmation KDS prématurée**
- Priorité : moyenne.
- Correction sur la branche : l'interface attend le résultat de la mise à jour serveur avant d'afficher « prêt » ou « servi » ; en cas de refus, aucun succès n'est annoncé.

### 6. Menu, clients et fidélité

**C1 — Course de doublons dans la création des clients**
- Priorité : haute.
- Fichiers : `src/components/restaumax/RestaurantAdminModuleView.tsx`, `firestore.rules`, `src/server/loyaltyService.ts`.
- Constat : vérification par requête puis `addDoc` séparé ; deux créations concurrentes peuvent passer le contrôle. Le service fidélité crée déjà un document déterministe `loyalty_<hash téléphone>`.
- Correction sur la branche : création via API/Admin SDK transactionnelle, identifiant déterministe cohérent avec le service fidélité, validation serveur des coordonnées et refus de création directe par le SDK client.
- Non-régression : deux requêtes concurrentes avec le même numéro ; une seule fiche ; les points automatiques se rattachent à la même fiche.

**C2 — Suppression de fiche et historique fidélité**
- Priorité : moyenne, à décider dans le module clients.
- Constat : la suppression de la fiche client ne supprime pas le ledger fidélité ; le solde peut devenir inaccessible depuis le répertoire.
- Correction sur la branche : archivage logique, masquage des fiches archivées dans le répertoire actif, suppression physique refusée par les règles et conservation du ledger/solde.

**M1 — Catalogue public**
- La réponse publique filtre les articles indisponibles/épuisés et exclut les champs internes ; les tests de sécurité du menu sont présents.
- Les options, suppléments, prix FCFA et fiches de recettes sont déjà représentés dans le code.
- Aucun défaut critique confirmé à ce stade.

### 7. Administration, abonnements et ergonomie

**A1 — Documentation Cron obsolète**
- Fichiers : `vercel.json`, `docs/SUBSCRIPTION_BILLING_OPERATIONS.md`.
- Constat : le Cron quotidien à 02:00 UTC est dans la version Production et `CRON_SECRET` est présent ; le document indique encore qu'un déploiement et la définition du secret sont à faire.
- Correction documentaire effectuée : la présence de la tâche Cron et du secret est indiquée, sans prétendre qu'un cycle réussi a été observé. La preuve d'exécution reste à obtenir.
- Limite : génération des factures et suspension automatisées ; encaissement d'abonnement manuel par le Super-admin.

**A2 — Dépréciation Node**
- Les journaux Vercel signalent `DEP0169 url.parse()` de façon répétée sur des routes utilisant Firebase Admin. Aucun crash applicatif correspondant n'est établi.
- Action : identifier la dépendance exacte via une trace de dépréciation. Tentative de lecture des logs Vercel sur 7 jours refusée par la rétention Hobby ; la fenêtre 50 minutes a expiré. Le warning n'est pas bloquant et aucune mise à jour de dépendance n'est faite sans attribution fiable.

**A3 — Validation navigateur**
- Les tests existants sont nombreux (unitaires, contrats, règles Firestore, Emulator, build) mais aucun parcours Playwright/Cypress automatisé n'est déclaré dans les scripts actuels.
- Action : ajouter des tests navigateur ciblés après les corrections critiques, sans déployer Production.

## Ordre d'exécution

1. Sécurité et permissions : S1/S2, tests négatifs sur les six profils.
2. QR et commandes : Q1/Q2/Q3, puis Q4 si la création concurrente est reproduite.
3. Caisse et paiements : P1, paiements partiels, remboursements et limites TEST.
4. Stocks et recettes : tests d'options/suppléments et unités.
5. Cuisine / Bar : K1/K2/K3.
6. Menu, clients et fidélité : C1/C2/M1.
7. Administration, abonnements et ergonomie : A1/A2/A3, MFA et configuration App Check à préparer sur Preview.

## Preuves et statut

Ce document est un registre vivant. Pour chaque correction, ajouter :
- commit de la branche ;
- fichiers modifiés ;
- tests ajoutés ;
- résultat GitHub Actions ;
- éventuelle validation manuelle Preview ;
- état final : corrigé, non reproduit, ou bloqué par configuration.

Aucune donnée Firebase Production ne doit servir de fixture de test. Utiliser exclusivement des mocks ou Firebase Emulator/Preview.

## Avancement de l'audit — PR #110

Dernier commit intégré au relevé : `673d1ea91deca5302f5c883d411a24e3af175e9a`.  
PR : `https://github.com/Pozytyf/restaumax/pull/110` (brouillon, non fusionnée).

### Corrections implémentées sur la branche

- **S1/S2 — Sécurité :** les autorisations caisse/remboursement sont contrôlées côté serveur selon les permissions effectives ; les gardes des modules administratifs sont renforcées. Les tests dédiés de rôles, de remboursement propriétaire et de PayDunya ont été verts sur le commit précédent `de32370`.
- **Q1 — Reprise QR :** note, nom et téléphone sont sauvegardés/restaurés avec la même intention de commande.
- **Q2 — Incertitude transactionnelle :** les erreurs d'infrastructure sont classées rejouables (HTTP 503) ; la clé d'idempotence n'est pas renouvelée automatiquement.
- **K1/K2/K3 — Cuisine/Bar :** catégorie catalogue propagée aux tickets, filtres Grillades/Fourneaux/Bar, raccourcis clavier non intrusifs ; le succès visuel attend la confirmation du serveur.
- **C1 — Clients :** création par endpoint serveur transactionnel, identifiant déterministe partagé avec la fidélité et contrôle d'unicité par téléphone ; la création directe par SDK client est interdite.
- **C2 — Fidélité :** la suppression physique est remplacée par l'archivage ; le ledger et les points restent conservés.
- **A1 — Abonnements :** la documentation Cron a été mise à jour ; l'exécution réelle du cycle reste à prouver.
- **API Vercel :** les routes `POST /api/customers` et `POST /api/tables` sont ajoutées au routeur central et aux réécritures Vercel.

### Contrôles déjà observés

- **Tous les contrôles GitHub Actions du commit `673d1ea` sont verts :** RestauMax CI (TypeScript, suite complète, build Production), validation Firestore Emulator stricte, sécurité/hardening, rôles, remboursements propriétaire, PayDunya et liaison propriétaire.
- La suite complète inclut les tests de création client concurrente, de création de table concurrente, de routage API Vercel, de reprise QR/idempotence, de KDS et de règles Firestore.
- QR : 60/60 tests ; cohérence QR/environnement : 4/4 ; diagnostic session/index : 16/16 ; choix espèces/caisse : 39 assertions réussies ; PayDunya : 40/40 tests unitaires et 36/36 parcours.
- Les tests ont d'abord révélé des assertions obsolètes après durcissement des règles et ajout des routes ; elles ont été corrigées et la suite complète est maintenant verte sur le commit indiqué.
- La PR reste en brouillon. **Aucune validation manuelle Preview n'est revendiquée.**

### Points toujours ouverts / bloquants

- **Q3 :** App Check Production non configuré pour les commandes à emporter ; aucune modification de Production n'est autorisée pendant cet audit.
- **Q4 :** unicité concurrente du numéro de table côté serveur non corrigée ; création locale encore vulnérable à une course entre deux gestionnaires.
- **A2 :** origine précise de `DEP0169 url.parse()` non identifiée.
- **A3 :** pas encore de parcours navigateur Playwright/Cypress automatisé.
- **MFA Super-admin :** activation différée à une validation Preview de l'enrôlement et de la récupération.
- **Cron abonnements :** déploiement et secret présents, mais aucun cycle d'exécution réussi observé.
- **Validation manuelle Preview :** à effectuer après le passage complet des contrôles CI, sans publier ni modifier Production.

Les prochaines étapes restent dans l'ordre du plan initial. Aucun correctif de cette PR n'est fusionné ou déployé.


## Suivi opérationnel — 2026-11-11

### État exact des six tâches demandées

| # | Travail | Résultat actuel | État |
|---|---|---|---|
| 1 | Tests navigateur automatisés | Playwright ajouté dans `tests/e2e/restaumax-smoke.spec.ts`, exécution CI isolée Firebase Demo. Les 3 tests (accueil, deep link QR, route gestion) passent sur Chromium. | **Smoke tests terminés ; couverture des parcours métier encore à étendre.** |
| 2 | App Check et commandes à emporter sur Preview | Variables Preview de la branche créées : `FIREBASE_APPCHECK_ENFORCE_PUBLIC_ORDERS=true`. La clé de site App Check existe. Les identifiants Firebase client/serveur Preview ont été vérifiés : `restaumax-demo`. Le garde App Check passe 20 assertions. | **Configuration préparée ; validation HTTP/browser sur Preview bloquée par l'absence de déploiement.** |
| 3 | MFA Super-admin sur Preview | L'écran de connexion traite maintenant les défis Firebase MFA TOTP et SMS. Le drapeau `RESTAUMAX_SUPER_ADMIN_REQUIRE_MFA=true` est limité à la Preview de cette branche. Le test de garde MFA passe 6 assertions. | **Code et configuration préparés ; enrôlement, connexion réelle et récupération non testés sur Preview.** |
| 4 | Exécution réelle du Cron abonnements | `vercel.json` déclare `/api/subscriptions/billing-cycle` à 02:00 UTC chaque jour. Un `CRON_SECRET` sensible, limité à la Preview de la branche, est présent. La suite Firestore Emulator du cycle passe 27 assertions. | **Exécution réelle non prouvée.** Les logs Production sur les 50 dernières minutes ne contiennent pas d'appel au endpoint ; la fenêtre de 7 jours est inaccessible avec la rétention Hobby. Aucun appel manuel au Cron Production n'a été fait, pour ne pas modifier les données financières. |
| 5 | Origine de `DEP0169` | Les actions GitHub `checkout` et `setup-node` ont été mises à jour vers des révisions exécutées sous Node 24. Le warning `DEP0169 url.parse()` n'apparaît plus dans les logs du workflow CI principal contrôlé après cette mise à jour. | **Résolu dans le workflow CI contrôlé ; attribution historique exacte non démontrée.** Le warning distinct `DEP0040 punycode` subsiste. |
| 6 | Tests manuels complets sur Preview | Aucun déploiement Preview de cette branche n'existe. Le projet Vercel renvoie `git.deploymentEnabled=false` et l'historique de déploiement filtré sur la branche est vide. | **Bloqué : pas de cible Preview déployée. Aucun test manuel n'est revendiqué.** |

### Preuves CI sur le commit `67187d26fc5b411cc0d5e6e246fe054d34d6522d`

Les 12 exécutions associées à la PR #110 sur ce commit sont terminées avec succès :
- RestauMax CI ;
- Playwright Browser Smoke Tests ;
- Firestore Emulator strict ;
- Security hardening ;
- Security role regression ;
- Firestore owner binding ;
- Owner refund authorization ;
- PayDunya payment/refund lifecycle ;
- Platform overview privacy ;
- GitHub App installation token compatibility ;
- plus les déclenchements push correspondants de RestauMax CI et Playwright.

Le journal Playwright indique explicitement **3 passed**. La suite principale confirme notamment App Check (20 assertions), MFA (6 assertions) et cycle de facturation abonnements Firestore Emulator (27 assertions). Ces tests CI/émulateur ne remplacent pas une validation réelle sur Preview.

### Garde-fous conservés

- Aucun déploiement créé ; aucune fusion ; aucune modification de `main`.
- Aucune donnée Firebase Production modifiée.
- PayDunya reste en TEST.
- Les variables App Check, MFA et Cron ajoutées sont ciblées sur Preview et limitées à la branche d'audit ; aucune variable Production n'a été modifiée.
- La PR #110 reste en brouillon.

### Conditions pour clôturer les tâches Preview

La configuration Vercel du projet désactive actuellement les déploiements Git automatiques (`git.deploymentEnabled=false`). Tant que cette règle et l'interdiction de déployer pendant l'audit restent en vigueur, les vérifications Preview ne peuvent pas être exécutées. Une fois une Preview autorisée et disponible, il restera à vérifier en conditions réelles : commande à emporter avec App Check valide/absent/invalide ; connexion Super-admin avec TOTP ou SMS et scénario de récupération ; exécution Cron sur les seules données Demo ; puis les parcours métier complets dans le navigateur.
