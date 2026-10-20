package com.colombe3.suivi;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ContentValues;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * Coquille Android : affiche l'application web embarquée (assets/www) dans une WebView
 * et lui fournit, via l'objet JavaScript « AndroidPont », le stockage des données,
 * le partage et l'enregistrement de fichiers.
 */
public class MainActivity extends Activity {

    private static final String HOTE = "appassets.androidplatform.net";
    private static final String ACCUEIL = "https://" + HOTE + "/index.html";
    private static final int DEMANDE_IMPORT = 1;
    private static final int DEMANDE_ENREGISTRER = 2;

    private WebView web;
    private FrameLayout cadre;
    private ValueCallback<Uri[]> rappelFichier;
    private byte[] fichierEnAttente;
    private float insetHaut;
    private float insetBas;

    @Override
    protected void onCreate(Bundle etat) {
        super.onCreate(etat);
        cadre = new FrameLayout(this);
        web = new WebView(this);
        cadre.addView(web, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(cadre);
        configurerBarresSysteme();

        WebSettings reglages = web.getSettings();
        reglages.setJavaScriptEnabled(true);
        reglages.setDomStorageEnabled(true);
        reglages.setAllowFileAccess(false);
        // Nécessaire pour lire le fichier choisi lors de la restauration d'une sauvegarde.
        reglages.setAllowContentAccess(true);
        reglages.setMediaPlaybackRequiresUserGesture(true);
        // Suit la taille de police du téléphone, plafonnée à 130 % pour préserver la mise en page.
        float echelle = getResources().getConfiguration().fontScale;
        reglages.setTextZoom(Math.round(100 * Math.max(1f, Math.min(echelle, 1.3f))));

        web.addJavascriptInterface(new Pont(), "AndroidPont");
        web.setWebViewClient(new ClientWeb());
        web.setWebChromeClient(new ClientChrome());

        if (etat == null || web.restoreState(etat) == null) {
            web.loadUrl(ACCUEIL);
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle etat) {
        super.onSaveInstanceState(etat);
        if (web != null) {
            web.saveState(etat);
        }
    }

    @Override
    public void onBackPressed() {
        if (web == null) {
            super.onBackPressed();
            return;
        }
        web.evaluateJavascript("window.retourArriere ? window.retourArriere() : false", valeur -> {
            if (!"true".equals(valeur)) {
                MainActivity.super.onBackPressed();
            }
        });
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.destroy();
        }
        super.onDestroy();
    }

    // ------------------------------------------------------------------ Barres système

    private boolean modeSombre() {
        int mode = getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
        return mode == Configuration.UI_MODE_NIGHT_YES;
    }

    private void configurerBarresSysteme() {
        if (Build.VERSION.SDK_INT >= 30) {
            // Affichage bord à bord : la page web gère elle-même les marges des barres système.
            getWindow().setDecorFitsSystemWindows(false);
            getWindow().setStatusBarColor(Color.TRANSPARENT);
            getWindow().setNavigationBarColor(Color.TRANSPARENT);
            WindowInsetsController controleur = getWindow().getInsetsController();
            if (controleur != null) {
                int clair = modeSombre() ? 0 : WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                controleur.setSystemBarsAppearance(clair,
                        WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                                | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
            }
            cadre.setOnApplyWindowInsetsListener((vue, insets) -> {
                Insets barres = insets.getInsets(
                        WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                Insets clavier = insets.getInsets(WindowInsets.Type.ime());
                float densite = getResources().getDisplayMetrics().density;
                insetHaut = barres.top / densite;
                insetBas = clavier.bottom > 0 ? 0 : barres.bottom / densite;
                // Le clavier réduit la zone de la WebView pour que le champ actif reste visible.
                vue.setPadding(barres.left, 0, barres.right, clavier.bottom);
                transmettreInsets();
                return WindowInsets.CONSUMED;
            });
        } else {
            getWindow().setStatusBarColor(Color.parseColor("#1F4E78"));
            getWindow().setNavigationBarColor(Color.BLACK);
        }
    }

    private void transmettreInsets() {
        if (web == null) return;
        String js = "window.appliquerMarges && window.appliquerMarges(" + insetHaut + "," + insetBas + ")";
        web.evaluateJavascript(js, null);
    }

    // ------------------------------------------------------------------ Navigation

    private class ClientWeb extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView vue, WebResourceRequest requete) {
            Uri url = requete.getUrl();
            if (!HOTE.equals(url.getHost())) {
                return null;
            }
            String chemin = url.getPath();
            if (chemin == null || chemin.isEmpty() || chemin.equals("/")) {
                chemin = "/index.html";
            }
            if (chemin.contains("..")) {
                return new WebResourceResponse("text/plain", "utf-8", 403, "Interdit", null, vide());
            }
            try {
                InputStream flux = getAssets().open("www" + chemin);
                return new WebResourceResponse(typeMime(chemin), "utf-8", flux);
            } catch (IOException e) {
                return new WebResourceResponse("text/plain", "utf-8", 404, "Introuvable", null, vide());
            }
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView vue, WebResourceRequest requete) {
            return ouvrirLienExterne(requete.getUrl());
        }

        /** Android 5 et 6 appellent cette variante plutôt que la précédente. */
        @Override
        @SuppressWarnings("deprecation")
        public boolean shouldOverrideUrlLoading(WebView vue, String url) {
            return ouvrirLienExterne(Uri.parse(url));
        }

        private boolean ouvrirLienExterne(Uri url) {
            if (HOTE.equals(url.getHost())) {
                return false;
            }
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, url));
            } catch (ActivityNotFoundException ignore) {
                // Aucune application pour ouvrir ce lien.
            }
            return true;
        }

        @Override
        public boolean onRenderProcessGone(WebView vue, RenderProcessGoneDetail detail) {
            // Sans ce traitement, Android ferme l'application. Les données sont déjà enregistrées :
            // on libère la WebView et on recrée l'écran.
            if (vue == web) {
                cadre.removeView(web);
                web.destroy();
                web = null;
                recreate();
            }
            return true;
        }

        @Override
        public void onPageFinished(WebView vue, String url) {
            transmettreInsets();
        }
    }

    private static InputStream vide() {
        return new ByteArrayInputStream(new byte[0]);
    }

    private static String typeMime(String chemin) {
        String c = chemin.toLowerCase();
        if (c.endsWith(".html")) return "text/html";
        if (c.endsWith(".js")) return "application/javascript";
        if (c.endsWith(".css")) return "text/css";
        if (c.endsWith(".png")) return "image/png";
        if (c.endsWith(".svg")) return "image/svg+xml";
        if (c.endsWith(".json")) return "application/json";
        if (c.endsWith(".woff2")) return "font/woff2";
        return "application/octet-stream";
    }

    private class ClientChrome extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView vue, ValueCallback<Uri[]> rappel,
                                         FileChooserParams parametres) {
            if (rappelFichier != null) {
                rappelFichier.onReceiveValue(null);
            }
            rappelFichier = rappel;
            Intent choix = new Intent(Intent.ACTION_GET_CONTENT);
            choix.addCategory(Intent.CATEGORY_OPENABLE);
            choix.setType("*/*");
            try {
                startActivityForResult(Intent.createChooser(choix, "Choisir un fichier"), DEMANDE_IMPORT);
            } catch (ActivityNotFoundException e) {
                rappelFichier = null;
                return false;
            }
            return true;
        }
    }

    @Override
    protected void onActivityResult(int demande, int resultat, Intent donnees) {
        super.onActivityResult(demande, resultat, donnees);
        if (demande == DEMANDE_IMPORT) {
            if (rappelFichier != null) {
                Uri[] choisis = null;
                if (resultat == RESULT_OK && donnees != null && donnees.getData() != null) {
                    choisis = new Uri[]{donnees.getData()};
                }
                rappelFichier.onReceiveValue(choisis);
                rappelFichier = null;
            }
        } else if (demande == DEMANDE_ENREGISTRER) {
            byte[] contenu = fichierEnAttente;
            fichierEnAttente = null;
            if (resultat != RESULT_OK || donnees == null || donnees.getData() == null || contenu == null) {
                return;
            }
            try (OutputStream sortie = getContentResolver().openOutputStream(donnees.getData())) {
                if (sortie == null) throw new IOException("flux indisponible");
                sortie.write(contenu);
                annoncer("Fichier enregistré");
            } catch (IOException e) {
                annoncer("Échec de l'enregistrement : " + e.getMessage());
            }
        }
    }

    private void annoncer(String message) {
        runOnUiThread(() -> Toast.makeText(this, message, Toast.LENGTH_LONG).show());
    }

    // ------------------------------------------------------------------ Pont JavaScript

    private File fichierDonnees() {
        return new File(getFilesDir(), "donnees.json");
    }

    private static String lireTexte(File fichier) throws IOException {
        byte[] octets = new byte[(int) fichier.length()];
        try (FileInputStream entree = new FileInputStream(fichier)) {
            int lu = 0;
            while (lu < octets.length) {
                int n = entree.read(octets, lu, octets.length - lu);
                if (n < 0) break;
                lu += n;
            }
        }
        return new String(octets, StandardCharsets.UTF_8);
    }

    private static void ecrireOctets(File fichier, byte[] octets) throws IOException {
        try (FileOutputStream sortie = new FileOutputStream(fichier)) {
            sortie.write(octets);
            sortie.getFD().sync();
        }
    }

    public class Pont {

        @JavascriptInterface
        public String lireDonnees() {
            File fichier = fichierDonnees();
            try {
                return fichier.exists() ? lireTexte(fichier) : "";
            } catch (IOException e) {
                // Le fichier existe mais n'a pas pu être lu : la page ne doit pas le réécrire.
                return "!erreur";
            }
        }

        /** Écriture atomique : fichier temporaire puis renommage ; l'ancienne version est gardée en .bak. */
        @JavascriptInterface
        public boolean ecrireDonnees(String json) {
            File fichier = fichierDonnees();
            File temporaire = new File(getFilesDir(), "donnees.json.tmp");
            File secours = new File(getFilesDir(), "donnees.json.bak");
            try {
                ecrireOctets(temporaire, json.getBytes(StandardCharsets.UTF_8));
                if (fichier.exists()) {
                    secours.delete();
                    fichier.renameTo(secours);
                }
                return temporaire.renameTo(fichier);
            } catch (IOException e) {
                return false;
            }
        }

        @JavascriptInterface
        public String lireSecours() {
            File secours = new File(getFilesDir(), "donnees.json.bak");
            try {
                return secours.exists() ? lireTexte(secours) : "";
            } catch (IOException e) {
                return "";
            }
        }

        @JavascriptInterface
        public String marges() {
            return "{\"haut\":" + insetHaut + ",\"bas\":" + insetBas + "}";
        }

        @JavascriptInterface
        public String version() {
            try {
                return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
            } catch (Exception e) {
                return "";
            }
        }

        @JavascriptInterface
        public void partagerTexte(String titre, String texte) {
            runOnUiThread(() -> {
                Intent envoi = new Intent(Intent.ACTION_SEND);
                envoi.setType("text/plain");
                envoi.putExtra(Intent.EXTRA_SUBJECT, titre);
                envoi.putExtra(Intent.EXTRA_TEXT, texte);
                startActivity(Intent.createChooser(envoi, "Partager"));
            });
        }

        @JavascriptInterface
        public boolean partagerFichier(String nom, String base64, String mime) {
            try {
                File dossier = new File(getCacheDir(), "partage");
                if (!dossier.exists() && !dossier.mkdirs()) return false;
                String nomSur = new File(nom).getName();
                File fichier = new File(dossier, nomSur);
                ecrireOctets(fichier, Base64.decode(base64, Base64.DEFAULT));
                Uri uri = Uri.parse("content://" + FichiersPartages.AUTORITE + "/" + Uri.encode(nomSur));
                runOnUiThread(() -> {
                    Intent envoi = new Intent(Intent.ACTION_SEND);
                    envoi.setType(mime);
                    envoi.putExtra(Intent.EXTRA_STREAM, uri);
                    envoi.putExtra(Intent.EXTRA_SUBJECT, nomSur);
                    envoi.setClipData(ClipData.newRawUri(nomSur, uri));
                    envoi.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    startActivity(Intent.createChooser(envoi, "Partager " + nomSur));
                });
                return true;
            } catch (IOException | IllegalArgumentException e) {
                return false;
            }
        }

        /** Enregistre dans « Téléchargements » (Android 10+) ou via le sélecteur de fichiers. */
        @JavascriptInterface
        public String enregistrerFichier(String nom, String base64, String mime) {
            byte[] octets;
            try {
                octets = Base64.decode(base64, Base64.DEFAULT);
            } catch (IllegalArgumentException e) {
                return "Fichier invalide";
            }
            String nomSur = new File(nom).getName();
            if (Build.VERSION.SDK_INT >= 29) {
                ContentValues valeurs = new ContentValues();
                valeurs.put(MediaStore.MediaColumns.DISPLAY_NAME, nomSur);
                valeurs.put(MediaStore.MediaColumns.MIME_TYPE, mime);
                valeurs.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, valeurs);
                if (uri == null) return "Échec de l'enregistrement";
                try (OutputStream sortie = getContentResolver().openOutputStream(uri)) {
                    if (sortie == null) throw new IOException("flux indisponible");
                    sortie.write(octets);
                    return "Enregistré dans Téléchargements : " + nomSur;
                } catch (IOException e) {
                    getContentResolver().delete(uri, null, null);
                    return "Échec de l'enregistrement : " + e.getMessage();
                }
            }
            fichierEnAttente = octets;
            runOnUiThread(() -> {
                Intent creation = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                creation.addCategory(Intent.CATEGORY_OPENABLE);
                creation.setType(mime);
                creation.putExtra(Intent.EXTRA_TITLE, nomSur);
                try {
                    startActivityForResult(creation, DEMANDE_ENREGISTRER);
                } catch (ActivityNotFoundException e) {
                    fichierEnAttente = null;
                    annoncer("Aucune application pour enregistrer le fichier");
                }
            });
            return "";
        }
    }
}
