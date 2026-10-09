package com.gofixo.app

import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.core.content.FileProvider
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.io.File
import java.security.MessageDigest

class MainActivity : FlutterActivity() {
    private val appInfoChannel = "gofixo/app_info"
    private val updateChannel = "gofixo/update"

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)

        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, appInfoChannel)
            .setMethodCallHandler { call, result ->
                if (call.method != "getInfo") {
                    result.notImplemented()
                    return@setMethodCallHandler
                }

                result.success(
                    mapOf(
                        "signatureSha256" to signingSha256(),
                        "androidVersion" to Build.VERSION.RELEASE,
                        "androidSdk" to Build.VERSION.SDK_INT.toString(),
                        "abi" to Build.SUPPORTED_ABIS.firstOrNull().orEmpty(),
                    )
                )
            }

        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, updateChannel)
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "installApk" -> {
                        val path = call.argument<String>("path")
                        if (path.isNullOrBlank()) {
                            result.error("INVALID_PATH", "APK path is missing.", null)
                            return@setMethodCallHandler
                        }

                        try {
                            val started = installApk(File(path))
                            result.success(started)
                        } catch (error: Exception) {
                            result.error(
                                "INSTALLER_ERROR",
                                error.message ?: "Could not open Android installer.",
                                null
                            )
                        }
                    }

                    else -> result.notImplemented()
                }
            }
    }

    private fun installApk(apkFile: File): Boolean {
        require(apkFile.exists()) { "Downloaded APK was not found." }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            !packageManager.canRequestPackageInstalls()
        ) {
            val settingsIntent = Intent(
                android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:$packageName")
            )
            startActivity(settingsIntent)
            return false
        }

        // Flutter's Directory.systemTemp on Android resolves to code_cache/.
        // FileProvider's <cache-path> root is cache/, so copy the APK into the
        // configured FileProvider root before creating the content:// URI.
        val installerApk = File(cacheDir, apkFile.name)
        if (apkFile.canonicalFile != installerApk.canonicalFile) {
            apkFile.copyTo(installerApk, overwrite = true)
        }

        val apkUri: Uri = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            FileProvider.getUriForFile(
                this,
                "$packageName.fileprovider",
                installerApk
            )
        } else {
            @Suppress("DEPRECATION")
            Uri.fromFile(apkFile)
        }

        val intent = Intent(Intent.ACTION_INSTALL_PACKAGE).apply {
            setDataAndType(apkUri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)
            putExtra(Intent.EXTRA_NOT_UNKNOWN_SOURCE, true)
        }

        try {
            startActivity(intent)
            return true
        } catch (error: android.content.ActivityNotFoundException) {
            throw IllegalStateException(
                "Android could not find an APK installer on this device.",
                error
            )
        }
    }

    private fun signingSha256(): String {
        return try {
            val signatures = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                packageManager.getPackageInfo(
                    packageName,
                    PackageManager.GET_SIGNING_CERTIFICATES
                ).signingInfo?.apkContentsSigners.orEmpty()
            } else {
                @Suppress("DEPRECATION")
                packageManager.getPackageInfo(
                    packageName,
                    @Suppress("DEPRECATION") PackageManager.GET_SIGNATURES
                ).signatures.orEmpty()
            }

            signatures.firstOrNull()?.toByteArray()?.let { bytes ->
                MessageDigest.getInstance("SHA-256")
                    .digest(bytes)
                    .joinToString(":") { "%02X".format(it) }
            } ?: "-"
        } catch (_: Exception) {
            "-"
        }
    }
}
