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
 * Mappls GL 2.0.7 compatibility shim for AGP 9 + built-in Kotlin.
 *
 * AGP 9 already provides Kotlin support, while Mappls GL 2.0.7's Android
 * build.gradle still uses the legacy Kotlin Android plugin and android.kotlinOptions.
 * Patch the cached package during Gradle initialization so every clean dependency
 * restore gets the same compatible package without maintaining a fork.
 */
fun patchMapplsGlForAgp9() {
    val pubCache = System.getenv("PUB_CACHE")
        ?: File(System.getProperty("user.home"), ".pub-cache").absolutePath

    val packageBuildFile = File(
        pubCache,
        "hosted/pub.dev/mappls_gl-2.0.7/android/build.gradle"
    )
    if (!packageBuildFile.isFile) return

    var source = packageBuildFile.readText()

    // AGP 9 provides Kotlin natively. Remove Mappls' legacy Kotlin plugin.
    source = source.replace(
        Regex("""(?m)^\s*apply plugin:\s*['"](?:org\.jetbrains\.kotlin\.android|kotlin-android)['"]\s*\r?\n?"""),
        ""
    )
    source = source.replace(
        Regex("""(?m)^\s*ext\.kotlin_version\s*=.*\r?\n"""),
        ""
    )

    // Remove the legacy android.kotlinOptions block.
    source = source.replace(
        Regex("""(?s)\n\s*kotlinOptions\s*\{.*?\n\s*\}"""),
        ""
    )

    // Mappls 2.0.7 does not declare compileSdk; AGP 9 requires it for libraries.
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

    packageBuildFile.writeText(source)
}

/*
 * Mappls GL 2.0.7 release-resource generator compatibility shim.
 *
 * Its legacy Flutter resource generator uses recursive Groovy file deletion.
 * On the small CI/EC2 builder this can exhaust JVM Metaspace during AGP 9
 * release resource processing. Use NIO's native tree traversal instead.
 */
fun patchMapplsResourceGeneratorForAgp9() {
    val pubCache = System.getenv("PUB_CACHE")
        ?: File(System.getProperty("user.home"), ".pub-cache").absolutePath

    val scriptFile = File(
        pubCache,
        "hosted/pub.dev/mappls_gl-2.0.7/android/flutter-mappls-plugin.gradle"
    )
    if (!scriptFile.isFile) return

    var source = scriptFile.readText()

    val legacy = Regex(
        """(?s)void deleteFolder\(File folder\) \{.*?\n\}"""
    )

    val replacement = """
void deleteFolder(File folder) {
    if (!folder.exists()) return

    def stream = java.nio.file.Files.walk(folder.toPath())
    try {
        stream
            .sorted(java.util.Comparator.reverseOrder())
            .forEach { path -> java.nio.file.Files.deleteIfExists(path) }
    } finally {
        stream.close()
    }
}
""".trim()

    if (legacy.containsMatchIn(source) &&
        !source.contains("java.nio.file.Files.walk(folder.toPath())")) {
        source = source.replaceFirst(legacy, replacement)
        scriptFile.writeText(source)
    }
}

gradle.settingsEvaluated {
    patchMapplsGlForAgp9()
    patchMapplsResourceGeneratorForAgp9()
}

include(":app")
