package io.github.bandao100.sentinelle;

import android.content.Context;
import android.media.AudioAttributes;
import android.speech.tts.TextToSpeech;

import java.util.Locale;

/** Alertes vocales avec la voix française du téléphone, en mode guidage (baisse la musique). */
final class Speaker implements TextToSpeech.OnInitListener {
    private final TextToSpeech tts;
    private boolean ready;
    private String pending;

    Speaker(Context context) {
        tts = new TextToSpeech(context.getApplicationContext(), this);
    }

    @Override
    public void onInit(int status) {
        if (status != TextToSpeech.SUCCESS) return;
        int r = tts.setLanguage(Locale.FRANCE);
        if (r == TextToSpeech.LANG_MISSING_DATA || r == TextToSpeech.LANG_NOT_SUPPORTED) tts.setLanguage(Locale.FRENCH);
        tts.setAudioAttributes(new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build());
        tts.setSpeechRate(1.05f);
        synchronized (this) {
            ready = true;
            if (pending != null) {
                say(pending);
                pending = null;
            }
        }
    }

    synchronized void speak(String text) {
        if (text == null || text.isEmpty()) return;
        if (ready) say(text);
        else pending = text;
    }

    private void say(String text) {
        tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "sentinelle");
    }

    void stop() {
        tts.stop();
    }

    void shutdown() {
        tts.shutdown();
    }
}
