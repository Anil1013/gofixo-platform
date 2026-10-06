import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:package_info_plus/package_info_plus.dart';

class UpdateInfo {
  final String version;
  final int buildNumber;
  final String downloadUrl;
  final String notes;
  final bool forceUpdate;

  const UpdateInfo({
    required this.version,
    required this.buildNumber,
    required this.downloadUrl,
    required this.notes,
    required this.forceUpdate,
  });
}

class UpdateService {
  static const _manifestUrl =
      'https://raw.githubusercontent.com/Anil1013/gofixo-platform/main/mobile/version.json';

  static const _installerChannel = MethodChannel('gofixo/update');

  static Future<void> checkAndPrompt(BuildContext context) async {
    try {
      final packageInfo = await PackageInfo.fromPlatform();
      final cacheBust = DateTime.now().millisecondsSinceEpoch;
      final response = await http
          .get(
            Uri.parse('$_manifestUrl?check=$cacheBust'),
            headers: const {
              'Accept': 'application/json',
              'Cache-Control': 'no-cache',
            },
          )
          .timeout(const Duration(seconds: 10));

      if (response.statusCode != 200) return;

      final data = jsonDecode(response.body);
      if (data is! Map) return;

      final latestVersion = data['version']?.toString();
      final buildNumber =
          int.tryParse(data['buildNumber']?.toString() ?? '') ?? 0;
      final downloadUrl = data['downloadUrl']?.toString();

      if (latestVersion == null || downloadUrl == null) return;

      final currentVersion = packageInfo.version;
      final currentBuild = int.tryParse(packageInfo.buildNumber) ?? 0;

      if (!_isNewer(
        currentVersion,
        currentBuild,
        latestVersion,
        buildNumber,
      )) {
        return;
      }

      if (!context.mounted) return;

      final info = UpdateInfo(
        version: latestVersion,
        buildNumber: buildNumber,
        downloadUrl: downloadUrl,
        notes: data['notes']?.toString() ?? 'Bug fixes and improvements.',
        forceUpdate: data['forceUpdate'] == true,
      );

      await showDialog<void>(
        context: context,
        barrierDismissible: !info.forceUpdate,
        builder: (dialogContext) => AlertDialog(
          title: const Text('New version available'),
          content: Text(
            'Gofixo ${info.version} is available.\n\n${info.notes}',
          ),
          actions: [
            if (!info.forceUpdate)
              TextButton(
                onPressed: () => Navigator.pop(dialogContext),
                child: const Text('Later'),
              ),
            FilledButton(
              onPressed: () async {
                Navigator.pop(dialogContext);
                await _downloadAndInstall(context, info);
              },
              child: const Text('Update'),
            ),
          ],
        ),
      );
    } catch (_) {}
  }

  static Future<void> _downloadAndInstall(
    BuildContext context,
    UpdateInfo info,
  ) async {
    final uri = Uri.tryParse(info.downloadUrl);
    if (uri == null || uri.scheme != 'https') {
      _showError(context, 'Update link is invalid. Please try again.');
      return;
    }

    final progressNotifier = ValueNotifier<double?>(0);
    var dialogOpen = true;

    if (context.mounted) {
      unawaited(showDialog<void>(
        context: context,
        barrierDismissible: false,
        builder: (_) => PopScope(
          canPop: false,
          child: AlertDialog(
            title: Text('Downloading Gofixo ${info.version}'),
            content: ValueListenableBuilder<double?>(
              valueListenable: progressNotifier,
              builder: (_, progress, __) {
                final percent =
                    progress == null ? 'Preparing…' : '${(progress * 100).toStringAsFixed(0)}%';
                return Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    LinearProgressIndicator(value: progress),
                    const SizedBox(height: 12),
                    Text(percent, textAlign: TextAlign.center),
                    const SizedBox(height: 4),
                    const Text(
                      'Please keep Gofixo open until the installer appears.',
                      textAlign: TextAlign.center,
                    ),
                  ],
                );
              },
            ),
          ),
        ),
      ));
    }

    File? apkFile;
    try {
      final client = http.Client();
      try {
        final request = http.Request('GET', uri);
        final response = await client.send(request).timeout(
              const Duration(minutes: 5),
            );

        if (response.statusCode != 200) {
          throw HttpException('HTTP ${response.statusCode}');
        }

        final tempDir = Directory.systemTemp;
        apkFile = File(
          '${tempDir.path}/gofixo-update-${info.buildNumber}.apk',
        );

        if (await apkFile.exists()) {
          await apkFile.delete();
        }

        final sink = apkFile.openWrite();
        var received = 0;
        final total = response.contentLength;

        await for (final chunk in response.stream) {
          sink.add(chunk);
          received += chunk.length;
          if (total != null && total > 0) {
            progressNotifier.value = received / total;
          } else {
            progressNotifier.value = null;
          }
        }
        await sink.flush();
        await sink.close();

        if (!await apkFile.exists() || await apkFile.length() < 1024 * 1024) {
          throw const FileSystemException('Downloaded APK is incomplete');
        }
      } finally {
        client.close();
      }

      progressNotifier.value = 1;
      await Future<void>.delayed(const Duration(milliseconds: 300));

      await _installerChannel.invokeMethod<void>(
        'installApk',
        <String, dynamic>{'path': apkFile.path},
      );

      if (context.mounted && info.forceUpdate) {
        // Android's package installer now owns the user-facing install flow.
      }
    } catch (e) {
      if (apkFile != null) {
        try {
          if (await apkFile.exists()) {
            await apkFile.delete();
          }
        } catch (_) {}
      }
      if (context.mounted) {
        _showError(
          context,
          'Update download failed. Please check your internet connection and try again.',
        );
      }
    } finally {
      progressNotifier.dispose();
      if (dialogOpen && context.mounted) {
        Navigator.of(context, rootNavigator: true).pop();
        dialogOpen = false;
      }
    }
  }

  static void _showError(BuildContext context, String message) {
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message)),
    );
  }

  static bool _isNewer(
    String currentVersion,
    int currentBuild,
    String latestVersion,
    int latestBuild,
  ) {
    final current = _versionParts(currentVersion);
    final latest = _versionParts(latestVersion);

    for (var i = 0; i < 3; i++) {
      if (latest[i] != current[i]) {
        return latest[i] > current[i];
      }
    }

    return latestBuild > currentBuild;
  }

  static List<int> _versionParts(String value) {
    final match = RegExp(r'^(\d+)\.(\d+)\.(\d+)').firstMatch(value);
    if (match == null) return const [0, 0, 0];

    return [
      int.parse(match.group(1)!),
      int.parse(match.group(2)!),
      int.parse(match.group(3)!),
    ];
  }
}
