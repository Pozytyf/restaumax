# Administration multi-restaurant RestauMax

## Espaces et rôles

RestauMax distingue six rôles métier :

- **Super-admin** : administration globale de la plateforme, création/suspension des restaurants et consultation d'indicateurs agrégés. Aucun accès opérationnel aux commandes, à la caisse ou aux données financières détaillées d'un restaurant.
- **Propriétaire** : contrôle complet de son restaurant et gestion de son personnel.
- **Manager** : gestion opérationnelle dans les limites de sa matrice fondamentale, y compris menu, commandes, caisse, rapports et remboursements.
- **Caissier** : encaissements et opérations de caisse. Les droits supplémentaires d'annulation (`orders.cancel`) et de remboursement (`payments.refund`) sont distincts et doivent être accordés explicitement par le propriétaire, dans les limites du rôle.
- **Serveur** : prise en charge des opérations de service et des commandes autorisées.
- **Cuisine/Bar** : préparation des commandes uniquement ; aucun accès aux rapports financiers.

Un droit individuel ne peut jamais dépasser le plafond du rôle. Un manager ne peut pas gérer les propriétaires ni les autres managers. Un super-admin ne reçoit pas de permissions opérationnelles d'un restaurant.

Les règles Firestore et les API vérifient l'identité Firebase, l'appartenance au restaurant, l'état du compte, la version de session et les permissions côté serveur. Le navigateur ne constitue jamais une source d'autorité.

## Configuration du super-admin

Le super-admin est identifié côté serveur par la configuration protégée `RESTAUMAX_SUPER_ADMIN_EMAILS`. Cette variable ne doit jamais être préfixée par `VITE_` ni exposée au navigateur. Toute modification de configuration doit être suivie d'un déploiement contrôlé.

## Enregistrer un restaurant

Depuis `/admin`, le super-admin utilise **Nouveau restaurant** pour créer l'établissement et son compte propriétaire. Le propriétaire se connecte ensuite à `/gestion`, où le contexte du restaurant est déterminé à partir de son compte et de son rattachement vérifié.

Le restaurant historique de démonstration `chez-awa` reste un enregistrement préexistant ; il ne doit pas être considéré comme un nouveau compte client sans vérification et attribution de propriété.

## Personnel et permissions

Le propriétaire gère les membres de son restaurant. Les droits personnalisés doivent rester dans le plafond du rôle. Les comptes désactivés doivent être bloqués et leurs sessions révoquées. Les anciens comptes utilisant le rôle historique `staff` doivent être reclassés explicitement ; aucune conversion automatique ne doit deviner leur fonction.

Les droits d'annulation et de remboursement sont deux permissions distinctes. Le fait de pouvoir annuler une commande ne donne pas automatiquement le droit de rembourser un paiement.

## Isolation et suspension

Chaque membre est rattaché à un restaurant précis. Les lectures et écritures privées sont limitées à ce restaurant. Un restaurant suspendu ne doit plus permettre les opérations métier ni l'enregistrement de nouvelles commandes. Sa réactivation ne rouvre pas automatiquement le service.

Les indicateurs de la plateforme sont agrégés et expurgés des informations personnelles du propriétaire. Les données financières détaillées restent dans l'espace du restaurant.

## État des fonctions complémentaires

Les éléments suivants ne doivent pas être présentés comme livrés tant que leur implémentation et leurs tests ne sont pas disponibles :

- invitations automatiques par e-mail et parcours sécurisé de première connexion ;
- changement autonome du mot de passe initial et transfert de propriété ;
- facturation/encaissement des abonnements RestauMax ;
- migration assistée et auditée des anciens comptes `staff`.

Les comptes propriétaire et personnel sont créés sans mot de passe prédéfini. Après création, RestauMax demande à Firebase Authentication d'envoyer un e-mail sécurisé de réinitialisation afin que le membre définisse lui-même son mot de passe. Si l'envoi échoue, l'écran de connexion propose « Mot de passe oublié ? ». Une invitation personnalisée avec contenu métier et le transfert de propriété restent des évolutions distinctes.
