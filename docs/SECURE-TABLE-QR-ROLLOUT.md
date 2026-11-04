# RestauMax — Déploiement du parcours QR sécurisé

## Variables serveur

Configurer dans l'environnement serveur (jamais dans le bundle navigateur) :

- `FIREBASE_SERVICE_ACCOUNT_JSON` : compte de service Firebase Admin pour les déploiements serverless, ou `GOOGLE_APPLICATION_CREDENTIALS` pour un serveur Node hébergé avec fichier de credentials.
- `APP_ORIGIN` : origine publique canonique en HTTPS, par exemple `https://app.example.com`, sans chemin ni slash final.

Le service utilise le projet et la base Firestore déclarés dans `firebase-applet-config.json`. Ne jamais copier une clé de service dans le dépôt.

## Règles et données Firestore

Le serveur Admin SDK gère exclusivement :

- `restaurants/{slug}/table_qr_tokens/{sha256}`
- `restaurants/{slug}/table_sessions/{sha256}`

Les clients Firestore ne doivent pas lire ni écrire ces collections. Les documents `tables` ne sont plus publics ; les accès de gestion restent soumis aux permissions du restaurant.

Les tables doivent contenir au minimum `tableNumber` et `isActive`. La génération/rotation ajoute et incrémente `qrVersion`.

## Mise en service des QR

1. Déployer les nouvelles règles Firestore avec le code de cette branche.
2. Vérifier que Firebase Admin est opérationnel et que `APP_ORIGIN` correspond au domaine utilisé par les clients.
3. Ouvrir Centre de Gestion → QR & Tables.
4. Pour chaque table active, cliquer sur **Générer le QR sécurisé**, puis télécharger/imprimer le chevalet.
5. Remplacer physiquement les anciens QR. Les anciennes URL `?table=` ne créent plus de session et ne doivent plus être utilisées pour les commandes sur place.
6. Scanner chaque nouveau QR depuis un téléphone réel et vérifier que le menu affiche la bonne table.

Un jeton QR brut n'est communiqué qu'à la création/rotation et ne peut pas être récupéré depuis Firestore. Si le fichier imprimé est perdu, générer un nouveau QR : l'ancien est révoqué automatiquement.

## Contrôles d'acceptation

- QR valide + table active + restaurant ouvert : session HttpOnly créée et table identifiée automatiquement.
- QR révoqué ou remplacé : nouvelle résolution refusée ; sessions existantes invalidées.
- Table inactive ou supprimée : résolution et commande refusées.
- Restaurant suspendu, inactif ou fermé : résolution/commande refusée.
- Cookie absent, session expirée, CSRF absent/invalide ou Origin tiers : commande sur place refusée.
- Une valeur `tableNumber` envoyée par le navigateur n'est jamais utilisée comme autorité.
- À emporter : commande possible sans session de table ; aucune donnée de session client n'est acceptée.

## Limites et précautions

Le QR physique est un secret porteur : une photo ou une copie peut être utilisée jusqu'à révocation/rotation. En cas de QR photographié, perdu ou suspect, utiliser **Révoquer les QR actifs** ou **Renouveler le QR**.

Aucun déploiement de production n'est effectué par cette branche. Le déploiement des règles et la configuration des variables serveur doivent être validés avant ouverture au public.
