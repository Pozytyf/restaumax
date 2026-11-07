# Bilan de recette RestauMax — 7 novembre 2026

## Périmètre et règles de validation

Cette recette porte sur le code et les services serveur, les transactions Firestore Emulator, les règles de sécurité et les workflows GitHub. Elle ne vaut pas recette visuelle dans un navigateur.

- Aucun déploiement Vercel (Preview ou Production).
- Aucun déploiement Firebase Production.
- Aucun paiement ou décaissement PayDunya réel ; les tests PayDunya restent en mode TEST/sandbox.
- Les fusions ne sont autorisées qu'après réussite des contrôles sur le SHA exact.

## Commit de code testé

- Branche de travail : `test/pos-kds-cash-e2e`
- SHA testé : `6c0b041542706260992967d14a02c637dcdfbf0d`
- PR : [#47 — POS → cuisine → caisse](https://github.com/Pozytyf/restaumax/pull/47)

## Workflows GitHub sur ce SHA

| Workflow | Résultat | Exécution |
|---|---|---|
| RestauMax CI — TypeScript, tests, build et audit dépendances | Réussi | [42370036903](https://github.com/Pozytyf/restaumax/actions/runs/42370036903) |
| Firestore Emulator & Qualité — transactions, règles, parcours intégrés et build | Réussi | [42370036895](https://github.com/Pozytyf/restaumax/actions/runs/42370036895) |
| Security role regression | Réussi | [42370036828](https://github.com/Pozytyf/restaumax/actions/runs/42370036828) |
| PayDunya payment and refund lifecycle (tests uniquement) | Réussi | [42370036922](https://github.com/Pozytyf/restaumax/actions/runs/42370036922) |

## Critères effectivement réussis

| Domaine / critère | Résultat vérifié |
|---|---|
| Persistance d'intention client et reprise | 22/22 |
| Lot 1 — catalogue, QR et sécurité associée | 51/51 |
| Lot 2 — contrats transactionnels et idempotence | 131/131 |
| QR — scénarios de sécurité | 39/39 |
| QR — transactions réelles sur Firestore Emulator | 23/23 |
| Idempotence transactionnelle des commandes sur Emulator | 36/36 |
| Consommation/restauration du stock sur Emulator | Réussi |
| Liaison propriétaire `ownerUid` et règles Emulator | Réussi |
| Parcours POS configuré → commande → KDS → caisse | 28/28 |
| Encaissements espèces, idempotence et rapprochement | 40/40 |
| Tests de plafonds de rôles, remboursement et confidentialité plateforme | Réussi |
| Tests de cycle PayDunya, callback/rapprochement et isolation des marchands | Réussi en mode TEST |

### Détails du parcours POS → KDS → caisse

Le test transversal utilise les services métier et Firestore Emulator. Il vérifie notamment :

1. Sélection de plusieurs groupes d'options obligatoires dans l'ordre du catalogue.
2. Validation serveur de chaque groupe et rejet d'un groupe obligatoire manquant.
3. Recalcul serveur des prix : prix de base + options + suppléments ; les prix/libellés envoyés par le client ne sont pas fiables.
4. Conservation des options, suppléments et notes dans la commande persistée.
5. Absence de champs `undefined` dans les documents Firestore lorsque les notes ou suppléments facultatifs sont absents.
6. Consommation transactionnelle des ingrédients au démarrage de la préparation.
7. Projection de la commande en ticket KDS, avec options, suppléments, notes et état du suivi de stock.
8. Pointage des lignes cuisine, passage à « prête », puis deux encaissements partiels sur la même commande.
9. Conservation de la progression KDS, idempotence des paiements et concordance du journal de caisse.

Les recettes ou suppléments sans nomenclature dédiée sont explicitement signalés comme suivi de stock partiel ; ils ne sont pas présentés comme consommés automatiquement.

## État des autres modules audités

- **Menu & Plats :** le catalogue Firestore est partagé entre le menu client et le POS ; les tests couvrent la disponibilité et les protections de gestion. Le POS ouvre désormais le configurateur de plat et affiche le prix des options/suppléments.
- **QR Code :** génération après création de table, rotation/révocation, invalidation des sessions et contrôle des commandes sur place vérifiés par les tests.
- **Authentification / rôles :** les tests de plafonds de permissions, de session révoquée, de propriétaire et d'isolation tenant sont verts.
- **Stocks :** consommation et restauration des composants de recettes vérifiées. Le suivi reste partiel pour les options/suppléments non reliés à une nomenclature.
- **Caisse :** sessions, paiements partiels, idempotence, journal et clôture vérifiés par tests automatisés.
- **PayDunya :** les tests automatisés couvrent le cycle et l'isolation des comptes marchands. Aucun test de transaction réelle n'a été effectué.

## Recette complémentaire — cinq chantiers fonctionnels (7 novembre 2026)

### Commit et validation exacte

- Branche : `feat/stock-tax-loyalty-finance-subscriptions`
- SHA validé : `8ded05962ac9eb3d310292b9ea85cc36991429e0`
- PR : [#48 — cinq chantiers fonctionnels](https://github.com/Pozytyf/restaumax/pull/48)

Tous les contrôles ci-dessous ont réussi sur ce SHA exact :

| Contrôle | Résultat |
|---|---|
| TypeScript, tests unitaires, build et audit dépendances | Réussi |
| Firestore Emulator strict | Réussi |
| Sécurité des rôles | Réussi |
| Liaison `ownerUid` | Réussi |
| Cycle PayDunya TEST | Réussi |
| Remboursement / liaison propriétaire | Réussi |
| Vue d'administration plateforme | Réussi |

### Critères réussis

| Domaine | Recette vérifiée |
|---|---|
| Recettes de stock des options et suppléments | Les recettes personnalisées sont résolues et consommées avec les ingrédients principaux ; les identifiants historiques d'extras restent compatibles ; les mouvements conservent le coût unitaire. |
| Fiscalité | Modes HT (taxe ajoutée) et TTC (taxe extraite), calcul serveur, conservation du détail sur commande/paiement, aperçu POS/QR et reçu. |
| Fidélité | Attribution idempotente au paiement intégral en espèces et PayDunya ; base de calcul hors taxes ; contrepassation proportionnelle des points lors des remboursements espèces. |
| Rapports | Ventes HT/TTC, taxes nettes, encaissements, remboursements, coût des marchandises, marge brute, dépenses enregistrées, résultat et écarts de caisse ; export CSV ; détail de caisse protégé par permission. |
| Abonnements | Factures mensuelles/annuelles idempotentes, période de grâce, suspension à échéance, révocation des sessions et QR, renouvellement gratuit, rapprochement manuel audité et réactivation contrôlée. |

### Tests Emulator additionnels

| Suite | Résultat |
|---|---:|
| Contrats transactionnels Firestore | 36/36 |
| POS → commande → stock → KDS → caisse | 28/28 |
| Paiements espèces | 44/44 |
| Facturation et suspension des abonnements | 27 assertions |
| Contrepassation des points sur remboursements | 10 assertions |
| Fidélité et base fiscale hors taxes | 7 assertions |
| Rapports financiers sur Firestore Emulator | 12 assertions |
| Tests de liaison `ownerUid` | Réussis |
| Lots unitaires historiques | Lot 1 : 51/51 ; lot 2 : 131/131 |
| Persistance d'intention | 22/22 |

### État des cinq chantiers

1. **Nomenclatures des options et suppléments — code validé.** Le restaurateur doit encore renseigner les composants et quantités réels pour chaque option/supplément. Tant qu'une nomenclature manque, le ticket et les rapports signalent le suivi partiel ; aucune consommation fictive n'est comptabilisée.
2. **Taxes — code validé.** Le taux reste paramétrable par restaurant. RestauMax ne choisit pas à la place du restaurateur le taux légal applicable : celui-ci doit être confirmé selon son régime fiscal.
3. **Fidélité — code validé.** Le client doit fournir un nom et un téléphone valides. Les points sont crédités sur les ventes hors taxes au règlement intégral. La contrepassation automatique est validée pour les remboursements espèces ; le remboursement Mobile Money PayDunya reste non opérationnel.
4. **Rapports — code validé.** Les coûts historiques absents et les commandes dont le suivi de stock est partiel/ignoré sont signalés comme couverture de marge incomplète. Les dépenses non saisies dans RestauMax ne peuvent pas être incluses.
5. **Abonnements — moteur code validé, activation hébergée en attente.** Le Cron quotidien est déclaré dans `vercel.json`, mais il ne s'exécutera qu'après configuration de `CRON_SECRET` et déploiement d'une version qui contient l'endpoint. Le rapprochement d'un paiement est manuel. Le débit automatique des clients par carte/Mobile Money n'est pas implémenté : aucun mandat ni compte marchand plateforme de prélèvement récurrent n'est configuré. Voir [les consignes d'exploitation](./SUBSCRIPTION_BILLING_OPERATIONS.md).

### Limites de cette recette

- Aucune recette visuelle dans un navigateur hébergé n'a été réalisée : aucun déploiement Vercel Preview ou Production n'a été effectué.
- Aucun déploiement Firebase Production n'a été effectué.
- PayDunya est resté en TEST ; aucune transaction réelle ni aucun remboursement Mobile Money réel n'a été exécuté.
- La recette certifie le code, les services, les règles et les transactions sur émulateur. Elle ne certifie pas l'activation du Cron ni l'expérience visuelle hébergée.

## Conclusion

Les cinq chantiers disposent désormais d'une implémentation dans la branche de recette et leurs suites automatisées sont vertes sur le SHA `8ded05962ac9eb3d310292b9ea85cc36991429e0`. La validation du code est terminée. L'activation opérationnelle de la facturation planifiée et tout débit récurrent restent explicitement en attente des prérequis décrits ci-dessus ; ils ne sont pas présentés comme actifs.
