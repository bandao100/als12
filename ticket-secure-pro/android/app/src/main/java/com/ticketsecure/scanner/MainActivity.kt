package com.ticketsecure.scanner

import android.Manifest
import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.view.WindowManager
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat

/**
 * Application de contrôle des billets.
 *
 * L'interface est le scanner web hors connexion (dossier static/scanner du serveur),
 * embarqué dans l'APK et servi localement via WebViewAssetLoader sous l'origine
 * sécurisée https://appassets.androidplatform.net. Elle fonctionne donc sans réseau ;
 * le réseau ne sert qu'à valider en ligne et à synchroniser avec le serveur (HTTPS).
 */
class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private var pendingPermission: PermissionRequest? = null

    private val assetLoader by lazy {
        WebViewAssetLoader.Builder()
            .setDomain(ASSET_DOMAIN)
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
    }

    private val cameraPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        val request = pendingPermission
        pendingPermission = null
        if (request == null) return@registerForActivityResult
        if (granted) {
            request.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE))
        } else {
            request.deny()
            Toast.makeText(this, R.string.camera_denied, Toast.LENGTH_LONG).show()
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // L'écran reste allumé pendant le contrôle des entrées.
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        webView = WebView(this)
        setContentView(webView)

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true            // localStorage : configuration et jeton d'appareil
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false             // aucun accès au système de fichiers
            allowContentAccess = false
            setGeolocationEnabled(false)
            cacheMode = WebSettings.LOAD_DEFAULT
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        }

        webView.webViewClient = object : WebViewClientCompat() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                assetLoader.shouldInterceptRequest(request.url)

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                // Seules les pages embarquées s'ouvrent dans l'application ; le reste part au navigateur.
                if (request.url.host == ASSET_DOMAIN) return false
                try {
                    startActivity(Intent(Intent.ACTION_VIEW, request.url))
                } catch (_: ActivityNotFoundException) {
                }
                return true
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                val wantsCamera = PermissionRequest.RESOURCE_VIDEO_CAPTURE in request.resources
                if (request.origin.host != ASSET_DOMAIN || !wantsCamera) {
                    request.deny()
                    return
                }
                runOnUiThread {
                    if (ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.CAMERA)
                        == PackageManager.PERMISSION_GRANTED
                    ) {
                        request.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE))
                    } else {
                        pendingPermission = request
                        cameraPermission.launch(Manifest.permission.CAMERA)
                    }
                }
            }
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack() else finish()
            }
        })

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState)
        } else {
            webView.loadUrl(startUrl())
        }
    }

    private fun startUrl(): String {
        val base = "https://$ASSET_DOMAIN/assets/scanner/index.html"
        val server = BuildConfig.DEFAULT_SERVER_URL
        return if (server.isBlank()) base else "$base?server=${Uri.encode(server)}"
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    override fun onPause() {
        webView.onPause()
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
    }

    override fun onDestroy() {
        webView.destroy()
        super.onDestroy()
    }

    companion object {
        private const val ASSET_DOMAIN = "appassets.androidplatform.net"
    }
}
