# RestauMax — Tableau de suivi technique

**Mise à jour :** 9 novembre 2026  
**Référence :** dépôt `Pozytyf/restaumax`, branche `main` au commit `5bd17cde5b7d7204ddf6a536b8779243f10cea32`.

## Légende des états

- **À faire** : travail ou recette non commencé(e).
- **En cours** : travail engagé, contrôles ou intégration en cours.
- **Bloquée** : dépendance ou preuve manquante empêchant de conclure.
- **Validée avec preuve** : résultat confirmé par un test, un contrôle de configuration ou une vérification opérationnelle citée.

Une fonctionnalité présente dans le code n'est pas considérée comme opérationnellement validée tant que son parcours réel n'a pas été testé.

## A. Livraison et sécurité de l'exploitation

| ID | Tâche | État | Preuve / critère de clôture |
|---|---|---|---|
| DEP-01 | Conserver le domaine officiel sur le déploiement restauré `10393cd` | **Validée avec preuve** | Lecture Vercel de l'alias `restaumax.vercel.app` → `dpl_DhwUSucgiXpUFtj4xcXXjiGgSZZK` |
| DEP-02 | Désactiver les déploiements Git automatiques pendant la stabilisation | **En cours** | PR #96 ouverte : `git.deploymentEnabled: false` dans `vercel.json`; intégrer après CI verte, puis vérifier l'absence de nouveau déploiement |
| DEP-03 | Vérifier qu'aucun workflow ou hook indépendant ne publie en Production | **À faire** | Audit des hooks, actions, clés et sources de déploiement Vercel |
| DEP-04 | Préserver les validations GitHub Actions pendant le gel Vercel | **En cours** | Les workflows CI de la PR #96 sont lancés et doivent tous réussir |
| SEC-01 | Initialiser App Check côté navigateur avec la clé de site Production | **Validée avec preuve** | `src/lib/firebase.ts` initialise `ReCaptchaEnterpriseProvider` si la clé est présente; variable de site key détectée en Production |
| SEC-02 | Récupérer un jeton App Check et l'envoyer dans `X-Firebase-AppCheck` | **Validée avec preuve** | `submitOrderWithServerValidation` appelle `getToken(appCheck)` et transmet le jeton |
| SEC-03 | Vérifier le jeton côté Firebase Admin sur les commandes publiques | **Validée avec preuve** | `server.ts` appelle `verifyPublicOrderAppCheck` et utilise `adminAppCheck` |
| SEC-04 | Tester l'acceptation d'un vrai jeton navigateur sur le serveur | **Bloquée** | Nécessite une exécution navigateur réelle et une requête contrôlée; pas de preuve de jeton réel à ce stade |
| SEC-05 | Tester le rejet réel d'un jeton absent, falsifié ou expiré | **En cours** | Tests unitaires du garde App Check présents; recette HTTP réelle encore à réaliser |
| SEC-06 | Activer `FIREBASE_APPCHECK_ENFORCE_PUBLIC_ORDERS=true` en Production | **Bloquée** | Ne pas activer avant SEC-04 et SEC-05; actuellement fail-closed avec HTTP 503 si l'enforcement n'est pas configuré |
| SEC-07 | Vérifier les limites de débit et l'idempotence des commandes publiques | **À faire** | Tests de charge contrôlés, absence de doublons et conservation du panier |
| STO-01 | Finaliser les règles Firebase Storage | **À faire** | Relecture des règles et tests émulateur positifs/négatifs |
| STO-02 | Tester upload, affichage et suppression des photos | **Bloquée** | Les indicateurs d'activation des images ne sont pas configurés en Production; ne pas activer avant tests Storage |

## B. Parcours restaurant

| ID | Tâche | État | Preuve / critère de clôture |
|---|---|---|---|
| MEN-01 | CRUD des plats et catégories avec persistance Firestore | **À faire** | Créer, modifier, désactiver, supprimer puis recharger les données |
| MEN-02 | Prix FCFA, options, suppléments et commentaires | **À faire** | Vérifier calculs, validation et affichage public |
| MEN-03 | Synchroniser catalogue administrateur, menu public et POS | **À faire** | Éliminer les identifiants divergents et prouver une source de vérité |
| MEN-04 | Gérer la disponibilité des plats | **À faire** | Un plat indisponible n'est ni affiché comme commandable ni accepté par l'API |
| QR-01 | Générer automatiquement un QR à la création d'une table | **À faire** | Création d'une table suivie de la génération vérifiée |
| QR-02 | Associer QR, restaurant, table, version et validité | **À faire** | Tests multi-tenant et tests de jeton expiré/révoqué |
| QR-03 | Révoquer immédiatement l'ancien QR lors d'une régénération | **À faire** | Ancien QR refusé; nouveau QR fonctionnel |
| QR-04 | Ouvrir une session client sécurisée | **À faire** | Cookies HttpOnly, CSRF, expiration et révocation vérifiés |
| ORD-01 | Envoyer une commande sur place et à emporter | **À faire** | Parcours réel complet depuis le téléphone |
| ORD-02 | Transmettre les commandes à la caisse, cuisine et bar | **À faire** | Réception et synchronisation de chaque service |
| ORD-03 | Gérer statuts, erreurs réseau, rejets et reprises sans doublon | **À faire** | Tests de bout en bout avec panier conservé |
| POS-01 | Encaissement espèces et gestion des sessions de caisse | **À faire** | Ouverture, mouvement, paiement, clôture et rapprochement |
| POS-02 | Factures, paiements partiels et additions partagées | **À faire** | Tests de calcul et de cohérence financière |
| PAY-01 | Tester les comptes marchands PayDunya propres aux restaurants | **À faire** | Mode TEST uniquement |
| PAY-02 | Vérifier callbacks, signatures, idempotence et rapprochement | **À faire** | Tests de callback valide, invalide, dupliqué et tardif |
| PAY-03 | Garder les paiements LIVE désactivés | **Validée avec preuve** | Variable `PAYDUNYA_LIVE_ENABLED` absente; aucune activation LIVE autorisée |

