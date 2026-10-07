import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:web_socket_channel/web_socket_channel.dart';
import 'package:geolocator/geolocator.dart';
import 'package:http/http.dart' as http;
import 'api_service.dart';

const gfOrange=Color(0xFF12B85F),gfNavy=Color(0xFF10213F),gfMuted=Color(0xFF728097),gfBg=Color(0xFFF4F7FB),gfLine=Color(0xFFE4E9F1),gfGreen=Color(0xFF12B85F);

class ReferenceCustomerHome extends StatefulWidget{
 final Session session;final Future<void> Function() onLogout;
 const ReferenceCustomerHome({super.key,required this.session,required this.onLogout});
 @override State<ReferenceCustomerHome> createState()=>_ReferenceCustomerHomeState();
}
class _ReferenceCustomerHomeState extends State<ReferenceCustomerHome>{
 List<Map<String,dynamic>> bookings=[];Timer? timer;bool loading=true;
 @override void initState(){super.initState();load();timer=Timer.periodic(const Duration(seconds:5),(_)=>load(silent:true));}
 @override void dispose(){timer?.cancel();super.dispose();}
 Future<void> load({bool silent=false})async{try{final b=await ApiService.customerBookings(widget.session.token);if(mounted)setState((){bookings=b;loading=false;});}catch(e){if(mounted&&!silent)_snack(e.toString());}}
 void _snack(String s)=>ScaffoldMessenger.of(context).showSnackBar(SnackBar(content:Text(s.replaceFirst('Exception: ',''))));
 @override Widget build(BuildContext c){if(loading)return const Scaffold(body:Center(child:CircularProgressIndicator()));return Scaffold(backgroundColor:gfBg,body:SafeArea(child:RefreshIndicator(onRefresh:load,child:ListView(padding:const EdgeInsets.fromLTRB(14,8,14,28),children:[
  _Top(role:'Customer',logout:widget.onLogout),const SizedBox(height:10),_Hero(name:widget.session.userName??'there'),const SizedBox(height:16),
  const _Title(kicker:'RIDE',title:'Where are you going?'),const SizedBox(height:10),
  _RideCard(session:widget.session,onChanged:load),const SizedBox(height:18),
  const _Title(kicker:'HOME SERVICES',title:'Help at your doorstep'),const SizedBox(height:10),_Services(onTap:(t)=>Navigator.push(c,MaterialPageRoute(builder:(_)=>ReferenceBookingPage(session:widget.session,type:t,onChanged:load)))),const SizedBox(height:18),
  const _Title(kicker:'ACTIVITY',title:'Recent bookings'),const SizedBox(height:10),
  if(bookings.isEmpty)const _Box(child:Text('No bookings yet. Your rides and services will appear here.')) else ...bookings.take(5).map((b)=>_Booking(b:b,session:widget.session,onChanged:load)),
  const SizedBox(height:12),const _Trust(),
 ]))));
}
}

class ReferenceProviderHome extends StatefulWidget{
 final Session session;final Future<void> Function() onLogout;
 const ReferenceProviderHome({super.key,required this.session,required this.onLogout});
 @override State<ReferenceProviderHome> createState()=>_ReferenceProviderHomeState();
}
class _ReferenceProviderHomeState extends State<ReferenceProviderHome>{
 Map<String,dynamic>? me;List<Map<String,dynamic>> jobs=[];Timer? timer;bool busy=false;bool locationBusy=false;
 @override void initState(){super.initState();load();timer=Timer.periodic(const Duration(seconds:4),(_)=>load(silent:true));}
 @override void dispose(){timer?.cancel();super.dispose();}
 Future<void> load({bool silent=false})async{try{final m=await ApiService.providerMe(widget.session.token);final j=await ApiService.providerBookings(widget.session.token);final id=int.tryParse(m['id']?.toString()??'');if(m['is_available']==true&&id!=null)await _location(id);if(mounted)setState((){me=m;jobs=j;});}catch(e){if(mounted&&!silent)_snack(e.toString());}}
 Future<void> _location(int id)async{
  if(locationBusy)return;
  locationBusy=true;
  try{
    if(!await Geolocator.isLocationServiceEnabled())return;
    var p=await Geolocator.checkPermission();
    if(p==LocationPermission.denied)p=await Geolocator.requestPermission();
    if(p==LocationPermission.denied||p==LocationPermission.deniedForever)return;
    final x=await Geolocator.getCurrentPosition(
      locationSettings:const LocationSettings(
        accuracy:LocationAccuracy.high,
        distanceFilter:10,
      ),
    );
    await ApiService.updateProviderLocation(widget.session.token,id,x.latitude,x.longitude);
  }catch(_){}
  finally{locationBusy=false;}
}
 Future<void> toggle()async{if(me==null)return;final id=int.tryParse(me!['id']?.toString()??'');if(id==null)return;if(me!['kyc_status']=='approved'){_snack('KYC approval is required before going online.');return;}setState(()=>busy=true);try{if(me!['is_available']==true){final x=await ApiService.setAvailability(widget.session.token,id,false);if(mounted)setState(()=>me=x);}else{await _location(id);final x=await ApiService.setAvailability(widget.session.token,id,true);if(mounted)setState(()=>me=x);}}catch(e){_snack(e.toString());}finally{if(mounted)setState(()=>busy=false);}}
 void _snack(String s)=>ScaffoldMessenger.of(context).showSnackBar(SnackBar(content:Text(s.replaceFirst('Exception: ',''))));
 @override Widget build(BuildContext c){final m=me??{};final requested=jobs.where((j)=>j['status']=='requested').toList();final active=jobs.where((j)=>j['status']=='accepted'||j['status']=='ongoing').toList();final rides=int.tryParse(m['today_rides']?.toString()??'')??0;final earned=double.tryParse(m['total_earned_this_cycle']?.toString()??'0')??0;final rating=double.tryParse(m['avg_rating']?.toString()??'0')??0;return Scaffold(backgroundColor:gfBg,body:SafeArea(child:RefreshIndicator(onRefresh:load,child:ListView(padding:const EdgeInsets.fromLTRB(14,8,14,28),children:[
  _Top(role:'Partner',online:m['is_available']==true,onOnline:busy?null:toggle,logout:widget.onLogout),const SizedBox(height:10),_Partner(m:m),const SizedBox(height:10),
  Row(children:[Expanded(child:_Stat('Today Rides',rides.toString(),Icons.route)),const SizedBox(width:8),Expanded(child:_Stat('Earnings','₹'+earned.toStringAsFixed(0),Icons.account_balance_wallet)),const SizedBox(width:8),Expanded(child:_Stat('Rating',rating==0?'—':rating.toStringAsFixed(1),Icons.star))]),
  const SizedBox(height:12),const _Keep(),const SizedBox(height:16),const _Title(kicker:'LIVE',title:'Incoming bookings'),const SizedBox(height:10),
  if(requested.isNotEmpty)...requested.take(2).map((j)=>_Incoming(session:widget.session,b:j,changed:load)) else if(active.isEmpty)const _Waiting() else ...active.map((j)=>_Active(session:widget.session,b:j,changed:load)),
 ]))));
}
}

