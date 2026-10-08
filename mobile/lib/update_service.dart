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

class UpdateDownloadException implements Exception {
  final String message;
  const UpdateDownloadException(this.message);

  @override
  String toString() => message;
}

class UpdateService {
  static const _manifestUrl =
      'https://raw.githubusercontent.com/Anil1013/gofixo-platform/main/mobile/version.json';
  static const _githubManifestApi =
      'https://api.github.com/repos/Anil1013/gofixo-platform/contents/mobile/version.json?ref=main';

  static const _installerChannel = MethodChannel('gofixo/update');

  static Future<void> checkAndPrompt(BuildContext context) async {
    try {
      final packageInfo = await PackageInfo.fromPlatform();
      final data = await _fetchManifest();
      if (data == null) return;

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

  static Future<Map<String, dynamic>?> _fetchManifest() async {
    try {
      final apiResponse = await http.get(
        Uri.parse(_githubManifestApi),
        headers: const {
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Cache-Control': 'no-cache',
          'User-Agent': 'Gofixo-Updater',
        },
      ).timeout(const Duration(seconds: 10));

      if (apiResponse.statusCode == 200) {
        final envelope = jsonDecode(apiResponse.body);
        if (envelope is Map && envelope['content'] != null) {
          final encoded =
              envelope['content'].toString().replaceAll(RegExp(r'\s'), '');
          final decoded = utf8.decode(base64.decode(encoded));
          final data = jsonDecode(decoded);
          if (data is Map<String, dynamic>) return data;
          if (data is Map) return Map<String, dynamic>.from(data);
        }
      }
    } catch (_) {}

    try {
      final cacheBust = DateTime.now().millisecondsSinceEpoch;
      final response = await http.get(
        Uri.parse('$_manifestUrl?check=$cacheBust'),
        headers: const {
          'Accept': 'application/json',
          'Cache-Control': 'no-cache',
          'User-Agent': 'Gofixo-Updater',
        },
      ).timeout(const Duration(seconds: 10));

      if (response.statusCode != 200) return null;
      final data = jsonDecode(response.body);
      if (data is Map<String, dynamic>) return data;
      if (data is Map) return Map<String, dynamic>.from(data);
    } catch (_) {}
    return null;
  }

  static Future<void> _downloadAndInstall(
    BuildContext context,
    UpdateInfo info,
  ) async {
    final uri = Uri.tryParse(info.downloadUrl);
    if (uri == null ||
        uri.scheme != 'https' ||
        !RegExp(
          r'(?:/releases/download/v\d+\.\d+\.\d+/gofixo-release\.apk|/download/gofixo-release-v\d+\.\d+\.\d+\.apk)(?:$|[?#])',
        ).hasMatch(uri.path)) {
      _showError(
        context,
        'Update link is invalid or not versioned. Please try again.',
      );
      return;
    }

    final progressNotifier = ValueNotifier<double?>(0);
    var downloadDialogShown = false;

    try {
      if (context.mounted) {
        downloadDialogShown = true;
        unawaited(
          showDialog<void>(
            context: context,
            barrierDismissible: false,
            builder: (_) => PopScope(
              canPop: false,
              child: AlertDialog(
                title: Text('Downloading Gofixo ${info.version}'),
                content: ValueListenableBuilder<double?>(
                  valueListenable: progressNotifier,
                  builder: (_, progress, __) {
                    final percent = progress == null
                        ? 'Preparing…'
                        : '${(progress * 100).toStringAsFixed(0)}%';
                    return Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        LinearProgressIndicator(value: progress),
                        const SizedBox(height: 12),
                        Text(percent, textAlign: TextAlign.center),
                        const SizedBox(height: 4),
                        const Text(
                          'Downloading securely. Please keep Gofixo open.',
                          textAlign: TextAlign.center,
                        ),
                      ],
                    );
                  },
                ),
              ),
            ),
          ),
        );
      }

      final apkFile = await _downloadApk(uri, info.buildNumber, progressNotifier);

      if (downloadDialogShown && context.mounted) {
        Navigator.of(context, rootNavigator: true).pop();
        downloadDialogShown = false;
      }

      final installerStarted = await _installerChannel.invokeMethod<bool>(
        'installApk',
        <String, dynamic>{'path': apkFile.path},
      ) ?? false;

      if (!installerStarted && context.mounted) {
        _showError(
          context,
          'Please allow Gofixo to install apps from this source, then tap Update again.',
        );
      }
    } on UpdateDownloadException catch (error) {
      if (context.mounted) {
        _showError(context, 'Update download failed: ${error.message}');
      }
    } on PlatformException catch (error) {
      if (context.mounted) {
        _showError(
          context,
          'Could not open Android installer: ${error.message ?? error.code}.',
        );
      }
    } on FileSystemException catch (error) {
      if (context.mounted) {
        _showError(
          context,
          'Could not save the update APK: ${error.message}.',
        );
      }
    } catch (error) {
      if (context.mounted) {
        _showError(context, 'Could not start the update: $error');
      }
    } finally {
      if (downloadDialogShown && context.mounted) {
        Navigator.of(context, rootNavigator: true).pop();
      }
      progressNotifier.dispose();
    }
  }

