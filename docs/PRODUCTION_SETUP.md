# RestauMax — mise en service de production

## 1. Configurer Firebase Admin dans Vercel

Le front-end utilise la configuration publique de Firebase présente dans `firebase-applet-config.json`. Les fonctions serveur de commande nécessitent en plus un compte de service Firebase Admin. Cette clé ne doit jamais être commitée dans GitHub ni exposée au navigateur.

Dans Firebase Console :

1. Ouvrir le projet Firebase utilisé par RestauMax.
2. Aller dans **Paramètres du projet → Comptes de service**.
3. Générer une clé privée JSON pour le compte de service.
4. Dans Vercel, ouvrir le projet **restaumax → Settings → Environment Variables**.
5. Créer la variable secrète `FIREBASE_SERVICE_ACCOUNT_JSON` avec le contenu JSON complet.
6. L'activer au minimum pour **Production**. Ajouter Preview/Development si ces environnements doivent également traiter des commandes.
7. Redéployer la branche `main`.

Ne jamais mettre cette clé dans `firebase-applet-config.json`, dans le code client, ni dans un fichier versionné.

L'API `/api/health` indique `hasAdminDb: true` lorsque le SDK administrateur est initialisé. Tant que cette valeur est fausse, `/api/orders` refuse volontairement les écritures avec HTTP 503.

## 2. Créer le premier compte gestionnaire

1. Dans Firebase Console → Authentication, créer l'utilisateur avec son adresse e-mail et son mot de passe.
2. Dans un terminal sécurisé, définir `FIREBASE_SERVICE_ACCOUNT_JSON` ou `GOOGLE_APPLICATION_CREDENTIALS`.
3. Exécuter :

```bash
node scripts/provision-manager.mjs admin@votre-restaurant.ci admin chez-awa
```

Le script crée le document d'autorisation `managers/{uid}`. Il ne crée pas de mot de passe et ne modifie pas le compte Authentication.

Pour un gestionnaire limité à un restaurant :

```bash
node scripts/provision-manager.mjs manager@votre-restaurant.ci manager chez-awa
```

## 3. Initialiser le catalogue

Après avoir configuré les identifiants administrateur, vérifier les données puis lancer le seed non destructif :

```bash
node scripts/seed-catalog.mjs --merge
```

Le mode `--merge` ajoute ou met à jour les données de démonstration prévues sans supprimer les documents personnalisés existants. Vérifier le catalogue et les tables dans le Centre de Gestion avant d'ouvrir le service.

## 4. Vérifications de mise en service

- `/` : page d'accueil RestauMax.
- `/r/chez-awa?table=4` : menu client avec contexte de table.
- `/gestion` : connexion gestionnaire puis catalogue et QR des tables.
- `/staff` : espace opérationnel.
- `/api/health` : état du serveur et de Firebase Admin.
- `/api/orders` : endpoint POST de création de commande, avec validation serveur et idempotence.

Les routes applicatives sont réécrites vers `index.html` par `vercel.json`; les endpoints `/api/*` restent des fonctions serveur distinctes.

## 5. Paiements Mobile Money

Le projet ne doit pas marquer un paiement Mobile Money comme réussi sur la seule base d'un retour navigateur. L'intégration doit confirmer chaque transaction côté serveur auprès du prestataire, puis enregistrer le résultat dans Firestore. Les clés marchandes et le compte de règlement du restaurant devront être configurés avant l'activation des paiements réels.
