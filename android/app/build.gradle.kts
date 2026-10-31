plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val backendUrl: String = System.getenv("CONEX_BACKEND_URL") ?: (project.findProperty("CONEX_BACKEND_URL") as String? ?: "https://SEU-DOMINIO.pt")
val appVersion: String = System.getenv("APP_VERSION") ?: "1.0.0"
val buildNumber: Int = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()

android {
    namespace = "pt.cryptoconex.mobile"
    compileSdk = 34

    defaultConfig {
        applicationId = "pt.cryptoconex.mobile"
        minSdk = 26
        targetSdk = 34
        versionCode = buildNumber
        versionName = appVersion
        buildConfigField("String", "BACKEND_URL", "\"$backendUrl\"")
    }

    signingConfigs {
        create("release") {
            val ks = System.getenv("ANDROID_KEYSTORE_PATH")
            if (ks != null && file(ks).exists()) {
                storeFile = file(ks)
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            val hasKs = System.getenv("ANDROID_KEYSTORE_PATH")?.let { file(it).exists() } == true
            signingConfig = if (hasKs) signingConfigs.getByName("release") else signingConfigs.getByName("debug")
        }
    }

    buildFeatures { buildConfig = true; viewBinding = true }
    lint { abortOnError = false; checkReleaseBuilds = false }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.4")
    implementation("io.getstream:stream-webrtc-android:1.3.8")
    implementation("io.socket:socket.io-client:2.1.1") {
        exclude(group = "org.json", module = "json")
    }
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
}
