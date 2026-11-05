# Configuration PayDunya — RestauMax

## Prérequis

1. Créer et activer un compte **PayDunya Business**.
2. Dans le tableau de bord, créer une application d'intégration.
3. Commencer en **mode Test** et récupérer les trois clés serveur : Master Key, Private Key et Token.
4. Pour les redistributions aux restaurants, demander/activer explicitement le service **PER (Paiement et Redistribution)** dans la configuration de l'application PayDunya.
5. Chaque restaurant bénéficiaire doit disposer d'un compte PayDunya et fournir un alias de réception vérifié (email, numéro local sans indicatif pays ou identifiant de compte PayDunya).

Ne jamais placer les clés dans Git, dans Firestore, dans le code frontend ou dans un message. Elles doivent être enregistrées uniquement dans les variables d'environnement Vercel.

## Variables Vercel

| Variable | Valeur initiale recommandée |
|---|---|
| `PAYDUNYA_ENABLED` | `false` |
| `PAYDUNYA_MODE` | `test` |
| `PAYDUNYA_MASTER_KEY` | clé privée du compte Test |
| `PAYDUNYA_PRIVATE_KEY` | clé privée du compte Test |
| `PAYDUNYA_TOKEN` | token du compte Test |
| `PAYDUNYA_LIVE_ENABLED` | `false` |
| `PAYDUNYA_PER_ENABLED` | `false` |

Les trois clés PayDunya sont des valeurs **Sensitive** dans Vercel. Configurer d'abord Preview/Test. Ne pas activer les paiements Production à ce stade.

## Séquence d'activation

### 1. Sandbox

Après validation de la création et de la confirmation des factures :

- `PAYDUNYA_ENABLED=true`
- `PAYDUNYA_MODE=test`
- `PAYDUNYA_LIVE_ENABLED=false`
- `PAYDUNYA_PER_ENABLED=false`

### 2. Redistribution PER en sandbox

Activer PER dans le tableau de bord PayDunya, vérifier l'alias de chaque restaurant destinataire, puis seulement :

- `PAYDUNYA_PER_ENABLED=true`

Ne pas déclencher de redistribution réelle depuis le code tant que le bénéficiaire, le montant et la transaction ne sont pas vérifiés.

### 3. Production

La bascule vers le mode réel nécessite une validation distincte :

- clés API Production (différentes des clés Test) ;
- compte PayDunya Business opérationnel ;
- PER activé si le modèle de redistribution est retenu ;
- alias PayDunya de chaque restaurant vérifié ;
- modèle de commission RestauMax et calendrier de reversement définis ;
- tests de bout en bout réussis en sandbox.

Alors seulement, configurer les clés Production et activer explicitement :

- `PAYDUNYA_MODE=live`
- `PAYDUNYA_LIVE_ENABLED=true`
- `PAYDUNYA_ENABLED=true`

## Sécurité et rapprochement

- Les callbacks doivent être authentifiés par le hash SHA-512 de la Master Key puis confirmés auprès de l'API PayDunya.
- Le navigateur ne décide jamais qu'un paiement est réussi.
- Une réponse réseau ambiguë lors d'un transfert PER ne doit jamais déclencher une relance automatique : vérifier le tableau de bord PayDunya et le relevé du compte avant toute nouvelle tentative.
- Les paiements clients et les redistributions aux restaurants sont deux transactions distinctes et doivent rester journalisés séparément.
- Ne jamais utiliser les clés d'exemple visibles dans la documentation PayDunya comme clés réelles.
