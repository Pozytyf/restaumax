# Recette — stock des personnalisations, fiscalité, fidélité, finances et abonnements

Date de préparation : 7 novembre 2026
Branche : `feat/finance-loyalty-subscriptions-stock`

## 1. Nomenclatures de stock des options et suppléments

- Une fiche recette peut cibler un plat, une option d'un groupe précis ou un supplément.
- Le serveur vérifie que l'option/le supplément appartient réellement au plat indiqué.
- Les identifiants de recettes de personnalisation sont déterministes et séparés des fiches recettes principales.
- Au passage `pending → in_prep`, le serveur agrège les ingrédients du plat, de chaque option choisie et de chaque supplément, puis consomme le stock dans la transaction de commande.
- La consommation est idempotente. Une annulation restaure les quantités réellement consommées, une seule fois.
- Une option ou un supplément sans fiche recette est explicitement marqué non suivi ; le système ne prétend pas que son stock a été déduit.

## 2. Calcul et application des taxes

- Le taux est configurable par restaurant, de 0 à 100 %, avec une précision décimale.
- Deux modes sont supportés : taxe ajoutée au prix (`exclusive`) et taxe incluse dans le prix (`inclusive`).
- Le serveur lit le taux et le mode depuis Firestore ; il ne fait pas confiance à un total ou à un taux envoyés par le navigateur.
- Le sous-total, le taux, le mode, le montant de taxe et le total payable sont figés sur la commande.
- Les paiements partiels répartissent la taxe au prorata et le dernier paiement règle l'écart d'arrondi ; la taxe n'est pas comptée plusieurs fois.
- Les reçus espèces et PayDunya conservent le détail fiscal.
- **À renseigner par chaque restaurant :** le taux réellement applicable selon son régime fiscal. Le taux par défaut est 0 % ; ce code ne remplace pas une validation comptable ou fiscale en Côte d'Ivoire.

## 3. Attribution automatique de fidélité

- Le POS permet d'associer une vente à un client existant lorsque le personnel dispose de `customers.view`.
- Le serveur vérifie que le client appartient au même restaurant que la commande.
- Le barème est configurable : points par tranche de 1 000 FCFA entièrement encaissés ; défaut 1 point, 0 désactive le programme.
- Les points et la dépense cumulée sont crédités uniquement lorsque la commande est intégralement payée, espèces ou PayDunya.
- Un registre `loyaltyTransactions/{orderId}` garantit l'unicité de l'attribution même en cas de callback ou paiement rejoué.
- Une vente sans client associé ne crédite aucun compte.

## 4. Rapports financiers

Le nouvel endpoint serveur, protégé par les permissions et l'identité du restaurant, calcule sur une fenêtre par défaut de 30 jours (maximum 93 jours) :

- commandes terminées et ventes hors taxes ;
- encaissements nets des remboursements et créances restantes ;
- taxes effectivement encaissées ;
- coût des matières consommées à partir du coût unitaire figé au démarrage de préparation ;
- marge brute estimée, dépenses, retraits et net de caisse après sorties.

La marge est calculée uniquement sur les commandes terminées, hors taxes, moins les coûts des consommations non restaurées. Les dépenses non saisies et les ingrédients/options sans nomenclature ne sont pas extrapolés. Ce rapport est une vue de gestion, pas une comptabilité certifiée.

## 5. Facturation récurrente et suspension

- L'option de renouvellement automatique est explicite dans la fiche d'abonnement ; les plans personnalisés ne sont pas renouvelables automatiquement.
- Le job quotidien `/api/subscription-reconcile` crée une facture déterministe à chaque échéance pour les abonnements payants, sans doublon.
- Un délai de grâce de 7 jours (configurable de 1 à 30 jours) est accordé.
- Après expiration du délai sans rapprochement, l'abonnement et le restaurant sont suspendus ; les points d'entrée opérationnels refusent alors les nouvelles opérations.
- Un super-administrateur peut rapprocher une facture avec une référence de transaction vérifiée ; le paiement réactive un restaurant suspendu uniquement par ce mécanisme.
- Les plans gratuits sont renouvelés sans facture de montant nul.

### Dépendances opérationnelles non activables depuis ce dépôt

1. Configurer `CRON_SECRET` dans les variables d'environnement Vercel. Vercel transmet ce secret au cron quotidien.
2. La collecte automatique des fonds de l'abonnement SaaS n'est pas activée : le compte PayDunya des restaurants est isolé par le modèle B et ne doit pas être utilisé pour collecter les abonnements de la plateforme. Il faut un compte marchand distinct appartenant à RestauMax, puis ses identifiants TEST et un contrat de paiement récurrent compatible. En attendant, les factures sont émises automatiquement et leur règlement est rapproché par le super-administrateur.

## Validation

Les tests unitaires ajoutés couvrent les calculs de taxe, l'agrégation financière et l'isolation des rapports, ainsi que la création idempotente de factures, le délai de grâce, la suspension et le rapprochement. Les tests Emulator couvrent la consommation/restauration des recettes de personnalisation et les règles Firestore.

**Aucune recette de production n'est déclarée avant réussite des workflows sur le SHA exact de la PR.** Aucun déploiement Vercel/Firebase Production ni paiement réel n'est autorisé par cette phase.
