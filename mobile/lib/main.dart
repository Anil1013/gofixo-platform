import 'package:flutter/material.dart';
import 'api_service.dart';

void main() { WidgetsFlutterBinding.ensureInitialized(); runApp(const GofixoApp()); }

class GofixoApp extends StatelessWidget {
  const GofixoApp({super.key});
  @override Widget build(BuildContext context) => MaterialApp(
    debugShowCheckedModeBanner: false, title: 'Gofixo',
    theme: ThemeData(useMaterial3: true, scaffoldBackgroundColor: const Color(0xFFF7F9FC), colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFFFF6B00))),
    home: const SessionGate(),
  );
}

class SessionGate extends StatefulWidget {
  const SessionGate({super.key});
  @override State<SessionGate> createState() => _SessionGateState();
}
class _SessionGateState extends State<SessionGate> {
  late Future<Session?> _session;
  @override void initState() { super.initState(); _session = ApiService.loadSession(); }
  void _refresh() => setState(() => _session = ApiService.loadSession());
  @override Widget build(BuildContext context) => FutureBuilder<Session?>(
    future: _session,
    builder: (context, snapshot) {
      if (snapshot.connectionState != ConnectionState.done) return const Scaffold(body: Center(child: CircularProgressIndicator()));
      final session = snapshot.data;
      if (session == null) return RoleSelectionScreen(onChanged: _refresh);
      return RoleHome(session: session, onLogout: () async { await ApiService.clearSession(); _refresh(); });
    },
  );
}

class RoleSelectionScreen extends StatelessWidget {
  final VoidCallback onChanged;
  const RoleSelectionScreen({super.key, required this.onChanged});
  @override Widget build(BuildContext context) => Scaffold(
    body: SafeArea(child: Center(child: SingleChildScrollView(
      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 32),
      child: Column(children: [
        const SizedBox(height: 30),
        Container(width: 82, height: 82, decoration: BoxDecoration(color: const Color(0xFFFF6B00), borderRadius: BorderRadius.circular(24)), child: const Icon(Icons.location_on_rounded, color: Colors.white, size: 48)),
        const SizedBox(height: 18),
        const Text('Gofixo', style: TextStyle(fontSize: 38, fontWeight: FontWeight.w800, color: Color(0xFF172B4D))),
        const SizedBox(height: 8),
        const Text('Your City. Your Services.', style: TextStyle(fontSize: 17, color: Color(0xFF64748B))),
        const SizedBox(height: 55),
        const Text('Welcome to Gofixo', style: TextStyle(fontSize: 25, fontWeight: FontWeight.w700, color: Color(0xFF172B4D))),
        const SizedBox(height: 10),
        const Text('Choose how you want to use Gofixo', textAlign: TextAlign.center, style: TextStyle(fontSize: 15, color: Color(0xFF64748B))),
        const SizedBox(height: 28),
        _RoleCard(icon: Icons.person_rounded, title: 'Continue as Customer', subtitle: 'Book rides and home services', onTap: () => _openAuth(context, 'customer')),
        const SizedBox(height: 16),
        _RoleCard(icon: Icons.directions_bike_rounded, title: 'Continue as Partner', subtitle: 'Accept bookings and earn money', outlined: true, onTap: () => _openAuth(context, 'provider')),
        const SizedBox(height: 36),
        const Text('One app for Customers and Partners', style: TextStyle(fontSize: 13, color: Color(0xFF94A3B8))),
      ]),
    ))),
  );
  void _openAuth(BuildContext context, String role) => Navigator.of(context).push(MaterialPageRoute(builder: (_) => AuthScreen(role: role, onAuthenticated: () { Navigator.of(context).pop(); onChanged(); })));
}

