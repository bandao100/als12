package io.github.bandao100.hiram;

import android.app.Activity;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.os.Build;
import android.view.Display;
import android.view.Surface;

import java.util.Locale;

/**
 * Magnétomètre (champ en µT) et cap issu du capteur de rotation fusionné
 * (accéléromètre + gyroscope + magnétomètre), plus stable qu'une boussole brute.
 */
final class SensorHub implements SensorEventListener {
    private final Activity activity;
    private final SensorManager manager;
    private final Sensor magnetometer;
    private final Sensor rotation;

    private boolean magnetometerWanted;
    private boolean compassWanted;
    private boolean foreground = true;

    private final float[] field = new float[3];
    private long fieldTime;
    private int fieldAccuracy = SensorManager.SENSOR_STATUS_ACCURACY_HIGH;

    private float heading = Float.NaN;
    private int rotationAccuracy = SensorManager.SENSOR_STATUS_ACCURACY_HIGH;
    private final float[] matrix = new float[9];
    private final float[] remapped = new float[9];
    private final float[] orientation = new float[3];

    SensorHub(Activity activity) {
        this.activity = activity;
        manager = (SensorManager) activity.getSystemService(Activity.SENSOR_SERVICE);
        magnetometer = manager != null ? manager.getDefaultSensor(Sensor.TYPE_MAGNETIC_FIELD) : null;
        rotation = manager != null ? manager.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR) : null;
    }

    boolean hasMagnetometer() {
        return magnetometer != null;
    }

    boolean hasRotation() {
        return rotation != null;
    }

    synchronized boolean startMagnetometer() {
        magnetometerWanted = true;
        apply();
        return magnetometer != null;
    }

    synchronized void stopMagnetometer() {
        magnetometerWanted = false;
        fieldTime = 0;
        apply();
    }

    synchronized boolean startCompass() {
        compassWanted = true;
        apply();
        return rotation != null;
    }

    synchronized void stopCompass() {
        compassWanted = false;
        heading = Float.NaN;
        apply();
    }

    /** Capteurs coupés quand l'application passe en arrière-plan, relancés au retour. */
    synchronized void setForeground(boolean value) {
        foreground = value;
        apply();
    }

    private void apply() {
        if (manager == null) return;
        manager.unregisterListener(this);
        if (!foreground) return;
        if (magnetometerWanted && magnetometer != null) manager.registerListener(this, magnetometer, SensorManager.SENSOR_DELAY_GAME);
        if (compassWanted && rotation != null) manager.registerListener(this, rotation, SensorManager.SENSOR_DELAY_UI);
    }

    @Override
    public synchronized void onSensorChanged(SensorEvent event) {
        int type = event.sensor.getType();
        if (type == Sensor.TYPE_MAGNETIC_FIELD) {
            System.arraycopy(event.values, 0, field, 0, 3);
            fieldTime = event.timestamp;
        } else if (type == Sensor.TYPE_ROTATION_VECTOR) {
            SensorManager.getRotationMatrixFromVector(matrix, event.values);
            remapForScreen();
            SensorManager.getOrientation(remapped, orientation);
            float deg = (float) Math.toDegrees(orientation[0]);
            heading = (deg + 360f) % 360f;
        }
    }

    // Le cap doit suivre le haut de l'écran, y compris en paysage sur un support voiture.
    private void remapForScreen() {
        int r = Surface.ROTATION_0;
        Display display = Build.VERSION.SDK_INT >= 30 ? activity.getDisplay() : activity.getWindowManager().getDefaultDisplay();
        if (display != null) r = display.getRotation();
        switch (r) {
            case Surface.ROTATION_90:
                SensorManager.remapCoordinateSystem(matrix, SensorManager.AXIS_Y, SensorManager.AXIS_MINUS_X, remapped);
                break;
            case Surface.ROTATION_180:
                SensorManager.remapCoordinateSystem(matrix, SensorManager.AXIS_MINUS_X, SensorManager.AXIS_MINUS_Y, remapped);
                break;
            case Surface.ROTATION_270:
                SensorManager.remapCoordinateSystem(matrix, SensorManager.AXIS_MINUS_Y, SensorManager.AXIS_X, remapped);
                break;
            default:
                System.arraycopy(matrix, 0, remapped, 0, 9);
        }
    }

    @Override
    public synchronized void onAccuracyChanged(Sensor sensor, int accuracy) {
        if (sensor.getType() == Sensor.TYPE_MAGNETIC_FIELD) fieldAccuracy = accuracy;
        else if (sensor.getType() == Sensor.TYPE_ROTATION_VECTOR) rotationAccuracy = accuracy;
    }

    synchronized String magnetometerJson() {
        if (fieldTime == 0) return "null";
        return String.format(Locale.US, "{\"x\":%.3f,\"y\":%.3f,\"z\":%.3f,\"t\":%d,\"accuracy\":%d}",
                field[0], field[1], field[2], fieldTime, fieldAccuracy);
    }

    synchronized String compassJson() {
        if (Float.isNaN(heading)) return "null";
        return String.format(Locale.US, "{\"heading\":%.2f,\"accuracy\":%d}", heading, rotationAccuracy);
    }

    synchronized void shutdown() {
        magnetometerWanted = false;
        compassWanted = false;
        if (manager != null) manager.unregisterListener(this);
    }
}