## C. Gestion et administration

| ID | Tâche | État | Preuve / critère de clôture |
|---|---|---|---|
| INV-01 | Entrées, sorties et ajustements de stock | **À faire** | Journal de mouvements et tests de droits |
| INV-02 | Décrémentation selon les recettes et commandes validées | **À faire** | Tests transactionnels, annulation et absence de double débit |
| INV-03 | Alertes de seuil bas, pertes et inventaires | **À faire** | Scénarios de stock bas et audit des ajustements |
| CRM-01 | Fiche client, recherche et historique de commandes | **À faire** | Parcours réel de création et consultation |
| CRM-02 | Attribution, retrait et utilisation des points fidélité | **En cours** | Endpoint sécurisé PR #95 intégré; recette métier complète à effectuer |
| CRM-03 | Idempotence et journal d'audit des points | **Validée avec preuve** | Couverture ajoutée dans PR #95; revalider via CI globale |
| REP-01 | Chiffre d'affaires, ventes, marges et rapports par période | **À faire** | Réconciliation avec commandes et paiements sources |
| REP-02 | Export et contrôle d'accès aux rapports | **À faire** | Tests d'export et séparation multi-tenant |
| SUB-01 | Forfaits, limites et cycle d'abonnement | **À faire** | Tests de souscription, expiration, suspension et réactivation |
| SUB-02 | Facturation et historique des paiements SaaS | **À faire** | Rapprochement et droits de consultation |
| ADM-01 | Gestion du cycle de vie des restaurants | **À faire** | Suspension, réactivation, suppression logique et conservation historique |
| ADM-02 | Journaux d'audit et supervision plateforme | **À faire** | Traçabilité et contrôle de confidentialité |
| ADM-03 | Vérifier les statistiques globales sans fuite inter-tenant | **À faire** | Tests négatifs multi-restaurant |

## D. Accès et isolation — déjà traités, à ne pas reprogrammer sans régression

| ID | Élément | État | Preuve |
|---|---|---|---|
| IAM-01 | Connexion super-administrateur distincte de la gestion restaurant | **Validée avec preuve** | Parcours confirmé par le propriétaire du projet et PR #93 |
| IAM-02 | Connexions propriétaire et manager | **Validée avec preuve** | Parcours confirmé par le propriétaire du projet |
| IAM-03 | Matrice des six rôles et limites de permissions | **Validée avec preuve** | Workflow de sécurité des rôles réussi sur la PR #96 |
| IAM-04 | Séparation des données entre restaurants | **En cours** | Couverture automatisée existante; recette multi-tenant globale à compléter |

## E. Contrôles GitHub en cours pour la PR #96

PR : https://github.com/Pozytyf/restaumax/pull/96  
Commit : `de894175c7e5b9ab2ea20c46b6017febc759eda7`

| Contrôle | État au dernier relevé |
|---|---|
| RestauMax security hardening | **En cours** |
| Firestore Emulator & Qualité | **En cours** |
| RestauMax CI | **En cours** |
| Security role regression | **Validée avec preuve** |

## Conditions de clôture du gel Vercel

1. Tous les workflows de la PR #96 doivent être verts.
2. La configuration de désactivation des déploiements Git doit être intégrée.
3. Vérifier qu'aucun nouveau déploiement Vercel n'a été créé à la suite de l'intégration.
4. Relire l'alias officiel et confirmer qu'il pointe toujours vers `dpl_DhwUSucgiXpUFtj4xcXXjiGgSZZK`.
5. Toute publication Production ultérieure nécessite une autorisation explicite.

## Conditions de clôture App Check

1. Obtenir un vrai jeton navigateur sur l'origine de test autorisée.
2. Vérifier ce jeton avec Firebase Admin sur le serveur.
3. Prouver les rejets des jetons absents et invalides.
4. Vérifier qu'aucune commande de test n'est enregistrée deux fois.
5. Seulement après ces preuves, proposer l'activation de l'enforcement Production.

**Règle permanente :** aucune tâche ne passe à « Validée avec preuve » sur la seule base de la présence d'un écran ou d'un fichier de code.
