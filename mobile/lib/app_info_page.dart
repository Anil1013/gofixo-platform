import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_ota_kit/flutter_ota_kit.dart';
import 'package:package_info_plus/package_info_plus.dart';

const _navy = Color(0xFF172B4D);
const _muted = Color(0xFF64748B);
const _orange = Color(0xFFFF6B00);

class AppInfoPage extends StatefulWidget {
  const AppInfoPage({super.key});
  @override State<AppInfoPage> createState() => _AppInfoPageState();
}

class _AppInfoPageState extends State<AppInfoPage> {
  static const _channel = MethodChannel('gofixo/app_info');
  PackageInfo? _package;
  String _signatureSha256 = '-';
  String _androidVersion = '-';
  String _androidSdk = '-';
  String _abi = '-';
  String _otaPatch = '-';
  bool _loading = true;

  static const String _gitCommit =
      String.fromEnvironment('GOFIXO_GIT_SHA', defaultValue: 'development');

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    try {
      final package = await PackageInfo.fromPlatform();
      final native = await _channel.invokeMapMethod<String, dynamic>('getInfo');
      final patch = await FlutterPatcher.currentVersion;
      if (!mounted) return;
      setState(() {
        _package = package;
        _signatureSha256 = native?['signatureSha256']?.toString() ?? '-';
        _androidVersion = native?['androidVersion']?.toString() ?? '-';
        _androidSdk = native?['androidSdk']?.toString() ?? '-';
        _abi = native?['abi']?.toString() ?? '-';
        _otaPatch = patch?.isNotEmpty == true ? patch! : 'Base APK';
        _loading = false;
      });
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = _package;
    return Scaffold(
      appBar: AppBar(title: const Text('App information')),
      body: _loading ? const Center(child: CircularProgressIndicator()) : ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Card(child: Padding(
            padding: const EdgeInsets.all(18),
            child: Column(children: [
              Container(width: 64, height: 64,
                decoration: BoxDecoration(color: _orange, borderRadius: BorderRadius.circular(18)),
                child: const Icon(Icons.location_on_rounded, color: Colors.white, size: 36)),
              const SizedBox(height: 12),
              const Text('Gofixo', style: TextStyle(fontSize: 25, fontWeight: FontWeight.w800, color: _navy)),
              const SizedBox(height: 4),
              const Text('Application & build details', style: TextStyle(color: _muted)),
            ]),
          )),
          const SizedBox(height: 12),
          _section('Application', [
            _row('Version', 'v' + (p?.version ?? '-')),
            _row('Build number', p?.buildNumber ?? '-'),
            _row('Package name', p?.packageName ?? '-'),
            _row('Installer', p?.installerStore ?? '-'),
            _row('Git commit SHA', _gitCommit),
          ]),
          const SizedBox(height: 12),
          _section('Android device', [
            _row('Android version', _androidVersion),
            _row('Android SDK', _androidSdk),
            _row('CPU ABI', _abi),
          ]),
          const SizedBox(height: 12),
          _section('Security / signing', [
            _row('Signing SHA-256', _signatureSha256),
          ]),
          const SizedBox(height: 12),
          _section('OTA', [_row('Current patch', _otaPatch)]),
          const SizedBox(height: 20),
          const Center(child: Text(
            'Use these details when reporting an app/update issue.',
            textAlign: TextAlign.center, style: TextStyle(fontSize: 12, color: _muted),
          )),
        ],
      ),
    );
  }

  Widget _section(String title, List<Widget> rows) => Card(
    child: Padding(
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 8),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(title, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: _navy)),
        const Divider(height: 20),
        ...rows,
      ]),
    ),
  );

  Widget _row(String label, String value) => Padding(
    padding: const EdgeInsets.only(bottom: 13),
    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(label, style: const TextStyle(fontSize: 12, color: _muted, fontWeight: FontWeight.w600)),
      const SizedBox(height: 3),
      SelectableText(value, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
    ]),
  );
}
