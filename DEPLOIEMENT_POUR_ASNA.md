# Transmission de la V3.1 à Asna

Cette archive correspond au site complet. Son code doit être ajouté à la racine du dépôt GitHub `Ervan-Marduel/RELAISCHALEUR`, sans supprimer `index.html` ni `.github/workflows/pages.yml` (page de démonstration existante).

## Ce que contient la V3.1

- Site public : chauffage, climatisation, professionnels, demande et textes juridiques provisoires.
- Simulateurs et parcours de précommande chauffage/climatisation.
- Administration des demandes et du parc ; bons de remise/reprise ; constats ; inspections ; notifications.
- SQL et migrations PostgreSQL ; tests et guide d’installation.

## Ce que GitHub Pages n’exécute pas

L’application est une solution Next.js avec routes serveur et PostgreSQL. Le lien GitHub Pages ne peut afficher que la **démo statique** et ne peut pas donner accès aux précommandes ou au back-office de la V3.1.

## Prochain déploiement pour recette (sans ouverture commerciale)

1. Séparer les services et bases de démonstration des futurs services de production.
2. Installer l’application sur un hébergement compatible Next.js serveur et une base PostgreSQL de test.
3. Définir le mode préproduction et un mot de passe ; ne publier aucun secret GitHub.
4. Appliquer les migrations selon `docs/MISE_EN_LIGNE.md`.
5. Vérifier l’accès privé, les pages, les simulations et le parcours réel selon `docs/RECETTE_PARCOURS.md`.

Cette archive n’est **pas** une preuve que l’environnement de recette est déployé.
