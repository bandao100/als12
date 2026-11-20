"""Affiches des événements.

Toute image envoyée est ouverte, vérifiée, redimensionnée et ré-encodée en WebP :
le fichier stocké ne contient jamais les octets d'origine (ni script caché, ni
métadonnées EXIF comme la position GPS). Son nom est aléatoire.
"""
import os
import re
import secrets

from flask import Blueprint, abort, current_app, send_from_directory
from PIL import Image, ImageOps, UnidentifiedImageError

bp = Blueprint("media", __name__, url_prefix="/media")

ALLOWED_FORMATS = {"JPEG", "PNG", "WEBP"}
MAX_SIDE = 1600
MAX_PIXELS = 40_000_000
NAME_RE = re.compile(r"^[a-f0-9]{24}\.webp$")


class PosterError(Exception):
    pass


def media_folder():
    folder = current_app.config["MEDIA_FOLDER"]
    os.makedirs(os.path.join(folder, "affiches"), exist_ok=True)
    return folder


def save_poster(file_storage):
    """Enregistre une affiche et retourne son nom de fichier. Lève PosterError."""
    if not file_storage or not file_storage.filename:
        raise PosterError("Aucun fichier reçu.")
    Image.MAX_IMAGE_PIXELS = MAX_PIXELS
    try:
        with Image.open(file_storage.stream) as probe:
            if probe.format not in ALLOWED_FORMATS:
                raise PosterError("Format accepté : JPEG, PNG ou WebP.")
            probe.verify()
        file_storage.stream.seek(0)
        with Image.open(file_storage.stream) as img:
            img = ImageOps.exif_transpose(img)
            img = img.convert("RGB")
            img.thumbnail((MAX_SIDE, MAX_SIDE))
            name = secrets.token_hex(12) + ".webp"
            img.save(os.path.join(media_folder(), "affiches", name), "WEBP", quality=82, method=4)
    except PosterError:
        raise
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError, ValueError):
        raise PosterError("Ce fichier n'est pas une image valide.")
    return name


def delete_poster(name):
    if name and NAME_RE.match(name):
        path = os.path.join(media_folder(), "affiches", name)
        if os.path.exists(path):
            os.remove(path)


@bp.route("/affiches/<name>")
def poster(name):
    if not NAME_RE.match(name):
        abort(404)
    response = send_from_directory(os.path.join(media_folder(), "affiches"), name, mimetype="image/webp",
                                   max_age=30 * 24 * 3600)
    # Les affiches sont affichées sur les sites partenaires.
    response.headers["Cross-Origin-Resource-Policy"] = "cross-origin"
    response.headers["Access-Control-Allow-Origin"] = "*"
    return response
