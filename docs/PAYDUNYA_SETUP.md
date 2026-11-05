# PayDunya — modèle marchand indépendant RestauMax

## Modèle financier retenu

RestauMax utilise un modèle **un compte marchand PayDunya par restaurant** :

- chaque restaurant connecte ses propres identifiants PayDunya ;
- les paiements clients sont encaissés directement sur le compte PayDunya du restaurant concerné ;
- RestauMax orchestre la création et la vérification des factures, sans recevoir ni conserver les fonds des restaurants ;
- les identifiants d'un restaurant ne doivent jamais être utilisés pour un autre restaurant ;
- un restaurant sans compte marchand actif ne peut pas proposer le paiement Mobile Money via PayDunya.

Aucune redistribution PER vers un compte central RestauMax n'est prévue dans ce modèle. Ne pas activer de flux de redistribution ou de collecte centralisée.

## Configuration d'un restaurant — mode TEST

1. Le propriétaire se connecte à l'espace de gestion du restaurant.
2. Ouvrir le panneau **Compte marchand PayDunya**.
3. Saisir les trois identifiants TEST du compte PayDunya Business du restaurant : Master Key, Private Key et Token.
4. Connecter le compte TEST.
5. Le serveur chiffre les identifiants avec AES-256-GCM avant de les enregistrer dans la sous-collection privée du restaurant.
6. Le navigateur ne reçoit jamais les identifiants stockés. Le propriétaire peut uniquement consulter l'état de connexion.

Les identifiants ne doivent jamais être ajoutés à Git, aux variables VITE, aux documents publics Firestore ou à une conversation. Ne jamais demander au propriétaire de copier ses clés dans le support technique.

## Variables serveur Vercel

| Variable | Usage |
|---|---|
| `PAYDUNYA_CREDENTIALS_ENCRYPTION_KEY` | Clé secrète de chiffrement AES-256-GCM, 64 caractères hexadécimaux (32 octets) |
| `PAYDUNYA_LIVE_ENABLED` | Garde-fou global ; doit rester `false` tant que la mise en production n'est pas autorisée |
| `PAYDUNYA_PUSH_ENABLED` | Garde-fou distinct des décaissements PUSH ; doit rester `false` |

La clé de chiffrement doit être de type **Sensitive/Secret**, générée aléatoirement et définie séparément pour chaque environnement nécessaire. Une modification de cette clé rend illisibles les identifiants chiffrés avec l'ancienne clé : toute rotation exige une migration contrôlée et vérifiée. Ne jamais remplacer la clé simplement pour relancer un déploiement.

Les clés API marchandes TEST ne sont pas des variables globales Vercel : elles sont saisies par le propriétaire dans le panneau du restaurant et chiffrées côté serveur.

## Paiements entrants

- Le serveur calcule le montant à payer à partir du solde de la commande Firestore ; le navigateur ne choisit pas le montant final.
- Les factures sont rattachées au restaurant, à la commande et à une intention idempotente.
- Le navigateur ne peut jamais déclarer un paiement réussi.
- Le callback doit être authentifié par le hash SHA-512 de la Master Key du restaurant, puis le statut doit être confirmé auprès de PayDunya.
- Les commandes avec plusieurs comptes convives ne sont pas encore prises en charge pour Mobile Money ; le paiement espèces reste distinct.
- En cas de résultat fournisseur ambigu, la tentative est bloquée pour rapprochement : aucune nouvelle facture automatique ne doit être créée.

## Remboursements

- Le remboursement espèces est traité côté serveur avec contrôle de rôle, session de caisse, solde remboursable et idempotence.
- Les remboursements Mobile Money via PayDunya ne sont **pas encore opérationnels**. Un décaissement PUSH n'est pas une annulation de paiement entrante et ne doit pas être présenté comme un remboursement fournisseur.
- Le flux PUSH de décaissement reste désactivé par défaut et nécessite une autorisation distincte, des contrôles de bénéficiaire et un rapprochement fiable.

## Activation Production

La configuration Production est volontairement bloquée tant que les validations sandbox, l'isolation entre deux comptes marchands, les callbacks et les procédures de rapprochement ne sont pas terminés et autorisés. Ne jamais activer `PAYDUNYA_LIVE_ENABLED` ou `PAYDUNYA_PUSH_ENABLED` dans le cadre des tests.

La validation technique de l'application ne constitue pas une autorisation d'effectuer des paiements ou décaissements réels.
