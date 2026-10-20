#!/usr/bin/env python3
"""Assemblage et contrôle de l'APK.

  python3 aligner_apk.py <base.apk> <classes.dex> <sortie.apk>   assemble l'APK (non signé)
  python3 aligner_apk.py --verifier <app.apk>                    contrôle l'APK signé

Les entrées non compressées (resources.arsc, images) sont alignées sur 4 octets comme le fait
zipalign : bloc « extra » 0xD935 dans l'en-tête local uniquement (apksigner le conserve).
Le contrôle vérifie ensuite, sur l'APK signé, cet alignement (exigence d'Android 11+) et que
tous les champs « extra » sont bien formés.
"""
import struct
import sys
import zipfile
import zlib

ALIGNEMENT = 4


def assembler(base, dex, cible):
    """Écrit l'archive à la main pour placer le bourrage d'alignement au format officiel
    (bloc « extra » 0xD935, en-tête local seulement, comme zipalign et apksigner)."""
    with zipfile.ZipFile(base) as entree:
        noms = sorted((n for n in entree.namelist() if n != "classes.dex"),
                      key=lambda n: n != "AndroidManifest.xml")
        contenus = [(n, entree.getinfo(n).compress_type == zipfile.ZIP_STORED, entree.read(n)) for n in noms]
    with open(dex, "rb") as f:
        contenus.append(("classes.dex", False, f.read()))

    heure, jour = 0, ((2026 - 1980) << 9) | (1 << 5) | 1   # 01/01/2026 00:00 au format MS-DOS
    centrale = bytearray()
    with open(cible, "wb") as sortie:
        for nom, stocke, donnees in contenus:
            nom_octets = nom.encode("utf-8")
            crc = zlib.crc32(donnees) & 0xFFFFFFFF
            if stocke:
                methode, compresse = 0, donnees
            else:
                compresseur = zlib.compressobj(9, zlib.DEFLATED, -15)
                methode, compresse = 8, compresseur.compress(donnees) + compresseur.flush()
            decalage = sortie.tell()
            extra = b""
            if stocke:
                debut = decalage + 30 + len(nom_octets)
                longueur = 6 + (-(debut + 6)) % ALIGNEMENT
                extra = struct.pack("<HHH", 0xD935, longueur - 4, ALIGNEMENT) + b"\0" * (longueur - 6)
            drapeaux = 0x800 if any(ord(c) > 127 for c in nom) else 0
            sortie.write(struct.pack("<IHHHHHIIIHH", 0x04034B50, 20, drapeaux, methode, heure, jour,
                                     crc, len(compresse), len(donnees), len(nom_octets), len(extra)))
            sortie.write(nom_octets + extra + compresse)
            centrale += struct.pack("<IHHHHHHIIIHHHHHII", 0x02014B50, 20, 20, drapeaux, methode, heure, jour,
                                    crc, len(compresse), len(donnees), len(nom_octets), 0, 0, 0, 0, 0, decalage)
            centrale += nom_octets
        debut_centrale = sortie.tell()
        sortie.write(centrale)
        sortie.write(struct.pack("<IHHHHIIH", 0x06054B50, 0, 0, len(contenus), len(contenus),
                                 len(centrale), debut_centrale, 0))


def extra_bien_forme(extra):
    """Un champ « extra » est une suite de blocs : identifiant (2 o), taille (2 o), données."""
    i = 0
    while i < len(extra):
        if i + 4 > len(extra):
            return False
        _, taille = struct.unpack_from("<HH", extra, i)
        i += 4 + taille
    return i == len(extra)


def verifier(apk):
    erreurs = []
    with open(apk, "rb") as f:
        octets = f.read()
    with zipfile.ZipFile(apk) as z:
        if z.testzip() is not None:
            erreurs.append("archive corrompue")
        for info in z.infolist():
            if not extra_bien_forme(info.extra):
                erreurs.append(f"{info.filename} : extra du répertoire central mal formé")
            debut = info.header_offset
            longueur_nom, longueur_extra = struct.unpack_from("<HH", octets, debut + 26)
            extra_local = octets[debut + 30 + longueur_nom:debut + 30 + longueur_nom + longueur_extra]
            if not extra_bien_forme(extra_local):
                erreurs.append(f"{info.filename} : extra local mal formé")
            if info.compress_type == zipfile.ZIP_STORED and (debut + 30 + longueur_nom + longueur_extra) % ALIGNEMENT:
                erreurs.append(f"{info.filename} : données non alignées sur {ALIGNEMENT} octets")
        if z.getinfo("resources.arsc").compress_type != zipfile.ZIP_STORED:
            erreurs.append("resources.arsc doit être stocké sans compression")
    if erreurs:
        raise SystemExit("APK invalide :\n  " + "\n  ".join(erreurs))
    print("Structure de l'APK conforme (alignement, champs extra, resources.arsc)")


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "--verifier":
        verifier(sys.argv[2])
    elif len(sys.argv) == 4:
        assembler(*sys.argv[1:])
    else:
        raise SystemExit(__doc__)
