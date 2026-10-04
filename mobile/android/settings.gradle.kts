pluginManagement {
    val flutterSdkPath =
        run {
            val properties = java.util.Properties()
            file("local.properties").inputStream().use { properties.load(it) }
            val flutterSdkPath = properties.getProperty("flutter.sdk")
            require(flutterSdkPath != null) { "flutter.sdk not set in local.properties" }
            flutterSdkPath
        }

    includeBuild("$flutterSdkPath/packages/flutter_tools/gradle")

    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
        maven(url = "https://maven.mappls.com/repository/mappls/")
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.PREFER_SETTINGS)
    repositories {
        google()
        mavenCentral()
        maven(url = "https://maven.mappls.com/repository/mappls/")
        val storageUrl: String = System.getenv("FLUTTER_STORAGE_BASE_URL") ?: "https://storage.googleapis.com"
        maven("$storageUrl/download.flutter.io")
    }
}

plugins {
    id("dev.flutter.flutter-plugin-loader") version "1.0.0"
    id("com.android.application") version "9.1.0" apply false
    id("org.jetbrains.kotlin.android") version "2.4.0" apply false
}


/*
 * Mappls GL 2.0.7 compatibility shim for Flutter 3.47 + AGP 9 built-in Kotlin.
 *
 * Mappls GL 2.0.7 still applies the legacy Kotlin Gradle Plugin and omits
 * compileSdk in its Android library build file. AGP 9 rejects that plugin
 * application when built-in Kotlin is enabled. Patch the hosted package before
 * Gradle evaluates subprojects so the app can keep the official 2.0.7 package
 * and its native Mappls implementation without maintaining a vendored fork.
 */
fun patchMapplsGlForAgp9() {
    val pubCache = System.getenv("PUB_CACHE")
        ?: File(System.getProperty("user.home"), ".pub-cache").absolutePath

    val packageBuildFile = File(pubCache, "hosted/pub.dev/mappls_gl-2.0.7/android/build.gradle")
    if (!packageBuildFile.isFile) return

    var source = packageBuildFile.readText()
    val original = source

    source = source.replace(
        Regex("""(?m)^\s*apply plugin:\s*['"](?:org\.jetbrains\.kotlin\.android|kotlin-android)['"]\s*\r?\n?"""),
        ""
    )
    source = source.replace(
        Regex("""(?m)^\s*ext\.kotlin_version\s*=.*\r?\n"""),
        ""
    )

    if (!Regex("""(?m)\bcompileSdk(?:Version)?\b""").containsMatchIn(source)) {
        source = source.replaceFirst(
            Regex("""android\s*\{"""),
            "android {\n    compileSdkVersion 36"
        )
    }

    if (!source.contains("compilerOptions")) {
        source += """

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}
"""
    }

    if (source != original) {
        packageBuildFile.writeText(source)
    }
}

patchMapplsGlForAgp9()

include(":app")