class ReferenceBookingPage extends StatefulWidget{
 final Session session;final String type;final Future<void> Function({bool silent}) onChanged;
 const ReferenceBookingPage({super.key,required this.session,this.type='bike',required this.onChanged});
 @override State<ReferenceBookingPage> createState()=>_ReferenceBookingPageState();
}
class _ReferenceBookingPageState extends State<ReferenceBookingPage>{
 GoogleMapController? mapController;
 final dest=TextEditingController();String type='bike',pickup='Use my current location';Position? pos;Map<String,dynamic>? place;bool get isService=>type=='general_worker'||type=='skilled_worker';List<Map<String,dynamic>> suggestions=[];Set<Polyline> routePolylines={};LatLng? destinationPoint;double? km,fare;bool busy=false;Timer? debounce;
 @override void initState(){super.initState();type=widget.type;}
 @override void dispose(){debounce?.cancel();dest.dispose();super.dispose();}
 Future<void>locate()async{setState(()=>busy=true);try{if(!await Geolocator.isLocationServiceEnabled())throw Exception('Please turn on Location Services.');var p=await Geolocator.checkPermission();if(p==LocationPermission.denied)p=await Geolocator.requestPermission();if(p==LocationPermission.denied||p==LocationPermission.deniedForever)throw Exception('Location permission is required.');final x=await Geolocator.getCurrentPosition(locationSettings:const LocationSettings(accuracy:LocationAccuracy.high));final a=await _reverse(x.latitude,x.longitude);if(mounted){setState((){pos=x;pickup=a;});_centerMap(LatLng(x.latitude,x.longitude),16);}}catch(e){_snack(e.toString());}finally{if(mounted)setState(()=>busy=false);}}
 void search(String v){debounce?.cancel();place=null;final q=v.trim();if(q.length<2){setState(()=>suggestions=[]);return;}debounce=Timer(const Duration(milliseconds:350),()async{try{final s=await ApiService.placeAutocomplete(q);if(mounted&&dest.text.trim()==q)setState(()=>suggestions=s);}catch(_){}});}
 Future<void>select(Map<String,dynamic>s)async{final id=s['placeId']?.toString();if(id==null||id.isEmpty)return;setState(()=>busy=true);try{final d=await ApiService.placeDetails(id);if(mounted)setState((){place=d;dest.text=d['address']?.toString()??s['text']?.toString()??'';suggestions=[];});}catch(e){_snack(e.toString());}finally{if(mounted)setState(()=>busy=false);}}
 Future<void>calculate()async{if(pos==null)await locate();if(pos==null||dest.text.trim().isEmpty)return;setState(()=>busy=true);try{final p=place??await ApiService.resolvePlace(dest.text.trim());final a=double.tryParse(p['lat']?.toString()??''),b=double.tryParse(p['lng']?.toString()??'');if(a==null||b==null)throw Exception('Destination not found.');if(isService){if(mounted)setState((){place=p;routePolylines={};destinationPoint=null;km=null;fare=null;});return;}final r=await ApiService.computeRoute(pos!.latitude,pos!.longitude,a,b);final d=(r['distanceMeters']as num).toDouble()/1000;final points=_decodeGooglePolyline(r['encodedPolyline']?.toString()??'');if(points.length<2)throw Exception('No route found.');if(mounted)setState((){place=p;km=d;fare=_fare(type,d);destinationPoint=LatLng(a,b);routePolylines={Polyline(polylineId:const PolylineId('gofixo-route'),points:points,color:gfOrange,width:6)};});}catch(e){_snack(e.toString());}finally{if(mounted)setState(()=>busy=false);}}
 Future<void>_centerMap(LatLng p,double zoom)async{try{await mapController?.animateCamera(CameraUpdate.newCameraPosition(CameraPosition(target:p,zoom:zoom)));}catch(_){}}
 Future<void>_fitMapToPoints()async{if(pos==null&&destinationPoint==null)return;try{if(pos!=null&&destinationPoint!=null){final a=pos!,b=destinationPoint!;final sw=LatLng(a.latitude<b.latitude?a.latitude:b.latitude,a.longitude<b.longitude?a.longitude:b.longitude);final ne=LatLng(a.latitude>b.latitude?a.latitude:b.latitude,a.longitude>b.longitude?a.longitude:b.longitude);await mapController?.animateCamera(CameraUpdate.newLatLngBounds(LatLngBounds(southwest:sw,northeast:ne),70));}else if(destinationPoint!=null){await _centerMap(destinationPoint!,15);}}catch(_){}
}
 double _fare(String t,double d){final base=t=='bike'?30:t=='auto'?40:60;final min=base;final slabs=t=='bike'?[[10,6],[20,5.5],[30,5],[50,4.5],[double.infinity,4.5]]:t=='auto'?[[10,7.5],[20,6.5],[30,6],[50,5.5],[double.infinity,5.5]]:[[10,9.5],[20,9],[30,8],[50,6.5],[100,5],[double.infinity,2.5]];var left=d,prev=0.0,total=0.0;for(final x in slabs){final limit=x[0]as double,rate=x[1]as double;final take=left<=0?0.0:(left<limit-prev?left:limit-prev);if(take>0)total+=take*rate;left-=take;prev=limit;if(left<=0)break;}return (base+total).clamp(min,double.infinity).roundToDouble();}
 Future<void>book()async{
  if(pos==null)return;
  if(!isService&&(km==null||fare==null))return;
  final address=place?['address']?.toString()??dest.text.trim();
  if(address.trim().isEmpty){_snack('Please enter the destination or service address.');return;}
  setState(()=>busy=true);
  try{
    await ApiService.createBooking(
      widget.session.token,
      providerType:type,
      pickup:pickup,
      drop:address,
      lat:pos!.latitude,
      lng:pos!.longitude,
      fare:isService?null:fare,
      distanceKm:isService?null:km,
      serviceType:isService?'services':'ride',
    );
    if(mounted){Navigator.pop(context);await widget.onChanged();}
  }catch(e){_snack(e.toString());}
  finally{if(mounted)setState(()=>busy=false);}
}
 void _snack(String s)=>ScaffoldMessenger.of(context).showSnackBar(SnackBar(content:Text(s.replaceFirst('Exception: ',''))));
 @override Widget build(BuildContext c)=>Scaffold(backgroundColor:gfBg,appBar:AppBar(title:Text(isService?'Request service':'Book a ride'),backgroundColor:gfBg,elevation:0),body:ListView(padding:const EdgeInsets.all(14),children:[
  if(!isService)Row(children:[Expanded(child:_Choice('Bike','bike',Icons.two_wheeler,type,(v)=>setState(()=>type=v))),const SizedBox(width:7),Expanded(child:_Choice('Auto','auto',Icons.electric_rickshaw,type,(v)=>setState(()=>type=v))),const SizedBox(width:7),Expanded(child:_Choice('Car','car',Icons.directions_car,type,(v)=>setState(()=>type=v)))]) else Container(padding:const EdgeInsets.all(14),decoration:BoxDecoration(color:Colors.white,border:Border.all(color:gfLine),borderRadius:BorderRadius.circular(18)),child:Text(type=='skilled_worker'?'Skilled Expert Service':'Home Help Service',style:const TextStyle(fontWeight:FontWeight.w800,color:gfNavy))),const SizedBox(height:12),
  Padding(padding:const EdgeInsets.only(top:12),child:ClipRRect(borderRadius:BorderRadius.circular(22),child:SizedBox(height:330,child:Stack(children:[GoogleMap(initialCameraPosition:CameraPosition(target:pos!=null?LatLng(pos!.latitude,pos!.longitude):const LatLng(28.6139,77.2090),zoom:15),onMapCreated:(m){mapController=m;if(pos!=null)_centerMap(LatLng(pos!.latitude,pos!.longitude),16);},myLocationEnabled:true,myLocationButtonEnabled:false,zoomControlsEnabled:false,markers:{if(pos!=null)Marker(markerId:const MarkerId('pickup'),position:LatLng(pos!.latitude,pos!.longitude),infoWindow:const InfoWindow(title:'Your location')),if(destinationPoint!=null)Marker(markerId:const MarkerId('drop'),position:destinationPoint!,infoWindow:const InfoWindow(title:'Destination'))},polylines:routePolylines),Positioned(top:12,left:12,right:12,child:Container(padding:const EdgeInsets.symmetric(horizontal:12,vertical:10),decoration:BoxDecoration(color:Colors.white,borderRadius:BorderRadius.circular(16),boxShadow:const[BoxShadow(color:Color(0x22000000),blurRadius:12)]),child:Row(children:[const Icon(Icons.my_location,color:gfGreen,size:19),const SizedBox(width:8),Expanded(child:Text(pos==null?'Detecting your location...':pickup,maxLines:1,overflow:TextOverflow.ellipsis,style:const TextStyle(fontSize:11,fontWeight:FontWeight.w800,color:gfNavy))),TextButton(onPressed:busy?null:locate,child:const Text('Use current'))]))),Positioned(bottom:12,left:12,right:12,child:Container(padding:const EdgeInsets.symmetric(horizontal:12,vertical:11),decoration:BoxDecoration(color:Colors.white,borderRadius:BorderRadius.circular(16),boxShadow:const[BoxShadow(color:Color(0x22000000),blurRadius:12)]),child:Row(children:[const Icon(Icons.search,color:gfGreen,size:20),const SizedBox(width:8),Expanded(child:Text(dest.text.trim().isEmpty?'Search destination':dest.text,maxLines:1,overflow:TextOverflow.ellipsis,style:const TextStyle(fontSize:12,fontWeight:FontWeight.w800,color:gfNavy))),if(destinationPoint!=null)const Icon(Icons.check_circle,color:gfGreen,size:19)])))])))),
  _Location(pickup:pickup,onTap:busy?null:locate),const SizedBox(height:10),
  TextField(controller:dest,onChanged:search,decoration:InputDecoration(filled:true,fillColor:Colors.white,prefixIcon:const Icon(Icons.search,color:gfGreen),labelText:'WHERE TO?',hintText:'Search destination, landmark or PIN code',border:OutlineInputBorder(borderRadius:BorderRadius.circular(18)))),
  if(suggestions.isNotEmpty)Container(color:Colors.white,child:Column(children:suggestions.take(5).map((s)=>ListTile(leading:const Icon(Icons.place,color:gfOrange),title:Text(s['mainText']?.toString()??s['text']?.toString()??''),subtitle:Text(s['secondaryText']?.toString()??''),onTap:busy?null:()=>select(s))).toList())),
  const SizedBox(height:12),FilledButton.icon(style:FilledButton.styleFrom(backgroundColor:gfOrange,minimumSize:const Size.fromHeight(52)),onPressed:busy?null:calculate,icon:Icon(isService?Icons.handyman:Icons.alt_route),label:Text(isService?'Request service':'Show route & fare')),

  if(isService&&place!=null)Padding(padding:const EdgeInsets.only(top:12),child:_Box(child:Row(children:[Expanded(child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[const Text('SERVICE REQUEST',style:TextStyle(fontSize:9,fontWeight:FontWeight.w800,color:gfGreen)),Text(type=='skilled_worker'?'Skilled expert at your location':'Home help at your location',style:const TextStyle(fontSize:16,fontWeight:FontWeight.w900,color:gfNavy)),Text(place!['address']?.toString()??dest.text,maxLines:2,overflow:TextOverflow.ellipsis,style:const TextStyle(fontSize:10,color:gfMuted))])),FilledButton(style:FilledButton.styleFrom(backgroundColor:gfGreen),onPressed:busy?null:book,child:const Text('Request'))]))),
  if(!isService&&fare!=null)Padding(padding:const EdgeInsets.only(top:12),child:Container(padding:const EdgeInsets.all(16),decoration:BoxDecoration(color:const Color(0xFFEFFFF5),borderRadius:BorderRadius.circular(20)),child:Row(children:[Expanded(child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[const Text('ESTIMATED FARE',style:TextStyle(fontSize:9,fontWeight:FontWeight.w800,color:gfGreen)),Text('₹'+fare!.toStringAsFixed(0),style:const TextStyle(fontSize:28,fontWeight:FontWeight.w900,color:gfNavy)),Text(km!.toStringAsFixed(1)+' km · '+type.toUpperCase(),style:const TextStyle(fontSize:11,color:gfMuted))])),FilledButton(style:FilledButton.styleFrom(backgroundColor:gfGreen),onPressed:busy?null:book,child:const Text('Confirm ride'))]))),
 ]));
}
class _Top extends StatelessWidget{final String role;final bool online;final VoidCallback? onOnline;final Future<void> Function() logout;const _Top({required this.role,this.online=false,this.onOnline,required this.logout});@override Widget build(BuildContext c)=>Row(children:[Container(width:38,height:42,decoration:BoxDecoration(color:gfOrange,borderRadius:BorderRadius.circular(13)),child:const Icon(Icons.location_on,color:Colors.white)),const SizedBox(width:9),const Expanded(child:Text('Gofixo',style:TextStyle(fontSize:25,fontWeight:FontWeight.w900,color:gfNavy))),if(onOnline!=null)GestureDetector(onTap:onOnline,child:Container(padding:const EdgeInsets.symmetric(horizontal:11,vertical:8),decoration:BoxDecoration(color:online?const Color(0xFFDFF9E9):const Color(0xFFEFF2F6),borderRadius:BorderRadius.circular(30)),child:Text(online?'Online':'Offline',style:TextStyle(fontSize:11,fontWeight:FontWeight.w800,color:online?gfGreen:gfMuted))))else Container(padding:const EdgeInsets.symmetric(horizontal:10,vertical:7),decoration:BoxDecoration(color:Colors.white,border:Border.all(color:gfLine),borderRadius:BorderRadius.circular(30)),child:Text(role,style:const TextStyle(fontSize:10,fontWeight:FontWeight.w800,color:gfMuted))),PopupMenuButton<String>(onSelected:(v){if(v=='logout')logout();},itemBuilder:(_)=>const[PopupMenuItem(value:'logout',child:Text('Log out'))])]);}
class _Hero extends StatelessWidget{final String name;const _Hero({required this.name});@override Widget build(BuildContext c)=>Container(padding:const EdgeInsets.fromLTRB(16,16,12,12),decoration:BoxDecoration(borderRadius:BorderRadius.circular(28),gradient:const LinearGradient(colors:[Colors.white,Color(0xFFEFFFF5)]),border:Border.all(color:gfLine)),child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[const Text('YOUR CITY. YOUR SERVICES.',style:TextStyle(fontSize:10,letterSpacing:1.5,fontWeight:FontWeight.w900,color:gfGreen)),const SizedBox(height:6),Text('Hello $name 👋',style:const TextStyle(fontSize:27,fontWeight:FontWeight.w900,color:gfNavy)),const SizedBox(height:4),const Text('Fast rides, trusted partners and everyday services in one place.',style:TextStyle(fontSize:12,height:1.35,color:gfMuted)),const SizedBox(height:10),SizedBox(height:126,child:Row(children:[Expanded(child:_PhotoCard('https://images.unsplash.com/photo-1679465427762-38cfdba8e2fb?auto=format&fit=crop&w=900&q=85','Bike')),Expanded(child:_PhotoCard('https://images.unsplash.com/photo-1626149637281-4e227308da18?auto=format&fit=crop&w=900&q=85','Auto')),Expanded(child:_PhotoCard('https://images.unsplash.com/photo-1685019718640-6e562edc365e?auto=format&fit=crop&w=900&q=85','Car'))]))]));}
class _PhotoCard extends StatelessWidget{final String url,label;const _PhotoCard(this.url,this.label);@override Widget build(BuildContext c)=>Padding(padding:const EdgeInsets.symmetric(horizontal:3),child:Column(children:[Expanded(child:ClipRRect(borderRadius:BorderRadius.circular(16),child:Image.network(url,fit:BoxFit.cover,width:double.infinity,errorBuilder:(_,__,___)=>const ColoredBox(color:Color(0xFFE8EEF5),child:Icon(Icons.image_not_supported_outlined))))),const SizedBox(height:5),Text(label,style:const TextStyle(fontSize:9,fontWeight:FontWeight.w900,color:gfNavy))]));}
class _Partner extends StatelessWidget{final Map<String,dynamic>m;const _Partner({required this.m});@override Widget build(BuildContext c)=>Container(padding:const EdgeInsets.all(16),decoration:BoxDecoration(color:Colors.white,border:Border.all(color:gfLine),borderRadius:BorderRadius.circular(22)),child:Row(children:[Container(width:58,height:58,padding:const EdgeInsets.all(4),decoration:const BoxDecoration(shape:BoxShape.circle,color:Color(0xFFEFFFF5)),child:ClipOval(child:Image.network('https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=300&q=85',fit:BoxFit.cover,errorBuilder:(_,__,___)=>const Icon(Icons.person,color:gfGreen,size:34)))),const SizedBox(width:12),Expanded(child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[const Text('PARTNER PROFILE',style:TextStyle(fontSize:9,fontWeight:FontWeight.w900,color:gfGreen)),Text(m['name']?.toString()??'Partner',style:const TextStyle(fontSize:19,fontWeight:FontWeight.w900,color:gfNavy)),Text((m['type']?.toString()??'partner').replaceAll('_',' ')+' · '+(m['generated_id']?.toString()??''),style:const TextStyle(fontSize:11,color:gfMuted))])),const Icon(Icons.chevron_right,color:gfMuted)]));}
class _RideCard extends StatelessWidget{final Session session;final Future<void> Function({bool silent}) onChanged;const _RideCard({required this.session,required this.onChanged});@override Widget build(BuildContext c)=>Container(padding:const EdgeInsets.all(14),decoration:BoxDecoration(color:Colors.white,border:Border.all(color:gfLine),borderRadius:BorderRadius.circular(22),boxShadow:const[BoxShadow(color:Color(0x0D10213F),blurRadius:16,offset:Offset(0,6))]),child:Column(children:[Row(children:[const Icon(Icons.location_on_rounded,color:gfGreen,size:27),const SizedBox(width:8),const Expanded(child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[Text('Where are you going?',style:TextStyle(fontSize:15,fontWeight:FontWeight.w900,color:gfNavy)),Text('Live location · Bike · Auto · Car',style:TextStyle(fontSize:10,color:gfMuted))])),FilledButton(style:FilledButton.styleFrom(backgroundColor:gfGreen),onPressed:()=>Navigator.push(c,MaterialPageRoute(builder:(_)=>ReferenceBookingPage(session:session,onChanged:onChanged))),child:const Text('Book'))]),const SizedBox(height:9),SizedBox(height:92,child:Row(children:[Expanded(child:_PhotoCard('https://images.unsplash.com/photo-1679465427762-38cfdba8e2fb?auto=format&fit=crop&w=900&q=85','Bike')),Expanded(child:_PhotoCard('https://images.unsplash.com/photo-1626149637281-4e227308da18?auto=format&fit=crop&w=900&q=85','Auto')),Expanded(child:_PhotoCard('https://images.unsplash.com/photo-1685019718640-6e562edc365e?auto=format&fit=crop&w=900&q=85','Car'))]))]));}
class _Services extends StatelessWidget{final ValueChanged<String> onTap;const _Services({required this.onTap});@override Widget build(BuildContext c)=>GridView.count(crossAxisCount:4,crossAxisSpacing:7,mainAxisSpacing:9,childAspectRatio:.72,shrinkWrap:true,physics:const NeverScrollableScrollPhysics(),children:[_Service('https://images.unsplash.com/photo-1621905252507-b35492cc74b4?auto=format&fit=crop&w=500&q=80','Electrician',()=>onTap('skilled_worker')),_Service('https://images.unsplash.com/photo-1607472586893-edb57bdc0e39?auto=format&fit=crop&w=500&q=80','Plumber',()=>onTap('skilled_worker')),_Service('https://images.unsplash.com/photo-1581578731548-c64695cc6952?auto=format&fit=crop&w=500&q=80','AC Service',()=>onTap('skilled_worker')),_Service('https://images.unsplash.com/photo-1581578731548-c64695cc6952?auto=format&fit=crop&w=500&q=80','Cleaning',()=>onTap('general_worker')),_Service('https://images.unsplash.com/photo-1562259949-e8e7689d7828?auto=format&fit=crop&w=500&q=80','Painter',()=>onTap('skilled_worker')),_Service('https://images.unsplash.com/photo-1601058268499-e52658a84c9d?auto=format&fit=crop&w=500&q=80','Carpenter',()=>onTap('skilled_worker')),_Service('https://images.unsplash.com/photo-1581092160607-ee22621dd758?auto=format&fit=crop&w=500&q=80','Appliance Repair',()=>onTap('skilled_worker')),_Service('https://images.unsplash.com/photo-1521791055366-0d553872125f?auto=format&fit=crop&w=500&q=80','More Services',()=>onTap('general_worker'))]);}
class _Service extends StatelessWidget {
  final String url;
  final String label;
  final VoidCallback tap;
  const _Service(this.url, this.label, this.tap);
  @override
  Widget build(BuildContext c) {
    return InkWell(
      onTap: tap,
      borderRadius: BorderRadius.circular(16),
      child: Container(
        padding: const EdgeInsets.all(5),
        decoration: BoxDecoration(
          color: Colors.white,
          border: Border.all(color: gfLine),
          borderRadius: BorderRadius.circular(16),
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Expanded(
              child: ClipRRect(
                borderRadius: BorderRadius.circular(12),
                child: Image.network(
                  url,
                  fit: BoxFit.cover,
                  width: double.infinity,
                  errorBuilder: (_, __, ___) => const ColoredBox(
                    color: Color(0xFFE8EEF5),
                    child: Icon(Icons.handyman_outlined),
                  ),
                ),
              ),
            ),
            const SizedBox(height: 4),
            Text(
              label,
              textAlign: TextAlign.center,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 8, fontWeight: FontWeight.w900, color: gfNavy),
            ),
          ],
        ),
      ),
    );
  }
}

