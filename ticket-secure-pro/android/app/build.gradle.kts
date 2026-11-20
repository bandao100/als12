plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val defaultServerUrl: String = (project.findProperty("defaultServerUrl") as String?).orEmpty()

// Le scanner web (PWA) est la source unique : il est copié dans les ressources de l'APK,
// de sorte que l'application fonctionne entièrement sans réseau.
val scannerSource = rootProject.file("../ticketsecure/static/scanner")
val generatedAssets = layout.buildDirectory.dir("generated/scannerAssets")

val copyScannerAssets by tasks.registering(Copy::class) {
    from(scannerSource) {
        exclude("sw.js") // inutile : les fichiers sont déjà locaux dans l'APK
    }
    into(generatedAssets.map { it.dir("scanner") })
}

android {
    namespace = "com.ticketsecure.scanner"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.ticketsecure.scanner"
        minSdk = 26 // Android 8.0 et plus
        targetSdk = 35
        versionCode = 3
        versionName = "3.0.0"
        buildConfigField("String", "DEFAULT_SERVER_URL", "\"$defaultServerUrl\"")
    }

    signingConfigs {
        create("release") {
            // Clé de signature fournie par variables d'environnement (secrets CI), jamais versionnée.
            val keystore = System.getenv("ANDROID_KEYSTORE_FILE")
            if (!keystore.isNullOrBlank()) {
                storeFile = file(keystore)
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (!System.getenv("ANDROID_KEYSTORE_FILE").isNullOrBlank()) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }

    buildFeatures {
        buildConfig = true
    }

    sourceSets["main"].assets.srcDir(generatedAssets)

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

tasks.named("preBuild") { dependsOn(copyScannerAssets) }

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.webkit:webkit:1.12.1")
}