  static Future<File> _downloadApk(
    Uri uri,
    int buildNumber,
    ValueNotifier<double?> progressNotifier,
  ) async {
    // Android's Directory.systemTemp may resolve to code_cache/, while the
    // FileProvider is intentionally rooted at the app's cache directory.
    // Write directly to the FileProvider-compatible cache path so the
    // currently installed APK can also perform the update.
    final tempDir = Platform.isAndroid
        ? Directory('/data/data/com.gofixo.app/cache')
        : Directory.systemTemp;
    await tempDir.create(recursive: true);
    final apkFile = File(
      '${tempDir.path}/gofixo-update-$buildNumber.apk',
    );

    Object? lastError;

    for (var attempt = 1; attempt <= 3; attempt++) {
      try {
        if (await apkFile.exists()) {
          await apkFile.delete();
        }

        final client = http.Client();
        try {
          final request = http.Request('GET', uri)
            ..followRedirects = true
            ..maxRedirects = 10
            ..headers.addAll(const {
              'Accept': 'application/vnd.android.package-archive',
              'Cache-Control': 'no-cache',
              'User-Agent': 'Gofixo-Updater',
            });

          final response = await client.send(request).timeout(
                const Duration(seconds: 30),
              );

          if (response.statusCode != HttpStatus.ok) {
            throw UpdateDownloadException(
              'GitHub returned HTTP ${response.statusCode}.',
            );
          }

          final total = response.contentLength ?? 0;
          var received = 0;
          final sink = apkFile.openWrite();

          try {
            await for (final chunk
                in response.stream.timeout(const Duration(seconds: 30))) {
              sink.add(chunk);
              received += chunk.length;

              if (total > 0) {
                progressNotifier.value = received / total;
              } else {
                progressNotifier.value = null;
              }
            }

            await sink.flush();
          } finally {
            await sink.close();
          }

          if (!await apkFile.exists()) {
            throw const UpdateDownloadException(
              'The downloaded APK file was not created.',
            );
          }

          final actualLength = await apkFile.length();
          if (actualLength < 1024 * 1024) {
            throw const UpdateDownloadException(
              'GitHub returned an incomplete APK.',
            );
          }

          if (total > 0 && actualLength != total) {
            throw UpdateDownloadException(
              'APK download was incomplete ($actualLength/$total bytes).',
            );
          }

          progressNotifier.value = 1;
          return apkFile;
        } finally {
          client.close();
        }
      } on UpdateDownloadException catch (error) {
        lastError = error;
        if (attempt == 3) break;
      } on SocketException catch (error) {
        lastError = error;
        if (attempt == 3) break;
      } on TimeoutException catch (error) {
        lastError = error;
        if (attempt == 3) break;
      } on HttpException catch (error) {
        lastError = error;
        if (attempt == 3) break;
      }

      progressNotifier.value = 0;
      await Future<void>.delayed(Duration(seconds: attempt * 2));
    }

    if (await apkFile.exists()) {
      try {
        await apkFile.delete();
      } catch (_) {}
    }

    final detail = lastError?.toString() ?? 'Unknown download error.';
    throw UpdateDownloadException(
      '$detail Please try again.',
    );
  }

  static void _showError(BuildContext context, String message) {
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        duration: const Duration(seconds: 6),
      ),
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
