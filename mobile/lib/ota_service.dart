import 'package:flutter_ota_kit/flutter_ota_kit.dart';

class OtaService {
  static const _checkUrl =
      'https://gofixo.mob13r.com/api/mobile/ota/check';

  static Future<void> checkAndApply() async {
    try {
      final appVersionCode = await FlutterPatcher.appVersionCode;
      final abi = await FlutterPatcher.deviceAbi;
      if (appVersionCode == null || abi.isEmpty) return;

      final currentPatch = await FlutterPatcher.currentVersion ?? '';
      final url = Uri.parse(_checkUrl).replace(queryParameters: {
        'app_version_code': appVersionCode.toString(),
        'abi': abi,
        'current_patch': currentPatch,
      });

      final check = await FlutterPatcher.checkUpdate(
        url.toString(),
        timeout: const Duration(seconds: 15),
      );
      if (!check.hasUpdate || check.patch == null) return;

      final result = await FlutterPatcher.applyPatch(check.patch!);
      if (!result.ok) return;

      await FlutterPatcher.restart();
    } catch (_) {
      // OTA must never block or crash the app.
    }
  }
}
