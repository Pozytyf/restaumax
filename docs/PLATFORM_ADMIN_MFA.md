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

Les règles Firestore sont en refus par défaut. Les clients Firebase ne peuvent ni lire ni modifier ces documents.

## Parcours d'enrôlement et de connexion

1. L'administrateur s'authentifie avec Firebase Authentication.
2. Le serveur vérifie que son identité appartient à la liste Super-admin vérifiée ou à un compte délégué actif.
3. S'il n'a pas encore de facteur, le serveur crée un secret temporaire et retourne une URI otpauth pour afficher le QR code. Le secret temporaire est déjà chiffré au repos.
4. L'administrateur saisit un code courant. Le serveur valide ce code, active le facteur et retourne dix codes de secours à usage unique.
5. Après sauvegarde des codes de secours, l'administrateur se déconnecte et se reconnecte.
6. Après le mot de passe Firebase, il doit saisir un TOTP ou un code de secours. Le serveur consomme atomiquement le pas TOTP ou le code de secours, puis crée une session aléatoire dont seul le hash est stocké.
7. Le navigateur reçoit le jeton uniquement dans un cookie `HttpOnly; Secure; SameSite=Strict`, limité à `/api/platform-admin`, avec une durée maximale de quatre heures.

Toutes les actions d'administration plateforme, y compris les lectures, exigent une session MFA valide lorsque `RESTAUMAX_SUPER_ADMIN_REQUIRE_MFA=true`. Les routes de support du restaurant restent dans leur périmètre tenant et ne sont pas transformées en routes super-admin.

## Anti-rejeu et limitation

- Un pas TOTP déjà accepté est rejeté, y compris lors de deux validations concurrentes.
- Les codes de secours sont stockés sous forme d'empreintes et supprimés à la première utilisation.
- Les tentatives de vérification et d'enrôlement sont limitées à huit par compte sur une fenêtre de dix minutes.
- Les sessions sont liées à la version de session Firebase de l'administrateur ; une révocation ou un changement de version invalide les sessions existantes.

## Réinitialisation d'urgence

L'action serveur `mfa_reset` est réservée à un Super-admin disposant lui-même d'une session MFA valide. Elle cible un autre compte administrateur, révoque ses sessions, invalide ses jetons Firebase, supprime son facteur et inscrit une entrée d'audit. Le compte cible doit ensuite se reconnecter et refaire son enrôlement.

Un administrateur ne peut pas réinitialiser lui-même son propre facteur via cette action.

## Activation progressive

La politique obligatoire doit rester désactivée pendant l'enrôlement et les tests. Elle ne peut être activée dans l'environnement Preview qu'après les étapes suivantes pour chacun des comptes concernés :

- `superadmin@restaumax.test`
- `essaidebali@gmail.com`

Pour chaque compte, confirmer l'enrôlement TOTP, se déconnecter, se reconnecter avec le mot de passe, puis valider un nouveau code MFA. Vérifier également qu'une requête API directe sans cookie MFA est refusée et qu'une session expirée ou révoquée ne peut pas être réutilisée.

La variable `RESTAUMAX_SUPER_ADMIN_REQUIRE_MFA=true` ne doit être activée qu'après réussite de ces tests. Le déploiement Production et l'activation de la politique Production nécessitent une procédure de release distincte.
