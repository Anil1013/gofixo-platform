package com.gofixo.app

import android.content.pm.PackageManager
import android.os.Build
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.security.MessageDigest

class MainActivity : FlutterActivity() {
    private val channelName = "gofixo/app_info"

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)

        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, channelName)
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
    }

    private fun signingSha256(): String {
        return try {
            val signatures = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                packageManager.getPackageInfo(
                    packageName,
                    PackageManager.GET_SIGNING_CERTIFICATES
                ).signingInfo.apkContentsSigners
            } else {
                @Suppress("DEPRECATION")
                packageManager.getPackageInfo(
                    packageName,
                    @Suppress("DEPRECATION") PackageManager.GET_SIGNATURES
                ).signatures
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
