import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:package_info_plus/package_info_plus.dart';
import 'package:url_launcher/url_launcher.dart';

class UpdateInfo {
  final String version;
  final int buildNumber;
  final String downloadUrl;
  final String notes;
  final bool forceUpdate;
  const UpdateInfo({required this.version, required this.buildNumber, required this.downloadUrl, required this.notes, required this.forceUpdate});
}

class UpdateService {
  static const _manifestUrl = 'https://raw.githubusercontent.com/Anil1013/gofixo-platform/main/mobile/version.json';
  static Future<void> checkAndPrompt(BuildContext context) async {
    try {
      final packageInfo = await PackageInfo.fromPlatform();
      final cacheBust = DateTime.now().millisecondsSinceEpoch;
      final response = await http.get(Uri.parse('$_manifestUrl?check=$cacheBust'), headers: const {'Accept': 'application/json', 'Cache-Control': 'no-cache'}).timeout(const Duration(seconds: 10));
      if (response.statusCode != 200) return;
      final data = jsonDecode(response.body);
      if (data is! Map) return;
      final latestVersion = data['version']?.toString();
      final buildNumber = int.tryParse(data['buildNumber']?.toString() ?? '') ?? 0;
      final downloadUrl = data['downloadUrl']?.toString();
      if (latestVersion == null || downloadUrl == null) return;
      final currentVersion = packageInfo.version;
      final currentBuild = int.tryParse(packageInfo.buildNumber) ?? 0;
      if (!_isNewer(currentVersion, currentBuild, latestVersion, buildNumber)) return;
      if (!context.mounted) return;
      final info = UpdateInfo(version: latestVersion, buildNumber: buildNumber, downloadUrl: downloadUrl, notes: data['notes']?.toString() ?? 'Bug fixes and improvements.', forceUpdate: data['forceUpdate'] == true);
      await showDialog<void>(
        context: context,
        barrierDismissible: !info.forceUpdate,
        builder: (dialogContext) => AlertDialog(
          title: const Text('New version available'),
          content: Text('Gofixo ${info.version} is available.\n\n${info.notes}'),
          actions: [
            if (!info.forceUpdate) TextButton(onPressed: () => Navigator.pop(dialogContext), child: const Text('Later')),
            FilledButton(
              onPressed: () async {
                final uri = Uri.parse(info.downloadUrl);
                if (await canLaunchUrl(uri)) await launchUrl(uri, mode: LaunchMode.externalApplication);
                if (dialogContext.mounted && !info.forceUpdate) Navigator.pop(dialogContext);
              },
              child: const Text('Update'),
            ),
          ],
        ),
      );
    } catch (_) {}
  }
  static bool _isNewer(String currentVersion, int currentBuild, String latestVersion, int latestBuild) {
    final current = _versionParts(currentVersion);
    final latest = _versionParts(latestVersion);
    for (var i = 0; i < 3; i++) { if (latest[i] != current[i]) return latest[i] > current[i]; }
    return latestBuild > currentBuild;
  }
  static List<int> _versionParts(String value) {
    final match = RegExp(r'^(\d+)\.(\d+)\.(\d+)').firstMatch(value);
    if (match == null) return const [0, 0, 0];
    return [int.parse(match.group(1)!), int.parse(match.group(2)!), int.parse(match.group(3)!)];
  }
}