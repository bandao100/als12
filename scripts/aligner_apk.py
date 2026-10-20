#!/usr/bin/env python3
"""Assemble l'APK final : APK de base (aapt2) + classes.dex, entrées non compressées alignées.

Usage : python3 aligner_apk.py <base.apk> <classes.dex> <sortie.apk>

Remplace « zipalign -p 4 » : chaque entrée stockée sans compression (resources.arsc...)
voit ses données commencer à un multiple de 4 octets, condition imposée par Android 11+.
"""
import sys
import zipfile

ALIGNEMENT = 4


def ecrire(sortie, info, donnees):
    nouvelle = zipfile.ZipInfo(info.filename, date_time=(2026, 1, 1, 0, 0, 0))
    nouvelle.compress_type = info.compress_type
    nouvelle.external_attr = info.external_attr
    nouvelle.create_system = 0
    if nouvelle.compress_type == zipfile.ZIP_STORED:
        # En-tête local = 30 octets + nom + champ « extra » : on complète l'extra pour aligner les données.
        debut = sortie.fp.tell() + 30 + len(nouvelle.filename.encode("utf-8"))
        nouvelle.extra = b"\0" * ((-debut) % ALIGNEMENT)
    sortie.writestr(nouvelle, donnees)


def main(base, dex, cible):
    with zipfile.ZipFile(base) as entree, zipfile.ZipFile(cible, "w") as sortie:
        noms = entree.namelist()
        # AndroidManifest.xml en premier, comme le produit aapt2.
        for nom in sorted(noms, key=lambda n: n != "AndroidManifest.xml"):
            if nom == "classes.dex":
                continue
            ecrire(sortie, entree.getinfo(nom), entree.read(nom))
        info = zipfile.ZipInfo("classes.dex")
        info.compress_type = zipfile.ZIP_DEFLATED
        with open(dex, "rb") as f:
            ecrire(sortie, info, f.read())

    with zipfile.ZipFile(cible) as verif:
        for info in verif.infolist():
            if info.compress_type == zipfile.ZIP_STORED:
                verif.fp.seek(info.header_offset + 26)
                longueurs = verif.fp.read(4)
                debut = info.header_offset + 30 + int.from_bytes(longueurs[:2], "little") \
                    + int.from_bytes(longueurs[2:], "little")
                if debut % ALIGNEMENT:
                    raise SystemExit(f"Alignement incorrect pour {info.filename}")


if __name__ == "__main__":
    if len(sys.argv) != 4:
        raise SystemExit(__doc__)
    main(*sys.argv[1:])
