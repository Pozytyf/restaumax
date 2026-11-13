# MFA TOTP des administrateurs de plateforme

## Objectif et périmètre

Le MFA de la super-administration RestauMax est géré par le serveur et reste compatible avec Firebase Authentication sur le plan Spark. Il n'utilise pas l'enrôlement TOTP natif Firebase et ne nécessite pas Identity Platform.

Le facteur est un TOTP RFC 6238 (SHA-1, 6 chiffres, période de 30 secondes), compatible avec Google Authenticator, Microsoft Authenticator et les applications respectant le format otpauth.

## Stockage et secrets

La variable serveur `RESTAUMAX_MFA_ENCRYPTION_KEY` doit contenir 32 octets aléatoires encodés en hexadécimal (64 caractères). Elle ne doit jamais être placée dans GitHub, le code client ou un journal.

Les documents sont gérés exclusivement par Firebase Admin SDK :

- `platform_admin_mfa/{uid}` : secret TOTP chiffré AES-256-GCM, état d'enrôlement, dernier pas TOTP consommé et empreintes SHA-256 des codes de secours.
- `platform_admin_mfa_sessions/{sha256(token)}` : sessions MFA courtes, identifiant utilisateur, version de session, expiration et révocation.
- `platform_admin_mfa_attempts/{uid}` : compteur de tentatives et fenêtre de limitation.
- `platform_admin_mfa_recovery_contacts/{uid}` : adresse de récupération indépendante, enregistrée uniquement après validation d'un code e-mail à usage unique.
- `platform_admin_mfa_recovery_contacts_claims/{sha256(email)}` : réservation atomique empêchant qu'une même adresse de récupération soit attribuée à plusieurs administrateurs.
- `platform_admin_mfa_recovery_contact_verifications/{uid}` : vérification temporaire, empreinte HMAC du code, expiration et compteur d'essais.

Les règles Firestore sont en refus par défaut. Les clients Firebase ne peuvent ni lire ni modifier ces documents.

## Parcours d'enrôlement et de connexion

1. L'administrateur s'authentifie avec Firebase Authentication.
2. Le serveur vérifie que son identité appartient à la liste Super-admin vérifiée ou à un compte délégué actif.
3. S'il n'a pas encore de facteur, le serveur crée un secret temporaire et retourne une URI otpauth pour afficher le QR code. Le secret temporaire est déjà chiffré au repos.
4. L'administrateur saisit un code courant. Le serveur valide ce code, active le facteur et retourne dix codes de secours à usage unique.
5. Après sauvegarde des codes de secours, l'administrateur se déconnecte et se reconnecte.
6. Après le mot de passe Firebase, il doit saisir un TOTP ou un code de secours. Le serveur consomme atomiquement le pas TOTP ou le code de secours, puis crée une session aléatoire dont seul le hash est stocké.
7. Le navigateur reçoit le jeton uniquement dans un cookie `HttpOnly; Secure; SameSite=Strict`, limité à `/api/platform-admin`, avec une durée maximale de 90 jours. La session est persistante sur cet appareil jusqu'à son expiration, sa révocation ou un changement de version de session.

Toutes les actions d'administration plateforme, y compris les lectures, exigent une session MFA valide lorsque `RESTAUMAX_SUPER_ADMIN_REQUIRE_MFA=true`. Les routes de support du restaurant restent dans leur périmètre tenant et ne sont pas transformées en routes super-admin.

## Adresse de récupération indépendante

L'adresse de récupération MFA est distincte de l'adresse de connexion Firebase. Elle est associée à l'UID de l'administrateur et ne modifie ni l'adresse Firebase, ni le mot de passe, ni les revendications du compte.

1. Depuis une session de plateforme déjà validée par TOTP ou passkey, l'administrateur saisit une adresse de récupération.
2. Le serveur envoie un code à huit chiffres via Resend. Le code est stocké uniquement sous forme HMAC avec la clé MFA, expire après dix minutes et est limité à trois envois par fenêtre de quinze minutes, avec un délai minimal entre envois.
3. La confirmation exige une session MFA normale et une authentification Firebase récente. Le code est consommé dans une transaction.
4. L'adresse vérifiée est enregistrée sous l'UID ; une réservation par empreinte SHA-256 empêche son attribution à un autre administrateur. Le remplacement d'une adresse libère l'ancienne réservation dans la même transaction.
5. La récupération MFA envoie exclusivement à cette adresse vérifiée. Si aucune adresse n'est configurée, la récupération est refusée sans repli silencieux vers l'adresse Firebase.

