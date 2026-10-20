package com.colombe3.suivi;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import java.io.File;
import java.io.FileNotFoundException;
import java.io.IOException;

/**
 * Fournit en lecture seule les fichiers du dossier cache/partage (exports Excel, sauvegardes)
 * aux applications choisies pour le partage (WhatsApp, Gmail, Drive...).
 */
public class FichiersPartages extends ContentProvider {

    static final String AUTORITE = "com.colombe3.suivi.fichiers";

    @Override
    public boolean onCreate() {
        return true;
    }

    private File fichier(Uri uri) throws FileNotFoundException {
        String nom = uri.getLastPathSegment();
        if (nom == null || getContext() == null) throw new FileNotFoundException();
        File dossier = new File(getContext().getCacheDir(), "partage");
        File cible = new File(dossier, new File(nom).getName());
        try {
            if (!cible.getCanonicalFile().getParentFile().equals(dossier.getCanonicalFile())) {
                throw new FileNotFoundException();
            }
        } catch (IOException e) {
            throw new FileNotFoundException();
        }
        if (!cible.exists()) throw new FileNotFoundException();
        return cible;
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        return ParcelFileDescriptor.open(fichier(uri), ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] args, String tri) {
        File f;
        try {
            f = fichier(uri);
        } catch (FileNotFoundException e) {
            return null;
        }
        String[] colonnes = projection != null ? projection
                : new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE};
        MatrixCursor curseur = new MatrixCursor(colonnes, 1);
        Object[] ligne = new Object[colonnes.length];
        for (int i = 0; i < colonnes.length; i++) {
            if (OpenableColumns.DISPLAY_NAME.equals(colonnes[i])) {
                ligne[i] = f.getName();
            } else if (OpenableColumns.SIZE.equals(colonnes[i])) {
                ligne[i] = f.length();
            }
        }
        curseur.addRow(ligne);
        return curseur;
    }

    @Override
    public String getType(Uri uri) {
        String nom = uri.getLastPathSegment();
        if (nom == null) return "application/octet-stream";
        if (nom.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
        if (nom.endsWith(".json")) return "application/json";
        if (nom.endsWith(".csv")) return "text/csv";
        if (nom.endsWith(".txt")) return "text/plain";
        return "application/octet-stream";
    }

    @Override
    public Uri insert(Uri uri, ContentValues valeurs) {
        throw new UnsupportedOperationException();
    }

    @Override
    public int delete(Uri uri, String selection, String[] args) {
        throw new UnsupportedOperationException();
    }

    @Override
    public int update(Uri uri, ContentValues valeurs, String selection, String[] args) {
        throw new UnsupportedOperationException();
    }
}
