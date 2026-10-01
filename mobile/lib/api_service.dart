import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

const String apiBase = 'https://gofixo.mob13r.com/api';

class Session {
  final String token;
  final String role;
  final Map<String, dynamic> user;
  Session({required this.token, required this.role, required this.user});
  String? get userName => user['name']?.toString();
}

class ApiService {
  static Future<Session?> loadSession() async {
    final prefs = await SharedPreferences.getInstance();
    final token = prefs.getString('gofixo_token');
    final role = prefs.getString('gofixo_role');
    final rawUser = prefs.getString('gofixo_user');
    if (token == null || role == null || rawUser == null) return null;
    try { return Session(token: token, role: role, user: Map<String, dynamic>.from(jsonDecode(rawUser))); }
    catch (_) { await clearSession(); return null; }
  }

  static Future<void> saveSession(String token, Map<String, dynamic> user, String role) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('gofixo_token', token);
    await prefs.setString('gofixo_user', jsonEncode(user));
    await prefs.setString('gofixo_role', role);
  }

  static Future<void> clearSession() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('gofixo_token');
    await prefs.remove('gofixo_user');
    await prefs.remove('gofixo_role');
  }

  static Future<Map<String, dynamic>> _post(String path, Map<String, dynamic> body) async {
    final response = await http.post(Uri.parse('${apiBase}${path}'), headers: {'Content-Type': 'application/json'}, body: jsonEncode(body));
    Map<String, dynamic> data = {};
    try { final decoded = jsonDecode(response.body); if (decoded is Map) data = Map<String, dynamic>.from(decoded); } catch (_) {}
    if (response.statusCode < 200 || response.statusCode >= 300) throw Exception(data['error']?.toString() ?? 'Request failed (${response.statusCode})');
    return data;
  }

  static Future<void> login(String role, String phone, String password) async {
    final data = await _post('/auth/$role/login', {'phone': phone, 'password': password});
    final token = data['token']?.toString(); final user = data['user'];
    if (token == null || user is! Map) throw Exception('Invalid login response from server.');
    await saveSession(token, Map<String, dynamic>.from(user), role);
  }

  static Future<void> registerCustomer(String name, String phone, String password) async => _post('/auth/customer/register', {'name': name, 'phone': phone, 'password': password});
  static Future<void> registerProvider(String name, String phone, String type, String password) async => _post('/providers/register', {'name': name, 'phone': phone, 'type': type, 'password': password});
  static Future<void> forgotPassword(String role, String phone) async => _post('/auth/$role/forgot-password', {'phone': phone});
}
