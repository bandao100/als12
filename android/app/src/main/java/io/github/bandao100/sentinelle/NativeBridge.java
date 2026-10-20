package io.github.bandao100.sentinelle;

import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Pont JavaScript exposé sous window.SentinelleNative.
 * call() est asynchrone : la réponse revient par window.__sentinelleNative.resolve(id, json).
 * poll() est synchrone, pour les mesures relevées plusieurs fois par seconde.
 */
final class NativeBridge {
    private final MainActivity activity;
    private final WebView web;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final SensorHub sensors;
    private final BleScanner ble;
    private final WifiScanner wifi;
    private final Speaker speaker;

    NativeBridge(MainActivity activity, WebView web) {
        this.activity = activity;
        this.web = web;
        sensors = new SensorHub(activity);
        ble = new BleScanner(activity);
        wifi = new WifiScanner(activity);
        speaker = new Speaker(activity);
    }

    @JavascriptInterface
    public String info() {
        JSONObject o = new JSONObject();
        try {
            o.put("platform", "android");
            o.put("model", deviceName());
            o.put("release", Build.VERSION.RELEASE);
            o.put("sdk", Build.VERSION.SDK_INT);
            o.put("version", versionName());
            o.put("magnetometer", sensors.hasMagnetometer());
            o.put("rotation", sensors.hasRotation());
            o.put("bluetoothLe", ble.available() && activity.getPackageManager().hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE));
            o.put("wifi", wifi.available());
            o.put("flash", activity.getPackageManager().hasSystemFeature(PackageManager.FEATURE_CAMERA_FLASH));
        } catch (JSONException ignored) {
            // Objet partiel.
        }
        return o.toString();
    }

    @JavascriptInterface
    public String poll(String what) {
        switch (what) {
            case "magnetometer":
                return sensors.magnetometerJson();
            case "compass":
                return sensors.compassJson();
            case "ble":
                return ble.pollJson();
            default:
                return "null";
        }
    }

    @JavascriptInterface
    public void call(String method, int id, String argsJson) {
        main.post(() -> dispatch(method, id, argsJson));
    }

    private void dispatch(String method, int id, String argsJson) {
        try {
            JSONArray args = new JSONArray(argsJson == null || argsJson.isEmpty() ? "[]" : argsJson);
            switch (method) {
                case "permissions": {
                    String group = args.optString(0);
                    activity.request(activity.permissionsFor(group), () -> resolve(id, obj("granted", activity.groupGranted(group))));
                    return;
                }
                case "settings":
                    activity.openSettings(args.optString(0));
                    break;
                case "magnetometer.start":
                    resolve(id, obj("ok", sensors.startMagnetometer()));
                    return;
                case "magnetometer.stop":
                    sensors.stopMagnetometer();
                    break;
                case "compass.start":
                    resolve(id, obj("ok", sensors.startCompass()));
                    return;
                case "compass.stop":
                    sensors.stopCompass();
                    break;
                case "ble.start": {
                    String state = ble.start();
                    JSONObject r = obj("ok", "ok".equals(state));
                    r.put("reason", state);
                    resolve(id, r);
                    return;
                }
                case "ble.stop":
                    ble.stop();
                    break;
                case "wifi.scan":
                    wifi.scan(result -> resolve(id, result));
                    return;
                case "speak":
                    speaker.speak(args.optString(0));
                    break;
                case "stopSpeaking":
                    speaker.stop();
                    break;
                case "vibrate":
                    vibrate(args.optJSONArray(0));
                    break;
                case "keepScreenOn":
                    activity.keepScreenOn(args.optBoolean(0));
                    break;
                case "chrome":
                    activity.setChrome(args.optString(0), args.optBoolean(1));
                    break;
                default:
                    reject(id, "Méthode inconnue : " + method);
                    return;
            }
            resolve(id, obj("ok", true));
        } catch (JSONException | RuntimeException e) {
            reject(id, e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage());
        }
    }

    @SuppressWarnings("deprecation")
    private void vibrate(JSONArray pattern) {
        Vibrator v = (Vibrator) activity.getSystemService(MainActivity.VIBRATOR_SERVICE);
        if (v == null || !v.hasVibrator() || pattern == null || pattern.length() == 0) return;
        // Motif web [vibre, pause, vibre…] → Android [attente, vibre, pause…].
        long[] timings = new long[pattern.length() + 1];
        for (int i = 0; i < pattern.length(); i++) timings[i + 1] = Math.max(0, pattern.optLong(i));
        v.vibrate(VibrationEffect.createWaveform(timings, -1));
    }

    void setForeground(boolean foreground) {
        sensors.setForeground(foreground);
        ble.setForeground(foreground);
    }

    void shutdown() {
        sensors.shutdown();
        ble.stop();
        wifi.shutdown();
        speaker.shutdown();
    }

    private void resolve(int id, JSONObject result) {
        send(id, result.toString());
    }

    private void reject(int id, String message) {
        JSONObject o = new JSONObject();
        try {
            o.put("error", message);
        } catch (JSONException ignored) {
            // Message vide.
        }
        send(id, o.toString());
    }

    private void send(int id, String json) {
        String script = "window.__sentinelleNative&&window.__sentinelleNative.resolve(" + id + "," + JSONObject.quote(json) + ")";
        main.post(() -> web.evaluateJavascript(script, null));
    }

    private static JSONObject obj(String key, Object value) {
        JSONObject o = new JSONObject();
        try {
            o.put(key, value);
        } catch (JSONException ignored) {
            // Clé non nulle : ne se produit pas.
        }
        return o;
    }

    private String versionName() {
        try {
            PackageInfo p = activity.getPackageManager().getPackageInfo(activity.getPackageName(), 0);
            return p.versionName;
        } catch (PackageManager.NameNotFoundException e) {
            return "";
        }
    }

    // Android ne donne que la référence (SM-S938B) : on traduit celles de la gamme Galaxy S25.
    private static String deviceName() {
        String maker = Build.MANUFACTURER == null ? "" : Build.MANUFACTURER;
        String model = Build.MODEL == null ? "" : Build.MODEL;
        if (model.startsWith("SM-S938")) return "Galaxy S25 Ultra";
        if (model.startsWith("SM-S936")) return "Galaxy S25+";
        if (model.startsWith("SM-S931")) return "Galaxy S25";
        if (!maker.isEmpty()) maker = Character.toUpperCase(maker.charAt(0)) + maker.substring(1);
        return model.toLowerCase().startsWith(maker.toLowerCase()) ? model : (maker + " " + model).trim();
    }
}
