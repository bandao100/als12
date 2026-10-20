package io.github.bandao100.hiram;

import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothManager;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanRecord;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.content.Context;
import android.os.ParcelUuid;
import android.os.SystemClock;
import android.util.SparseArray;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;

/** Scan Bluetooth basse consommation en continu ; les annonces sont relevées par la page. */
final class BleScanner {
    private static final long FORGET_AFTER_MS = 60_000;

    private final Context context;
    private final Map<String, Entry> devices = new HashMap<>();
    private BluetoothLeScanner scanner;
    private boolean wanted;
    private boolean running;
    private int lastError;

    private static final class Entry {
        String address;
        String name;
        int rssi;
        int txPower = Integer.MIN_VALUE;
        SparseArray<byte[]> manufacturer;
        Map<ParcelUuid, byte[]> serviceData;
        List<ParcelUuid> uuids;
        long seen;
        boolean fresh;
    }

    private final ScanCallback callback = new ScanCallback() {
        @Override
        public void onScanResult(int callbackType, ScanResult result) {
            record(result);
        }

        @Override
        public void onBatchScanResults(List<ScanResult> results) {
            for (ScanResult r : results) record(r);
        }

        @Override
        public void onScanFailed(int errorCode) {
            synchronized (BleScanner.this) {
                lastError = errorCode;
                running = false;
            }
        }
    };

    BleScanner(Context context) {
        this.context = context;
    }

    boolean available() {
        return adapter() != null;
    }

    private BluetoothAdapter adapter() {
        BluetoothManager manager = (BluetoothManager) context.getSystemService(Context.BLUETOOTH_SERVICE);
        return manager != null ? manager.getAdapter() : null;
    }

    /** "ok", "absent" (pas de Bluetooth), "off" (désactivé) ou "denied" (autorisation refusée). */
    synchronized String start() {
        wanted = true;
        return begin();
    }

    private String begin() {
        BluetoothAdapter adapter = adapter();
        if (adapter == null) return "absent";
        if (!adapter.isEnabled()) return "off";
        if (running) return "ok";
        scanner = adapter.getBluetoothLeScanner();
        if (scanner == null) return "off";
        ScanSettings.Builder settings = new ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).setReportDelay(0);
        // Annonces étendues (Bluetooth 5) en plus des annonces classiques, si la puce les gère.
        if (adapter.isLeExtendedAdvertisingSupported()) settings.setLegacy(false);
        try {
            scanner.startScan(null, settings.build(), callback);
        } catch (SecurityException e) {
            return "denied";
        }
        running = true;
        lastError = 0;
        return "ok";
    }

    synchronized void stop() {
        wanted = false;
        end();
        devices.clear();
    }

    private void end() {
        if (scanner != null && running) {
            try {
                scanner.stopScan(callback);
            } catch (SecurityException | IllegalStateException ignored) {
                // Bluetooth coupé entre-temps.
            }
        }
        running = false;
    }

    synchronized void setForeground(boolean foreground) {
        if (!wanted) return;
        if (foreground) begin();
        else end();
    }

    private synchronized void record(ScanResult result) {
        String address = result.getDevice().getAddress();
        Entry e = devices.get(address);
        if (e == null) {
            e = new Entry();
            e.address = address;
            devices.put(address, e);
        }
        e.rssi = result.getRssi();
        e.seen = SystemClock.elapsedRealtime();
        e.fresh = true;
        ScanRecord rec = result.getScanRecord();
        if (rec != null) {
            if (rec.getDeviceName() != null) e.name = rec.getDeviceName();
            if (rec.getTxPowerLevel() != Integer.MIN_VALUE) e.txPower = rec.getTxPowerLevel();
            e.manufacturer = rec.getManufacturerSpecificData();
            e.serviceData = rec.getServiceData();
            e.uuids = rec.getServiceUuids();
        }
    }

    /** Annonces reçues depuis le dernier relevé. */
    synchronized String pollJson() {
        JSONObject out = new JSONObject();
        JSONArray list = new JSONArray();
        long now = SystemClock.elapsedRealtime();
        try {
            for (Iterator<Entry> it = devices.values().iterator(); it.hasNext(); ) {
                Entry e = it.next();
                if (now - e.seen > FORGET_AFTER_MS) {
                    it.remove();
                    continue;
                }
                if (!e.fresh) continue;
                e.fresh = false;
                list.put(toJson(e));
            }
            out.put("devices", list);
            out.put("running", running);
            out.put("error", lastError == 0 ? JSONObject.NULL : lastError);
        } catch (JSONException ignored) {
            return "null";
        }
        return out.toString();
    }

    private static JSONObject toJson(Entry e) throws JSONException {
        JSONObject o = new JSONObject();
        o.put("id", e.address);
        o.put("name", e.name == null ? JSONObject.NULL : e.name);
        o.put("rssi", e.rssi);
        o.put("txPower", e.txPower == Integer.MIN_VALUE ? JSONObject.NULL : e.txPower);
        JSONObject manufacturer = new JSONObject();
        if (e.manufacturer != null) {
            for (int i = 0; i < e.manufacturer.size(); i++) manufacturer.put(String.valueOf(e.manufacturer.keyAt(i)), hex(e.manufacturer.valueAt(i)));
        }
        o.put("manufacturer", manufacturer);
        JSONObject service = new JSONObject();
        if (e.serviceData != null) {
            for (Map.Entry<ParcelUuid, byte[]> s : e.serviceData.entrySet()) service.put(s.getKey().toString(), hex(s.getValue()));
        }
        o.put("serviceData", service);
        JSONArray uuids = new JSONArray();
        if (e.uuids != null) for (ParcelUuid u : e.uuids) uuids.put(u.toString());
        o.put("uuids", uuids);
        return o;
    }

    private static String hex(byte[] bytes) {
        if (bytes == null) return "";
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) sb.append(String.format("%02x", b & 0xff));
        return sb.toString();
    }
}
