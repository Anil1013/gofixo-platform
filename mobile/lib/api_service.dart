import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

const String apiBase = 'https://gofixo.mob13r.com/api';
class Session {
  final String token; final String role; final Map<String,dynamic> user;
  Session({required this.token,required this.role,required this.user});
  String? get userName=>user['name']?.toString();
  int? get userId=>int.tryParse(user['id']?.toString()??'');
}
class ApiService {
  static Future<Session?> loadSession() async {final p=await SharedPreferences.getInstance();final t=p.getString('gofixo_token'),r=p.getString('gofixo_role'),u=p.getString('gofixo_user');if(t==null||r==null||u==null)return null;try{return Session(token:t,role:r,user:Map<String,dynamic>.from(jsonDecode(u)));}catch(_){await clearSession();return null;}}
  static Future<void> saveSession(String t,Map<String,dynamic> u,String r)async{final p=await SharedPreferences.getInstance();await p.setString('gofixo_token',t);await p.setString('gofixo_user',jsonEncode(u));await p.setString('gofixo_role',r);}
  static Future<void> clearSession()async{final p=await SharedPreferences.getInstance();await p.remove('gofixo_token');await p.remove('gofixo_user');await p.remove('gofixo_role');}
  static Future<dynamic> _request(String m,String path,{Map<String,dynamic>? body,String? token})async{final h=<String,String>{'Content-Type':'application/json','Accept':'application/json'};if(token!=null)h['Authorization']='Bearer '+token;final u=Uri.parse(apiBase+path);late http.Response x;if(m=='GET')x=await http.get(u,headers:h).timeout(const Duration(seconds:20));else if(m=='PATCH')x=await http.patch(u,headers:h,body:jsonEncode(body??{})).timeout(const Duration(seconds:20));else x=await http.post(u,headers:h,body:jsonEncode(body??{})).timeout(const Duration(seconds:20));dynamic d;try{d=jsonDecode(x.body);}catch(_){d={};}if(x.statusCode<200||x.statusCode>=300){if(x.statusCode==401&&token!=null)await clearSession();final message=d is Map?(d['error']??d['message'])?.toString():null;throw Exception(message??'Request failed ('+x.statusCode.toString()+')');}return d;}
  static Future<List<Map<String,dynamic>>> placeAutocomplete(String input,{String? sessionToken})async{
    final q='?input='+Uri.encodeQueryComponent(input)+
        (sessionToken==null?'':'&sessionToken='+Uri.encodeQueryComponent(sessionToken));
    final d=await _request('GET','/places/autocomplete'+q);
    return d is Map&&d['suggestions'] is List
        ?(d['suggestions'] as List).map((e)=>Map<String,dynamic>.from(e as Map)).toList()
        :[];
  }
  static Future<Map<String,dynamic>> placeDetails(String placeId,{String? sessionToken})async{
    final q=sessionToken==null?'':'?sessionToken='+Uri.encodeQueryComponent(sessionToken);
    final d=await _request('GET','/places/details/'+Uri.encodeComponent(placeId)+q);
    return Map<String,dynamic>.from(d as Map);
  }
  static Future<Map<String,dynamic>> resolvePlace(String input)async{
    final d=await _request('GET','/places/resolve?input='+Uri.encodeQueryComponent(input));
    return Map<String,dynamic>.from((d as Map)['place'] as Map);
  }
  /// Returns Google Routes distance + traffic-aware duration + encoded polyline.
  static Future<Map<String,dynamic>> computeRoute(double originLat,double originLng,double destinationLat,double destinationLng)async{
    final d=await _request('POST','/routes/compute',body:{
      'origin':{'lat':originLat,'lng':originLng},
      'destination':{'lat':destinationLat,'lng':destinationLng},
    });
    return Map<String,dynamic>.from(d as Map);
  }
  static WebSocketChannel realtimeChannel(String token){
    final base=apiBase.replaceFirst('https://','wss://').replaceFirst('/api','/api/realtime');
    return WebSocketChannel.connect(Uri.parse(base+'?token='+Uri.encodeQueryComponent(token)));
  }
  static Future<void> login(String role,String phone,String password)async{final path=role=='customer'?'/auth/customer/login':'/auth/provider/login';final d=await _request('POST',path,body:{'phone':phone,'password':password});if(d is! Map||d['token']==null||d['user'] is! Map)throw Exception('Invalid login response');await saveSession(d['token'].toString(),Map<String,dynamic>.from(d['user']),role);}
  static Future<void> registerCustomer(String name,String phone,String password)=>_request('POST','/auth/customer/register',body:{'name':name,'phone':phone,'password':password});
  static Future<void> registerProvider(String name,String phone,String type,String password,{List<String> serviceCategories=const []})=>_request('POST','/providers/register',body:{'name':name,'phone':phone,'type':type,'password':password,'service_categories':serviceCategories});
  static Future<void> forgotPassword(String role,String phone)=>_request('POST',role=='customer'?'/auth/customer/forgot-password':'/auth/provider/forgot-password',body:{'phone':phone});
  static Future<List<Map<String,dynamic>>> customerBookings(String token)async{final d=await _request('GET','/bookings/mine',token:token);return d is List?d.map((e)=>Map<String,dynamic>.from(e as Map)).toList():[];}
  static Future<List<Map<String,dynamic>>> providerBookings(String token)async{final d=await _request('GET','/bookings/mine/provider',token:token);return d is List?d.map((e)=>Map<String,dynamic>.from(e as Map)).toList():[];}
  static Future<Map<String,dynamic>> createBooking(String token,{required String providerType,required String pickup,required String drop,required double lat,required double lng,double? destinationLat,double? destinationLng,double? fare,double? distanceKm,String serviceType='ride',String? serviceCategory,String? serviceDescription})async=>Map<String,dynamic>.from(await _request('POST','/bookings',token:token,body:{'service_type':serviceType,'provider_type':providerType,'pickup_location':pickup,'drop_or_service_address':drop,'pickup_lat':lat,'pickup_lng':lng,if(destinationLat!=null)'drop_lat':destinationLat,if(destinationLng!=null)'drop_lng':destinationLng,if(fare!=null)'estimated_fare':fare,if(distanceKm!=null)'route_distance_km':distanceKm,if(serviceCategory!=null)'service_category':serviceCategory,if(serviceDescription!=null)'service_description':serviceDescription}) as Map);
  static Future<void> cancelBooking(String token,int id)=>_request('POST','/bookings/'+id.toString()+'/cancel',token:token);
  static Future<void> rateBooking(String token,int id,int rating,String comment)=>_request('POST','/bookings/'+id.toString()+'/rate',token:token,body:{'rating':rating,'comment':comment});
  static Future<Map<String,dynamic>> providerMe(String token)async=>Map<String,dynamic>.from(await _request('GET','/providers/me',token:token) as Map);
  static Future<void> updateProviderLocation(String token,int id,double lat,double lng)=>_request('PATCH','/providers/'+id.toString()+'/location',token:token,body:{'lat':lat,'lng':lng});
  static Future<Map<String,dynamic>> setAvailability(String token,int id,bool v)async=>Map<String,dynamic>.from(await _request('PATCH','/providers/'+id.toString()+'/availability',token:token,body:{'is_available':v}) as Map);
  static Future<List<Map<String,dynamic>>> plans()async{final d=await _request('GET','/subscriptions/plans');return d is List?d.map((e)=>Map<String,dynamic>.from(e as Map)).toList():[];}
  static Future<Map<String,dynamic>?> subscription(String token,int id)async{try{return Map<String,dynamic>.from(await _request('GET','/subscriptions/status/'+id.toString(),token:token) as Map);}catch(_){return null;}}
  static Future<Map<String,dynamic>> subscribe(String token,int planId)async=>Map<String,dynamic>.from(await _request('POST','/subscriptions/subscribe',token:token,body:{'plan_id':planId}) as Map);
  static Future<Map<String,dynamic>> acceptBooking(String token,int id)async=>Map<String,dynamic>.from(await _request('POST','/bookings/'+id.toString()+'/accept',token:token) as Map);
  static Future<void> declineBooking(String token,int id)=>_request('POST','/bookings/'+id.toString()+'/decline',token:token);
  static Future<Map<String,dynamic>> startBooking(String token,int id,String pin)async=>Map<String,dynamic>.from(await _request('POST','/bookings/'+id.toString()+'/start',token:token,body:{'pin':pin}) as Map);
  static Future<Map<String,dynamic>> markArrived(String token,int id)async=>Map<String,dynamic>.from(await _request('POST','/bookings/'+id.toString()+'/arrived',token:token) as Map);
  static Future<Map<String,dynamic>> confirmPayment(String token,int id,double fare)async=>Map<String,dynamic>.from(await _request('POST','/bookings/'+id.toString()+'/confirm-payment',token:token,body:{'fare_amount':fare}) as Map);
  static Future<Map<String,dynamic>> uploadProviderDocument(String token,int id,String docType,String path)async{
    final q=http.MultipartRequest('POST',Uri.parse(apiBase+'/providers/'+id.toString()+'/documents'));q.headers['Authorization']='Bearer '+token;q.fields['doc_type']=docType;q.files.add(await http.MultipartFile.fromPath('file',path));final r=await q.send().timeout(const Duration(seconds:60));final body=await r.stream.bytesToString();dynamic d;try{d=jsonDecode(body);}catch(_){d={};}if(r.statusCode<200||r.statusCode>=300){if(r.statusCode==401)await clearSession();throw Exception(d is Map?(d['error']??d['message'])?.toString()??'Upload failed':'Upload failed');}if(d is! Map)throw Exception('Invalid upload response from server');return Map<String,dynamic>.from(d);
  }
}