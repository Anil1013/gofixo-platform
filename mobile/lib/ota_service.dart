import 'package:flutter/foundation.dart';
import 'package:flutter_ota_kit/flutter_ota_kit.dart';

class OtaService {
  static final ValueNotifier<String> status = ValueNotifier<String>(
    'OTA: starting...',
  );

  static void _setStatus(String value) {
    status.value = value;
    debugPrint(value);
  }

  static const _checkUrl =
      'https://gofixo.mob13r.com/api/mobile/ota/check';

  static Future<void> checkAndApply() async {
    try {
      _setStatus('OTA: START');
      final appVersionCode = await FlutterPatcher.appVersionCode;
      _setStatus('OTA: appVersionCode=' + appVersionCode.toString());
      final abi = await FlutterPatcher.deviceAbi;
      _setStatus('OTA: abi=' + abi);
      if (appVersionCode == null || abi.isEmpty) {
        _setStatus('OTA: STOP invalid version/abi');
        return;
      }
      final currentPatch = await FlutterPatcher.currentVersion ?? '';
      _setStatus('OTA: currentPatch=' + currentPatch);
      final url = Uri.parse(_checkUrl).replace(queryParameters: {
        'app_version_code': appVersionCode.toString(),
        'abi': abi,
        'current_patch': currentPatch,
      });
      _setStatus('OTA: CHECKING');
      final check = await FlutterPatcher.checkUpdate(
        url.toString(),
        timeout: const Duration(seconds: 15),
      );
      _setStatus(
        'OTA: hasUpdate=' + check.hasUpdate.toString() +
        ' patch=' + (check.patch?.version ?? 'null'),
      );
      if (!check.hasUpdate || check.patch == null) {
        _setStatus('OTA: NO UPDATE');
        return;
      }
      _setStatus('OTA: APPLY START');
      _setStatus('OTA: patch=' + check.patch!.version);
      debugPrint('OTA: patch url=' + check.patch!.patchUrl);
      debugPrint('OTA: patch md5=' + check.patch!.md5);
      debugPrint(
        'OTA: targetVersionCode=' +
        check.patch!.targetVersionCode.toString(),
      );
      final result = await FlutterPatcher.applyPatch(check.patch!);
      _setStatus(
        'OTA: RESULT ok=' + result.ok.toString() +
        ' error=' + (result.error?.name ?? 'null') +
        ' message=' + (result.message ?? 'null'),
      );
      if (!result.ok) {
        _setStatus('OTA: APPLY FAILED');
        return;
      }
      _setStatus('OTA: APPLY SUCCESS');
      _setStatus('OTA: RESTART START');
      await FlutterPatcher.restart();
      _setStatus('OTA: RESTART RETURNED');
    } catch (e, st) {
      _setStatus('OTA: EXCEPTION=' + e.toString());
      debugPrint('OTA: STACK=' + st.toString());
    }
  }
}