class AuthScreen extends StatefulWidget {
  final String role; final VoidCallback onAuthenticated;
  const AuthScreen({super.key, required this.role, required this.onAuthenticated});
  @override State<AuthScreen> createState() => _AuthScreenState();
}
class _AuthScreenState extends State<AuthScreen> {
  final _formKey = GlobalKey<FormState>();
  final _name = TextEditingController(), _phone = TextEditingController(), _password = TextEditingController();
  String _mode = 'login', _providerType = 'bike'; bool _loading = false; String? _error, _message;
  bool get isCustomer => widget.role == 'customer';
  @override void dispose() { _name.dispose(); _phone.dispose(); _password.dispose(); super.dispose(); }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() { _loading = true; _error = null; _message = null; });
    try {
      if (_mode == 'register') {
        if (isCustomer) await ApiService.registerCustomer(_name.text.trim(), _phone.text.trim(), _password.text);
        else await ApiService.registerProvider(_name.text.trim(), _phone.text.trim(), _providerType, _password.text);
        setState(() { _mode = 'login'; _message = 'Account created — please log in.'; });
      } else if (_mode == 'forgot') {
        await ApiService.forgotPassword(widget.role, _phone.text.trim());
        setState(() { _mode = 'login'; _message = 'Reset request submitted. An administrator can complete the password reset.'; });
      } else {
        await ApiService.login(widget.role, _phone.text.trim(), _password.text);
        widget.onAuthenticated();
      }
    } catch (e) {
      if (mounted) setState(() => _error = e.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override Widget build(BuildContext context) {
    final register = _mode == 'register', forgot = _mode == 'forgot';
    return Scaffold(appBar: AppBar(title: Text(isCustomer ? 'Customer' : 'Partner')),
      body: SafeArea(child: Form(key: _formKey, child: ListView(padding: const EdgeInsets.all(24), children: [
        Text(forgot ? 'Forgot password' : register ? (isCustomer ? 'Create customer account' : 'Register as a partner') : 'Log in', style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w800, color: Color(0xFF172B4D))),
        const SizedBox(height: 8),
        Text(isCustomer ? 'Rides and home services' : 'Drive, provide services and earn', style: const TextStyle(color: Color(0xFF64748B))),
        const SizedBox(height: 28),
        if (register) ...[
          TextFormField(controller: _name, decoration: const InputDecoration(labelText: 'Name', border: OutlineInputBorder()), validator: (v) => (v == null || v.trim().isEmpty) ? 'Enter your name' : null),
          const SizedBox(height: 16),
          if (!isCustomer) ...[
            DropdownButtonFormField<String>(value: _providerType, decoration: const InputDecoration(labelText: 'What do you do?', border: OutlineInputBorder()),
              items: const [DropdownMenuItem(value: 'bike', child: Text('Bike driver')), DropdownMenuItem(value: 'auto', child: Text('Auto driver')), DropdownMenuItem(value: 'car', child: Text('Car driver')), DropdownMenuItem(value: 'general_worker', child: Text('Home helper')), DropdownMenuItem(value: 'skilled_worker', child: Text('Skilled worker'))],
              onChanged: (v) => setState(() => _providerType = v ?? 'bike')),
            const SizedBox(height: 16),
          ],
        ],
        TextFormField(controller: _phone, keyboardType: TextInputType.phone, maxLength: 10, decoration: const InputDecoration(labelText: 'Phone number', prefixText: '+91 ', border: OutlineInputBorder()), validator: (v) => RegExp(r'^\d{10}$').hasMatch(v?.trim() ?? '') ? null : 'Enter a valid 10-digit phone number'),
        if (!forgot) ...[
          const SizedBox(height: 16),
          TextFormField(controller: _password, obscureText: true, decoration: const InputDecoration(labelText: 'Password', hintText: 'Minimum 8 characters', border: OutlineInputBorder()), validator: (v) => (v == null || v.length < 8) ? 'Password must be at least 8 characters' : null),
        ],
        if (forgot) const Padding(padding: EdgeInsets.only(top: 12), child: Text('Enter your registered phone number. The existing admin-approved reset workflow is used.', style: TextStyle(color: Color(0xFF64748B)))),
        if (_error != null) Padding(padding: const EdgeInsets.only(top: 16), child: Text(_error!, style: const TextStyle(color: Colors.red))),
        if (_message != null) Padding(padding: const EdgeInsets.only(top: 16), child: Text(_message!, style: const TextStyle(color: Colors.green))),
        const SizedBox(height: 24),
        SizedBox(height: 52, child: FilledButton(onPressed: _loading ? null : _submit, style: FilledButton.styleFrom(backgroundColor: const Color(0xFFFF6B00)), child: _loading ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : Text(forgot ? 'Request reset' : register ? 'Create account' : 'Log in'))),
        const SizedBox(height: 12),
        if (_mode == 'login') ...[
          TextButton(onPressed: () => setState(() { _mode = 'register'; _error = null; _message = null; }), child: const Text('New here? Create account')),
          if (isCustomer) TextButton(onPressed: () => setState(() { _mode = 'forgot'; _error = null; _message = null; }), child: const Text('Forgot password?')),
        ] else TextButton(onPressed: () => setState(() { _mode = 'login'; _error = null; _message = null; }), child: const Text('Back to login')),
      ])));
  }
}

class RoleHome extends StatelessWidget {
  final Session session; final Future<void> Function() onLogout;
  const RoleHome({super.key, required this.session, required this.onLogout});
  @override Widget build(BuildContext context) {
    final provider = session.role == 'provider';
    return Scaffold(appBar: AppBar(title: const Text('Gofixo'), actions: [IconButton(onPressed: onLogout, icon: const Icon(Icons.logout_rounded))]),
      body: Center(child: Padding(padding: const EdgeInsets.all(24), child: Card(child: Padding(padding: const EdgeInsets.all(24), child: Column(mainAxisSize: MainAxisSize.min, children: [
        Icon(provider ? Icons.directions_bike_rounded : Icons.person_rounded, size: 64, color: const Color(0xFFFF6B00)),
        const SizedBox(height: 16),
        Text('Welcome ${session.userName ?? ''}', style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700)),
        const SizedBox(height: 8),
        Text(provider ? 'Partner account' : 'Customer account', style: const TextStyle(color: Color(0xFF64748B))),
        const SizedBox(height: 24),
        Text(provider ? 'Partner dashboard is next.' : 'Customer home, booking and Mappls flow is next.'),
      ])))));
  }
}

class _RoleCard extends StatelessWidget {
  final IconData icon; final String title; final String subtitle; final VoidCallback onTap; final bool outlined;
  const _RoleCard({required this.icon, required this.title, required this.subtitle, required this.onTap, this.outlined = false});
  @override Widget build(BuildContext context) => Material(color: Colors.transparent, child: InkWell(onTap: onTap, borderRadius: BorderRadius.circular(18), child: Ink(padding: const EdgeInsets.all(18), decoration: BoxDecoration(color: outlined ? Colors.white : const Color(0xFFFF6B00), borderRadius: BorderRadius.circular(18), border: Border.all(color: const Color(0xFFFF6B00), width: outlined ? 1.5 : 0)), child: Row(children: [
    Container(width: 54, height: 54, decoration: BoxDecoration(color: outlined ? const Color(0xFFFFF1E6) : Colors.white.withValues(alpha: .18), borderRadius: BorderRadius.circular(16)), child: Icon(icon, size: 28, color: outlined ? const Color(0xFFFF6B00) : Colors.white)),
    const SizedBox(width: 16), Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(title, style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: outlined ? const Color(0xFF172B4D) : Colors.white)), const SizedBox(height: 4), Text(subtitle, style: TextStyle(fontSize: 13, color: outlined ? const Color(0xFF64748B) : Colors.white.withValues(alpha: .88)))])),
    Icon(Icons.arrow_forward_ios_rounded, size: 17, color: outlined ? const Color(0xFFFF6B00) : Colors.white),
  ])));
}
