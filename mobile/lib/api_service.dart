import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

const String apiBase = 'https://backend.mob13r.com/api';

class Session {
  final String token; final String role; final Map<String, dynamic> user;
  Session({required this.token, required this.role, required this.user});
  String? get userName => user['name']?.toString();
  int? get userId => int.tryParse(user['id']?.toString() ?? '');
}

class ApiService {
  static Future<Session?> loadSession() async {
    final prefs = await SharedPreferences.getInstance();
    final token = prefs.getString('gofixo_token'), role = prefs.getString('gofixo_role'), rawUser = prefs.getString('gofixo_user');
    if (token == null || role == null || rawUser == null) return null;
    try { return Session(token: token, role: role, user: Map<String,dynamic>.from(jsonDecode(rawUser))); }
    catch (_) { await clearSession(); return null; }
  }
  static Future<void> saveSession(String token, Map<String,dynamic> user, String role) async {
    final p = await SharedPreferences.getInstance();
    await p.setString('gofixo_token', token); await p.setString('gofixo_user', jsonEncode(user)); await p.setString('gofixo_role', role);
  }
  static Future<void> clearSession() async {
    final p = await SharedPreferences.getInstance();
    await p.remove('gofixo_token'); await p.remove('gofixo_user'); await p.remove('gofixo_role');
  }
  static Future<dynamic> _request(String method, String path, {Map<String,dynamic>? body, String? token}) async {
    final headers = <String,String>{'Content-Type':'application/json'};
    if (token != null) headers['Authorization'] = 'Bearer ' + token;
    final uri = Uri.parse(apiBase + path);
    final response = method == 'GET' ? await http.get(uri, headers: headers) : await http.post(uri, headers: headers, body: jsonEncode(body ?? {}));
    dynamic data; try { data = jsonDecode(response.body); } catch (_) { data = {}; }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      final message = data is Map ? data['error']?.toString() : null;
      throw Exception(message ?? 'Request failed (' + response.statusCode.toString() + ')');
    }
    return data;
  }
  static Future<void> login(String role, String phone, String password) async {
    final data = await _request('POST', '/auth/' + role + '/login', body: {'phone':phone,'password':password});
    if (data is! Map) throw Exception('Invalid login response from server.');
    final token = data['token']?.toString(), user = data['user'];
    if (token == null || user is! Map) throw Exception('Invalid login response from server.');
    await saveSession(token, Map<String,dynamic>.from(user), role);
  }
  static Future<void> registerCustomer(String name,String phone,String password) async => _request('POST','/auth/customer/register',body:{'name':name,'phone':phone,'password':password});
  static Future<void> registerProvider(String name,String phone,String type,String password) async => _request('POST','/providers/register',body:{'name':name,'phone':phone,'type':type,'password':password});
  static Future<void> forgotPassword(String role,String phone) async => _request('POST','/auth/' + role + '/forgot-password',body:{'phone':phone});
  static Future<List<Map<String,dynamic>>> customerBookings(String token) async {
    final data=await _request('GET','/bookings/mine',token:token);
    return data is List ? data.map((e)=>Map<String,dynamic>.from(e as Map)).toList() : [];
  }
  static Future<List<Map<String,dynamic>>> providerBookings(String token) async {
    final data=await _request('GET','/bookings/mine/provider',token:token);
    return data is List ? data.map((e)=>Map<String,dynamic>.from(e as Map)).toList() : [];
  }
  static Future<Map<String,dynamic>> createBooking(String token,{required String providerType,required String pickup,required String drop,required double lat,required double lng,required double fare,required double distanceKm}) async {
    final data=await _request('POST','/bookings',token:token,body:{
      'service_type':'ride','provider_type':providerType,'pickup_location':pickup,'drop_or_service_address':drop,
      'pickup_lat':lat,'pickup_lng':lng,'estimated_fare':fare,'route_distance_km':distanceKm,
    });
    return Map<String,dynamic>.from(data as Map);
  }
}
