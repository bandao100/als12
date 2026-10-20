package io.github.bandao100.sentinelle;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.GeolocationPermissions;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** Fenêtre unique : l'interface web de Sentinelle dans une WebView reliée aux capteurs natifs. */
public class MainActivity extends Activity {
    static final String START_URL = "https://" + AssetServer.HOST + "/www/index.html";

    private FrameLayout root;
    private WebView web;
    private NativeBridge bridge;
    private final Map<Integer, Runnable> permissionCallbacks = new HashMap<>();
    private int nextRequestCode = 1;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        root = new FrameLayout(this);
        web = new WebView(this);
        web.setBackgroundColor(Color.TRANSPARENT);
        root.addView(web, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);
        setupEdgeToEdge();

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setGeolocationEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportZoom(false);
        // Taille de police système ignorée : la mise en page est déjà adaptée à l'écran.
        s.setTextZoom(100);
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) WebView.setWebContentsDebuggingEnabled(true);

        AssetServer assets = new AssetServer(getAssets());
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assets.handle(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (AssetServer.HOST.equals(uri.getHost())) return false;
                // Liens externes (carte OpenStreetMap, téléchargements) : navigateur du téléphone.
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (ActivityNotFoundException ignored) {
                    // Aucune application ne sait ouvrir ce lien.
                }
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> grantWebPermission(request));
            }

            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                request(permissionsFor("location"), () -> callback.invoke(origin, groupGranted("location"), false));
            }
        });

        bridge = new NativeBridge(this, web);
        web.addJavascriptInterface(bridge, "SentinelleNative");
        if (state == null || web.restoreState(state) == null) web.loadUrl(START_URL);
    }

    // ───── Autorisations ─────

    /** Autorisations Android à demander pour chaque fonction de l'application. */
    String[] permissionsFor(String group) {
        List<String> p = new ArrayList<>();
        switch (group) {
            case "location":
                p.add(Manifest.permission.ACCESS_FINE_LOCATION);
                p.add(Manifest.permission.ACCESS_COARSE_LOCATION);
                break;
            case "camera":
                p.add(Manifest.permission.CAMERA);
                break;
            case "microphone":
                p.add(Manifest.permission.RECORD_AUDIO);
                break;
            case "bluetooth":
                if (Build.VERSION.SDK_INT >= 31) p.add(Manifest.permission.BLUETOOTH_SCAN);
                // Sans position précise, Android masque certaines balises dont les traceurs.
                p.add(Manifest.permission.ACCESS_FINE_LOCATION);
                break;
            case "wifi":
                if (Build.VERSION.SDK_INT >= 33) p.add(Manifest.permission.NEARBY_WIFI_DEVICES);
                p.add(Manifest.permission.ACCESS_FINE_LOCATION);
                break;
            default:
                break;
        }
        return p.toArray(new String[0]);
    }

    /** Vrai si la fonction peut tourner avec les autorisations accordées. */
    boolean groupGranted(String group) {
        switch (group) {
            case "location":
                return has(Manifest.permission.ACCESS_FINE_LOCATION) || has(Manifest.permission.ACCESS_COARSE_LOCATION);
            case "bluetooth":
                return Build.VERSION.SDK_INT >= 31 ? has(Manifest.permission.BLUETOOTH_SCAN) : has(Manifest.permission.ACCESS_FINE_LOCATION);
            case "wifi":
                return has(Manifest.permission.ACCESS_FINE_LOCATION)
                        && (Build.VERSION.SDK_INT < 33 || has(Manifest.permission.NEARBY_WIFI_DEVICES));
            default:
                for (String p : permissionsFor(group)) if (!has(p)) return false;
                return true;
        }
    }

    boolean has(String permission) {
        return checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED;
    }

    /** Demande les autorisations manquantes puis exécute la suite sur le fil principal. */
    void request(String[] permissions, Runnable then) {
        List<String> missing = new ArrayList<>();
        for (String p : permissions) if (!has(p)) missing.add(p);
        if (missing.isEmpty()) {
            then.run();
            return;
        }
        int code = nextRequestCode++;
        permissionCallbacks.put(code, then);
        requestPermissions(missing.toArray(new String[0]), code);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        Runnable then = permissionCallbacks.remove(requestCode);
        if (then != null) then.run();
    }

    /** La page demande caméra ou micro : on relaie vers les autorisations Android. */
    private void grantWebPermission(PermissionRequest request) {
        if (!AssetServer.HOST.equals(request.getOrigin().getHost())) {
            request.deny();
            return;
        }
        List<String> needed = new ArrayList<>();
        for (String resource : request.getResources()) {
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)) needed.add(Manifest.permission.CAMERA);
            else if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) needed.add(Manifest.permission.RECORD_AUDIO);
        }
        if (needed.isEmpty()) {
            request.deny();
            return;
        }
        request(needed.toArray(new String[0]), () -> {
            for (String p : needed) {
                if (!has(p)) {
                    request.deny();
                    return;
                }
            }
            request.grant(request.getResources());
        });
    }

    // ───── Fenêtre ─────

    /** Contenu sous les barres système, avec une marge égale à leur hauteur. */
    private void setupEdgeToEdge() {
        if (Build.VERSION.SDK_INT < 30) return;
        getWindow().setDecorFitsSystemWindows(false);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            Insets i = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
            v.setPadding(i.left, i.top, i.right, i.bottom);
            return WindowInsets.CONSUMED;
        });
    }

    /** Couleur des barres système alignée sur le thème choisi dans l'application. */
    void setChrome(String color, boolean light) {
        int c;
        try {
            c = Color.parseColor(color);
        } catch (IllegalArgumentException e) {
            return;
        }
        root.setBackgroundColor(c);
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) {
                int mask = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                controller.setSystemBarsAppearance(light ? mask : 0, mask);
            }
        } else {
            getWindow().setStatusBarColor(c);
            getWindow().setNavigationBarColor(c);
            View decor = getWindow().getDecorView();
            int flags = decor.getSystemUiVisibility();
            flags = light ? flags | View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR : flags & ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            decor.setSystemUiVisibility(flags);
        }
    }

    void keepScreenOn(boolean on) {
        if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }

    void openSettings(String kind) {
        Intent intent;
        switch (kind) {
            case "bluetooth":
                intent = new Intent(Settings.ACTION_BLUETOOTH_SETTINGS);
                break;
            case "location":
                intent = new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS);
                break;
            case "wifi":
                intent = new Intent(Settings.ACTION_WIFI_SETTINGS);
                break;
            default:
                intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", getPackageName(), null));
        }
        try {
            startActivity(intent);
        } catch (ActivityNotFoundException ignored) {
            // Réglage absent sur cet appareil.
        }
    }

    // ───── Cycle de vie ─────

    @Override
    protected void onStart() {
        super.onStart();
        bridge.setForeground(true);
    }

    @Override
    protected void onStop() {
        bridge.setForeground(false);
        super.onStop();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onDestroy() {
        bridge.shutdown();
        web.destroy();
        super.onDestroy();
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        // Retour : écran précédent de l'application, puis sortie.
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }
}
