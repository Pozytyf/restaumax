# Administration multi-restaurant RestauMax

## Espaces et rôles

- **Super-administrateur** : accès global à `/admin`. Il enregistre les restaurants, crée le compte du propriétaire et peut suspendre/réactiver un établissement.
- **Propriétaire** : accès à `/gestion` sur son restaurant. Il dispose de tous les droits métier et gère les comptes du personnel.
- **Gérant / personnel** : accès au seul restaurant auquel le compte est rattaché. Le propriétaire choisit les autorisations métier accordées.

Les rôles et permissions sont stockés dans les Firebase Custom Claims et dans les documents de confiance `/managers/{uid}`. Les règles Firestore vérifient le restaurant ciblé, le rôle, l'autorisation et l'état actif du compte. Les API d'administration vérifient le Firebase ID token côté serveur et ne font jamais confiance à un rôle fourni par le navigateur.

## Configuration initiale du super-administrateur

1. Créer ou choisir un compte utilisateur dans Firebase Authentication (e-mail et mot de passe).
2. Dans Vercel, ouvrir le projet RestauMax puis **Settings → Environment Variables**.
3. Ajouter `RESTAUMAX_SUPER_ADMIN_EMAILS` avec l'adresse e-mail exacte du compte, en cible **Production**. Plusieurs adresses sont possibles, séparées par des virgules.
4. Redéployer Production pour charger la variable.
5. Ouvrir `https://restaumax.vercel.app/admin` et se connecter avec ce compte Firebase.

Ne jamais ajouter cette variable avec le préfixe `VITE_` : elle doit rester côté serveur.

## Enregistrer un restaurant

Depuis `/admin`, utiliser **Nouveau restaurant**. Le super-administrateur renseigne le nom du restaurant, le nom et l'e-mail du propriétaire, ainsi qu'un mot de passe initial d'au moins 10 caractères. RestauMax crée le compte Firebase, attribue le rôle propriétaire, crée le document restaurant et rattache le compte à ce restaurant.

Le propriétaire se connecte ensuite sur `/gestion`. Le contexte restaurant est résolu depuis son compte Firebase. Il peut créer son personnel dans **Personnel et rôles**.

## Permissions du personnel

Le propriétaire peut attribuer et modifier les droits suivants :
- consultation et gestion du menu ;
- consultation et gestion des commandes ;
- consultation et gestion des tables ;
- accès au terminal POS ;
- accès à l'écran cuisine ;
- consultation et gestion de la caisse ;
- consultation des rapports ;
- consultation et gestion du personnel ;
- consultation et gestion des paramètres.

Un compte désactivé est bloqué côté Auth et ses sessions sont révoquées. Les règles Firestore consultent aussi l'état du document de confiance pour empêcher la poursuite des accès avec un ancien jeton.

## Isolation et suspension

Chaque compte de gestion possède un `restaurantSlug`. Les lectures et écritures privées sont limitées à ce restaurant. Un restaurant suspendu ne permet plus les opérations de gestion ni l'enregistrement de nouvelles commandes. Sa suspension ferme également le service ; la réactivation ne rouvre pas automatiquement le restaurant.

## Limites actuelles

- Les comptes sont créés avec un mot de passe initial saisi par l'administrateur ou le propriétaire. Il faut le transmettre par un canal privé et organiser son changement dès la première connexion.
- Le module d'abonnement/facturation, l'envoi automatique d'invitations e-mail et le transfert de propriété ne sont pas encore implémentés.
- Le restaurant de démonstration historique `chez-awa` reste un enregistrement de démonstration préexistant ; son propriétaire doit être attribué séparément si ce restaurant doit devenir un compte client réel.
