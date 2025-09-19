# Changelog

## 0.0.4 - 2025-09-18
- Fix: Empêche le serveur statique de détourner les routes `/covers` et `/api`. Les couvertures se chargent désormais correctement via le cache local.
- Chore: Met à jour l’UA Open Library vers `Bibliomanager2/0.0.4`.

## 0.0.3 - 2025-09-17
- Ajout: Recherche et suggestions depuis Open Library, sélection d’édition, cache des couvertures et pages tablette (ajout, prêts, disponibles).

## 0.0.2 - 2025-09-16
- Corrections de build et ajustements UI.

## 0.0.1 - 2025-09-16
- Initialisation du projet.
## 0.0.5 - 2025-09-18
- Import: Ajoute le scanner universel multi-caméras (sélection du périphérique, bascule rapide, rafraîchissement de la liste) et prise en charge BarcodeDetector/ZXing.
- Données: Attribut `uid` unique par livre (pour RFID/QR) et tri par date d’ajout dans la page d’ajout.
## 0.0.6 - 2025-09-19
- Impression Zebra USB: ajout d’un agent local (EXE/PS1) et d’un bouton d’impression direct “Imprimer (USB Zebra)”.
- ZPL: QR code carré agrandi (~17mm), titre multi-lignes (2 max) sans chevauchement.
- RFID: écriture de l’EPC (96 bits) sur la puce via `^RFW,H,2,6` avant l’impression.
- Persistance serveur: ajout /api/state pour sauvegarder livres/prêts côté serveur.
- Corrections: CORS de l’agent, fallback localhost/127.0.0.1, corrections de build (quotes).
