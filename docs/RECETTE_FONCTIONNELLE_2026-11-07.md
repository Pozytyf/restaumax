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

## Lacunes restantes — ne pas présenter comme livrées

1. **Nomenclatures configurables :** rattacher les options et suppléments à leurs propres composants de stock pour éliminer les états « suivi partiel ».
2. **Taxes :** le taux est enregistrable dans les paramètres, mais le POS conserve actuellement un calcul de taxe à zéro ; le calcul fiscal et son affichage doivent être définis et testés.
3. **Fidélité :** les fiches clients et points existent, mais l'attribution des points n'est pas encore automatisée à partir des ventes encaissées.
4. **Rapports :** les indicateurs présents portent surtout sur les commandes finalisées et les meilleures ventes ; les marges, dépenses et rapprochements financiers complets restent à consolider.
5. **Abonnements RestauMax :** les statuts et dates sont administrables, mais la facturation récurrente, le renouvellement et la suspension automatique à échéance ne sont pas certifiés.
6. **PayDunya :** le paiement Mobile Money des factures partagées entre convives reste désactivé ; les remboursements Mobile Money ne sont pas opérationnels. Le décaissement PUSH ne doit pas être assimilé à un remboursement.
7. **Recette navigateur :** aucune validation visuelle/interactive sur Preview n'a été réalisée, conformément à l'interdiction de déployer sur Vercel. Les tests présents certifient le code, les services et les transactions, pas l'expérience navigateur en environnement hébergé.

## Conclusion

Le commit testé satisfait les workflows CI, Emulator, rôles et PayDunya TEST. Le parcours transversal POS → commande → cuisine → caisse est validé sur Firestore Emulator à 28/28. Les lacunes listées ci-dessus restent ouvertes et doivent être traitées avant de déclarer RestauMax complet ou prêt pour une exploitation réelle.
