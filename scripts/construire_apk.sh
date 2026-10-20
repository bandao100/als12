#!/usr/bin/env bash
# Construit l'APK « Aurore » sans Android Studio ni SDK Android installé.
#
# Usage : scripts/construire_apk.sh [classeur.xlsx]   -> build/Aurore.apk
#
# Avec un classeur Excel, ses données (postes, paiements) sont d'abord converties dans
# web/donnees-initiales.js et embarquées dans l'APK. Sans argument, le fichier
# web/donnees-initiales.js déjà présent est utilisé (application vide s'il n'existe pas).
#
# Prérequis : Linux x86-64, Java 17+, Python 3 (openpyxl), curl, unzip.
# Les outils (aapt2, d8, apksigner, bibliothèque Android 15) sont téléchargés une fois
# dans $OUTILS (par défaut ~/.cache/aurore-outils) et vérifiés par empreinte SHA-256.
set -euo pipefail

RACINE="$(cd "$(dirname "$0")/.." && pwd)"
OUTILS="${OUTILS:-$HOME/.cache/aurore-outils}"
BUILD="$RACINE/build"
VERSION_CODE="${VERSION_CODE:-3}"
VERSION_NOM="${VERSION_NOM:-1.2}"
MIN_SDK=24
CIBLE_SDK=35

# Clé de signature : la même à chaque version, pour pouvoir mettre l'application à jour
# sans la désinstaller (et donc sans perdre les données saisies). Le nom du fichier date
# de la version 1.0 et reste inchangé.
KEYSTORE="${KEYSTORE:-$RACINE/android/colombe3.keystore}"
KEYSTORE_MDP="${KEYSTORE_MDP:-colombe3-suivi}"
KEY_ALIAS="${KEY_ALIAS:-colombe3}"

telecharger() { # url fichier sha256
  local url="$1" cible="$2" empreinte="$3"
  if [ ! -f "$cible" ] || ! echo "$empreinte  $cible" | sha256sum -c --status; then
    echo "Téléchargement de $(basename "$cible")..."
    curl -fsSL --retry 3 -o "$cible.part" "$url"
    echo "$empreinte  $cible.part" | sha256sum -c --status \
      || { echo "Empreinte SHA-256 inattendue pour $url" >&2; rm -f "$cible.part"; exit 1; }
    mv "$cible.part" "$cible"
  fi
}