Les administrateurs doivent configurer et vérifier cette adresse avant tout incident. Le parcours de récupération reste restreint : il ne donne accès qu'au remplacement du facteur et ne restaure pas directement l'accès au panel.

## Anti-rejeu et limitation

- Un pas TOTP déjà accepté est rejeté, y compris lors de deux validations concurrentes.
- Les codes de secours sont stockés sous forme d'empreintes et supprimés à la première utilisation.
- Les tentatives de vérification et d'enrôlement sont limitées à huit par compte sur une fenêtre de dix minutes.
- Les sessions sont liées à la version de session Firebase de l'administrateur ; une révocation ou un changement de version invalide les sessions existantes.

## Perte du téléphone et récupération

### Renouveler les codes avant épuisement

Tant que l'application TOTP est accessible, l'administrateur peut renouveler ses dix codes depuis le bandeau « Codes de secours MFA » du panel. L'opération exige une session MFA normale déjà valide et un nouveau code TOTP courant. Le serveur consomme ce pas TOTP une seule fois, remplace atomiquement les dix empreintes, journalise l'opération et affiche les nouveaux codes une seule fois. Les anciens codes deviennent immédiatement inutilisables. Le nombre de codes restants est affiché dans le panel.

### Si au moins un code de secours reste disponible

1. Se connecter avec l'adresse e-mail et le mot de passe habituels.
2. À l'écran MFA, saisir un code de secours encore inutilisé (10 caractères hexadécimaux). Le code est consommé atomiquement et ne peut plus être réutilisé.
3. Le serveur crée une session de récupération explicitement marquée `factorSource=recovery`. Cette session n'autorise aucune lecture ni opération du panel.
4. L'application impose immédiatement le remplacement du facteur : scanner le nouveau QR TOTP et confirmer avec un code à six chiffres.
5. La confirmation remplace le secret TOTP précédent et génère dix nouveaux codes de secours. Les anciens codes restants sont invalidés.
6. Enregistrer les nouveaux codes hors ligne, puis utiliser le bouton de fin qui révoque la session de récupération et déconnecte le compte.
7. Se reconnecter avec le nouveau facteur TOTP.

La session de récupération ne peut servir qu'à consulter l'état MFA, démarrer/confirmer le nouvel enrôlement ou se déconnecter. Toute autre action de plateforme est refusée côté serveur. Le mot de passe seul ne permet ni de créer cette session ni de remplacer le facteur.

### Si tous les codes de secours sont épuisés

- Si un autre Super-admin est disponible : celui-ci doit se connecter avec son propre MFA, puis effectuer `mfa_reset` sur le compte bloqué. Cette action cible un autre compte uniquement, révoque ses sessions et jetons Firebase, supprime son facteur et laisse une trace d'audit. Le compte réinitialisé doit ensuite s'enrôler à nouveau.
- Si le compte concerné est le seul Super-admin : aucune réinitialisation autonome par mot de passe n'est prévue. Il faut déclencher une procédure opérateur hors bande avec vérification d'identité indépendante, contrôle à deux personnes et journalisation du ticket d'incident. L'opérateur autorisé doit révoquer les sessions/jetons et supprimer le facteur via l'administration sécurisée, puis le titulaire refait l'enrôlement. Ne jamais ajouter de route publique, de code universel, de lien de contournement ou de désactivation MFA par mot de passe.

### Règles de sécurité

- Les codes de secours sont des secrets à usage unique, stockés uniquement sous forme d'empreintes.
- Un code de secours ne donne qu'une session de récupération restreinte, jamais une session d'administration complète.
- La perte du téléphone doit être suivie immédiatement d'un remplacement TOTP.
- Un reset par un autre Super-admin exige sa propre session MFA valide et ne peut pas se cibler lui-même.
- Toute opération de récupération ou de réinitialisation est journalisée.

## Activation progressive

La politique obligatoire doit rester désactivée pendant l'enrôlement et les tests. Elle ne peut être activée dans l'environnement Preview qu'après les étapes suivantes pour chacun des comptes concernés :

- `superadmin@restaumax.test`
- `essaidebali@gmail.com`

Pour chaque compte, confirmer l'enrôlement TOTP, se déconnecter, se reconnecter avec le mot de passe, puis valider un nouveau code MFA. Vérifier également qu'une requête API directe sans cookie MFA est refusée et qu'une session expirée ou révoquée ne peut pas être réutilisée.

La variable `RESTAUMAX_SUPER_ADMIN_REQUIRE_MFA=true` ne doit être activée qu'après réussite de ces tests. Le déploiement Production et l'activation de la politique Production nécessitent une procédure de release distincte.