class _Choice extends StatelessWidget{final String label,value;final IconData icon;final String selected;final ValueChanged<String>onTap;const _Choice(this.label,this.value,this.icon,this.selected,this.onTap);String get _url=>value=='bike'?'https://images.unsplash.com/photo-1679465427762-38cfdba8e2fb?auto=format&fit=crop&w=900&q=85':value=='auto'?'https://images.unsplash.com/photo-1626149637281-4e227308da18?auto=format&fit=crop&w=900&q=85':'https://images.unsplash.com/photo-1685019718640-6e562edc365e?auto=format&fit=crop&w=900&q=85';@override Widget build(BuildContext c)=>InkWell(onTap:()=>onTap(value),borderRadius:BorderRadius.circular(15),child:Container(height:112,padding:const EdgeInsets.all(6),decoration:BoxDecoration(color:selected==value?const Color(0xFFEFFFF5):Colors.white,border:Border.all(color:selected==value?gfGreen:gfLine,width:selected==value?1.5:1),borderRadius:BorderRadius.circular(15)),child:Column(children:[Expanded(child:ClipRRect(borderRadius:BorderRadius.circular(11),child:Image.network(_url,fit:BoxFit.cover,width:double.infinity,errorBuilder:(_,__,___)=>Icon(icon,color:gfGreen,size:30)))),Text(label,style:TextStyle(fontSize:10,fontWeight:FontWeight.w900,color:selected==value?gfGreen:gfNavy))])));}
class _Title extends StatelessWidget{
 final String kicker,title;
 const _Title({required this.kicker,required this.title});
 @override Widget build(BuildContext c)=>Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
  Text(kicker,style:const TextStyle(fontSize:8,letterSpacing:1.5,fontWeight:FontWeight.w900,color:gfGreen)),
  Text(title,style:const TextStyle(fontSize:20,fontWeight:FontWeight.w900,color:gfNavy))
 ]);
}
class _Stat extends StatelessWidget{
 final String label,value; final IconData icon;
 const _Stat(this.label,this.value,this.icon);
 @override Widget build(BuildContext c)=>Container(padding:const EdgeInsets.symmetric(vertical:13,horizontal:5),decoration:BoxDecoration(color:Colors.white,border:Border.all(color:gfLine),borderRadius:BorderRadius.circular(17)),child:Column(children:[
  Icon(icon,color:gfGreen,size:18),const SizedBox(height:4),Text(value,maxLines:1,overflow:TextOverflow.ellipsis,style:const TextStyle(fontWeight:FontWeight.w900,color:gfNavy)),Text(label,textAlign:TextAlign.center,style:const TextStyle(fontSize:8,color:gfMuted))
 ]));
}
class _Keep extends StatelessWidget{
 const _Keep();
 @override Widget build(BuildContext c)=>Container(padding:const EdgeInsets.all(15),decoration:BoxDecoration(color:const Color(0xFFFFF7E8),borderRadius:BorderRadius.circular(20)),child:const Row(children:[
  Text('🏆',style:TextStyle(fontSize:24)),SizedBox(width:10),Expanded(child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
   Text('Keep Going!',style:TextStyle(fontWeight:FontWeight.w900,color:gfNavy)),
   Text('Stay online and accept nearby jobs to grow your earnings.',style:TextStyle(fontSize:10,color:gfMuted))
  ]))
 ]));
}
class _Waiting extends StatelessWidget{
 const _Waiting();
 @override Widget build(BuildContext c)=>_Box(child:Column(children:const[
  Icon(Icons.radar,color:gfGreen,size:35),SizedBox(height:7),
  Text('Waiting for your next ride',style:TextStyle(fontWeight:FontWeight.w800,color:gfNavy)),
  Text('Stay online and nearby requests will appear here.',style:TextStyle(fontSize:10,color:gfMuted))
 ]));
}
class _Incoming extends StatelessWidget{
 final Session session; final Map<String,dynamic>b; final Future<void> Function({bool silent}) changed;
 const _Incoming({required this.session,required this.b,required this.changed});
 @override Widget build(BuildContext c){
  final id=int.tryParse(b['id']?.toString()??'')??0;
  return _Box(child:Column(children:[
   Row(children:[const Icon(Icons.notifications_active,color:gfGreen),const SizedBox(width:7),const Expanded(child:Text('New ride request',style:TextStyle(fontSize:16,fontWeight:FontWeight.w900,color:gfNavy))),Text('₹'+(b['fare_amount']??0).toString(),style:const TextStyle(fontWeight:FontWeight.w900))]),
   const SizedBox(height:10),_Route('Pickup',b['pickup_location']?.toString()??''),_Route('Drop',b['drop_or_service_address']?.toString()??''),const SizedBox(height:10),
   Row(children:[
    Expanded(child:OutlinedButton(onPressed:()async{await ApiService.declineBooking(session.token,id);await changed();},child:const Text('Reject'))),
    const SizedBox(width:8),
    Expanded(child:FilledButton(style:FilledButton.styleFrom(backgroundColor:gfGreen),onPressed:()async{try{await ApiService.acceptBooking(session.token,id);await changed();}catch(e){ScaffoldMessenger.of(c).showSnackBar(SnackBar(content:Text(e.toString().replaceFirst('Exception: ',''))));}},child:const Text('Accept')))
   ])
  ]));
 }
}
class _Active extends StatefulWidget{
 final Session session; final Map<String,dynamic>b; final Future<void> Function({bool silent})changed;
 const _Active({required this.session,required this.b,required this.changed});
 @override State<_Active> createState()=>_ActiveState();
}
class _ActiveState extends State<_Active>{
 final pin=TextEditingController(); final fare=TextEditingController(); bool submitting=false;
 @override void initState(){super.initState();fare.text=widget.b['fare_amount']?.toString()??'';}
 @override void dispose(){pin.dispose();fare.dispose();super.dispose();}
 @override Widget build(BuildContext c){
  final id=int.tryParse(widget.b['id']?.toString()??'')??0;final ongoing=widget.b['status']=='ongoing';
  return _Box(child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
   Text(ongoing?'TRIP IN PROGRESS':'ON THE WAY',style:const TextStyle(fontSize:9,fontWeight:FontWeight.w800,color:gfGreen)),
   const SizedBox(height:4),Text(ongoing?'Confirm payment to complete':'Start with customer PIN',style:const TextStyle(fontSize:18,fontWeight:FontWeight.w900,color:gfNavy)),
   const SizedBox(height:10),_Route('Pickup',widget.b['pickup_location']?.toString()??''),
   if(!ongoing)TextField(controller:pin,maxLength:4,keyboardType:TextInputType.number,onChanged:(_)=>setState((){}),decoration:const InputDecoration(labelText:'Customer 4-digit PIN')),
   if(!ongoing)SizedBox(width:double.infinity,child:FilledButton(style:FilledButton.styleFrom(backgroundColor:gfGreen),onPressed:pin.text.length==4?()async{try{await ApiService.startBooking(widget.session.token,id,pin.text);await widget.changed();}catch(e){if(mounted)ScaffoldMessenger.of(c).showSnackBar(SnackBar(content:Text(e.toString().replaceFirst('Exception: ',''))));}}:null,child:const Text('Start trip →'))),
   if(ongoing)TextField(controller:fare,keyboardType:const TextInputType.numberWithOptions(decimal:true),decoration:const InputDecoration(labelText:'Final fare ₹')),
   if(ongoing)SizedBox(width:double.infinity,child:FilledButton(style:FilledButton.styleFrom(backgroundColor:gfGreen),onPressed:submitting?null:()async{
      final value=double.tryParse(fare.text.trim());
      if(value==null||value<=0){ScaffoldMessenger.of(c).showSnackBar(const SnackBar(content:Text('Enter a valid final fare.')));return;}
      setState(()=>submitting=true);
      try{await ApiService.confirmPayment(widget.session.token,id,value);await widget.changed();}
      catch(e){if(mounted)ScaffoldMessenger.of(c).showSnackBar(SnackBar(content:Text(e.toString().replaceFirst('Exception: ',''))));}
      finally{if(mounted)setState(()=>submitting=false);}
    },child:Text(submitting?'Saving…':'Confirm payment received →'))),
   const SizedBox(height:6),
   OutlinedButton.icon(onPressed:()=>Navigator.push(c,MaterialPageRoute(builder:(_)=>LiveTrackingPage(session:widget.session,booking:widget.b,isProvider:true))),icon:const Icon(Icons.map_outlined),label:const Text('Open live map'))
  ]));
 }
}
class _Booking extends StatelessWidget{
 final Map<String,dynamic>b; final Session session; final Future<void> Function({bool silent})onChanged;
 const _Booking({required this.b,required this.session,required this.onChanged});
 @override Widget build(BuildContext c){
  final s=b['status']?.toString()??'';final id=b['id']?.toString()??'';
  return Container(margin:const EdgeInsets.only(bottom:8),padding:const EdgeInsets.all(13),decoration:BoxDecoration(color:Colors.white,border:Border.all(color:gfLine),borderRadius:BorderRadius.circular(18)),child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
   Row(children:[Expanded(child:Text('#'+id+' · '+s.toUpperCase(),style:const TextStyle(fontWeight:FontWeight.w800,color:gfNavy))),Text('₹'+(b['fare_amount']??b['estimated_fare']??0).toString(),style:const TextStyle(fontWeight:FontWeight.w900))]),
   Text(b['pickup_location']?.toString()??'',maxLines:1,overflow:TextOverflow.ellipsis),
   Text('→ '+(b['drop_or_service_address']?.toString()??''),maxLines:1,overflow:TextOverflow.ellipsis,style:const TextStyle(color:gfMuted)),
   if(s=='requested'||s=='accepted')Align(alignment:Alignment.centerRight,child:TextButton(onPressed:()async{await ApiService.cancelBooking(session.token,int.tryParse(id)??0);await onChanged();},child:const Text('Cancel'))),
   if(s=='accepted'||s=='ongoing')Align(alignment:Alignment.centerRight,child:OutlinedButton.icon(onPressed:()=>Navigator.push(c,MaterialPageRoute(builder:(_)=>LiveTrackingPage(session:session,booking:b,isProvider:false))),icon:const Icon(Icons.location_searching),label:const Text('Track live')))
  ]));
 }
}
class _Box extends StatelessWidget{
 final Widget child; const _Box({required this.child});
 @override Widget build(BuildContext c)=>Container(padding:const EdgeInsets.all(16),decoration:BoxDecoration(color:Colors.white,border:Border.all(color:gfLine),borderRadius:BorderRadius.circular(20)),child:child);
}
class _Location extends StatelessWidget{
 final String pickup; final VoidCallback? onTap;
 const _Location({required this.pickup,required this.onTap});
 @override Widget build(BuildContext c)=>_Box(child:Row(children:[
  const Icon(Icons.my_location,color:gfGreen),const SizedBox(width:9),Expanded(child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
   const Text('PICKUP',style:TextStyle(fontSize:8,fontWeight:FontWeight.w800,color:gfMuted)),
   Text(pickup,maxLines:2,overflow:TextOverflow.ellipsis,style:const TextStyle(fontSize:12,fontWeight:FontWeight.w700,color:gfNavy))
  ])),IconButton(onPressed:onTap,icon:const Icon(Icons.gps_fixed,color:gfGreen))
 ]));
}
class _Route extends StatelessWidget{final String label,value;const _Route(this.label,this.value);@override Widget build(BuildContext c)=>Padding(padding:const EdgeInsets.only(bottom:7),child:Row(children:[Icon(label=='Pickup'?Icons.my_location:Icons.location_on,color:label=='Pickup'?gfGreen:gfOrange,size:17),const SizedBox(width:7),Expanded(child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[Text(label.toUpperCase(),style:const TextStyle(fontSize:7,color:gfMuted,fontWeight:FontWeight.w800)),Text(value,maxLines:2,overflow:TextOverflow.ellipsis,style:const TextStyle(fontSize:11,fontWeight:FontWeight.w700,color:gfNavy))]))]));}
class _Trust extends StatelessWidget{const _Trust();@override Widget build(BuildContext c)=>Container(padding:const EdgeInsets.all(15),decoration:BoxDecoration(color:gfNavy,borderRadius:BorderRadius.circular(20)),child:const Row(children:[Expanded(child:_T(Icons.verified_user,'Verified')),Expanded(child:_T(Icons.shield,'Safe rides')),Expanded(child:_T(Icons.support_agent,'Support'))]));}
class _T extends StatelessWidget{final IconData i;final String t;const _T(this.i,this.t);@override Widget build(BuildContext c)=>Column(children:[Icon(i,color:Colors.white,size:19),Text(t,style:const TextStyle(color:Colors.white,fontSize:8,fontWeight:FontWeight.w700))]);}

