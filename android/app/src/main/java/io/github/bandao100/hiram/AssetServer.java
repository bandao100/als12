package io.github.bandao100.hiram;

import android.content.res.AssetManager;
import android.net.Uri;
import android.webkit.WebResourceResponse;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * Sert l'application web embarquée sous une adresse https locale. Le contexte sécurisé
 * est indispensable pour la caméra, le micro et la géolocalisation dans la WebView.
 */
final class AssetServer {
    static final String HOST = "appassets.androidplatform.net";

    private static final Map<String, String> TYPES = new HashMap<>();

    static {
        TYPES.put("html", "text/html");
        TYPES.put("js", "text/javascript");
        TYPES.put("mjs", "text/javascript");
        TYPES.put("css", "text/css");
        TYPES.put("json", "application/json");
        TYPES.put("webmanifest", "application/manifest+json");
        TYPES.put("svg", "image/svg+xml");
        TYPES.put("png", "image/png");
        TYPES.put("jpg", "image/jpeg");
        TYPES.put("woff2", "font/woff2");
    }

    private final AssetManager assets;

    AssetServer(AssetManager assets) {
        this.assets = assets;
    }

    WebResourceResponse handle(Uri uri) {
        if (!"https".equals(uri.getScheme()) || !HOST.equals(uri.getHost())) return null;
        String path = uri.getPath();
        if (path == null || path.equals("/")) path = "/www/index.html";
        String asset = path.substring(1);
        if (asset.endsWith("/")) asset += "index.html";
        if (asset.contains("..")) return notFound();
        String type = typeOf(asset);
        boolean text = type.startsWith("text/") || type.contains("json") || type.contains("svg");
        try {
            InputStream in = assets.open(asset);
            WebResourceResponse response = new WebResourceResponse(type, text ? "utf-8" : null, in);
            Map<String, String> headers = new HashMap<>();
            headers.put("Cache-Control", "no-cache");
            response.setResponseHeaders(headers);
            return response;
        } catch (IOException e) {
            return notFound();
        }
    }

    private static String typeOf(String asset) {
        int dot = asset.lastIndexOf('.');
        String ext = dot >= 0 ? asset.substring(dot + 1).toLowerCase() : "";
        String type = TYPES.get(ext);
        return type != null ? type : "application/octet-stream";
    }

    private static WebResourceResponse notFound() {
        return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", new HashMap<>(), new ByteArrayInputStream(new byte[0]));
    }
}