if [ $# -ge 1 ]; then
  echo "Conversion du classeur $1"
  python3 -I "$RACINE/scripts/excel_vers_donnees.py" "$1" "$RACINE/web/donnees-initiales.js"
fi
[ -f "$RACINE/web/donnees-initiales.js" ] \
  || echo "Attention : web/donnees-initiales.js absent, l'application démarrera sans données."

mkdir -p "$OUTILS"
telecharger "https://github.com/iBotPeaches/Apktool/releases/download/v2.10.0/apktool_2.10.0.jar" \
  "$OUTILS/apktool.jar" c0350abbab5314248dfe2ee0c907def4edd14f6faef1f5d372d3d4abd28f0431
telecharger "https://storage.googleapis.com/r8-releases/raw/8.5.35/r8lib.jar" \
  "$OUTILS/r8lib.jar" 4733945987ee0a840fafc34080b135259e01678412e07212b23f706334290294
telecharger "https://github.com/patrickfav/uber-apk-signer/releases/download/v1.3.0/uber-apk-signer-1.3.0.jar" \
  "$OUTILS/uber-apk-signer.jar" e1299fd6fcf4da527dd53735b56127e8ea922a321128123b9c32d619bba1d835
telecharger "https://repo1.maven.org/maven2/org/robolectric/android-all/15-robolectric-13954326/android-all-15-robolectric-13954326.jar" \
  "$OUTILS/android-all.jar" e17105f6c432357e6bb278a527f8e848d01fc56ccee01be77725bea23d871990

AAPT2="$OUTILS/aapt2"
APKSIGNER="$OUTILS/apksigner.jar"
ANDROID_JAR="$OUTILS/android-all.jar"
# Extraction via un fichier temporaire : une extraction interrompue ne laisse pas d'outil tronqué.
if [ ! -x "$AAPT2" ]; then
  unzip -o -q -p "$OUTILS/apktool.jar" prebuilt/linux/aapt2_64 > "$AAPT2.part"
  chmod +x "$AAPT2.part" && mv "$AAPT2.part" "$AAPT2"
fi
if [ ! -f "$APKSIGNER" ]; then
  unzip -o -q -p "$OUTILS/uber-apk-signer.jar" lib/apksigner_33_0_2.jar > "$APKSIGNER.part"
  mv "$APKSIGNER.part" "$APKSIGNER"
fi

if [ ! -f "$KEYSTORE" ]; then
  echo "Création de la clé de signature $KEYSTORE"
  keytool -genkeypair -keystore "$KEYSTORE" -storetype PKCS12 -alias "$KEY_ALIAS" \
    -storepass "$KEYSTORE_MDP" -keypass "$KEYSTORE_MDP" -keyalg RSA -keysize 2048 -validity 10000 \
    -dname "CN=Aurore, O=Aurore, C=CI"
fi

rm -rf "$BUILD"
mkdir -p "$BUILD/res" "$BUILD/gen" "$BUILD/classes" "$BUILD/dex" "$BUILD/assets/www"

echo "1/5 Application web -> assets"
cp -R "$RACINE/web/." "$BUILD/assets/www/"

echo "2/5 Ressources (aapt2)"
"$AAPT2" compile --dir "$RACINE/android/res" -o "$BUILD/res/ressources.zip"
"$AAPT2" link -o "$BUILD/base.apk" -I "$ANDROID_JAR" \
  --manifest "$RACINE/android/AndroidManifest.xml" \
  --min-sdk-version "$MIN_SDK" --target-sdk-version "$CIBLE_SDK" \
  --version-code "$VERSION_CODE" --version-name "$VERSION_NOM" \
  --java "$BUILD/gen" -A "$BUILD/assets" "$BUILD/res/ressources.zip"

echo "3/5 Compilation Java"
find "$RACINE/android/java" "$BUILD/gen" -name '*.java' > "$BUILD/sources.txt"
javac -nowarn --release 11 -encoding UTF-8 -cp "$ANDROID_JAR" -d "$BUILD/classes" @"$BUILD/sources.txt" 2>&1 \
  | grep -v '^Picked up JAVA_TOOL_OPTIONS' || true
[ -n "$(find "$BUILD/classes" -name 'MainActivity.class')" ] || { echo "Échec de la compilation Java" >&2; exit 1; }

echo "4/5 Conversion DEX (d8)"
mapfile -t CLASSES < <(find "$BUILD/classes" -name '*.class')
java -cp "$OUTILS/r8lib.jar" com.android.tools.r8.D8 --release --min-api "$MIN_SDK" \
  --lib "$ANDROID_JAR" --output "$BUILD/dex" "${CLASSES[@]}" 2>&1 \
  | grep -v '^Picked up JAVA_TOOL_OPTIONS' || true
[ -f "$BUILD/dex/classes.dex" ] || { echo "Échec de d8" >&2; exit 1; }

echo "5/5 Assemblage, alignement et signature"
python3 "$RACINE/scripts/aligner_apk.py" "$BUILD/base.apk" "$BUILD/dex/classes.dex" "$BUILD/aligne.apk"
java -jar "$APKSIGNER" sign --ks "$KEYSTORE" --ks-pass "pass:$KEYSTORE_MDP" --key-pass "pass:$KEYSTORE_MDP" \
  --ks-key-alias "$KEY_ALIAS" --v1-signing-enabled true --v2-signing-enabled true --v3-signing-enabled true \
  --out "$BUILD/Aurore.apk" "$BUILD/aligne.apk" 2>&1 | grep -v '^Picked up JAVA_TOOL_OPTIONS' || true
java -jar "$APKSIGNER" verify "$BUILD/Aurore.apk" 2>/dev/null \
  || { echo "La signature de l'APK n'est pas valide" >&2; exit 1; }

echo "APK prêt : $BUILD/Aurore.apk ($(du -h "$BUILD/Aurore.apk" | cut -f1))"
