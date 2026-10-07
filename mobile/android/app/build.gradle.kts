import java.io.FileInputStream
import java.util.Properties

plugins {
    id("com.android.application")
    id("dev.flutter.flutter-gradle-plugin")
}
val keystoreProperties = Properties()
val keystorePropertiesFile = rootProject.file("key.properties")
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(FileInputStream(keystorePropertiesFile))
}

android {
    namespace = "com.gofixo"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    defaultConfig {
        applicationId = "com.gofixo.app"
        minSdk = 24
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
        manifestPlaceholders["GOFIXO_GOOGLE_MAPS_API_KEY"] = System.getenv("GOFIXO_GOOGLE_MAPS_API_KEY") ?: "MISSING_GOOGLE_MAPS_KEY"
    }
    signingConfigs {
        create("release") {
            keyAlias = keystoreProperties.getProperty("keyAlias")
                ?: error("Missing keyAlias in android/key.properties")
            keyPassword = keystoreProperties.getProperty("keyPassword")
                ?: error("Missing keyPassword in android/key.properties")
            storeFile = keystoreProperties.getProperty("storeFile")
                ?.let { file(it) }
                ?: error("Missing storeFile in android/key.properties")
            storePassword = keystoreProperties.getProperty("storePassword")
                ?: error("Missing storePassword in android/key.properties")
        }
    }

    buildTypes {
        release {
            signingConfig = signingConfigs.getByName("release")
            isMinifyEnabled = false
            isShrinkResources = false
        }
    }
}
flutter { source = "../.." }
