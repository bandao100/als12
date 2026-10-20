package io.github.bandao100.hiram;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.location.LocationManager;
import android.net.wifi.ScanResult;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * Analyse des réseaux Wi-Fi alentour. Android limite les analyses (4 toutes les
 * 2 minutes au premier plan) : quand il refuse, on renvoie les derniers résultats.
 */
final class WifiScanner {
    interface Callback {
        void done(JSONObject result);
    }

    private static final long TIMEOUT_MS = 10_000;

    private final Context context;
    private final WifiManager wifi;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final List<Callback> waiting = new ArrayList<>();
    private BroadcastReceiver receiver;
    private Runnable timeout;

    WifiScanner(Context context) {
        this.context = context;
        wifi = (WifiManager) context.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
    }

    boolean available() {
        return wifi != null;
    }

    /** À appeler depuis le fil principal. */
    void scan(Callback callback) {
        if (wifi == null) {
            callback.done(result(false, "absent"));
            return;
        }
        if (!locationEnabled()) {
            callback.done(result(false, "location_off"));
            return;
        }
        waiting.add(callback);
        if (receiver != null) return;
        receiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context c, Intent intent) {
                finish(intent.getBooleanExtra(WifiManager.EXTRA_RESULTS_UPDATED, false), null);
            }
        };
        IntentFilter filter = new IntentFilter(WifiManager.SCAN_RESULTS_AVAILABLE_ACTION);
        if (Build.VERSION.SDK_INT >= 33) context.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED);
        else context.registerReceiver(receiver, filter);
        boolean started;
        try {
            started = wifi.startScan();
        } catch (SecurityException e) {
            finish(false, "denied");
            return;
        }
        if (!started) {
            // Analyse refusée (limitation Android) : résultats en mémoire.
            finish(false, null);
            return;
        }
        timeout = () -> finish(false, null);
        main.postDelayed(timeout, TIMEOUT_MS);
    }

    private void finish(boolean fresh, String reason) {
        if (receiver != null) {
            try {
                context.unregisterReceiver(receiver);
            } catch (IllegalArgumentException ignored) {
                // Déjà retiré.
            }
            receiver = null;
        }
        if (timeout != null) {
            main.removeCallbacks(timeout);
            timeout = null;
        }
        JSONObject r = result(fresh, reason);
        List<Callback> done = new ArrayList<>(waiting);
        waiting.clear();
        for (Callback cb : done) cb.done(r);
    }

    private boolean locationEnabled() {
        LocationManager lm = (LocationManager) context.getSystemService(Context.LOCATION_SERVICE);
        if (lm == null) return true;
        if (Build.VERSION.SDK_INT >= 28) return lm.isLocationEnabled();
        return lm.isProviderEnabled(LocationManager.GPS_PROVIDER) || lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER);
    }

    @SuppressWarnings("deprecation")
    private JSONObject result(boolean fresh, String reason) {
        JSONObject out = new JSONObject();
        JSONArray list = new JSONArray();
        try {
            if (wifi != null && reason == null) {
                long now = SystemClock.elapsedRealtime();
                for (ScanResult r : wifi.getScanResults()) {
                    JSONObject o = new JSONObject();
                    o.put("ssid", r.SSID == null ? "" : r.SSID);
                    o.put("bssid", r.BSSID == null ? "" : r.BSSID);
                    o.put("level", r.level);
                    o.put("frequency", r.frequency);
                    o.put("capabilities", r.capabilities == null ? "" : r.capabilities);
                    o.put("ageSeconds", Math.max(0, (now - r.timestamp / 1000) / 1000));
                    list.put(o);
                }
            }
            out.put("results", list);
            out.put("fresh", fresh);
            out.put("reason", reason == null ? JSONObject.NULL : reason);
        } catch (JSONException | SecurityException ignored) {
            // Liste vide si l'autorisation a été retirée entre-temps.
        }
        return out;
    }

    void shutdown() {
        if (receiver != null) finish(false, "stopped");
    }
}
