# RestauMax — abonnements, formules et promotions plateforme

## Catalogue des formules

La configuration centrale est stockée dans `platform_config/global`.

- `plans` contient de 1 à 20 formules.
- Chaque formule possède un nom unique, une description, un état actif/inactif, un prix mensuel en FCFA et ses droits.
- `planFeatures` est maintenu en miroir pour les contrôles de droits existants.
- Une formule désactivée ne peut plus être attribuée à un nouveau restaurant. Les abonnements existants ne sont pas silencieusement modifiés.

### Droits actuellement contrôlés

| Clé | Fonction |
| --- | --- |
| `kitchenScreen` | Écran cuisine / bar |
| `advancedReports` | Rapports avancés sur période longue |
| `inventoryRecipes` | Stocks et recettes |
| `loyalty` | Programme de fidélité |

Les API serveur et les règles Firestore refusent les fonctionnalités Premium non explicitement accordées. Les anciennes formules non répertoriées, dont « Argent », conservent uniquement l'accès de base à l'écran cuisine jusqu'à attribution manuelle d'une formule reconnue.

## Tarification et périodicités

Le prix de formule est défini au mois. Le tarif de période appliqué à un abonnement est calculé côté serveur :

- Mensuel : prix mensuel × 1
- Trimestriel : prix mensuel × 3
- Annuel : prix mensuel × 12
- Personnalisé : tarif manuel, sans renouvellement automatique

La remise trimestrielle globale `quarterlyDiscountPercent` est configurable de 0 à 100 %. Le montant de base, le taux, le montant de réduction et le net sont enregistrés sur la facture au moment de sa création. Une modification ultérieure de la politique n'altère pas les factures déjà émises.

## Promotions

Les promotions sont enregistrées dans `platform_promotions` et gérées depuis Abonnements et factures.

Chaque promotion contient un nom, un code de suivi, une réduction en pourcentage ou en montant fixe, une période de validité, les formules éligibles, un quota d'utilisations et un état actif/inactif.

- Les promotions sont appliquées automatiquement aux factures de renouvellement éligibles.
- La meilleure réduction entre la promotion et la remise trimestrielle est retenue ; les réductions ne se cumulent pas.
- Le quota est vérifié et incrémenté dans la même transaction Firestore que la facture.
- Les factures conservent un instantané du montant, de la réduction et du code de promotion.
- Les créations, modifications et activations/désactivations sont auditées.

## Santé de la plateforme

Les statuts de santé s'appuient sur des sondes et de la télémétrie disponibles. Une intégration sans mesure reste « non mesurée » ; la présence d'une variable d'environnement ne suffit pas à déclarer un service opérationnel.

- La dernière exécution de facturation doit être un succès, datée dans le passé et âgée de moins de 36 heures.
- La sauvegarde doit être déclarée réussie, datée dans le passé et âgée de moins de 48 heures.
- La sonde de déploiement n'affirme pas l'état Ready de Vercel sans vérification indépendante.