Future<String> _reverse(double lat,double lon)async{try{final u=Uri.https('nominatim.openstreetmap.org','/reverse',{'lat':'$lat','lon':'$lon','format':'json'});final r=await http.get(u,headers:{'User-Agent':'Gofixo/1.0'}).timeout(const Duration(seconds:10));final d=jsonDecode(r.body);return d['display_name']?.toString()??'$lat, $lon';}catch(_){return '$lat, $lon';}}
List<LatLng> _decodeGooglePolyline(String encoded){final points=<LatLng>[];var index=0;var lat=0;var lng=0;while(index<encoded.length){var result=0;var shift=0;int b;do{b=encoded.codeUnitAt(index++)-63;result|=(b&31)<<shift;shift+=5;}while(b>=32&&index<encoded.length);lat+=((result&1)!=0?~(result>>1):(result>>1));result=0;shift=0;do{b=encoded.codeUnitAt(index++)-63;result|=(b&31)<<shift;shift+=5;}while(b>=32&&index<encoded.length);lng+=((result&1)!=0?~(result>>1):(result>>1));points.add(LatLng(lat/1e5,lng/1e5));}return points;}



class LiveTrackingPage extends StatefulWidget{
  final Session session;
  final Map<String,dynamic> booking;
  final bool isProvider;
  const LiveTrackingPage({super.key,required this.session,required this.booking,required this.isProvider});
  @override State<LiveTrackingPage> createState()=>_LiveTrackingPageState();
}
class _LiveTrackingPageState extends State<LiveTrackingPage>{
  WebSocketChannel? channel;
  Timer? gpsTimer;
  LatLng? providerPoint;
  LatLng? pickupPoint;
  String status='';
  @override void initState(){super.initState();status=widget.booking['status']?.toString()??'';final plat=double.tryParse(widget.booking['pickup_lat']?.toString()??'');final plng=double.tryParse(widget.booking['pickup_lng']?.toString()??'');if(plat!=null&&plng!=null)pickupPoint=LatLng(plat,plng);final vlat=double.tryParse(widget.booking['provider_lat']?.toString()??'');final vlng=double.tryParse(widget.booking['provider_lng']?.toString()??'');if(vlat!=null&&vlng!=null)providerPoint=LatLng(vlat,vlng);if(widget.isProvider){_refreshProviderGps();gpsTimer=Timer.periodic(const Duration(seconds:5),(_)=>_refreshProviderGps());}else{_connectRealtime();}}
  @override void dispose(){gpsTimer?.cancel();channel?.sink.close();super.dispose();}
  void _connectRealtime(){try{final ch=ApiService.realtimeChannel(widget.session.token);channel=ch;ch.sink.add(jsonEncode({'type':'subscribe_booking','booking_id':widget.booking['id']}));ch.stream.listen((raw){try{final d=jsonDecode(raw.toString());if(d is Map&&d['type']=='provider_location'){final lat=double.tryParse(d['lat']?.toString()??'');final lng=double.tryParse(d['lng']?.toString()??'');if(lat!=null&&lng!=null&&mounted)setState(()=>providerPoint=LatLng(lat,lng));}}catch(_){}});}catch(_){}} 
  Future<void> _refreshProviderGps()async{try{if(!await Geolocator.isLocationServiceEnabled())return;var p=await Geolocator.checkPermission();if(p==LocationPermission.denied)p=await Geolocator.requestPermission();if(p==LocationPermission.denied||p==LocationPermission.deniedForever)return;final x=await Geolocator.getCurrentPosition(locationSettings:const LocationSettings(accuracy:LocationAccuracy.high));if(mounted)setState(()=>providerPoint=LatLng(x.latitude,x.longitude));}catch(_){}} 
  @override Widget build(BuildContext c){final center=providerPoint??pickupPoint??const LatLng(26.9124,75.7873);final markers=<Marker>{if(pickupPoint!=null)Marker(markerId:const MarkerId('pickup'),position:pickupPoint!,infoWindow:const InfoWindow(title:'Pickup')),if(providerPoint!=null)Marker(markerId:const MarkerId('partner'),position:providerPoint!,icon:BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueGreen),infoWindow:InfoWindow(title:widget.isProvider?'You':'Gofixo Partner'))};return Scaffold(appBar:AppBar(title:Text(widget.isProvider?'Trip map':'Track your partner')),body:Stack(children:[GoogleMap(initialCameraPosition:CameraPosition(target:center,zoom:14),myLocationEnabled:widget.isProvider,myLocationButtonEnabled:true,markers:markers,zoomControlsEnabled:false),Positioned(left:14,right:14,bottom:18,child:Container(padding:const EdgeInsets.all(16),decoration:BoxDecoration(color:Colors.white,borderRadius:BorderRadius.circular(20),boxShadow:const[BoxShadow(color:Color(0x22000000),blurRadius:18)]),child:Row(children:[Container(width:44,height:44,decoration:const BoxDecoration(shape:BoxShape.circle,color:Color(0xFFEFFFF5)),child:const Icon(Icons.two_wheeler,color:gfGreen)),const SizedBox(width:12),Expanded(child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[Text(widget.isProvider?'Live trip':'Partner is on the way',style:const TextStyle(fontWeight:FontWeight.w900,color:gfNavy)),Text(widget.isProvider?'Your GPS is updating every 5 seconds':'Live partner location is connected',style:const TextStyle(fontSize:11,color:gfMuted))]))])))]));}
}
