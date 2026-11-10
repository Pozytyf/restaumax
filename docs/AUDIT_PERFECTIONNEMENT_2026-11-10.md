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
- Fichiers : `src/components/restaumax/TableQrGeneratorView.tsx`, `src/lib/firebase.ts`, `server.ts`, règles Firestore.
- Constat : le contrôle de doublon est effectué dans la liste locale, puis `persistTable` fait un `setDoc` direct. Deux gestionnaires peuvent créer simultanément le même numéro. Le POS résout ensuite la table à partir du numéro, ce qui peut rendre l'affectation ambiguë.
- Action : ajouter une création serveur transactionnelle et un index unique déterministe avant de modifier le flux.
- Non-régression : deux créations concurrentes du même numéro ; une seule doit réussir.

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
- Action : conserver ce comportement fail-closed et compléter les tests d'options/suppléments manquants ; aucun défaut critique n'est confirmé à ce stade.

### 5. Cuisine / Bar

**K1 — Filtres de station inactifs**
- Priorité : haute.
- Fichiers : `src/components/kds/KdsView.tsx`, `src/utils/kitchenTicket.ts`, `src/server/orderService.ts`, `src/types/restaumax.ts`, `src/types/pos.ts`.
- Constat : `filterStation` change d'état mais ne filtre pas les tickets ; le mapping persistant attribue `course: 'plat'` à toutes les lignes ; aucun onglet Bar n'est rendu.
- Correction : conserver la catégorie catalogue dans les lignes de commande, projeter Grillades/Plats/Boissons et filtrer les lignes par station, avec un onglet Bar.
- Non-régression : commande mixte grillades + plat + boisson ; chaque station ne voit que ses lignes ; l'état « prêt » reste bloqué tant que toutes les lignes du ticket ne sont pas terminées.

**K2 — Raccourcis clavier perturbant l'accessibilité**
- Priorité : moyenne.
- Fichier : `src/components/kds/KdsView.tsx`.
- Constat : Tab/Maj+Tab sont interceptées comme raccourcis de navigation ; Entrée/Espace peuvent aussi détourner l'activation native d'un contrôle focalisé.
- Correction : ne jamais intercepter Tab ; suspendre les raccourcis globaux lorsque le focus est sur un contrôle interactif.
- Non-régression : navigation clavier standard entre les boutons, raccourcis KDS actifs hors contrôles.

**K3 — Confirmation KDS prématurée**
- Priorité : moyenne, à vérifier.
- Constat : le message « ticket prêt » est affiché avant confirmation de la mise à jour serveur.
- Action : faire attendre le résultat serveur avant d'afficher un succès.

### 6. Menu, clients et fidélité

**C1 — Course de doublons dans la création des clients**
- Priorité : haute.
- Fichiers : `src/components/restaumax/RestaurantAdminModuleView.tsx`, `firestore.rules`, `src/server/loyaltyService.ts`.
- Constat : vérification par requête puis `addDoc` séparé ; deux créations concurrentes peuvent passer le contrôle. Le service fidélité crée déjà un document déterministe `loyalty_<hash téléphone>`.
- Correction : création client via API/Admin SDK transactionnelle, identifiant cohérent avec le service fidélité, et refus de création directe par le SDK client.
- Non-régression : deux requêtes concurrentes avec le même numéro ; une seule fiche ; les points automatiques se rattachent à la même fiche.

**C2 — Suppression de fiche et historique fidélité**
- Priorité : moyenne, à décider dans le module clients.
- Constat : la suppression de la fiche client ne supprime pas le ledger fidélité ; le solde peut devenir inaccessible depuis le répertoire.
- Action : évaluer l'archivage logique plutôt que la suppression physique ; préserver l'historique.

**M1 — Catalogue public**
- La réponse publique filtre les articles indisponibles/épuisés et exclut les champs internes ; les tests de sécurité du menu sont présents.
- Les options, suppléments, prix FCFA et fiches de recettes sont déjà représentés dans le code.
- Aucun défaut critique confirmé à ce stade.

### 7. Administration, abonnements et ergonomie

**A1 — Documentation Cron obsolète**
- Fichiers : `vercel.json`, `docs/SUBSCRIPTION_BILLING_OPERATIONS.md`.
- Constat : le Cron quotidien à 02:00 UTC est dans la version Production et `CRON_SECRET` est présent ; le document indique encore qu'un déploiement et la définition du secret sont à faire.
- Correction : actualiser le statut documentaire, sans prétendre que l'exécution réelle a été observée. Les journaux disponibles ne permettent pas de confirmer un cycle réussi.
- Limite : génération des factures et suspension automatisées ; encaissement d'abonnement manuel par le Super-admin.

**A2 — Dépréciation Node**
- Les journaux Vercel signalent `DEP0169 url.parse()` de façon répétée sur des routes utilisant Firebase Admin. Aucun crash applicatif correspondant n'est établi.
- Action : tracer la dépendance exacte via les tests CI avec `NODE_OPTIONS=--trace-deprecation`, puis mettre à jour uniquement la dépendance responsable.

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
