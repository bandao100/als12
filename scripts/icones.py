#!/usr/bin/env python3
"""Génère les icônes de l'application (maison + barre d'avancement) dans android/res."""
import os
import sys

from PIL import Image, ImageDraw

MARINE = (31, 78, 120, 255)
BLANC = (255, 255, 255, 255)
CIEL = (155, 194, 230, 255)
VERT = (112, 200, 140, 255)

DENSITES = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}


def dessiner(d, cx, cy, u):
    """Dessine le motif centré en (cx, cy) ; u = 1/24 de la taille utile."""
    # Toit
    d.polygon([(cx - 10 * u, cy - 1 * u), (cx, cy - 10 * u), (cx + 10 * u, cy - 1 * u)], fill=BLANC)
    # Corps de la maison
    d.rectangle([cx - 7 * u, cy - 2 * u, cx + 7 * u, cy + 6 * u], fill=BLANC)
    # Porte
    d.rectangle([cx - 1.6 * u, cy + 1.2 * u, cx + 1.6 * u, cy + 6 * u], fill=MARINE)
    # Barre d'avancement
    d.rounded_rectangle([cx - 9 * u, cy + 8 * u, cx + 9 * u, cy + 10.4 * u], radius=1.2 * u, fill=CIEL)
    d.rounded_rectangle([cx - 9 * u, cy + 8 * u, cx + 4.5 * u, cy + 10.4 * u], radius=1.2 * u, fill=VERT)


def icone_classique(taille):
    s = taille * 4
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([s * 0.04, s * 0.04, s * 0.96, s * 0.96], radius=s * 0.2, fill=MARINE)
    dessiner(d, s / 2, s / 2 - s * 0.03, s / 30)
    return img.resize((taille, taille), Image.LANCZOS)


def premier_plan(taille):
    s = taille * 4
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # Zone sûre : 66/108 du cadre
    dessiner(d, s / 2, s / 2 - s * 0.02, s * 66 / 108 / 26)
    return img.resize((taille, taille), Image.LANCZOS)


def main(res):
    for nom, f in DENSITES.items():
        dossier = os.path.join(res, f"mipmap-{nom}")
        os.makedirs(dossier, exist_ok=True)
        icone_classique(round(48 * f)).save(os.path.join(dossier, "ic_launcher.png"))
        premier_plan(round(108 * f)).save(os.path.join(dossier, "ic_launcher_fg.png"))
    adaptatif = os.path.join(res, "mipmap-anydpi-v26")
    os.makedirs(adaptatif, exist_ok=True)
    with open(os.path.join(adaptatif, "ic_launcher.xml"), "w", encoding="utf-8") as f:
        f.write(
            '<?xml version="1.0" encoding="utf-8"?>\n'
            '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
            '    <background android:drawable="@color/marine" />\n'
            '    <foreground android:drawable="@mipmap/ic_launcher_fg" />\n'
            '</adaptive-icon>\n'
        )
    # Icône de la page web (favicon / écran d'accueil navigateur)
    web = os.path.join(os.path.dirname(res), "..", "web")
    if os.path.isdir(web):
        icone_classique(192).save(os.path.join(web, "icone.png"))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "android/res")
